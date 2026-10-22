"use strict";
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const pct = v => v == null ? "—" : (100 * v).toFixed(2) + "%";
  const num = v => v == null ? "—" : Number(v).toFixed(2);
  const labels = {sharpe:"Sharpe ratio",max_drawdown:"Maximum drawdown",factor_alpha_t:"Factor-alpha t-statistic",minimum_fills:"Trade fills",portfolio:"Portfolio treatment"};
  try {
    const response = await fetch("annual-data.json", {cache:"no-store"});
    if (!response.ok) throw new Error("Results could not be loaded");
    const data = await response.json();
    const baseline = data.runs.find(r => r.phase === "research");
    if (!baseline) throw new Error("Baseline result is missing");
    const m = baseline.metrics;
    $("research-status").textContent = `Original batch: ${data.runs.filter(r => r.status === "ok").length} / ${data.runs.length} runs completed · ${data.runs.filter(r => r.engine_agreement).length} / ${data.runs.length} reconciled across all three engines`;
    $("annual-kpis").innerHTML = [["Annualized return",pct(m.cagr)],["Sharpe ratio",num(m.sharpe)],["Maximum drawdown",pct(m.max_drawdown)],["Annual factor alpha",pct(m.factor_alpha_annual)]].map(([label,v])=>`<div class="stat"><b>${v}</b><span>${label}</span></div>`).join("");
    $("annual-gates").innerHTML += '<thead><tr><th scope="col">Check</th><th scope="col">Required</th><th scope="col">Actual</th><th scope="col">Result</th></tr></thead><tbody>' + baseline.checks.map(c=>{
      const metric = c.metric || c.rule;
      const fmt = v => metric === "max_drawdown" ? pct(v) : typeof v === "number" ? num(v) : esc(v);
      const threshold = c.threshold ?? c.required;
      return `<tr><th scope="row">${esc(labels[metric] || metric)}</th><td>${threshold == null ? "As specified" : "≥ " + fmt(threshold)}</td><td>${fmt(c.actual)}</td><td class="${c.outcome === "passed" ? "pass" : "fail"}">${esc(c.outcome)}</td></tr>`;
    }).join("") + '</tbody>';
    $("annual-runs").innerHTML += '<thead><tr><th scope="col">Test</th><th scope="col">Return / year</th><th scope="col">Sharpe</th><th scope="col">Worst drawdown</th><th scope="col">Alpha t</th><th scope="col">Applicable checks</th><th scope="col">Three engines</th></tr></thead><tbody>' + data.runs.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${pct(r.metrics.cagr)}</td><td>${num(r.metrics.sharpe)}</td><td>${pct(r.metrics.max_drawdown)}</td><td>${num(r.metrics.factor_alpha_t)}</td><td class="${r.thresholds_met ? "pass" : "fail"}">${r.thresholds_met ? "Passed robustness checks" : "Failed advancement"}</td><td>${r.engine_agreement ? "Agreed" : "Not verified"}</td></tr>`).join("")+'</tbody>';
    $("annual-warnings").innerHTML = '<ul>' + data.runs.map(r=>`<li><b>${esc(r.label)}:</b> ${r.warnings.length ? r.warnings.map(esc).join("; ") : "No execution warnings recorded."}</li>`).join("")+'</ul>';
    $("annual-provenance").textContent = `Report completed ${new Date(data.generated_at).toLocaleString()}. Data cutoff: ${data.cutoff}. Evidence: ${data.evidence}.`;
    if (!window.echarts) throw new Error("Chart library unavailable; the results tables remain available");
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-2").trim();
    const line = getComputedStyle(document.documentElement).getPropertyValue("--line").trim();
    const points = baseline.curve;
    const common = {animation:false,textStyle:{color:ink,fontFamily:"system-ui"},tooltip:{trigger:"axis"},grid:{left:65,right:26,top:55,bottom:45},legend:{textStyle:{color:ink}},xAxis:{type:"time",axisLabel:{color:ink},splitLine:{show:false}},yAxis:{type:"value",axisLabel:{color:ink},splitLine:{lineStyle:{color:line}}}};
    const growth = echarts.init($("annual-growth"));
    growth.setOption({...common,yAxis:{...common.yAxis,axisLabel:{formatter:v=>"$"+v.toFixed(1)}},series:[{name:"Annual strategy",type:"line",showSymbol:false,lineStyle:{width:2},itemStyle:{color:"#10b981"},data:points.map(p=>[p[0],p[1]])},{name:"S&P 500 benchmark",type:"line",showSymbol:false,itemStyle:{color:"#6366f1"},data:points.map(p=>[p[0],p[2]])}]});
    const dd = echarts.init($("annual-drawdown"));
    dd.setOption({...common,yAxis:{...common.yAxis,axisLabel:{formatter:v=>(v*100).toFixed(0)+"%"}},series:[{name:"Drawdown",type:"line",showSymbol:false,itemStyle:{color:"#ef4444"},areaStyle:{opacity:.1},data:points.map(p=>[p[0],p[3]]),markLine:{symbol:"none",label:{formatter:"35% limit",position:"insideEndTop"},data:[{yAxis:-.35}],lineStyle:{color:"#d97706",type:"dashed"}}}]});
    window.addEventListener("resize",()=>{growth.resize();dd.resize();});
  } catch (error) {
    $("research-status").textContent = `Unable to display all results: ${error.message}. Try refreshing or use the results JSON below.`;
  }
})();
