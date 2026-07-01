import { useState, useMemo, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line } from "recharts";

// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG  ·  reads the weekly materialized views live (anon key)
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
// CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════════════════════
const CC = { "DM":"#7c3aed","CRM":"#059669","Platform":"#0ea5e9","Share":"#f59e0b","Social Media Team":"#db2777","SEO":"#84cc16","Update":"#6366f1","Referral":"#14b8a6","Others":"#f43f5e","Null":"#94a3b8","Total":"#0f172a","All":"#0f172a" };
const chColor = ch => CC[ch] || "#94a3b8";
const COUNTRIES_FALLBACK = ["All","India","United States","Canada","United Arab Emirates","Australia"];
const OT_LABELS = { "All":"All Orders","normal_order":"Normal Order","main_order":"Main Order" };

const f = { fontFamily:"'DM Sans',sans-serif" };
const fmt = n => n>=10000000?`₹${(n/10000000).toFixed(2)}Cr`:n>=100000?`₹${(n/100000).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n)}`;
const fN = n => typeof n==='number'?(n>=1000?`${(n/1000).toFixed(1)}K`:String(Math.round(n))):n;
const pct = (c,b) => b&&b!==0?((c-b)/b*100).toFixed(1):null;
const tt = { background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,fontSize:11,...f,boxShadow:"0 4px 12px rgba(0,0,0,.08)" };
const cd = { background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"18px 20px" };

// week label: "W12 · Jan 19" style from week_start (ISO date string) + week_idx
const wkLabel = (idx, start) => {
  const d = new Date(start + "T00:00:00");
  const mo = d.toLocaleString("en-US",{month:"short"});
  return `W${idx+1} ${mo} ${d.getDate()}`;
};
const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;

// ── small components ──────────────────────────────────────────────────────────
function Pill({label,active,onClick,color="#0f172a"}){
  return <button onClick={onClick} style={{...f,padding:"5px 14px",borderRadius:20,border:`1.5px solid ${active?color:"#e2e8f0"}`,background:active?color+"16":"#fff",color:active?color:"#64748b",cursor:"pointer",fontSize:11,fontWeight:active?600:400,transition:"all .12s"}}>{label}</button>;
}
function Dt({c,b,s=11,label}){
  const p=pct(c,b);if(p===null)return<span style={{...f,fontSize:s,color:"#94a3b8"}}>—</span>;
  const u=parseFloat(p)>=0;
  return<span style={{display:"inline-flex",alignItems:"center",gap:3}}>
    <span style={{...f,fontSize:s,color:u?"#059669":"#ef4444",fontWeight:600}}>{u?"▲":"▼"}{Math.abs(p)}%</span>
    {label&&<span style={{...f,fontSize:Math.max(s-1,9),color:"#94a3b8"}}>{label}</span>}
  </span>;
}
function TabBtn({label,active,onClick}){
  return<button onClick={onClick} style={{...f,padding:"10px 20px",border:"none",borderBottom:active?"2.5px solid #0f172a":"2.5px solid transparent",background:"transparent",color:active?"#0f172a":"#94a3b8",cursor:"pointer",fontSize:13,fontWeight:active?600:400}}>{label}</button>;
}
const barLabel=(clr="#0f172a",inside=false)=>({position:inside?"inside":"top",fontSize:9,fill:inside?"#fff":clr,...f});

// horizontally-scrollable chart wrapper: keeps only `visible` weeks in view (rest scroll),
// sizing each week to an equal slice of the frame and auto-scrolling to the latest week.
function ScrollChart({ count, height, visible=12, children }){
  const ref=useRef(null);
  const [w,setW]=useState(0);
  useEffect(()=>{
    const el=ref.current; if(!el) return;
    const measure=()=>setW(el.clientWidth);
    measure();
    const ro=new ResizeObserver(measure); ro.observe(el);
    return ()=>ro.disconnect();
  },[]);
  useEffect(()=>{ const el=ref.current; if(el) el.scrollLeft=el.scrollWidth; },[w,count]);
  const perWeek = w>0 ? w/visible : 72;
  const innerW = Math.max(w, count*perWeek);
  return(
    <div ref={ref} style={{overflowX:"auto",overflowY:"hidden"}}>
      <div style={{width:innerW,height}}>
        <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

// fixed (non-scrolling) legend that lives OUTSIDE ScrollChart so it stays in view;
// click a swatch to isolate that series, click again to reset. items: [{key,label,color}]
function IsoLegend({ items, iso, setIso, size=10 }){
  return(
    <div style={{display:"flex",flexWrap:"wrap",gap:"6px 16px",justifyContent:"center",marginTop:10}}>
      {items.map(it=>{
        const dim=iso!==null&&iso!==it.key;
        return(
          <span key={it.key} onClick={()=>setIso(iso===it.key?null:it.key)} style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer"}}>
            <span style={{width:9,height:9,borderRadius:2,background:it.color,display:"inline-block",opacity:dim?0.35:1}}/>
            <span style={{...f,fontSize:size,color:dim?"#cbd5e1":"#64748b",fontWeight:iso===it.key?700:400}}>{it.label}</span>
          </span>
        );
      })}
    </div>
  );
}

// mono font for the scorecard (terminal/exec aesthetic from the reference)
const mono = { fontFamily:"'IBM Plex Mono','DM Mono',ui-monospace,monospace" };

// ══════════════════════════════════════════════════════════════════════════════
// TAB 0 — WEEKLY SCORECARD (exec view)  ·  per-channel KPI cards, latest vs prev
// ══════════════════════════════════════════════════════════════════════════════
// KPI delta row: WoW / 12wk / 24wk
function DeltaRows({ cur, prev, a12, a24 }){
  const row=(lab,b)=>{
    const p=pct(cur,b);
    const up=p!==null&&parseFloat(p)>=0;
    return(
      <div key={lab} style={{display:"flex",justifyContent:"space-between",...mono,fontSize:12}}>
        <span style={{color:"#94a3b8"}}>{lab}</span>
        <span style={{color:p===null?"#cbd5e1":up?"#059669":"#dc2626",fontWeight:600}}>{p===null?"—":`${up?"+":""}${p}%`}</span>
      </div>
    );
  };
  return <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:6}}>{row("WoW",prev)}{row("12wk",a12)}{row("24wk",a24)}</div>;
}

// one KPI block (label, big value, deltas)
function Kpi({ label, value, cur, prev, a12, a24 }){
  return(
    <div>
      <div style={{...mono,fontSize:11,color:"#64748b",letterSpacing:".04em",marginBottom:4}}>{label}</div>
      <div style={{...f,fontSize:30,fontWeight:700,color:"#0f172a",lineHeight:1,marginBottom:8}}>{value}</div>
      <DeltaRows cur={cur} prev={prev} a12={a12} a24={a24}/>
    </div>
  );
}

// builds the 4 KPI values + comparison bases for a given week index
function weekKpis(D, ch, idx){
  const get=(i)=> (ch==="Total"||ch==="All") ? D.weekTotals[i] : D.chWk[i]?.[ch];
  const r=get(idx)||{orders:0,amount:0,brand_new:0};
  const idxList=D.weeks.map(w=>w.idx);
  const win=(n)=> idxList.filter(i=> i<idx && i>=idx-n);
  const w12=win(12), w24=win(24);
  const m=(sel)=>({
    o:Math.round(avg(sel.map(i=>get(i)?.orders||0))),
    a:avg(sel.map(i=>+(get(i)?.amount||0))),
    bn:Math.round(avg(sel.map(i=>get(i)?.brand_new||0))),
    v:(()=>{const oo=avg(sel.map(i=>get(i)?.orders||0)),aa=avg(sel.map(i=>+(get(i)?.amount||0)));return oo>0?aa/oo:0;})(),
  });
  const prev=get(idx-1)||{orders:0,amount:0,brand_new:0};
  return {
    cur:{ o:r.orders, a:+r.amount, bn:r.brand_new, v:r.orders>0?+r.amount/r.orders:0 },
    prev:{ o:prev.orders, a:+prev.amount, bn:prev.brand_new, v:prev.orders>0?+prev.amount/prev.orders:0 },
    a12:m(w12), a24:m(w24)
  };
}

function ScoreCard({ D, ch, idx, variant }){
  const k=weekKpis(D,ch,idx);
  const wk=D.weeks.find(w=>w.idx===idx);
  const latest=variant==="latest";
  const dateLong=wk?new Date(wk.start+"T00:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"—";
  return(
    <div style={{background:"#fff",border:"1px solid #e2e8f0",borderLeft:latest?`4px solid ${chColor(ch)}`:"1px solid #e2e8f0",borderRadius:14,padding:"22px 26px",flex:"0 0 auto",width:360}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <span style={{...mono,fontSize:12,color:"#64748b",letterSpacing:".06em",textTransform:"uppercase"}}>Week of {dateLong}</span>
        <span style={{...mono,fontSize:10,fontWeight:700,letterSpacing:".06em",padding:"2px 9px",borderRadius:6,background:latest?chColor(ch):"#f1f5f9",color:latest?"#fff":"#64748b"}}>{latest?"LATEST":"PREVIOUS"}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px 28px"}}>
        <Kpi label="Total Donation" value={fmt(k.cur.a)} cur={k.cur.a} prev={k.prev.a} a12={k.a12.a} a24={k.a24.a}/>
        <Kpi label="Total Orders"   value={fN(k.cur.o)}  cur={k.cur.o} prev={k.prev.o} a12={k.a12.o} a24={k.a24.o}/>
        <Kpi label="Avg Ticket Size" value={fmt(k.cur.v)} cur={k.cur.v} prev={k.prev.v} a12={k.a12.v} a24={k.a24.v}/>
        <Kpi label="Brand-New Donors" value={fN(k.cur.bn)} cur={k.cur.bn} prev={k.prev.bn} a12={k.a12.bn} a24={k.a24.bn}/>
      </div>
    </div>
  );
}

function ScorecardTab({ D }){
  const channels=["All",...D.mainChs];
  const [ch,setCh]=useState("All");
  const lastIdx=D.lastIdx;

  // latest → oldest weeks for the scrollable scorecard row (at least 6, up to 12 shown)
  const cardWeeks=D.weeks.slice(-12).reverse();

  // health verdict: weighted on orders + donation WoW
  const k=weekKpis(D,ch,lastIdx);
  const oW=pct(k.cur.o,k.prev.o), aW=pct(k.cur.a,k.prev.a);
  const score=(parseFloat(oW||0)+parseFloat(aW||0))/2;
  const verdict= score> 5 ? {t:"Good",c:"#059669",bg:"#f0fdf4",bd:"#bbf7d0"} : score < -5 ? {t:"Bad",c:"#dc2626",bg:"#fef2f2",bd:"#fecaca"} : {t:"Flat",c:"#d97706",bg:"#fffbeb",bd:"#fde68a"};

  // 12-week trend (donation + orders/donors-ish: orders & brand-new)
  const trend=D.weeks.slice(-12).map(w=>{
    const c= (ch==="Total"||ch==="All")?D.weekTotals[w.idx]:D.chWk[w.idx]?.[ch];
    return { m:w.label, donation:c?Math.round(+c.amount/1000):0, orders:c?c.orders:0, brand:c?c.brand_new:0 };
  });

  return(
    <div>
      {/* channel selector */}
      <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
        {channels.map(c=><Pill key={c} label={c} active={ch===c} onClick={()=>setCh(c)} color={chColor(c)}/>)}
      </div>

      {/* heading + verdict */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{...f,fontSize:26,fontWeight:700,color:"#0f172a"}}>{ch}</span>
          <span style={{...mono,fontSize:12,fontWeight:700,padding:"3px 12px",borderRadius:20,background:verdict.bg,color:verdict.c,border:`1px solid ${verdict.bd}`}}>{verdict.t}</span>
        </div>
        <span style={{...f,fontSize:11,color:"#94a3b8"}}>Latest → oldest · scroll for more weeks →</span>
      </div>

      {/* scorecards: latest → oldest, scrollable */}
      <div style={{display:"flex",gap:16,overflowX:"auto",overflowY:"hidden",paddingBottom:10,marginBottom:26}}>
        {cardWeeks.map((w,i)=><ScoreCard key={w.idx} D={D} ch={ch} idx={w.idx} variant={i===0?"latest":"previous"}/>)}
      </div>

      {/* 12-week trend */}
      <div style={{...mono,fontSize:11,letterSpacing:".1em",color:"#94a3b8",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",paddingBottom:8,marginBottom:16,display:"flex",justifyContent:"space-between"}}>
        <span>12-Week Trend</span><span>Last 12 weeks</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>Total Donation</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Weekly donation trend (₹K)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{left:10,right:10,top:20,bottom:0}} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:8,...f}} angle={-40} textAnchor="end" height={48} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v=>`₹${v}K`}/>
              <Bar dataKey="donation" fill={chColor(ch)} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>Orders &amp; Brand-New Donors</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Weekly volume</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{left:10,right:10,top:10,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:8,...f}} angle={-40} textAnchor="end" height={48} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt}/>
              <Line type="monotone" dataKey="orders" stroke="#0f172a" strokeWidth={2} dot={{r:2}} name="Orders"/>
              <Line type="monotone" dataKey="brand" stroke="#059669" strokeWidth={2} dot={{r:2}} name="Brand-New"/>
              <Legend formatter={v=><span style={{...f,fontSize:11,color:"#64748b"}}>{v}</span>}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SOURCE × MEDIUM — latest week, with WoW/12wk/24wk on orders */}
      <div style={{...cd,padding:0,overflow:"hidden",marginTop:20}}>
        <div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0"}}>
          <div style={{...f,fontSize:17,fontWeight:700,color:"#0f172a"}}>{ch} — Source × Medium</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginTop:2}}>Latest week ({D.latestLabel}) · deltas on orders vs WoW / trailing 12-week avg / trailing 24-week avg</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:13}}>
            <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".04em"}}>
              {["Source","Medium","Orders","Amount","ASV","New","Rep","WoW","12wk","24wk"].map(h=>
                <th key={h} style={{padding:"12px 16px",textAlign:(h==="Source"||h==="Medium")?"left":"right",fontWeight:600}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(D.srcBench[ch]||[]).filter(r=>r.c.o>0 || r.p.o>0).slice(0,25).map((r,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafbfc"}}>
                  <td style={{padding:"12px 16px",fontWeight:600,color:"#1e293b"}}>{r.source}</td>
                  <td style={{padding:"12px 16px",color:"#94a3b8"}}>{r.medium}</td>
                  <td style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:chColor(ch)}}>{r.c.o}</td>
                  <td style={{padding:"12px 16px",textAlign:"right",color:"#0f172a"}}>{fmt(r.c.a)}</td>
                  <td style={{padding:"12px 16px",textAlign:"right",color:"#059669",fontWeight:600}}>{fmt(r.c.v)}</td>
                  <td style={{padding:"12px 16px",textAlign:"right",color:"#7c3aed"}}>{r.c.ns}</td>
                  <td style={{padding:"12px 16px",textAlign:"right",color:"#db2777"}}>{r.c.rs}</td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}><Dt c={r.c.o} b={r.p.o}/></td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}><Dt c={r.c.o} b={r.a12.o}/></td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}><Dt c={r.c.o} b={r.a24.o}/></td>
                </tr>
              ))}
              {(!D.srcBench[ch]||D.srcBench[ch].filter(r=>r.c.o>0||r.p.o>0).length===0)&&(
                <tr><td colSpan={10} style={{padding:"20px 16px",textAlign:"center",color:"#94a3b8",...f,fontSize:13}}>No source/medium activity for {ch} in the latest or previous week.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — SIP PULSE & BENCHMARKS
// ══════════════════════════════════════════════════════════════════════════════
function PulseTab({ D }){
  const [view,setView]=useState("all");
  const [mk,setMk]=useState("orders");
  const [pulseIso,setPulseIso]=useState(null); // isolate a legend series in the pulse chart
  const [stackIso,setStackIso]=useState(null); // isolate a channel in the channel-split chart
  const [asvCountry,setAsvCountry]=useState("All");
  const [asvOT,setAsvOT]=useState("All");
  const [asvChs,setAsvChs]=useState(["All",...D.mainChs.slice(0,4)]);

  // 1. pulse
  const pulseData = D.pulse.map(p=>{
    if(mk==="orders") return { m:p.label, Tel:view!=="non_tel"?p.tel_orders:0, NonTel:view!=="tel"?p.nontel_orders:0, total:p.tel_orders+p.nontel_orders };
    return { m:p.label, Tel:view!=="non_tel"?Math.round(p.tel_amount/1000):0, NonTel:view!=="tel"?Math.round(p.nontel_amount/1000):0 };
  });

  // 2. channel stack (non-tel)
  const stackData = D.weeks.map(w=>{
    const row={ m:w.label };
    D.mainChs.forEach(ch=>{ const c=D.chWk[w.idx]?.[ch]; row[ch]= c ? (mk==="orders"?c.orders:Math.round(c.amount/1000)) : 0; });
    return row;
  });

  // 3. ASV trend (country / order-type filtered)
  const asvData = D.weeks.map(w=>{
    const row={ m:w.label };
    asvChs.forEach(ch=>{
      let o=0,a=0;
      if(asvCountry!=="All"){ const c=D.countryWk[w.idx]?.[asvCountry]?.[ch]; if(c){o=c.orders;a=c.amount;} }
      else if(asvOT!=="All"){ const c=D.chOtWk[w.idx]?.[ch]?.[asvOT]; if(c){o=c.orders;a=c.amount;} }
      else { const c= ch==="All"? D.weekTotals[w.idx] : D.chWk[w.idx]?.[ch]; if(c){o=c.orders;a=c.amount;} }
      if(asvCountry!=="All" && ch==="All"){ const t=D.countryWkTotals[w.idx]?.[asvCountry]; if(t){o=t.orders;a=t.amount;} }
      if(asvOT!=="All" && ch==="All"){ const t=D.otWkTotals[w.idx]?.[asvOT]; if(t){o=t.orders;a=t.amount;} }
      row[ch]= o>0? Math.round(a/o):0;
    });
    return row;
  });

  // 4. benchmark table — current week vs prev / 12w / 24w
  const benchRows=[...D.mainChs,"Total"];
  const chb=D.bench;

  const latest=D.pulse[D.pulse.length-1];

  return(
    <div>
      {/* PULSE */}
      <div style={{...cd,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>SIP Acquisition Pulse</div>
            <div style={{...f,fontSize:12,color:"#94a3b8"}}>{D.weeks.length} weeks · 12 in view, scroll → for older · click a legend to isolate</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            {[["all","All"],["non_tel","Non-Tel"],["tel","Telecalling"]].map(([k,l])=><Pill key={k} label={l} active={view===k} onClick={()=>setView(k)}/>)}
            <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 4px"}}/>
            {[["orders","Orders"],["amount","Amount (₹K)"]].map(([k,l])=><Pill key={k} label={l} active={mk===k} onClick={()=>setMk(k)} color="#7c3aed"/>)}
          </div>
        </div>
        <ScrollChart count={pulseData.length} height={250} visible={12}>
          <BarChart data={pulseData} margin={{left:10,right:10,top:25,bottom:0}} barSize={view==="all"?16:24}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:9,...f}} angle={-35} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt} formatter={v=>mk==="amount"?`₹${v}K`:v}/>
            {view!=="non_tel"&&<Bar dataKey="Tel" stackId="a" fill="#f97316" hide={pulseIso!==null&&pulseIso!=="Tel"} label={view==="tel"?barLabel("#f97316"):barLabel("#fff",true)}/>}
            {view!=="tel"&&<Bar dataKey="NonTel" stackId="a" fill="#0f172a" radius={[3,3,0,0]} hide={pulseIso!==null&&pulseIso!=="NonTel"} label={barLabel("#0f172a")}/>}
          </BarChart>
        </ScrollChart>
        <IsoLegend size={11} iso={pulseIso} setIso={setPulseIso} items={[
          ...(view!=="non_tel"?[{key:"Tel",label:"Telecalling",color:"#f97316"}]:[]),
          ...(view!=="tel"?[{key:"NonTel",label:"Non-Telecalling",color:"#0f172a"}]:[]),
        ]}/>
        {view==="all"&&latest&&(
          <div style={{display:"flex",gap:20,justifyContent:"center",marginTop:6,...f,fontSize:12}}>
            <span style={{color:"#f97316"}}>Tel: <b>{fN(latest.tel_orders)}</b></span>
            <span style={{color:"#0f172a"}}>Non-Tel: <b>{fN(latest.nontel_orders)}</b></span>
            <span style={{color:"#64748b"}}>Total: <b>{fN(latest.tel_orders+latest.nontel_orders)}</b></span>
          </div>
        )}
      </div>

      {/* CHANNEL STACK */}
      <div style={{...cd,marginBottom:16}}>
        <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>Non-Telecalling — Channel Split Over Time</div>
        <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Stacked · {mk==="orders"?"order count":"amount (₹K)"} per channel per week · 12 weeks in view, scroll → · click a legend to isolate</div>
        <ScrollChart count={stackData.length} height={290} visible={12}>
          <BarChart data={stackData} margin={{left:10,right:10,top:10,bottom:0}} barSize={24}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:9,...f}} angle={-35} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt} formatter={v=>mk==="amount"?`₹${v}K`:v}/>
            {D.mainChs.map((ch,i)=><Bar key={ch} dataKey={ch} stackId="a" fill={chColor(ch)} hide={stackIso!==null&&stackIso!==ch} radius={i===D.mainChs.length-1?[3,3,0,0]:[0,0,0,0]} label={stackIso===ch?barLabel(chColor(ch)):undefined}/>)}
          </BarChart>
        </ScrollChart>
        <IsoLegend items={D.mainChs.map(ch=>({key:ch,label:ch,color:chColor(ch)}))} iso={stackIso} setIso={setStackIso}/>
      </div>

      {/* ASV TREND */}
      <div style={{...cd,marginBottom:16}}>
        <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>ASV Trend by Channel (₹)</div>
        <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:10}}>Total donation ÷ total orders · filter by country & order type</div>
        <div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{...f,fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase"}}>Country</span>
            {D.countryList.map(c=><Pill key={c} label={c==="All"?"All":c} active={asvCountry===c} onClick={()=>{setAsvCountry(c);if(c!=="All")setAsvOT("All");}} color="#0ea5e9"/>)}
          </div>
          <div style={{width:1,height:22,background:"#e2e8f0"}}/>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span style={{...f,fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase"}}>Order Type</span>
            {["All","normal_order","main_order"].map(k=><Pill key={k} label={OT_LABELS[k]} active={asvOT===k} onClick={()=>{setAsvOT(k);if(k!=="All")setAsvCountry("All");}} color="#db2777"/>)}
          </div>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          <span style={{...f,fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",lineHeight:"28px"}}>Channels</span>
          {["All",...D.mainChs].map(ch=>{
            const active=asvChs.includes(ch);
            return<button key={ch} onClick={()=>{if(ch==="All"){setAsvChs(active?D.mainChs.slice(0,3):["All",...D.mainChs.slice(0,4)]);}else{const next=active?asvChs.filter(c=>c!==ch&&c!=="All"):[...asvChs.filter(c=>c!=="All"),ch];setAsvChs(next.length?next:["All"]);}}} style={{...f,padding:"3px 10px",borderRadius:16,border:`1px solid ${active?chColor(ch):"#e2e8f0"}`,background:active?chColor(ch)+"16":"#fff",color:active?chColor(ch):"#94a3b8",cursor:"pointer",fontSize:10,fontWeight:active?600:400}}>{ch==="All"?"Overall":ch}</button>;
          })}
        </div>
        <ResponsiveContainer width="100%" height={270}>
          <LineChart data={asvData} margin={{left:10,right:20,top:5,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:9,...f}} angle={-35} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt} formatter={v=>`₹${v}`}/>
            {asvChs.map(ch=><Line key={ch} type="monotone" dataKey={ch} stroke={ch==="All"?"#0f172a":chColor(ch)} strokeWidth={ch==="All"?2.5:1.5} dot={{r:ch==="All"?3:2}} name={ch==="All"?"Overall":ch} connectNulls/>)}
            <Legend formatter={v=><span style={{...f,fontSize:10,color:"#64748b"}}>{v}</span>}/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* BENCHMARK TABLE */}
      <div style={{...cd,padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #e2e8f0"}}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>Channel Benchmarks — {D.latestLabel} vs History</div>
          <div style={{...f,fontSize:12,color:"#94a3b8"}}>Non-Tel channels · vs prev week, trailing 12-week avg, trailing 24-week avg</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:12}}>
            <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:10,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em"}}>
              {["Channel","Orders","vs WoW","vs 12W","vs 24W","Amount","ASV","New SIP","Rep SIP"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:h==="Channel"?"left":"right",fontWeight:600}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {benchRows.map((ch,i)=>{
                const d2=chb[ch];if(!d2)return null;const isT=ch==="Total";
                return(<tr key={ch} style={{borderBottom:"1px solid #f1f5f9",background:isT?"#f0f9ff":i%2===0?"#fff":"#fafbfc",fontWeight:isT?700:400}}>
                  <td style={{padding:"10px 12px",color:isT?"#0f172a":chColor(ch),fontWeight:600}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}>{!isT&&<span style={{width:7,height:7,borderRadius:"50%",background:chColor(ch),display:"inline-block"}}/>}{isT?"Total Non-Tel":ch}</span></td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#0f172a",fontSize:14}}>{d2.c.o}</td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.p.o}/></td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.a12.o}/></td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.a24.o}/></td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#64748b"}}>{fmt(d2.c.a)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#059669",fontWeight:600}}>{fmt(d2.c.v)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#7c3aed"}}>{d2.c.ns}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#db2777"}}>{d2.c.rs}</td>
                </tr>);
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — DONOR QUALITY
// ══════════════════════════════════════════════════════════════════════════════
function DonorTab({ D }){
  const [selCh,setSelCh]=useState("All");
  // new vs repeat split per week for selected channel
  const splitData = D.weeks.map(w=>{
    let ns=0,rs=0;
    if(selCh==="All"){ const t=D.weekTotals[w.idx]; if(t){ns=t.new_sip;rs=t.repeat_sip;} }
    else { const c=D.chWk[w.idx]?.[selCh]; if(c){ns=c.new_sip;rs=c.repeat_sip;} }
    return { m:w.label, "New SIP":ns, "Repeat SIP":rs };
  });
  // brand-new donors (first-ever Ketto donation is a SIP) per week
  const brandData = D.weeks.map(w=>({ m:w.label, brand:D.weekTotals[w.idx]?.brand_new||0 }));

  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {["All",...D.mainChs].map(c=><Pill key={c} label={c} active={selCh===c} onClick={()=>setSelCh(c)} color={chColor(c)}/>)}
      </div>
      <div style={{...cd,marginBottom:16}}>
        <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>New vs Repeat SIP — Weekly{selCh!=="All"?` · ${selCh}`:""}</div>
        <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Based on donor_type_on_sip_order · stacked order count</div>
        <ResponsiveContainer width="100%" height={290}>
          <BarChart data={splitData} margin={{left:10,right:10,top:20,bottom:0}} barSize={24}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:9,...f}} angle={-35} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt}/>
            <Bar dataKey="New SIP" stackId="a" fill="#0ea5e9" label={barLabel("#fff",true)}/>
            <Bar dataKey="Repeat SIP" stackId="a" fill="#7c3aed" radius={[3,3,0,0]} label={barLabel("#fff",true)}/>
            <Legend formatter={v=><span style={{...f,fontSize:11,color:"#64748b"}}>{v}</span>}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={cd}>
        <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>Brand-New Donor Acquisition</div>
        <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Donors whose first-ever Ketto donation is a SIP (overall = New) · non-tel</div>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={brandData} margin={{left:10,right:10,top:25,bottom:0}} barSize={24}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:9,...f}} angle={-35} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt} formatter={v=>[v,"Brand-new donors"]}/>
            <Bar dataKey="brand" fill="#059669" radius={[3,3,0,0]} label={barLabel("#059669")}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — PAGE & DEVICE
// ══════════════════════════════════════════════════════════════════════════════
function PageDeviceTab({ D }){
  const [selCh,setSelCh]=useState("All");
  const pgClr={"sip_payment_standalone":"#059669","sip_inactive":"#0ea5e9","sip_welcome":"#f97316","sip_welcome_failed":"#ef4444","stories":"#7c3aed","thank_you":"#10b981","fundraiser":"#94a3b8","Blank":"#cbd5e1"};
  const pageData = D.weeks.map(w=>{ const row={m:w.label}; D.pages.forEach(p=>{row[p]=D.pageWk[w.idx]?.[p]||0;}); return row; });
  const dvData = D.weeks.map(w=>{
    const src = selCh==="All" ? D.deviceWkTotals[w.idx] : D.deviceWk[w.idx]?.[selCh];
    return { m:w.label, Desktop:src?.Desktop||0, Mobile:src?.Mobile||0, App:src?.App||0 };
  });
  const latest=D.weeks[D.weeks.length-1];

  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {["All",...D.mainChs].map(c=><Pill key={c} label={c} active={selCh===c} onClick={()=>setSelCh(c)} color={chColor(c)}/>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>Page Type — Weekly</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Where non-tel SIP orders are created · "Blank" = page not captured</div>
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={pageData} margin={{left:10,right:10,top:5,bottom:0}} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:8,...f}} angle={-40} textAnchor="end" height={50} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt}/>
              {D.pages.map((p,i)=><Bar key={p} dataKey={p} stackId="a" fill={pgClr[p]||"#94a3b8"} radius={i===D.pages.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
              <Legend formatter={v=><span style={{...f,fontSize:8,color:"#64748b"}}>{v}{v==="sip_welcome_failed"?" ⚠":""}</span>}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>Device Split — Weekly{selCh!=="All"?` · ${selCh}`:""}</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Select channel above to filter</div>
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={dvData} margin={{left:10,right:10,top:5,bottom:0}} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:8,...f}} angle={-40} textAnchor="end" height={50} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt}/>
              <Bar dataKey="Mobile" stackId="a" fill="#0ea5e9"/>
              <Bar dataKey="Desktop" stackId="a" fill="#7c3aed"/>
              <Bar dataKey="App" stackId="a" fill="#059669" radius={[3,3,0,0]}/>
              <Legend formatter={v=><span style={{...f,fontSize:11,color:"#64748b"}}>{v}</span>}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{...cd,padding:0,overflow:"hidden"}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",...f,fontSize:14,fontWeight:600,color:"#0f172a"}}>Device Mix by Channel — {latest?.label}</div>
        <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:10,color:"#94a3b8",textTransform:"uppercase"}}>
            {["Channel","Desktop","Mobile","App","Total","Desktop %"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:h==="Channel"?"left":"right",fontWeight:600}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {D.mainChs.map((ch,i)=>{
              const src=latest?D.deviceWk[latest.idx]?.[ch]:null;
              const desk=src?.Desktop||0,mob=src?.Mobile||0,app=src?.App||0;
              const tot=desk+mob+app;const dpct=tot>0?Math.round(desk/tot*100):0;
              return(<tr key={ch} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafbfc"}}>
                <td style={{padding:"10px 12px",color:chColor(ch),fontWeight:600}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:7,height:7,borderRadius:"50%",background:chColor(ch),display:"inline-block"}}/>{ch}</span></td>
                <td style={{padding:"10px 12px",textAlign:"right",color:"#7c3aed"}}>{desk}</td>
                <td style={{padding:"10px 12px",textAlign:"right",color:"#0ea5e9"}}>{mob}</td>
                <td style={{padding:"10px 12px",textAlign:"right",color:"#059669"}}>{app}</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600}}>{tot}</td>
                <td style={{padding:"10px 12px",textAlign:"right"}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}><div style={{width:50,height:5,background:"#f1f5f9",borderRadius:99,overflow:"hidden"}}><div style={{width:`${dpct}%`,height:"100%",background:"#7c3aed",borderRadius:99}}/></div><span style={{...f,fontSize:11,fontWeight:600,color:dpct>60?"#7c3aed":"#64748b"}}>{dpct}%</span></div></td>
              </tr>);
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — COUNTRY INSIGHTS
// ══════════════════════════════════════════════════════════════════════════════
function CountryTab({ D }){
  const [selCountries,setSelCountries]=useState([]); // multi-select
  const [selChTrend,setSelChTrend]=useState("All");
  const [trendMk,setTrendMk]=useState("o");
  const trendLabels={"o":"Orders","a":"Amount (₹)","v":"ASV (₹)"};
  const toggleCountry=(c)=>{ setSelChTrend("All"); setSelCountries(prev=>prev.includes(c)?prev.filter(x=>x!==c):[...prev,c]); };

  const india=D.countryAgg.find(c=>c.c==="India");
  const intl=D.countryAgg.filter(c=>c.c!=="India").slice(0,12);

  // aggregate the selected countries into one view (works for 1 or many)
  const selList=selCountries.map(cn=>D.countryAgg.find(x=>x.c===cn)).filter(Boolean);
  let sel=null;
  if(selList.length){
    const chMap={}; let o=0,a=0,ns=0,rs=0;
    selList.forEach(g=>{ o+=g.o;a+=g.a;ns+=g.ns;rs+=g.rs; g.chs.forEach(c=>{const d=(chMap[c.ch] ||= {ch:c.ch,o:0,a:0}); d.o+=c.o; d.a+=c.a;}); });
    const chs=Object.values(chMap).map(c=>({...c,v:c.o>0?Math.round(c.a/c.o):0})).sort((x,y)=>y.o-x.o);
    sel={ c:selList.map(g=>g.c).join(" + "), o, a, ns, rs, v:o>0?Math.round(a/o):0, chs };
  }

  // trend aggregated across the selected countries (+ channel filter)
  const trendData = sel ? D.weeks.map(w=>{
    let o=0,a=0;
    selCountries.forEach(cn=>{
      if(selChTrend==="All"){ const t=D.countryWkTotals[w.idx]?.[cn]; if(t){o+=t.orders;a+=t.amount;} }
      else { const c=D.countryWk[w.idx]?.[cn]?.[selChTrend]; if(c){o+=c.orders;a+=c.amount;} }
    });
    return { m:w.label, o, a, v:o>0?Math.round(a/o):0 };
  }) : [];

  return(
    <div>
      {india&&(
        <div onClick={()=>toggleCountry("India")} style={{...cd,border:selCountries.includes("India")?"1.5px solid #f97316":"1.5px solid #fed7aa",background:selCountries.includes("India")?"#fff7ed":"#fffbf5",marginBottom:14,cursor:"pointer"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>🇮🇳</span>
              <div><div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>India{selCountries.includes("India")&&<span style={{...f,fontSize:11,color:"#f97316",fontWeight:600,marginLeft:8}}>✓ selected</span>}</div><div style={{...f,fontSize:11,color:"#94a3b8"}}>Click to add/remove from the aggregated trend below</div></div>
            </div>
            {[["Orders",fN(india.o),"#0f172a"],["Amount",fmt(india.a),"#7c3aed"],["ASV",fmt(india.v),"#059669"],["New SIP",india.ns,"#0ea5e9"],["Repeat",india.rs,"#db2777"]].map(([l,v,c])=>(
              <div key={l} style={{textAlign:"center"}}><div style={{...f,fontSize:10,color:"#94a3b8",textTransform:"uppercase",fontWeight:600,marginBottom:2}}>{l}</div><div style={{...f,fontSize:18,fontWeight:700,color:c}}>{v}</div></div>
            ))}
          </div>
        </div>
      )}
      <div style={{...cd,padding:0,overflow:"hidden",marginBottom:16}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",...f,fontSize:14,fontWeight:600}}>International — {intl.length} countries · ₹ INR-converted · cumulative non-tel <span style={{fontWeight:400,color:"#94a3b8",fontSize:12}}>· click rows to select multiple &amp; aggregate</span></div>
        <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:10,color:"#94a3b8",textTransform:"uppercase"}}>
            {["Country","Orders","Amount","ASV","New SIP","Repeat","Top Channel"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:h==="Country"||h==="Top Channel"?"left":"right",fontWeight:600}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {intl.map((c,i)=>{ const top=c.chs&&c.chs[0];
              return(<tr key={i} onClick={()=>toggleCountry(c.c)} style={{borderBottom:"1px solid #f1f5f9",background:selCountries.includes(c.c)?"#f0f9ff":i%2===0?"#fff":"#fafbfc",cursor:"pointer"}}>
                <td style={{padding:"10px 12px",fontWeight:500,color:"#1e293b"}}>{selCountries.includes(c.c)&&<span style={{color:"#0ea5e9",fontWeight:700,marginRight:5}}>✓</span>}{c.c}</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#0ea5e9"}}>{c.o}</td>
                <td style={{padding:"10px 12px",textAlign:"right"}}>{fmt(c.a)}</td>
                <td style={{padding:"10px 12px",textAlign:"right",color:"#059669",fontWeight:500}}>{fmt(c.v)}</td>
                <td style={{padding:"10px 12px",textAlign:"right",color:"#7c3aed"}}>{c.ns}</td>
                <td style={{padding:"10px 12px",textAlign:"right",color:"#db2777"}}>{c.rs}</td>
                <td style={{padding:"10px 12px"}}>{top&&<span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:6,height:6,borderRadius:"50%",background:chColor(top.ch)}}/><span style={{fontSize:11}}>{top.ch} ({top.o})</span></span>}</td>
              </tr>);
            })}
          </tbody>
        </table>
      </div>
      {sel&&(
        <div style={cd}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:12}}>
            <div><div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>{sel.c}{selList.length>1&&<span style={{...f,fontSize:12,fontWeight:600,color:"#0ea5e9",marginLeft:8}}>· {selList.length} countries aggregated</span>}</div><div style={{...f,fontSize:12,color:"#94a3b8"}}>Weekly trend · click channel to filter · {trendLabels[trendMk]}</div></div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>{Object.entries(trendLabels).map(([k,l])=><Pill key={k} label={l} active={trendMk===k} onClick={()=>setTrendMk(k)}/>)}<button onClick={()=>setSelCountries([])} style={{...f,padding:"5px 12px",borderRadius:20,border:"1.5px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:11}}>Clear</button></div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <div onClick={()=>setSelChTrend("All")} style={{background:selChTrend==="All"?"#0f172a14":"#fff",border:`1.5px solid ${selChTrend==="All"?"#0f172a":"#e2e8f0"}`,borderRadius:8,padding:"8px 12px",cursor:"pointer"}}>
              <div style={{...f,fontSize:9,color:"#0f172a",fontWeight:700,textTransform:"uppercase"}}>All</div>
              <div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>{sel.o}</div>
            </div>
            {sel.chs&&sel.chs.map(ch=>(
              <div key={ch.ch} onClick={()=>setSelChTrend(selChTrend===ch.ch?"All":ch.ch)} style={{background:selChTrend===ch.ch?chColor(ch.ch)+"14":"#fff",border:`1.5px solid ${selChTrend===ch.ch?chColor(ch.ch):"#e2e8f0"}`,borderRadius:8,padding:"8px 12px",cursor:"pointer"}}>
                <div style={{...f,fontSize:9,color:chColor(ch.ch),fontWeight:700,textTransform:"uppercase"}}>{ch.ch}</div>
                <div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>{ch.o}</div>
                <div style={{...f,fontSize:10,color:"#64748b"}}>{fmt(ch.a)} · ASV {fmt(ch.v)}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={trendData} margin={{left:10,right:10,top:25,bottom:0}} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:9,...f}} angle={-35} textAnchor="end" height={50} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v=>trendMk==="o"?v:fmt(v)}/>
              <Bar dataKey={trendMk} fill={selChTrend==="All"?"#0f172a":chColor(selChTrend)} radius={[3,3,0,0]} label={{position:"top",fontSize:9,fill:selChTrend==="All"?"#0f172a":chColor(selChTrend),...f,formatter:v=>trendMk==="o"?v:fmt(v)}}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA LOADER — fetch MVs, build the in-memory shape the tabs expect
// ══════════════════════════════════════════════════════════════════════════════
function buildModel(raw){
  const { pulse, chWk, chOtWk, pageWk, deviceWk, countryWk, sourceWk } = raw;

  // weeks list from pulse
  pulse.sort((a,b)=>a.week_idx-b.week_idx);
  const weeks = pulse.map(p=>({ idx:p.week_idx, start:p.week_start, label:wkLabel(p.week_idx,p.week_start) }));
  const pulseL = pulse.map(p=>({ ...p, label:wkLabel(p.week_idx,p.week_start) }));
  const lastIdx = weeks.length? weeks[weeks.length-1].idx : 0;
  const latestLabel = weeks.length? weeks[weeks.length-1].label : "—";

  // channel set ordered by total orders (non-tel), excluding nothing
  const chTotals={};
  chWk.forEach(r=>{ chTotals[r.channel]=(chTotals[r.channel]||0)+r.orders; });
  const mainChs = Object.keys(chTotals).sort((a,b)=>chTotals[b]-chTotals[a]);

  // index chWk: [idx][channel]
  const chIdx={}, weekTotals={};
  chWk.forEach(r=>{
    (chIdx[r.week_idx] ||= {})[r.channel] = { orders:r.orders, amount:+r.amount, new_sip:r.new_sip, repeat_sip:r.repeat_sip, brand_new:r.brand_new, asv:r.asv };
    const t=(weekTotals[r.week_idx] ||= {orders:0,amount:0,new_sip:0,repeat_sip:0,brand_new:0});
    t.orders+=r.orders; t.amount+=+r.amount; t.new_sip+=r.new_sip; t.repeat_sip+=r.repeat_sip; t.brand_new+=r.brand_new;
  });

  // chOtWk: [idx][channel][order_type]  + otWkTotals[idx][ot]
  const chOtIdx={}, otWkTotals={};
  chOtWk.forEach(r=>{
    (((chOtIdx[r.week_idx] ||= {})[r.channel] ||= {}))[r.order_type] = { orders:r.orders, amount:+r.amount, asv:r.asv };
    const t=((otWkTotals[r.week_idx] ||= {})[r.order_type] ||= {orders:0,amount:0});
    t.orders+=r.orders; t.amount+=+r.amount;
  });

  // pageWk: [idx][page]
  const pageIdx={}, pageSet={};
  pageWk.forEach(r=>{ (pageIdx[r.week_idx] ||= {})[r.page]=r.orders; pageSet[r.page]=(pageSet[r.page]||0)+r.orders; });
  const PAGE_ORDER=["sip_payment_standalone","sip_inactive","sip_welcome","sip_welcome_failed","stories","thank_you","fundraiser","Blank"];
  const pages=[...PAGE_ORDER.filter(p=>pageSet[p]), ...Object.keys(pageSet).filter(p=>!PAGE_ORDER.includes(p))];

  // deviceWk: [idx][channel][device] + deviceWkTotals[idx][device]
  const devIdx={}, devWkTotals={};
  deviceWk.forEach(r=>{
    (((devIdx[r.week_idx] ||= {})[r.channel] ||= {}))[r.device]=r.orders;
    const t=(devWkTotals[r.week_idx] ||= {Desktop:0,Mobile:0,App:0,Other:0});
    t[r.device]=(t[r.device]||0)+r.orders;
  });

  // countryWk: [idx][country][channel] + countryWkTotals[idx][country] + countryAgg cumulative
  const cWkIdx={}, cWkTotals={}, cAgg={};
  countryWk.forEach(r=>{
    (((cWkIdx[r.week_idx] ||= {})[r.country] ||= {}))[r.channel] = { orders:r.orders, amount:+r.amount, new_sip:r.new_sip, repeat_sip:r.repeat_sip };
    const t=((cWkTotals[r.week_idx] ||= {})[r.country] ||= {orders:0,amount:0});
    t.orders+=r.orders; t.amount+=+r.amount;
    const g=(cAgg[r.country] ||= {c:r.country,o:0,a:0,ns:0,rs:0,_ch:{}});
    g.o+=r.orders; g.a+=+r.amount; g.ns+=r.new_sip; g.rs+=r.repeat_sip;
    const gc=(g._ch[r.channel] ||= {ch:r.channel,o:0,a:0});
    gc.o+=r.orders; gc.a+=+r.amount;
  });
  const countryAgg=Object.values(cAgg).map(g=>({
    ...g, v: g.o>0?Math.round(g.a/g.o):0,
    chs: Object.values(g._ch).map(c=>({...c,v:c.o>0?Math.round(c.a/c.o):0})).sort((a,b)=>b.o-a.o)
  })).sort((a,b)=>b.o-a.o);

  // country list for ASV filter (India + top intl by orders)
  const countryList=["All", ...countryAgg.slice(0,6).map(c=>c.c)];

  // benchmarks: current week vs prev week, trailing 12w avg, trailing 24w avg
  const idxList=weeks.map(w=>w.idx);
  const curIdx=lastIdx, prevIdx=curIdx-1;
  const win = (n)=> idxList.filter(i=> i<curIdx && i>=curIdx-n);
  const w12=win(12), w24=win(24);
  const bench={};
  const chListForBench=[...mainChs,"Total"];
  chListForBench.forEach(ch=>{
    const get=(idx)=> ch==="Total" ? weekTotals[idx] : chIdx[idx]?.[ch];
    const cur=get(curIdx)||{orders:0,amount:0,new_sip:0,repeat_sip:0};
    const prev=get(prevIdx)||{orders:0};
    const a12={ o:Math.round(avg(w12.map(i=>get(i)?.orders||0))) };
    const a24={ o:Math.round(avg(w24.map(i=>get(i)?.orders||0))) };
    bench[ch]={
      c:{ o:cur.orders, a:cur.amount, v:cur.orders>0?Math.round(cur.amount/cur.orders):0, ns:cur.new_sip||0, rs:cur.repeat_sip||0 },
      p:{ o:prev.orders||0 }, a12, a24
    };
  });

  // ── SOURCE × MEDIUM per channel ── index by [channel][src|med][week_idx]=orders/amount/...
  // then compute, per channel, a list of {source,medium} rows with current-week + WoW/12w/24w order bases.
  const srcIdx={};   // srcIdx[channel][key][week_idx] = {orders,amount,new_sip,repeat_sip}
  sourceWk.forEach(r=>{
    const key=r.utm_source+" ||| "+r.utm_medium;
    (((srcIdx[r.channel] ||= {})[key] ||= {}))[r.week_idx] = { orders:r.orders, amount:+r.amount, new_sip:r.new_sip, repeat_sip:r.repeat_sip, source:r.utm_source, medium:r.utm_medium };
  });
  // "All" channel: aggregate the same source|medium buckets across every channel, per week
  const allSrc={};
  Object.keys(srcIdx).forEach(ch=>{
    Object.entries(srcIdx[ch]).forEach(([key,byWk])=>{
      const dst=(allSrc[key] ||= {});
      Object.entries(byWk).forEach(([wi,v])=>{
        const d=(dst[wi] ||= { orders:0, amount:0, new_sip:0, repeat_sip:0, source:v.source, medium:v.medium });
        d.orders+=v.orders; d.amount+=v.amount; d.new_sip+=v.new_sip; d.repeat_sip+=v.repeat_sip;
      });
    });
  });
  srcIdx["All"]=allSrc;

  const srcBench={};  // srcBench[channel] = [ {source,medium,c:{o,a,v,ns,rs}, p:{o}, a12:{o}, a24:{o}} ... ] sorted by current orders desc
  Object.keys(srcIdx).forEach(ch=>{
    const rows=[];
    Object.values(srcIdx[ch]).forEach(byWk=>{
      const cur=byWk[curIdx], any=Object.values(byWk)[0];
      const source=(cur||any).source, medium=(cur||any).medium;
      const o=cur?.orders||0, a=cur?.amount||0;
      const prev=byWk[prevIdx]?.orders||0;
      const a12=Math.round(avg(w12.map(i=>byWk[i]?.orders||0)));
      const a24=Math.round(avg(w24.map(i=>byWk[i]?.orders||0)));
      rows.push({ source, medium,
        c:{ o, a, v:o>0?Math.round(a/o):0, ns:cur?.new_sip||0, rs:cur?.repeat_sip||0 },
        p:{o:prev}, a12:{o:a12}, a24:{o:a24} });
    });
    srcBench[ch]=rows.sort((x,y)=>y.c.o-x.c.o);
  });

  return { weeks, pulse:pulseL, mainChs, chWk:chIdx, weekTotals, chOtWk:chOtIdx, otWkTotals,
           pageWk:pageIdx, pages, deviceWk:devIdx, deviceWkTotals:devWkTotals,
           countryWk:cWkIdx, countryWkTotals:cWkTotals, countryAgg, countryList,
           bench, srcBench, latestLabel, lastIdx };
}

// ══════════════════════════════════════════════════════════════════════════════
// APP SHELL
// ══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]=useState("scorecard");
  const [D,setD]=useState(null);
  const [err,setErr]=useState(null);

  useEffect(()=>{
    (async()=>{
      try{
        const [pulse,chWk,chOtWk,pageWk,deviceWk,countryWk,sourceWk]=await Promise.all([
          sb("mv_sip_pulse","&order=week_idx.asc"),
          sb("mv_sip_channel_week"),
          sb("mv_sip_channel_ot_week"),
          sb("mv_sip_page_week"),
          sb("mv_sip_device_week"),
          sb("mv_sip_country_week"),
          sb("mv_sip_source_week"),
        ]);
        setD(buildModel({pulse,chWk,chOtWk,pageWk,deviceWk,countryWk,sourceWk}));
      }catch(e){ setErr(e.message); }
    })();
  },[]);

  const tabs=[
    {k:"scorecard",l:"Weekly Scorecard"},
    {k:"pulse",l:"SIP Pulse & Benchmarks"},
    {k:"donor",l:"Donor Quality"},
    {k:"pagedevice",l:"Page & Device"},
    {k:"country",l:"Country Insights"},
  ];

  const latestTel = D?.pulse?.length ? D.pulse[D.pulse.length-1] : null;

  return(
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{minHeight:"100vh",background:"#f8fafc",...f}}>
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"16px 28px"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{...f,fontSize:17,fontWeight:700,color:"#0f172a"}}>Ketto SIP</span>
                <span style={{...f,fontSize:12,background:"#f1f5f9",color:"#64748b",padding:"2px 10px",borderRadius:20,fontWeight:500}}>Weekly Report</span>
                {D&&<span style={{...f,fontSize:12,background:"#fff7ed",color:"#f97316",padding:"2px 10px",borderRadius:20,fontWeight:500,border:"1px solid #fed7aa"}}>{D.latestLabel}</span>}
                <span style={{...f,fontSize:12,background:"#f0fdf4",color:"#059669",padding:"2px 10px",borderRadius:20,fontWeight:500,border:"1px solid #bbf7d0"}}>Live · Supabase</span>
                <a href="/monthly.html" style={{...f,fontSize:12,background:"#eef2ff",color:"#4f46e5",padding:"2px 10px",borderRadius:20,fontWeight:500,border:"1px solid #c7d2fe",textDecoration:"none"}}>Monthly →</a>
              </div>
              <div style={{...f,fontSize:12,color:"#94a3b8"}}>Weeks anchored Mon Nov 3 2025 · WoW · 12-week · 24-week · Non-Tel focus · ₹ INR-converted</div>
            </div>
            {latestTel&&(
              <div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10,padding:"8px 18px",textAlign:"center"}}>
                <div style={{...f,fontSize:10,color:"#f97316",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>Telecalling ({D.latestLabel})</div>
                <div style={{...f,fontSize:22,fontWeight:700,color:"#f97316"}}>{latestTel.tel_orders.toLocaleString()}</div>
                <div style={{...f,fontSize:10,color:"#94a3b8"}}>orders · view only</div>
              </div>
            )}
          </div>
        </div>

        <div style={{padding:"20px 28px",maxWidth:1440,margin:"0 auto"}}>
          {err && <div style={{...cd,borderColor:"#fecaca",background:"#fef2f2",color:"#b91c1c",fontSize:13}}>Failed to load data: {err}<br/><span style={{fontSize:11,color:"#94a3b8"}}>Make sure the MVs are created and granted to the anon role (run sip_weekly_mvs.sql, then SELECT refresh_sip_weekly()).</span></div>}
          {!D && !err && <div style={{...f,padding:60,textAlign:"center",color:"#94a3b8",fontSize:14}}>Loading weekly data from Supabase…</div>}
          {D && (
            <>
              <div style={{borderBottom:"1px solid #e2e8f0",marginBottom:22,display:"flex",flexWrap:"wrap"}}>
                {tabs.map(t=><TabBtn key={t.k} label={t.l} active={tab===t.k} onClick={()=>setTab(t.k)}/>)}
              </div>
              {tab==="scorecard"&&<ScorecardTab D={D}/>}
              {tab==="pulse"&&<PulseTab D={D}/>}
              {tab==="donor"&&<DonorTab D={D}/>}
              {tab==="pagedevice"&&<PageDeviceTab D={D}/>}
              {tab==="country"&&<CountryTab D={D}/>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
