"use strict";
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const pct = (v, d = 1) => v == null ? "—" : (100 * v).toFixed(d) + "%";
  const num = (v, d = 3) => v == null ? "—" : Number(v).toFixed(d);
  const sgn = (v, d = 2) => v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d) + "%";
  const cls = (v) => v == null ? "" : v > 0 ? "lk-good" : "lk-bad";
  const day = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
  try {
    const res = await fetch("lookout-data.json", {cache: "no-store"});
    if (!res.ok) throw new Error("Results could not be loaded");
    const d = await res.json();
    const claude = d.summary.find(r => r.predictor === "Claude") || {};
    const open = d.calls.filter(c => c.status === "open").length;
    $("lookout-status").textContent = `${d.calls.length} calls made · ${claude.resolved || 0} resolved · ${open} open · updated ${new Date(d.updated).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"})}`;
    const k = [[`${claude.resolved || 0} / 60`, "Resolved calls (60 needed)"],
               [pct(claude.hit_rate), "Hit rate"],
               [pct(claude.base_hit_rate), "Expected from base rates"],
               [num(claude.skill), "Skill vs base rate"]];
    $("lookout-kpis").innerHTML = k.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    $("lookout-compare").querySelector("tbody").innerHTML = d.summary.map(r => `<tr><td>${esc(r.predictor)}</td>`
      + `<td class="num">${r.resolved ?? 0}</td><td class="num">${r.open ?? "—"}</td>`
      + `<td class="num">${pct(r.hit_rate)}</td><td class="num">${pct(r.base_hit_rate)}</td>`
      + `<td class="num">${num(r.p_value)}</td><td class="num ${cls(r.skill)}">${num(r.skill)}</td>`
      + `<td class="num">${sgn(r.avg_edge_pct)}</td></tr>`).join("");
    $("lookout-gates").querySelector("tbody").innerHTML = d.gates.map(g => `<tr><td>${esc(g.gate)}</td>`
      + `<td class="num">${g.have}</td><td class="num">${g.need}</td>`
      + `<td><span class="lk-pill ${esc(g.status)}">${esc(g.status)}</span></td><td class="wrap">${esc(g.rule)}</td></tr>`).join("");

    const progress = d.progress || [];
    $("lookout-progress-status").textContent = progress.length
      ? "" : "Nothing has settled yet; the shortest horizon is 5 sessions.";
    let progressChart;
    const drawProgress = () => {
      const el = $("lookout-progress");
      if (!progress.length) { el.innerHTML = ""; return; }
      if (!window.echarts) { el.textContent = "Charts unavailable; the tables above remain accurate."; return; }
      const t = chartTheme();
      const { bad, ...common } = t;
      const by = {};
      for (const r of progress) (by[r.predictor] ??= []).push([r.day, r.resolved]);
      const color = ["#10b981", "#f59e0b"];
      progressChart && progressChart.dispose();
      progressChart = echarts.init(el);
      progressChart.setOption({
        ...common,
        series: [
          ...Object.entries(by).map(([name, pts], i) => ({
            name, type: "line", showSymbol: false, step: "end",
            lineStyle: { width: 2, color: color[i % color.length] },
            itemStyle: { color: color[i % color.length] }, data: pts,
          })),
          { type: "line", silent: true, showSymbol: false, markLine: { symbol: "none",
            label: { formatter: "60 needed", position: "insideEndTop", color: t.ink3 },
            lineStyle: { type: "dashed", color: t.ink3 }, data: [{ yAxis: 60 }] },
            data: [] },
        ],
      });
    };
    drawProgress();
    window.addEventListener("themechange", drawProgress);
    window.addEventListener("resize", () => progressChart && progressChart.resize());

    const openStanding = d.calls.filter(c => c.status === "open" && c.current_rel_return_pct != null);
    $("lookout-standing-status").textContent = openStanding.length ? ""
      : "No open call has a close yet after its entry day; check back after tonight's bar refresh.";
    let standingChart;
    const drawStanding = () => {
      const el = $("lookout-standing");
      if (!openStanding.length) { el.innerHTML = ""; el.style.height = ""; return; }
      if (!window.echarts) { el.textContent = "Charts unavailable; see the calls list below."; return; }
      el.style.height = Math.max(120, openStanding.length * 28 + 50) + "px";
      const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const [accent, bad, ink2, ink3, line, panel, ink] =
        ["--accent", "--bad", "--ink-2", "--ink-3", "--line", "--panel", "--ink"].map(css);
      const sorted = [...openStanding].sort((a, b) => a.current_rel_return_pct - b.current_rel_return_pct);
      const onTrack = (c) => (c.current_rel_return_pct > 0) === (c.call === "beat");
      standingChart && standingChart.dispose();
      standingChart = echarts.init(el);
      standingChart.setOption({
        animation: false,
        textStyle: { color: ink2, fontFamily: "Inter, sans-serif", fontSize: 12 },
        grid: { left: 56, right: 24, top: 10, bottom: 24 },
        tooltip: {
          trigger: "item", backgroundColor: panel, borderColor: line,
          textStyle: { color: ink, fontSize: 12 },
          formatter: (p) => {
            const c = sorted[p.dataIndex];
            return `<b>${esc(c.ticker)}</b> &middot; called ${esc(c.call)} vs ${esc(c.vs)}<br>`
              + `${c.elapsed_days}/${c.horizon_days}d &middot; ${sgn(c.current_rel_return_pct)} rel. so far`;
          },
        },
        xAxis: { type: "value", axisLabel: { color: ink3, formatter: (v) => v + "%" },
          axisLine: { lineStyle: { color: line } }, splitLine: { lineStyle: { color: line } } },
        yAxis: { type: "category", data: sorted.map(c => c.ticker),
          axisLabel: { color: ink2 }, axisLine: { lineStyle: { color: line } }, splitLine: { show: false } },
        series: [{
          type: "bar", data: sorted.map(c => ({
            value: c.current_rel_return_pct,
            itemStyle: { color: onTrack(c) ? accent : bad },
          })), barWidth: 10,
        }],
      });
    };
    drawStanding();
    window.addEventListener("themechange", drawStanding);
    window.addEventListener("resize", () => standingChart && standingChart.resize());

    const sz = (d.size_check || [])[0] || {n: 0, need: 30};
    const ready = sz.status === "ready";
    $("lookout-size-status").textContent = ready ? `Based on ${sz.n} settled calls.`
      : `Shown from ${sz.need} settled calls; ${sz.n} so far.`;
    const mag = (v) => v == null ? "—" : Math.abs(v).toFixed(1) + "%";
    const sv = [[ready ? mag(sz.expected_pct) : "—", "Claude’s average estimate"],
                [ready ? sgn(sz.realized_on_hits_pct, 1) : "—", "Actual, when the call was right"],
                [ready ? sgn(sz.realized_pct, 1) : "—", "Actual, all calls"],
                [ready ? mag(sz.typical_abs_pct) : "—", "Typical size of a move, either way"]];
    $("lookout-size").innerHTML = sv.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    const tc = d.trade_check || [];
    const names = {long_only: "Buy on beat, skip lag", directional: "Buy or short the stock", hedged: "Stock vs sector ETF"};
    const usd = (v) => v == null ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(0);
    const tcN = tc.length ? tc[0] : {n: 0, need: 30};
    const claudeN = Math.max(0, ...tc.filter(r => r.predictor === "Claude").map(r => r.n || 0));
    const tReady = tc.length && tc[0].status === "ready";
    $("lookout-trade-status").textContent = tReady ? `Based on ${claudeN} settled calls.`
      : `Read from ${tcN.need} settled calls; ${claudeN} so far.`;
    $("lookout-trade").querySelector("tbody").innerHTML = tc.length ? tc.map(r => `<tr><td>${esc(r.predictor)}</td>`
      + `<td>${esc(names[r.expression] || r.expression)}</td><td class="num">${r.n}</td>`
      + `<td class="num ${cls(r.mean_net_pct)}">${sgn(r.mean_net_pct)}</td><td class="num">${pct(r.win_rate, 0)}</td>`
      + `<td class="num">${sgn(r.worst_pct)}</td><td class="num ${cls(r.total_usd)}">${usd(r.total_usd)}</td>`
      + `<td class="num">${usd(r.max_drawdown_usd)}</td><td class="num">${sgn(r.worst_adverse_pct)}</td></tr>`).join("")
      : `<tr><td colspan="9" class="note">No trade data yet.</td></tr>`;
    const card = (c) => {
      const up = c.call === "beat";
      const mv = c.expected_move_pct == null ? "" : ` by ~${Math.abs(c.expected_move_pct)}%`;
      const done = c.status !== "open";
      const result = done
        ? `<span><span class="lk-pill ${esc(c.status)}">${esc(c.status)}</span> actual <b class="${cls(c.rel_return_pct)}">${sgn(c.rel_return_pct)}</b> vs ${esc(c.vs)}</span>`
        : `<span><span class="lk-pill open">open</span> settles <b>${esc(day(c.due))}</b></span>`;
      const why = (c.drivers || []).length
        ? `<ul>${c.drivers.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
      return `<article class="lk-card">`
        + `<div class="lk-top"><span class="lk-arrow ${up ? "up" : "down"}" aria-hidden="true">${up ? "&#9650;" : "&#9660;"}</span>`
        + `<div class="lk-id"><b>${esc(c.ticker)}</b><span>${esc(c.name || "")}${c.name ? " · " : ""}${esc(c.trigger)}</span></div></div>`
        + `<p class="lk-head ${up ? "lk-up" : "lk-down"}">${up ? "Beat" : "Lag"} ${esc(c.vs)}${mv} over ${c.horizon_days} sessions</p>`
        + `<p class="lk-meta"><span>Confidence <b>${pct(c.confidence, 0)}</b></span><span>Called <b>${esc(day(c.day))}</b></span>${result}</p>`
        + why
        + (c.wrong_if ? `<p class="lk-wrong"><b>Wrong if:</b> ${esc(c.wrong_if)}</p>` : "")
        + (c.reason ? `<details><summary>Full reasoning</summary><p>${esc(c.reason)}</p></details>` : "")
        + `</article>`;
    };
    const box = $("lookout-calls"), more = $("lookout-more"), FIRST = 12, STEP = 24;
    let shown = FIRST;
    const draw = () => {
      const list = d.calls.slice(0, shown);
      box.innerHTML = list.length ? list.map(card).join("")
        : `<p class="note">The first calls are made at 3:25 PM ET on the next trading day.</p>`;
      const left = d.calls.length - shown;
      more.hidden = left <= 0;
      more.textContent = `Show ${Math.min(STEP, left)} older calls`;
    };
    more.addEventListener("click", () => { shown += STEP; draw(); });
    draw();
  } catch (e) {
    $("lookout-status").textContent = e.message;
  }
})();
