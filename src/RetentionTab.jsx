import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE  ·  reads sip_retention_matrix directly (table is small, no MV needed)
// ══════════════════════════════════════════════════════════════════════════════
const SB_URL = "https://jjvuilxjkjxhkuhpmlgs.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqdnVpbHhqa2p4aGt1aHBtbGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDE2NTEsImV4cCI6MjA5NTQ3NzY1MX0.amIQrVRGxwuR3yFCRpD0EBx9UF_wAQnb9Ql_wcOQCdM";
async function sb(view, params = "") {
  const res = await fetch(`${SB_URL}/rest/v1/${view}?select=*${params}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${view}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const SOURCES = ["Telecalling", "Marketing", "Null", "Product", "Others"];
const SOURCE_COLORS = {
  Telecalling: "#f97316",
  Marketing:   "#7c3aed",
  Null:        "#94a3b8",
  Product:     "#0ea5e9",
  Others:      "#e11d48",
};
const SOURCE_MAPPING = [
  ["Telecalling", "Telecalling"],
  ["Marketing",   "CRM + DM"],
  ["Null",        "Null"],
  ["Product",     "Platform + Updates + Shares + Referral"],
  ["Others",      "SEO + Social Media + Others"],
];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// Gap-since bucket upper bounds (from the Metabase query definition)
const ENDS = [14, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340, 370];

const f = { fontFamily: "'DM Sans',sans-serif" };
const mono = { fontFamily: "'IBM Plex Mono',ui-monospace,monospace" };
const cd = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" };
const tt = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, ...f, boxShadow: "0 4px 12px rgba(0,0,0,.08)" };

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function moLabel(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  return `${MONTH_NAMES[m-1]} ${y}`;
}
function parseMoLabel(s) {
  const [mn, yr] = s.split(" ");
  return new Date(parseInt(yr, 10), MONTH_NAMES.indexOf(mn), 1);
}
// Compute partial-cell index `p` for a cohort (first Mn whose bucket end > days_since_last_day)
function computeP(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  const lastDay = new Date(y, m, 0);  // day 0 of next month = last day of this month
  const today = new Date();
  const daysSince = Math.floor((today - lastDay) / 86400000);
  for (let i = 0; i < ENDS.length; i++) if (daysSince < ENDS[i]) return i;
  return 13;
}
const avgOf = arr => arr.length ? arr.reduce((s,v)=>s+v,0) / arr.length : null;
const round1 = n => n == null ? null : Math.round(n * 10) / 10;

// Dynamic Y-axis domain from the currently-visible series, rounded to 5s with padding.
// Lets charts "resize" as legend series are toggled on/off.
function visibleDomain(data, keys, fallback){
  let min = Infinity, max = -Infinity;
  data.forEach(d => keys.forEach(k => {
    const v = d[k];
    if (v != null) { if (v < min) min = v; if (v > max) max = v; }
  }));
  if (!isFinite(min)) return fallback;
  const pad = Math.max(2, Math.round((max - min) * 0.1));
  return [Math.max(0, Math.floor((min - pad) / 5) * 5), Math.min(100, Math.ceil((max + pad) / 5) * 5)];
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA MODEL  ·  transform flat rows from Supabase into per-source cohort lists
// ══════════════════════════════════════════════════════════════════════════════
function buildModel(raw) {
  const bySrc = {};
  raw.forEach(r => {
    const p = computeP(r.signup_month);
    const vals = [];
    for (let i = 0; i < 13; i++) {
      const v = r[`m${i}_retention`];
      // Treat 0s in future buckets (i > p) as null (cohort hasn't reached that Mn yet)
      if (i > p) vals.push(null);
      else vals.push(v ?? null);
    }
    (bySrc[r.source] ||= []).push({ mo: moLabel(r.signup_month), date: r.signup_month, n: r.signups, vals, p });
  });
  // Sort each source: newest cohort first
  Object.keys(bySrc).forEach(s => bySrc[s].sort((a,b) => b.date.localeCompare(a.date)));
  return bySrc;
}

// For a given Mn + vintage (yearsBack) + window size, return avg + window label + count
function vintageAtMn(rows, mnIdx, yearsBack, windowSize) {
  const eligible = rows.filter(r => r.p > mnIdx && r.vals[mnIdx] != null);
  if (!eligible.length) return { avg: null, count: 0, windowLabel: null };
  const anchor = parseMoLabel(eligible[0].mo);
  const targetEnd = new Date(anchor.getFullYear() - yearsBack, anchor.getMonth(), 1);
  const targetStart = new Date(targetEnd.getFullYear(), targetEnd.getMonth() - (windowSize - 1), 1);
  const inWindow = eligible.filter(r => {
    const d = parseMoLabel(r.mo);
    return d >= targetStart && d <= targetEnd;
  });
  if (!inWindow.length) return { avg: null, count: 0, windowLabel: null };
  const avg = inWindow.reduce((s, r) => s + r.vals[mnIdx], 0) / inWindow.length;
  return {
    avg: round1(avg),
    count: inWindow.length,
    windowLabel: `${inWindow[inWindow.length-1].mo} → ${inWindow[0].mo}`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE PILLS + MAPPING LEGEND
// ══════════════════════════════════════════════════════════════════════════════
function SourcePills({ active, onChange }){
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
        <span style={{...mono,fontSize:11,color:"#94a3b8",letterSpacing:".04em",textTransform:"uppercase",marginRight:4}}>Source</span>
        {SOURCES.map(s => {
          const isActive = active === s;
          return (
            <button key={s} onClick={()=>onChange(s)} style={{...f,
              padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:isActive?600:500,
              border:`1.5px solid ${isActive?SOURCE_COLORS[s]:"#e2e8f0"}`,
              background:isActive?SOURCE_COLORS[s]+"14":"#fff",
              color:isActive?SOURCE_COLORS[s]:"#64748b",cursor:"pointer"}}>
              {s}
            </button>
          );
        })}
      </div>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 14px"}}>
        <div style={{...mono,fontSize:10,color:"#64748b",letterSpacing:".06em",textTransform:"uppercase",fontWeight:600,marginBottom:6}}>Source Mapping</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(250px, 1fr))",gap:"4px 16px",fontSize:12,color:"#475569",...f}}>
          {SOURCE_MAPPING.map(([k,v]) => (
            <div key={k}>
              <span style={{color:SOURCE_COLORS[k],fontWeight:600}}>● {k}</span>
              <span style={{color:"#94a3b8"}}> = </span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// KPI ROW  ·  M1 / M3 / M9 / M12  with latest + 3-mo + 6-mo averages
// ══════════════════════════════════════════════════════════════════════════════
function KpiCard({ title, rows, mn }){
  const eligible = rows.filter(r => r.p > mn && r.vals[mn] != null);
  if (!eligible.length) return (
    <div style={cd}>
      <div style={{...mono,fontSize:11,color:"#64748b",letterSpacing:".04em",textTransform:"uppercase",marginBottom:6}}>{title}</div>
      <div style={{...f,fontSize:30,fontWeight:700,color:"#cbd5e1"}}>—</div>
      <div style={{...mono,fontSize:11,color:"#94a3b8",marginTop:6}}>no complete data</div>
    </div>
  );
  const latest = eligible[0];
  const avg3 = round1(avgOf(eligible.slice(0, 3).map(r => r.vals[mn])));
  const avg6 = round1(avgOf(eligible.slice(0, 6).map(r => r.vals[mn])));
  return (
    <div style={cd}>
      <div style={{...mono,fontSize:11,color:"#64748b",letterSpacing:".04em",textTransform:"uppercase",marginBottom:4}}>{title}</div>
      <div style={{...f,fontSize:30,fontWeight:700,color:"#0f172a",lineHeight:1,marginBottom:8}}>{latest.vals[mn]}%</div>
      <div style={{display:"flex",justifyContent:"space-between",...mono,fontSize:12,marginTop:3}}>
        <span style={{color:"#94a3b8"}}>latest ({latest.mo})</span><span></span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",...mono,fontSize:12,marginTop:3}}>
        <span style={{color:"#94a3b8"}}>3-mo avg</span><span style={{fontWeight:600}}>{avg3}%</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",...mono,fontSize:12,marginTop:3}}>
        <span style={{color:"#94a3b8"}}>6-mo avg</span><span style={{fontWeight:600}}>{avg6}%</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DECAY CURVES  ·  Year-over-year vintage comparison
// 6 lines: Recent + 1/2/3/4/5 yrs ago. Window size picker (3 or 6 cohorts).
// ══════════════════════════════════════════════════════════════════════════════
const VINTAGES = [
  { key:"recent", label:"Recent",     yb:0, useBrand:true,  width:3,    dash:""    },
  { key:"y1",     label:"1 yr ago",   yb:1, color:"#64748b", width:2,    dash:""    },
  { key:"y2",     label:"2 yrs ago",  yb:2, color:"#94a3b8", width:2,    dash:""    },
  { key:"y3",     label:"3 yrs ago",  yb:3, color:"#f59e0b", width:1.8,  dash:""    },
  { key:"y4",     label:"4 yrs ago",  yb:4, color:"#d97706", width:1.8,  dash:"5 4" },
  { key:"y5",     label:"5 yrs ago",  yb:5, color:"#b45309", width:1.6,  dash:"5 4" },
];

function DecayChart({ rows, src, windowSize, onOpenInfo, onWindowChange }){
  const [hidden, setHidden] = useState({});
  const toggle = key => setHidden(h => ({ ...h, [key]: !h[key] }));

  const chartData = useMemo(() => {
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const pt = { m: `M${m}` };
      VINTAGES.forEach(v => {
        const r = vintageAtMn(rows, m, v.yb, windowSize);
        pt[v.key] = r.avg;
        pt[`${v.key}_meta`] = r;
      });
      out.push(pt);
    }
    return out;
  }, [rows, windowSize]);

  const recentColor = SOURCE_COLORS[src];
  const visibleKeys = VINTAGES.filter(v => !hidden[v.key]).map(v => v.key);
  const yDomain = visibleDomain(chartData, visibleKeys, [10, 85]);

  return (
    <div style={{...cd, padding:0, overflow:"hidden"}}>
      <div style={{padding:"16px 24px", borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:8}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>Cohort Decay Curves</span>
            <button onClick={onOpenInfo} title="What is this?" style={{
              width:20,height:20,borderRadius:"50%",border:"1.5px solid #94a3b8",
              background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:11,fontWeight:700,
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              ...mono}}>i</button>
          </div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginTop:2}}>
            Year-over-year donor stickiness · Recent vs same window 1-5 years ago. Tap the <b>i</b> for explainer.
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{...mono,fontSize:10,color:"#94a3b8",letterSpacing:".06em",textTransform:"uppercase",fontWeight:600}}>Window</span>
          {[3, 6].map(w => (
            <button key={w} onClick={()=>onWindowChange(w)} style={{...mono,
              padding:"4px 11px",borderRadius:16,fontSize:11,fontWeight:500,
              border:`1px solid ${windowSize===w?"#0f172a":"#e2e8f0"}`,
              background:windowSize===w?"#0f172a":"#fff",
              color:windowSize===w?"#fff":"#64748b",cursor:"pointer"}}>
              {w} cohorts
            </button>
          ))}
        </div>
      </div>
      <div style={{padding:"16px 24px"}}>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData} margin={{ top:24, right:20, bottom:0, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:11,...mono}}/>
            <YAxis domain={yDomain} allowDataOverflow tick={{fill:"#94a3b8",fontSize:10,...mono}} tickFormatter={v=>`${v}%`}/>
            <Tooltip content={<DecayTooltip src={src}/>}/>
            {VINTAGES.map(v => (
              <Line
                key={v.key}
                type="monotone"
                dataKey={v.key}
                hide={!!hidden[v.key]}
                stroke={v.useBrand ? recentColor : v.color}
                strokeWidth={v.width}
                strokeDasharray={v.dash}
                dot={{ r: 3, strokeWidth: 1.5, stroke: "#fff", fill: v.useBrand ? recentColor : v.color }}
                activeDot={{ r: 6 }}
                connectNulls
                isAnimationActive={false}
                name={v.label}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
          {VINTAGES.map(v => {
            const color = v.useBrand ? recentColor : v.color;
            const off = hidden[v.key];
            return (
              <button key={v.key} onClick={()=>toggle(v.key)} title={off?"Show":"Hide"} style={{...mono,fontSize:11,
                display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:16,cursor:"pointer",
                border:`1px solid ${off?"#e2e8f0":color+"55"}`,background:off?"#f8fafc":color+"10",
                color:off?"#cbd5e1":"#475569"}}>
                <span style={{display:"inline-block",width:20,height:0,borderTop:v.dash?`2px dashed ${off?"#cbd5e1":color}`:`3px solid ${off?"#cbd5e1":color}`}}/>
                <span style={{textDecoration:off?"line-through":"none"}}>{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DecayTooltip({ active, payload, label, src }){
  if (!active || !payload?.length) return null;
  return (
    <div style={{...tt, padding:"10px 14px"}}>
      <div style={{...f,fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:6}}>{label}</div>
      {payload.filter(p => p.value != null).map(p => {
        const meta = p.payload[`${p.dataKey}_meta`];
        return (
          <div key={p.dataKey} style={{...mono,fontSize:11,marginBottom:3,color:p.color}}>
            <span style={{fontWeight:600}}>{VINTAGES.find(v=>v.key===p.dataKey)?.label}:</span> {p.value}%
            {meta?.windowLabel && (
              <span style={{color:"#94a3b8",marginLeft:6}}>· {meta.windowLabel}{meta.count < 6 ? ` (n=${meta.count})` : ""}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// INFO MODAL  ·  Founder-level explainer for the decay chart
// ══════════════════════════════════════════════════════════════════════════════
function InfoModal({ open, onClose }){
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(15,23,42,.55)",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#fff",borderRadius:14,maxWidth:580,width:"100%",padding:"28px 32px",
        maxHeight:"90vh",overflow:"auto",position:"relative",
        boxShadow:"0 20px 60px rgba(15,23,42,.25)",...f}}>
        <button onClick={onClose} aria-label="Close" style={{
          position:"absolute",top:14,right:14,width:30,height:30,border:"none",
          background:"transparent",cursor:"pointer",fontSize:22,color:"#64748b",borderRadius:6}}>×</button>

        <h3 style={{...f,fontSize:18,fontWeight:700,margin:"0 0 6px",color:"#0f172a"}}>Cohort Decay Curves — What is this?</h3>
        <div style={{fontSize:13,color:"#94a3b8",marginBottom:18}}>A 90-second explainer for anyone seeing this chart for the first time.</div>

        <Block label="The Idea">
          <p>A <b>cohort</b> is a group of donors who started their SIP in the same month. We track that group and ask: <em>how many of them are still donating 1, 3, 6, 9, 12 months later?</em></p>
          <p>This chart shows that stickiness <b>year over year</b> so you can see if retention is improving, holding, or slipping.</p>
        </Block>

        <Block label="Reading the Chart">
          <p>Each line starts at M1 on the left (1 month after signup) and shows what % of the cohort is still donating at each milestone. Lower = donors dropping off faster.</p>
        </Block>

        <Block label="The Six Lines">
          <p><b>Recent</b> (bright, solid) — the most current view. At each milestone, the average across the last 3 or 6 cohorts where that milestone is fully observable.</p>
          <p><b>1 / 2 yrs ago</b> (gray, solid) — same window shifted back 12 / 24 months. Direct year-over-year comparison.</p>
          <p><b>3 / 4 / 5 yrs ago</b> (amber tones) — older historical reference, going back as far as our data allows.</p>
        </Block>

        <Block label="The Window Picker">
          <p>Switch between <b>3 cohorts</b> (sharper signal, more recent) or <b>6 cohorts</b> (smoother, more stable). Hover any point to see the exact cohorts in that window.</p>
        </Block>

        <Block label="A subtle but important point">
          <p>Each line's window slides as you move right along the x-axis. At <b>M1</b>, the Recent window might be Nov 2025 → Apr 2026. At <b>M12</b>, it's a year older — because to observe M12 retention, the cohort must be at least 12 months old.</p>
        </Block>

        <Block label="What to look for">
          <p>• Is <b>Recent above or below</b> the older lines? (improving or slipping)<br/>
             • At which milestone do the lines <b>diverge most</b>? (where this year differs)<br/>
             • Where's the <b>steepest drop</b>? (consistent leak point)</p>
        </Block>
      </div>
    </div>
  );
}
function Block({ label, children }){
  return (
    <div style={{marginBottom:18}}>
      <div style={{...mono,fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#0f172a",marginBottom:8}}>{label}</div>
      <div style={{...f,fontSize:14,lineHeight:1.6,color:"#334155"}}>{children}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Mn OVER TIME  ·  4 lines (M1, M3, M6, M12) across cohort months
// ══════════════════════════════════════════════════════════════════════════════
const MN_LINES = [
  { mn: 1,  label: "M1",  color: "#0ea5e9" },
  { mn: 3,  label: "M3",  color: "#7c3aed" },
  { mn: 6,  label: "M6",  color: "#f59e0b" },
  { mn: 12, label: "M12", color: "#db2777" },
];

function MnOverTimeChart({ rows }){
  const [hidden, setHidden] = useState({});
  const toggle = key => setHidden(h => ({ ...h, [key]: !h[key] }));

  const data = useMemo(() => {
    // Last 18 cohorts, chronological order
    const recent = rows.slice(0, 18).slice().reverse();
    return recent.map(r => {
      const pt = { mo: r.mo };
      MN_LINES.forEach(ml => {
        // Only show if complete (not partial)
        pt[ml.label] = (r.p > ml.mn && r.vals[ml.mn] != null) ? r.vals[ml.mn] : null;
      });
      return pt;
    });
  }, [rows]);

  const visibleKeys = MN_LINES.filter(ml => !hidden[ml.label]).map(ml => ml.label);
  const yDomain = visibleDomain(data, visibleKeys, [0, 100]);

  return (
    <div style={cd}>
      <div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>Mn Retention Over Time</div>
      <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>How M1 / M3 / M6 / M12 trend cohort-by-cohort. Are early or late stages drifting? · tap a legend to toggle</div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top:10, right:10, bottom:0, left:0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis dataKey="mo" tick={{fill:"#64748b",fontSize:10,...mono}} angle={-30} textAnchor="end" height={50} interval={0}/>
          <YAxis domain={yDomain} allowDataOverflow tick={{fill:"#94a3b8",fontSize:10,...mono}} tickFormatter={v=>`${v}%`}/>
          <Tooltip contentStyle={tt} formatter={(v) => v == null ? "—" : `${v}%`}/>
          {MN_LINES.map(ml => (
            <Line key={ml.label} type="monotone" dataKey={ml.label} hide={!!hidden[ml.label]} stroke={ml.color} strokeWidth={2} dot={{r:3}} connectNulls isAnimationActive={false}/>
          ))}
          <Legend onClick={e => toggle(e.dataKey ?? e.value)} formatter={(v) => <span style={{...f,fontSize:11,cursor:"pointer",color:hidden[v]?"#cbd5e1":"#64748b",textDecoration:hidden[v]?"line-through":"none"}}>{v}</span>}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HEATMAP  ·  Last 12 cohorts × 13 months grid
// ══════════════════════════════════════════════════════════════════════════════
function cellBg(pct){ const a = 0.08 + (pct/100) * 0.87; return `rgba(14, 165, 233, ${a.toFixed(3)})`; }

function HeatmapCard({ rows }){
  const last12 = rows.slice(0, 12);
  return (
    <div style={{...cd, padding:0, overflow:"hidden"}}>
      <div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0"}}>
        <div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>Heatmap — Full Reference</div>
        <div style={{...f,fontSize:12,color:"#94a3b8",marginTop:2}}>Triangle view for cell-level inspection · partial diagonal = bucket not fully observed</div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",minWidth:922,tableLayout:"fixed",borderCollapse:"separate",borderSpacing:0,...mono,fontSize:12.5}}>
          <thead>
            <tr style={{background:"#fafbfc",fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em"}}>
              <th style={{width:130,padding:"10px 18px",textAlign:"left",fontWeight:600,borderBottom:"1px solid #e2e8f0"}}>Cohort</th>
              <th style={{width:90,padding:"10px 14px",textAlign:"right",fontWeight:600,borderBottom:"1px solid #e2e8f0"}}>Signups</th>
              {[0,1,2,3,4,5,6,7,8,9,10,11,12].map(i => (
                <th key={i} style={{width:54,padding:"10px 0",textAlign:"center",fontWeight:600,borderBottom:"1px solid #e2e8f0"}}>M{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {last12.map((row, ri) => (
              <tr key={ri}>
                <td style={{padding:"10px 18px",textAlign:"left",verticalAlign:"middle",fontWeight:600,color:"#0f172a",fontSize:13,...f,background:"#fff",borderBottom:"1px solid #f1f5f9",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{row.mo}</td>
                <td style={{padding:"10px 14px",textAlign:"right",verticalAlign:"middle",color:"#64748b",fontWeight:500,fontSize:13,background:"#fff",borderRight:"1px solid #e2e8f0",borderBottom:"1px solid #f1f5f9"}}>{row.n.toLocaleString()}</td>
                {row.vals.map((v, ci) => {
                  const partial = ci === row.p;
                  if (v == null) return <td key={ci} style={{height:38,verticalAlign:"middle",color:"#cbd5e1",fontWeight:400,background:"#fdfdfd",textAlign:"center",borderBottom:"1px solid #f1f5f9"}}>·</td>;
                  const dark = v >= 55;
                  const stripe = partial ? "repeating-linear-gradient(45deg,transparent 0,transparent 5px,rgba(15,23,42,.06) 5px,rgba(15,23,42,.06) 6px)" : "";
                  return (
                    <td key={ci} style={{
                      height:38,textAlign:"center",verticalAlign:"middle",fontWeight:500,boxSizing:"border-box",
                      background:cellBg(v), backgroundImage:stripe,
                      color: dark?"#fff":"#0f172a",
                      fontStyle: partial?"italic":"normal",
                      borderBottom:"1px solid #f1f5f9",
                    }}>{v}{partial?<span style={{fontSize:9,marginLeft:1,opacity:.7,verticalAlign:"middle"}}>*</span>:""}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CROSS-SOURCE COMPARISON  ·  One Mn across all sources
// ══════════════════════════════════════════════════════════════════════════════
function CrossSourceChart({ data }){
  const [mn, setMn] = useState(1);
  const [hidden, setHidden] = useState({});
  const toggle = key => setHidden(h => ({ ...h, [key]: !h[key] }));
  const chartData = useMemo(() => {
    // Use Telecalling's date list as the X axis (all sources have similar recent cohorts)
    const tel = data.Telecalling || [];
    const recent = tel.slice(0, 18).slice().reverse();
    return recent.map(r => {
      const pt = { mo: r.mo };
      SOURCES.forEach(s => {
        const sr = (data[s] || []).find(x => x.date === r.date);
        pt[s] = (sr && sr.p > mn && sr.vals[mn] != null) ? sr.vals[mn] : null;
      });
      return pt;
    });
  }, [data, mn]);

  const visibleKeys = SOURCES.filter(s => !hidden[s]);
  const yDomain = visibleDomain(chartData, visibleKeys, [0, 100]);

  return (
    <div style={{...cd, padding:0, overflow:"hidden"}}>
      <div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>Cross-Source Comparison</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginTop:2}}>Same retention metric across all 5 sources. Which channel produces stickiest donors?</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {[1, 3, 6, 12].map(v => (
            <button key={v} onClick={()=>setMn(v)} style={{...mono,
              padding:"4px 12px",borderRadius:16,fontSize:11,fontWeight:500,
              border:`1px solid ${mn===v?"#0f172a":"#e2e8f0"}`,
              background:mn===v?"#0f172a":"#fff",
              color:mn===v?"#fff":"#64748b",cursor:"pointer"}}>M{v}</button>
          ))}
        </div>
      </div>
      <div style={{padding:"16px 24px"}}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top:10, right:10, bottom:0, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="mo" tick={{fill:"#64748b",fontSize:10,...mono}} angle={-30} textAnchor="end" height={50} interval={0}/>
            <YAxis domain={yDomain} allowDataOverflow tick={{fill:"#94a3b8",fontSize:10,...mono}} tickFormatter={v=>`${v}%`}/>
            <Tooltip contentStyle={tt} formatter={(v) => v == null ? "—" : `${v}%`}/>
            {SOURCES.map(s => (
              <Line key={s} type="monotone" dataKey={s} hide={!!hidden[s]} stroke={SOURCE_COLORS[s]} strokeWidth={2} dot={{r:3}} connectNulls isAnimationActive={false}/>
            ))}
            <Legend onClick={e => toggle(e.dataKey ?? e.value)} formatter={(v) => <span style={{...f,fontSize:11,cursor:"pointer",color:hidden[v]?"#cbd5e1":"#64748b",textDecoration:hidden[v]?"line-through":"none"}}>{v}</span>}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT  ·  RetentionTab
// ══════════════════════════════════════════════════════════════════════════════
export default function RetentionTab(){
  const [model, setModel] = useState(null);
  const [err, setErr] = useState(null);
  const [src, setSrc] = useState("Telecalling");
  const [windowSize, setWindowSize] = useState(3);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await sb("sip_retention_matrix", "&order=source.asc,signup_month.desc&limit=2000");
        setModel(buildModel(raw));
      } catch (e) { setErr(e.message); }
    })();
  }, []);

  if (err) return <div style={{...cd, borderColor:"#fecaca", background:"#fef2f2", color:"#b91c1c", fontSize:13}}>Failed to load retention data: {err}</div>;
  if (!model) return <div style={{...f, padding:60, textAlign:"center", color:"#94a3b8", fontSize:14}}>Loading retention data from Supabase…</div>;

  const rows = model[src] || [];

  return (
    <div>
      <SourcePills active={src} onChange={setSrc}/>

      <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14, marginBottom:18}}>
        <KpiCard title="M1 Retention · 1 month"   rows={rows} mn={1}/>
        <KpiCard title="M3 Retention · 3 months"  rows={rows} mn={3}/>
        <KpiCard title="M9 Retention · 9 months"  rows={rows} mn={9}/>
        <KpiCard title="M12 Retention · 1 year"   rows={rows} mn={12}/>
      </div>

      <div style={{marginBottom:18}}>
        <DecayChart rows={rows} src={src} windowSize={windowSize}
          onOpenInfo={()=>setModalOpen(true)}
          onWindowChange={setWindowSize}/>
      </div>

      <div style={{marginBottom:18}}>
        <MnOverTimeChart rows={rows}/>
      </div>

      <div style={{marginBottom:18}}>
        <HeatmapCard rows={rows}/>
      </div>

      <div style={{marginBottom:18}}>
        <CrossSourceChart data={model}/>
      </div>

      <InfoModal open={modalOpen} onClose={()=>setModalOpen(false)}/>
    </div>
  );
}
