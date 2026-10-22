"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const pct = v => v == null ? "—" : (100*v).toFixed(2)+"%";
  const num = v => v == null ? "—" : Number(v).toFixed(2);
  const load = async name => {
    const response = await fetch(name,{cache:"no-store"});
    if (!response.ok) throw new Error(name+" could not be loaded");
    return response.json();
  };
  try {
    const [original, controls, review] = await Promise.all([load("annual-data.json"),load("controls-data.json"),load("annual-review.json")]);
    const runs = [...original.runs.filter(r=>["research","stress"].includes(r.phase)),...controls.runs];
    const main = runs.filter(r=>r.phase==="research");
    if (runs.length!==6 || main.length!==3) throw new Error("Expected three normal-cost and three stressed results");
    const shortName = r => r.study.startsWith("Value alone") ? "Value alone" : r.study.startsWith("Profitability alone") ? "Profitability alone" : "Combined";
    $("comparison-status").textContent = `${original.runs.length + controls.runs.length} / 11 runs completed across both batches · ${controls.runs.filter(r=>r.engine_agreement).length} / 4 controls reconciled · no strategy qualifies for advancement`;
    $("comparison-table").innerHTML += '<thead><tr><th scope="col">Portfolio</th><th scope="col">Costs</th><th scope="col">Return / year</th><th scope="col">Sharpe</th><th scope="col">Worst drawdown</th><th scope="col">Alpha / year</th><th scope="col">Alpha t</th><th scope="col">Annual turnover</th><th scope="col">Applicable checks</th></tr></thead><tbody>' + runs.map(r=>`<tr><th scope="row">${esc(shortName(r))}</th><td>${r.phase==="stress"?"Doubled":"Normal"}</td><td>${pct(r.metrics.cagr)}</td><td>${num(r.metrics.sharpe)}</td><td>${pct(r.metrics.max_drawdown)}</td><td>${pct(r.metrics.factor_alpha_annual)}</td><td>${num(r.metrics.factor_alpha_t)}</td><td>${pct(r.metrics.annual_turnover)}</td><td class="${r.thresholds_met?"pass":"fail"}">${r.phase==="stress"?(r.thresholds_met?"Passed robustness only":"Failed robustness"):(r.thresholds_met?"Passed advancement":"Failed advancement")}</td></tr>`).join("")+'</tbody>';
    $("comparison-years").innerHTML += '<thead><tr><th scope="col">Year</th>'+main.map(r=>`<th scope="col">${esc(shortName(r))}</th>`).join("")+'</tr></thead><tbody>'+Object.entries(review.calendar_years).map(([year,values])=>`<tr><th scope="row">${esc(year)}</th>`+main.map(r=>`<td>${pct(values[shortName(r)==="Combined"?"Combined":r.study])}</td>`).join("")+'</tr>').join("")+'</tbody>';
    $("comparison-warnings").innerHTML='<h3>Execution warnings</h3><ul>'+runs.map(r=>`<li><b>${esc(shortName(r))}, ${r.phase==="stress"?"doubled costs":"normal costs"}:</b> ${r.warnings.length?r.warnings.map(esc).join("; "):"No execution warnings recorded."}</li>`).join("")+'</ul><p>Stress checks require Sharpe ≥ 0.3 and at least 30 fills; they do not override failed baseline checks. Factor alpha uses the same FF5 + momentum model as the original study.</p>';
    if (!window.echarts) throw new Error("Charts unavailable; comparison tables remain available");
    const color=["#10b981","#f59e0b","#6366f1"];
    let growth, drawdown;
    const draw=()=>{
      const t=chartTheme();
      const {accent, bad, warn, ink3, ...common}=t;
      [growth, drawdown].forEach(c=>c&&c.dispose());
      growth=echarts.init($("comparison-growth"));
      growth.setOption({...common,yAxis:{...common.yAxis,axisLabel:{...common.yAxis.axisLabel,formatter:v=>"$"+v.toFixed(1)}},tooltip:{...common.tooltip,valueFormatter:v=>"$"+v.toFixed(2)},series:[...main.map((r,i)=>({name:shortName(r),type:"line",showSymbol:false,lineStyle:{width:2,color:color[i]},itemStyle:{color:color[i]},data:r.curve.map(p=>[p[0],p[1]])})),{name:"S&P 500 reference",type:"line",showSymbol:false,lineStyle:{width:1.4,type:"dashed",color:ink3},itemStyle:{color:ink3},data:main[0].curve.map(p=>[p[0],p[2]])}]});
      drawdown=echarts.init($("comparison-drawdown"));
      drawdown.setOption({...common,yAxis:{...common.yAxis,axisLabel:{...common.yAxis.axisLabel,formatter:v=>(100*v).toFixed(0)+"%"}},tooltip:{...common.tooltip,valueFormatter:pct},series:main.map((r,i)=>({name:shortName(r),type:"line",showSymbol:false,lineStyle:{width:1.6,color:color[i]},itemStyle:{color:color[i]},data:r.curve.map(p=>[p[0],p[3]]),...(i===0?{markLine:{symbol:"none",label:{formatter:"−35% limit",position:"insideEndTop",color:warn},lineStyle:{type:"dashed",color:warn},data:[{yAxis:-.35}]}}:{})}))});
    };
    draw();
    window.addEventListener("themechange",draw);
    window.addEventListener("resize",()=>{growth.resize();drawdown.resize();});
  } catch(error) {
    $("comparison-status").textContent="Unable to display the full comparison: "+error.message+". Download the results JSON below or refresh.";
  }
})();
