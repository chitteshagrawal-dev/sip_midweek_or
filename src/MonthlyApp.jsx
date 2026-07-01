import { useState, useMemo, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line } from "recharts";
import RetentionTab from "./RetentionTab.jsx";

// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG  ·  reads the monthly materialized views live (anon key)
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
const CC = { "DM":"#7c3aed","CRM":"#059669","Platform":"#0ea5e9","Share":"#f59e0b","Social Media Team":"#db2777","SEO":"#84cc16","Update":"#6366f1","Referral":"#14b8a6","Others":"#f43f5e","Null":"#94a3b8","Total":"#0f172a" };
const chColor = ch => CC[ch] || "#94a3b8";
const OT_LABELS = { "All":"All Orders","normal_order":"Normal Order","main_order":"Main Order" };

const f = { fontFamily:"'DM Sans',sans-serif" };
const fmt = n => n>=10000000?`₹${(n/10000000).toFixed(2)}Cr`:n>=100000?`₹${(n/100000).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n)}`;
const fN = n => typeof n==='number'?(n>=1000?`${(n/1000).toFixed(1)}K`:String(Math.round(n))):n;
const pct = (c,b) => b&&b!==0?((c-b)/b*100).toFixed(1):null;
const tt = { background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,fontSize:11,...f,boxShadow:"0 4px 12px rgba(0,0,0,.08)" };
const cd = { background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"18px 20px" };

// month label: "May 2025" style from month_start
const moLabel = (idx, start) => {
  const d = new Date(start + "T00:00:00");
  return d.toLocaleString("en-US",{month:"short",year:"2-digit"});
};
const moLabelLong = (start) => {
  const d = new Date(start + "T00:00:00");
  return d.toLocaleString("en-US",{month:"long",year:"numeric"});
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

// mono font for the scorecard (terminal/exec aesthetic from the reference)
const mono = { fontFamily:"'IBM Plex Mono','DM Mono',ui-monospace,monospace" };

// ══════════════════════════════════════════════════════════════════════════════
// TAB 0 — MONTHLY SCORECARD (exec view)  ·  per-channel KPI cards, latest vs prev
// ══════════════════════════════════════════════════════════════════════════════
// KPI delta row: MoM / 3mo / 6mo / All
function DeltaRows({ cur, prev, a3, a6, aAll }){
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
  return <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:6}}>{row("MoM",prev)}{row("3mo",a3)}{row("6mo",a6)}{row("All",aAll)}</div>;
}

// one KPI block (label, big value, deltas)
function Kpi({ label, value, cur, prev, a3, a6, aAll }){
  return(
    <div>
      <div style={{...mono,fontSize:11,color:"#64748b",letterSpacing:".04em",marginBottom:4}}>{label}</div>
      <div style={{...f,fontSize:30,fontWeight:700,color:"#0f172a",lineHeight:1,marginBottom:8}}>{value}</div>
      <DeltaRows cur={cur} prev={prev} a3={a3} a6={a6} aAll={aAll}/>
    </div>
  );
}

// builds the 4 KPI values + comparison bases for a given month index
function monthKpis(D, ch, idx){
  const get=(i)=> ch==="Total" ? D.monthTotals[i] : D.chMo[i]?.[ch];
  const r=get(idx)||{orders:0,amount:0,brand_new:0};
  const idxList=D.months.map(w=>w.idx);
  const win=(n)=> idxList.filter(i=> i<idx && i>=idx-n);
  const winAll=()=> idxList.filter(i=> i<idx);
  const w3=win(3), w6=win(6), wAll=winAll();
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
    a3:m(w3), a6:m(w6), aAll:m(wAll)
  };
}

function ScoreCard({ D, ch, idx, variant }){
  const k=monthKpis(D,ch,idx);
  const mo=D.months.find(w=>w.idx===idx);
  const latest=variant==="latest";
  const dateLong=mo?moLabelLong(mo.start):"—";
  return(
    <div style={{background:"#fff",border:"1px solid #e2e8f0",borderLeft:latest?`4px solid ${chColor(ch)}`:"1px solid #e2e8f0",borderRadius:14,padding:"22px 26px",flex:1,minWidth:340}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <span style={{...mono,fontSize:12,color:"#64748b",letterSpacing:".06em",textTransform:"uppercase"}}>Month of {dateLong}</span>
        <span style={{...mono,fontSize:10,fontWeight:700,letterSpacing:".06em",padding:"2px 9px",borderRadius:6,background:latest?chColor(ch):"#f1f5f9",color:latest?"#fff":"#64748b"}}>{latest?"LATEST":"PREVIOUS"}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px 28px"}}>
        <Kpi label="Total Donation" value={fmt(k.cur.a)} cur={k.cur.a} prev={k.prev.a} a3={k.a3.a} a6={k.a6.a} aAll={k.aAll.a}/>
        <Kpi label="Total Orders"   value={fN(k.cur.o)}  cur={k.cur.o} prev={k.prev.o} a3={k.a3.o} a6={k.a6.o} aAll={k.aAll.o}/>
        <Kpi label="Avg Ticket Size" value={fmt(k.cur.v)} cur={k.cur.v} prev={k.prev.v} a3={k.a3.v} a6={k.a6.v} aAll={k.aAll.v}/>
        <Kpi label="Brand-New Donors" value={fN(k.cur.bn)} cur={k.cur.bn} prev={k.prev.bn} a3={k.a3.bn} a6={k.a6.bn} aAll={k.aAll.bn}/>
      </div>
    </div>
  );
}

function ScorecardTab({ D }){
  const channels=D.mainChs;
  const [ch,setCh]=useState(channels[0]);
  const lastIdx=D.lastIdx;
  const prevIdx=lastIdx-1;

  // health verdict: weighted on orders + donation MoM
  const k=monthKpis(D,ch,lastIdx);
  const oW=pct(k.cur.o,k.prev.o), aW=pct(k.cur.a,k.prev.a);
  const score=(parseFloat(oW||0)+parseFloat(aW||0))/2;
  const verdict= score> 5 ? {t:"Good",c:"#059669",bg:"#f0fdf4",bd:"#bbf7d0"} : score < -5 ? {t:"Bad",c:"#dc2626",bg:"#fef2f2",bd:"#fecaca"} : {t:"Flat",c:"#d97706",bg:"#fffbeb",bd:"#fde68a"};

  // 12-month trend (or all available)
  const trend=D.months.slice(-12).map(w=>{
    const c= ch==="Total"?D.monthTotals[w.idx]:D.chMo[w.idx]?.[ch];
    return { m:w.label, donation:c?Math.round(+c.amount/1000):0, orders:c?c.orders:0, brand:c?c.brand_new:0 };
  });

  return(
    <div>
      {/* channel selector */}
      <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
        {channels.map(c=><Pill key={c} label={c} active={ch===c} onClick={()=>setCh(c)} color={chColor(c)}/>)}
      </div>

      {/* heading + verdict + deep dive */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{...f,fontSize:26,fontWeight:700,color:"#0f172a"}}>{ch}</span>
          <span style={{...mono,fontSize:12,fontWeight:700,padding:"3px 12px",borderRadius:20,background:verdict.bg,color:verdict.c,border:`1px solid ${verdict.bd}`}}>{verdict.t}</span>
        </div>
        <span style={{...f,fontSize:13,fontWeight:600,color:"#4f46e5",cursor:"default"}}>Deep Dive in other tabs →</span>
      </div>

      {/* scorecards: latest vs previous */}
      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:26}}>
        <ScoreCard D={D} ch={ch} idx={lastIdx} variant="latest"/>
        {prevIdx>=0 && <ScoreCard D={D} ch={ch} idx={prevIdx} variant="previous"/>}
      </div>

      {/* trend */}
      <div style={{...mono,fontSize:11,letterSpacing:".1em",color:"#94a3b8",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",paddingBottom:8,marginBottom:16,display:"flex",justifyContent:"space-between"}}>
        <span>Monthly Trend</span><span>Last {trend.length} months</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>Total Donation</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Monthly donation trend (₹K)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{left:10,right:10,top:20,bottom:0}} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={48} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v=>`₹${v}K`}/>
              <Bar dataKey="donation" fill={chColor(ch)} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>Orders &amp; Brand-New Donors</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Monthly volume</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{left:10,right:10,top:10,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={48} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt}/>
              <Line type="monotone" dataKey="orders" stroke="#0f172a" strokeWidth={2} dot={{r:2}} name="Orders"/>
              <Line type="monotone" dataKey="brand" stroke="#059669" strokeWidth={2} dot={{r:2}} name="Brand-New"/>
              <Legend formatter={v=><span style={{...f,fontSize:11,color:"#64748b"}}>{v}</span>}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SOURCE × MEDIUM — latest month, with MoM/3mo/6mo/All on orders */}
      <div style={{...cd,padding:0,overflow:"hidden",marginTop:20}}>
        <div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0"}}>
          <div style={{...f,fontSize:17,fontWeight:700,color:"#0f172a"}}>{ch} — Source × Medium</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginTop:2}}>Latest month ({D.latestLabel}) · deltas on orders vs MoM / trailing 3-month avg / trailing 6-month avg / all-time avg</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:13}}>
            <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".04em"}}>
              {["Source","Medium","Orders","Amount","ASV","New","Rep","MoM","3mo","6mo","All"].map(h=>
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
                  <td style={{padding:"12px 16px",textAlign:"right"}}><Dt c={r.c.o} b={r.a3.o}/></td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}><Dt c={r.c.o} b={r.a6.o}/></td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}><Dt c={r.c.o} b={r.aAll.o}/></td>
                </tr>
              ))}
              {(!D.srcBench[ch]||D.srcBench[ch].filter(r=>r.c.o>0||r.p.o>0).length===0)&&(
                <tr><td colSpan={11} style={{padding:"20px 16px",textAlign:"center",color:"#94a3b8",...f,fontSize:13}}>No source/medium activity for {ch} in the latest or previous month.</td></tr>
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
  const [asvCountry,setAsvCountry]=useState("All");
  const [asvOT,setAsvOT]=useState("All");
  const [asvChs,setAsvChs]=useState(["All",...D.mainChs.slice(0,4)]);

  // 1. pulse
  const pulseData = D.pulse.map(p=>{
    if(mk==="orders") return { m:p.label, Tel:view!=="non_tel"?p.tel_orders:0, NonTel:view!=="tel"?p.nontel_orders:0, total:p.tel_orders+p.nontel_orders };
    return { m:p.label, Tel:view!=="non_tel"?Math.round(p.tel_amount/1000):0, NonTel:view!=="tel"?Math.round(p.nontel_amount/1000):0 };
  });

  // 2. channel stack (non-tel)
  const stackData = D.months.map(w=>{
    const row={ m:w.label };
    D.mainChs.forEach(ch=>{ const c=D.chMo[w.idx]?.[ch]; row[ch]= c ? (mk==="orders"?c.orders:Math.round(c.amount/1000)) : 0; });
    return row;
  });

  // 3. ASV trend (country / order-type filtered)
  const asvData = D.months.map(w=>{
    const row={ m:w.label };
    asvChs.forEach(ch=>{
      let o=0,a=0;
      if(asvCountry!=="All"){ const c=D.countryMo[w.idx]?.[asvCountry]?.[ch]; if(c){o=c.orders;a=c.amount;} }
      else if(asvOT!=="All"){ const c=D.chOtMo[w.idx]?.[ch]?.[asvOT]; if(c){o=c.orders;a=c.amount;} }
      else { const c= ch==="All"? D.monthTotals[w.idx] : D.chMo[w.idx]?.[ch]; if(c){o=c.orders;a=c.amount;} }
      if(asvCountry!=="All" && ch==="All"){ const t=D.countryMoTotals[w.idx]?.[asvCountry]; if(t){o=t.orders;a=t.amount;} }
      if(asvOT!=="All" && ch==="All"){ const t=D.otMoTotals[w.idx]?.[asvOT]; if(t){o=t.orders;a=t.amount;} }
      row[ch]= o>0? Math.round(a/o):0;
    });
    return row;
  });

  // 4. benchmark table — current month vs prev / 3mo / 6mo / all
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
            <div style={{...f,fontSize:12,color:"#94a3b8"}}>{D.months.length} months · Telecalling vs Non-Telecalling · numbers on bars</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            {[["all","All"],["non_tel","Non-Tel"],["tel","Telecalling"]].map(([k,l])=><Pill key={k} label={l} active={view===k} onClick={()=>setView(k)}/>)}
            <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 4px"}}/>
            {[["orders","Orders"],["amount","Amount (₹K)"]].map(([k,l])=><Pill key={k} label={l} active={mk===k} onClick={()=>setMk(k)} color="#7c3aed"/>)}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={pulseData} margin={{left:10,right:10,top:25,bottom:0}} barSize={view==="all"?20:28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt} formatter={v=>mk==="amount"?`₹${v}K`:v}/>
            {view!=="non_tel"&&<Bar dataKey="Tel" stackId="a" fill="#f97316" label={view==="tel"?barLabel("#f97316"):barLabel("#fff",true)}/>}
            {view!=="tel"&&<Bar dataKey="NonTel" stackId="a" fill="#0f172a" radius={[3,3,0,0]} label={barLabel("#0f172a")}/>}
            <Legend formatter={v=><span style={{...f,fontSize:11,color:"#64748b"}}>{v==="Tel"?"Telecalling":"Non-Telecalling"}</span>}/>
          </BarChart>
        </ResponsiveContainer>
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
        <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Stacked · {mk==="orders"?"order count":"amount (₹K)"} per channel per month</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={stackData} margin={{left:10,right:10,top:10,bottom:0}} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={tt} formatter={v=>mk==="amount"?`₹${v}K`:v}/>
            {D.mainChs.map((ch,i)=><Bar key={ch} dataKey={ch} stackId="a" fill={chColor(ch)} radius={i===D.mainChs.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
            <Legend formatter={v=><span style={{...f,fontSize:10,color:"#64748b"}}>{v}</span>}/>
          </BarChart>
        </ResponsiveContainer>
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
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
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
          <div style={{...f,fontSize:12,color:"#94a3b8"}}>Non-Tel channels · vs prev month, trailing 3-month avg, trailing 6-month avg, all-time avg</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:12}}>
            <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:10,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em"}}>
              {["Channel","Orders","vs MoM","vs 3M","vs 6M","vs All","Amount","ASV","New SIP","Rep SIP"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:h==="Channel"?"left":"right",fontWeight:600}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {benchRows.map((ch,i)=>{
                const d2=chb[ch];if(!d2)return null;const isT=ch==="Total";
                return(<tr key={ch} style={{borderBottom:"1px solid #f1f5f9",background:isT?"#f0f9ff":i%2===0?"#fff":"#fafbfc",fontWeight:isT?700:400}}>
                  <td style={{padding:"10px 12px",color:isT?"#0f172a":chColor(ch),fontWeight:600}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}>{!isT&&<span style={{width:7,height:7,borderRadius:"50%",background:chColor(ch),display:"inline-block"}}/>}{isT?"Total Non-Tel":ch}</span></td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#0f172a",fontSize:14}}>{d2.c.o}</td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.p.o}/></td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.a3.o}/></td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.a6.o}/></td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}><Dt c={d2.c.o} b={d2.aAll.o}/></td>
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
  const splitData = D.months.map(w=>{
    let ns=0,rs=0;
    if(selCh==="All"){ const t=D.monthTotals[w.idx]; if(t){ns=t.new_sip;rs=t.repeat_sip;} }
    else { const c=D.chMo[w.idx]?.[selCh]; if(c){ns=c.new_sip;rs=c.repeat_sip;} }
    return { m:w.label, "New SIP":ns, "Repeat SIP":rs };
  });
  const brandData = D.months.map(w=>({ m:w.label, brand:D.monthTotals[w.idx]?.brand_new||0 }));

  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {["All",...D.mainChs].map(c=><Pill key={c} label={c} active={selCh===c} onClick={()=>setSelCh(c)} color={chColor(c)}/>)}
      </div>
      <div style={{...cd,marginBottom:16}}>
        <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>New vs Repeat SIP — Monthly{selCh!=="All"?` · ${selCh}`:""}</div>
        <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Based on donor_type_on_sip_order · stacked order count</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={splitData} margin={{left:10,right:10,top:20,bottom:0}} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
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
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={brandData} margin={{left:10,right:10,top:25,bottom:0}} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
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
  const pageData = D.months.map(w=>{ const row={m:w.label}; D.pages.forEach(p=>{row[p]=D.pageMo[w.idx]?.[p]||0;}); return row; });
  const dvData = D.months.map(w=>{
    const src = selCh==="All" ? D.deviceMoTotals[w.idx] : D.deviceMo[w.idx]?.[selCh];
    return { m:w.label, Desktop:src?.Desktop||0, Mobile:src?.Mobile||0, App:src?.App||0 };
  });
  const latest=D.months[D.months.length-1];

  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {["All",...D.mainChs].map(c=><Pill key={c} label={c} active={selCh===c} onClick={()=>setSelCh(c)} color={chColor(c)}/>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>Page Type — Monthly</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Where non-tel SIP orders are created · "Blank" = page not captured</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pageData} margin={{left:10,right:10,top:5,bottom:0}} barSize={26}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
              <Tooltip contentStyle={tt}/>
              {D.pages.map((p,i)=><Bar key={p} dataKey={p} stackId="a" fill={pgClr[p]||"#94a3b8"} radius={i===D.pages.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
              <Legend formatter={v=><span style={{...f,fontSize:9,color:"#64748b"}}>{v}{v==="sip_welcome_failed"?" ⚠":""}</span>}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={cd}>
          <div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:2}}>Device Split — Monthly{selCh!=="All"?` · ${selCh}`:""}</div>
          <div style={{...f,fontSize:12,color:"#94a3b8",marginBottom:14}}>Select channel above to filter</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dvData} margin={{left:10,right:10,top:5,bottom:0}} barSize={26}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
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
              const src=latest?D.deviceMo[latest.idx]?.[ch]:null;
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
  const [selCountry,setSelCountry]=useState(null);
  const [selChTrend,setSelChTrend]=useState("All");
  const [trendMk,setTrendMk]=useState("o");
  const trendLabels={"o":"Orders","a":"Amount (₹)","v":"ASV (₹)"};

  const india=D.countryAgg.find(c=>c.c==="India");
  const intl=D.countryAgg.filter(c=>c.c!=="India").slice(0,12);
  const sel=D.countryAgg.find(c=>c.c===selCountry);

  const trendData = sel ? D.months.map(w=>{
    let o=0,a=0;
    if(selChTrend==="All"){ const t=D.countryMoTotals[w.idx]?.[sel.c]; if(t){o=t.orders;a=t.amount;} }
    else { const c=D.countryMo[w.idx]?.[sel.c]?.[selChTrend]; if(c){o=c.orders;a=c.amount;} }
    return { m:w.label, o, a, v:o>0?Math.round(a/o):0 };
  }) : [];

  return(
    <div>
      {india&&(
        <div onClick={()=>{setSelCountry(selCountry==="India"?null:"India");setSelChTrend("All");}} style={{...cd,border:"1.5px solid #fed7aa",background:"#fffbf5",marginBottom:14,cursor:"pointer"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>🇮🇳</span>
              <div><div style={{...f,fontSize:15,fontWeight:700,color:"#0f172a"}}>India</div><div style={{...f,fontSize:11,color:"#94a3b8"}}>Click to expand trend + channels</div></div>
            </div>
            {[["Orders",fN(india.o),"#0f172a"],["Amount",fmt(india.a),"#7c3aed"],["ASV",fmt(india.v),"#059669"],["New SIP",india.ns,"#0ea5e9"],["Repeat",india.rs,"#db2777"]].map(([l,v,c])=>(
              <div key={l} style={{textAlign:"center"}}><div style={{...f,fontSize:10,color:"#94a3b8",textTransform:"uppercase",fontWeight:600,marginBottom:2}}>{l}</div><div style={{...f,fontSize:18,fontWeight:700,color:c}}>{v}</div></div>
            ))}
          </div>
        </div>
      )}
      <div style={{...cd,padding:0,overflow:"hidden",marginBottom:16}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",...f,fontSize:14,fontWeight:600}}>International — {intl.length} countries · ₹ INR-converted · cumulative non-tel</div>
        <table style={{width:"100%",borderCollapse:"collapse",...f,fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #e2e8f0",fontSize:10,color:"#94a3b8",textTransform:"uppercase"}}>
            {["Country","Orders","Amount","ASV","New SIP","Repeat","Top Channel"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:h==="Country"||h==="Top Channel"?"left":"right",fontWeight:600}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {intl.map((c,i)=>{ const top=c.chs&&c.chs[0];
              return(<tr key={i} onClick={()=>{setSelCountry(c.c===selCountry?null:c.c);setSelChTrend("All");}} style={{borderBottom:"1px solid #f1f5f9",background:selCountry===c.c?"#f0f9ff":i%2===0?"#fff":"#fafbfc",cursor:"pointer"}}>
                <td style={{padding:"10px 12px",fontWeight:500,color:"#1e293b"}}>{c.c}</td>
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
            <div><div style={{...f,fontSize:16,fontWeight:700,color:"#0f172a"}}>{sel.c}</div><div style={{...f,fontSize:12,color:"#94a3b8"}}>Monthly trend · click channel to filter · {trendLabels[trendMk]}</div></div>
            <div style={{display:"flex",gap:6}}>{Object.entries(trendLabels).map(([k,l])=><Pill key={k} label={l} active={trendMk===k} onClick={()=>setTrendMk(k)}/>)}</div>
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
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trendData} margin={{left:10,right:10,top:25,bottom:0}} barSize={26}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10,...f}} angle={-30} textAnchor="end" height={50} interval={0}/>
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
  const { pulse, chMo, chOtMo, pageMo, deviceMo, countryMo, sourceMo } = raw;

  // months list from pulse
  pulse.sort((a,b)=>a.month_idx-b.month_idx);
  const months = pulse.map(p=>({ idx:p.month_idx, start:p.month_start, label:moLabel(p.month_idx,p.month_start) }));
  const pulseL = pulse.map(p=>({ ...p, label:moLabel(p.month_idx,p.month_start) }));
  const lastIdx = months.length? months[months.length-1].idx : 0;
  const latestLabel = months.length? moLabelLong(months[months.length-1].start) : "—";

  // channel set ordered by total orders (non-tel)
  const chTotals={};
  chMo.forEach(r=>{ chTotals[r.channel]=(chTotals[r.channel]||0)+r.orders; });
  const mainChs = Object.keys(chTotals).sort((a,b)=>chTotals[b]-chTotals[a]);

  // index chMo: [idx][channel]
  const chIdx={}, monthTotals={};
  chMo.forEach(r=>{
    (chIdx[r.month_idx] ||= {})[r.channel] = { orders:r.orders, amount:+r.amount, new_sip:r.new_sip, repeat_sip:r.repeat_sip, brand_new:r.brand_new, asv:r.asv };
    const t=(monthTotals[r.month_idx] ||= {orders:0,amount:0,new_sip:0,repeat_sip:0,brand_new:0});
    t.orders+=r.orders; t.amount+=+r.amount; t.new_sip+=r.new_sip; t.repeat_sip+=r.repeat_sip; t.brand_new+=r.brand_new;
  });

  // chOtMo: [idx][channel][order_type]  + otMoTotals[idx][ot]
  const chOtIdx={}, otMoTotals={};
  chOtMo.forEach(r=>{
    (((chOtIdx[r.month_idx] ||= {})[r.channel] ||= {}))[r.order_type] = { orders:r.orders, amount:+r.amount, asv:r.asv };
    const t=((otMoTotals[r.month_idx] ||= {})[r.order_type] ||= {orders:0,amount:0});
    t.orders+=r.orders; t.amount+=+r.amount;
  });

  // pageMo: [idx][page]
  const pageIdx={}, pageSet={};
  pageMo.forEach(r=>{ (pageIdx[r.month_idx] ||= {})[r.page]=r.orders; pageSet[r.page]=(pageSet[r.page]||0)+r.orders; });
  const PAGE_ORDER=["sip_payment_standalone","sip_inactive","sip_welcome","sip_welcome_failed","stories","thank_you","fundraiser","Blank"];
  const pages=[...PAGE_ORDER.filter(p=>pageSet[p]), ...Object.keys(pageSet).filter(p=>!PAGE_ORDER.includes(p))];

  // deviceMo: [idx][channel][device] + deviceMoTotals[idx][device]
  const devIdx={}, devMoTotals={};
  deviceMo.forEach(r=>{
    (((devIdx[r.month_idx] ||= {})[r.channel] ||= {}))[r.device]=r.orders;
    const t=(devMoTotals[r.month_idx] ||= {Desktop:0,Mobile:0,App:0,Other:0});
    t[r.device]=(t[r.device]||0)+r.orders;
  });

  // countryMo: [idx][country][channel] + countryMoTotals[idx][country] + countryAgg cumulative
  const cMoIdx={}, cMoTotals={}, cAgg={};
  countryMo.forEach(r=>{
    (((cMoIdx[r.month_idx] ||= {})[r.country] ||= {}))[r.channel] = { orders:r.orders, amount:+r.amount, new_sip:r.new_sip, repeat_sip:r.repeat_sip };
    const t=((cMoTotals[r.month_idx] ||= {})[r.country] ||= {orders:0,amount:0});
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

  const countryList=["All", ...countryAgg.slice(0,6).map(c=>c.c)];

  // benchmarks: current month vs prev month, trailing 3mo avg, 6mo avg, all-time avg
  const idxList=months.map(w=>w.idx);
  const curIdx=lastIdx, prevIdx=curIdx-1;
  const win = (n)=> idxList.filter(i=> i<curIdx && i>=curIdx-n);
  const winAll= ()=> idxList.filter(i=> i<curIdx);
  const w3=win(3), w6=win(6), wAll=winAll();
  const bench={};
  const chListForBench=[...mainChs,"Total"];
  chListForBench.forEach(ch=>{
    const get=(idx)=> ch==="Total" ? monthTotals[idx] : chIdx[idx]?.[ch];
    const cur=get(curIdx)||{orders:0,amount:0,new_sip:0,repeat_sip:0};
    const prev=get(prevIdx)||{orders:0};
    const a3={ o:Math.round(avg(w3.map(i=>get(i)?.orders||0))) };
    const a6={ o:Math.round(avg(w6.map(i=>get(i)?.orders||0))) };
    const aAll={ o:Math.round(avg(wAll.map(i=>get(i)?.orders||0))) };
    bench[ch]={
      c:{ o:cur.orders, a:cur.amount, v:cur.orders>0?Math.round(cur.amount/cur.orders):0, ns:cur.new_sip||0, rs:cur.repeat_sip||0 },
      p:{ o:prev.orders||0 }, a3, a6, aAll
    };
  });

  // ── SOURCE × MEDIUM per channel ──
  const srcIdx={};
  sourceMo.forEach(r=>{
    const key=r.utm_source+" ||| "+r.utm_medium;
    (((srcIdx[r.channel] ||= {})[key] ||= {}))[r.month_idx] = { orders:r.orders, amount:+r.amount, new_sip:r.new_sip, repeat_sip:r.repeat_sip, source:r.utm_source, medium:r.utm_medium };
  });
  const srcBench={};
  Object.keys(srcIdx).forEach(ch=>{
    const rows=[];
    Object.values(srcIdx[ch]).forEach(byMo=>{
      const cur=byMo[curIdx], any=Object.values(byMo)[0];
      const source=(cur||any).source, medium=(cur||any).medium;
      const o=cur?.orders||0, a=cur?.amount||0;
      const prev=byMo[prevIdx]?.orders||0;
      const a3=Math.round(avg(w3.map(i=>byMo[i]?.orders||0)));
      const a6=Math.round(avg(w6.map(i=>byMo[i]?.orders||0)));
      const aAll=Math.round(avg(wAll.map(i=>byMo[i]?.orders||0)));
      rows.push({ source, medium,
        c:{ o, a, v:o>0?Math.round(a/o):0, ns:cur?.new_sip||0, rs:cur?.repeat_sip||0 },
        p:{o:prev}, a3:{o:a3}, a6:{o:a6}, aAll:{o:aAll} });
    });
    srcBench[ch]=rows.sort((x,y)=>y.c.o-x.c.o);
  });

  return { months, pulse:pulseL, mainChs, chMo:chIdx, monthTotals, chOtMo:chOtIdx, otMoTotals,
           pageMo:pageIdx, pages, deviceMo:devIdx, deviceMoTotals:devMoTotals,
           countryMo:cMoIdx, countryMoTotals:cMoTotals, countryAgg, countryList,
           bench, srcBench, latestLabel, lastIdx };
}

// ══════════════════════════════════════════════════════════════════════════════
// APP SHELL
// ══════════════════════════════════════════════════════════════════════════════
export default function MonthlyApp(){
  const [tab,setTab]=useState("scorecard");
  const [D,setD]=useState(null);
  const [err,setErr]=useState(null);

  useEffect(()=>{
    (async()=>{
      try{
        const [pulse,chMo,chOtMo,pageMo,deviceMo,countryMo,sourceMo]=await Promise.all([
          sb("mv_sip_pulse_month","&order=month_idx.asc"),
          sb("mv_sip_channel_month"),
          sb("mv_sip_channel_ot_month"),
          sb("mv_sip_page_month"),
          sb("mv_sip_device_month"),
          sb("mv_sip_country_month"),
          sb("mv_sip_source_month"),
        ]);
        setD(buildModel({pulse,chMo,chOtMo,pageMo,deviceMo,countryMo,sourceMo}));
      }catch(e){ setErr(e.message); }
    })();
  },[]);

  const tabs=[
    {k:"scorecard",l:"Monthly Scorecard"},
    {k:"pulse",l:"SIP Pulse & Benchmarks"},
    {k:"donor",l:"Donor Quality"},
    {k:"pagedevice",l:"Page & Device"},
    {k:"country",l:"Country Insights"},
    {k:"retention",l:"Retention"},
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
                <span style={{...f,fontSize:12,background:"#f1f5f9",color:"#64748b",padding:"2px 10px",borderRadius:20,fontWeight:500}}>Monthly Report</span>
                {D&&<span style={{...f,fontSize:12,background:"#fff7ed",color:"#f97316",padding:"2px 10px",borderRadius:20,fontWeight:500,border:"1px solid #fed7aa"}}>{D.latestLabel}</span>}
                <span style={{...f,fontSize:12,background:"#f0fdf4",color:"#059669",padding:"2px 10px",borderRadius:20,fontWeight:500,border:"1px solid #bbf7d0"}}>Live · Supabase</span>
                <a href="/" style={{...f,fontSize:12,background:"#eef2ff",color:"#4f46e5",padding:"2px 10px",borderRadius:20,fontWeight:500,border:"1px solid #c7d2fe",textDecoration:"none"}}>← Weekly</a>
              </div>
              <div style={{...f,fontSize:12,color:"#94a3b8"}}>Monthly grain · MoM · 3-month avg · 6-month avg · All-time avg · Non-Tel focus · ₹ INR-converted</div>
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
          {err && <div style={{...cd,borderColor:"#fecaca",background:"#fef2f2",color:"#b91c1c",fontSize:13}}>Failed to load data: {err}<br/><span style={{fontSize:11,color:"#94a3b8"}}>Make sure the MVs are created and granted to the anon role (run sip_monthly_mvs.sql, then SELECT refresh_sip_monthly()).</span></div>}
          {!D && !err && <div style={{...f,padding:60,textAlign:"center",color:"#94a3b8",fontSize:14}}>Loading monthly data from Supabase…</div>}
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
              {tab==="retention"&&<RetentionTab/>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
