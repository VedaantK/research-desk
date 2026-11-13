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
    const flags = d.flags || [], fdays = d.flag_days || [];
    const last = fdays[fdays.length - 1] || {};
    $("lookout-flags-status").textContent = flags.length ? `Scan day ${day(last.day)}.` : "No scan yet.";
    $("lookout-flag-kpis").innerHTML = [[last.flagged ?? "—", "Flagged"], [last.new ?? "—", "New names"],
      [last.claude ?? "—", "Picked by Claude"], [fdays.length, "Days scanned"]]
      .map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    const pick = (v, h) => v == null ? `<span class="note">—</span>`
      : `<span class="${v === "beat" ? "lk-good" : "lk-bad"}">${v === "beat" ? "&#9650; beat" : "&#9660; lag"}${h ? ` ${h}d` : ""}</span>`;
    $("lookout-flags").querySelector("tbody").innerHTML = flags.length ? flags.map(f => `<tr><td><b>${esc(f.ticker)}</b></td>`
      + `<td class="nm">${esc(f.name)}</td><td>${esc(f.trigger)}</td>`
      + `<td>${f.new ? `<span class="lk-pill new">new</span>` : `<span class="note" title="first flagged ${esc(f.first_flagged)}">since ${esc(day(f.first_flagged))}</span>`}</td>`
      + `<td>${pick(f.claude, f.claude_horizon)}</td><td>${pick(f.local)}</td>`
      + `<td class="num">${pct(f.checklist_p, 0)}</td><td>${esc(f.vs)}</td></tr>`).join("")
      : `<tr><td colspan="8" class="note">No flags yet.</td></tr>`;

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
    const mvAll = (d.move_agreement || []).find(r => r.prompts === "all");
    if (mvAll && mvAll.n) $("lookout-move").innerHTML = `<b>Claude has followed the triggering move on ${mvAll.same} of ${mvAll.n} calls.</b> `
      + (mvAll.same === mvAll.n ? "Until it disagrees with the move, its direction can&rsquo;t beat this row; only its confidence can."
        : `It went against the move ${mvAll.n - mvAll.same} time${mvAll.n - mvAll.same === 1 ? "" : "s"}; those calls decide whether its direction adds anything.`);
    const econ = d.economic || {};
    $("lookout-economic").textContent = econ.n
      ? `After costs, the stock-versus-sector book averages ${Number(econ.mean_net_pct).toFixed(2)}% per settled call, across ${econ.n} calls. The pass/fail lines do not use this number.`
      : "Nothing has settled, so there is no after-cost number yet. When one appears, it is the figure to read. The pass/fail lines do not use it.";
    const factor = d.factor_days || {days: [], limit: 15, claude_calls: 0, claude_calls_on_factor_days: 0};
    const fd = (factor.days || []).map(x => `${day(x.day)} (${x.idio_flags} names)`).join(", ") || "none so far";
    $("lookout-factor").textContent = `Busy days, when more than ${factor.limit} stocks looked company-specific at once: ${fd}. Claude made ${factor.claude_calls_on_factor_days} of ${factor.claude_calls} calls on those days.`;
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
    const openAll = d.calls.filter(c => c.status === "open")
      .sort((a, b) => (b.current_rel_return_pct ?? -1e9) - (a.current_rel_return_pct ?? -1e9));
    const track = (c) => c.current_rel_return_pct == null ? `<span class="note">no close yet</span>`
      : ((c.current_rel_return_pct > 0) === (c.call === "beat")
        ? `<span class="lk-good">yes</span>` : `<span class="lk-bad">no</span>`);
    const forCall = (c, v) => v == null ? "" : cls(c.call === "beat" ? v : -v);
    const cov = (c) => c.evidence_coverage
      ? `<span class="note" title="${esc(c.evidence_coverage)}">${esc(String(c.evidence_coverage).replace(/_/g, " ").slice(0, 18))}</span>`
      : `<span class="note">—</span>`;
    const inv = (c) => c.invalidation_status
      ? `<span class="note">${esc(String(c.invalidation_status).replace(/_/g, " "))}</span>`
      : `<span class="note">—</span>`;
    $("lookout-open").querySelector("tbody").innerHTML = openAll.length ? openAll.map(c => `<tr><td><b>${esc(c.ticker)}</b></td>`
      + `<td>${pick(c.call, c.horizon_days)} vs ${esc(c.vs)}</td>`
      + `<td class="num">${c.elapsed_days ?? 0}/${c.horizon_days}</td>`
      + `<td class="num ${forCall(c, c.current_rel_return_pct)}">${sgn(c.current_rel_return_pct)}</td>`
      + `<td class="num">${sgn(c.current_stock_return_pct)}</td>`
      + `<td class="num">${sgn(c.current_etf_return_pct)}</td>`
      + `<td class="num">${sgn(c.beta_adj_return_pct)}</td>`
      + `<td class="num ${forCall(c, c.rel_change_1d_pct)}">${sgn(c.rel_change_1d_pct)}</td>`
      + `<td>${cov(c)}</td><td>${inv(c)}</td>`
      + `<td>${esc(day(c.due))}</td><td>${track(c)}</td></tr>`).join("")
      : `<tr><td colspan="12" class="note">No open calls.</td></tr>`;
    const diag = d.diagnostics || {};
    const iss = diag.issuers || {};
    const boot = diag.day_cluster_bootstrap || {};
    if ($("lookout-diag")) {
      $("lookout-diag").textContent = iss.n_calls != null
        ? `Diagnostics (not gates): ${iss.n_issuers ?? "—"} unique issuers across ${iss.n_calls} settled current-book calls`
          + (boot.status === "ok"
            ? `; day-clustered hit-rate CI ${boot.ci_low}–${boot.ci_high} (${boot.n_days} entry dates).`
            : `; clustered bootstrap ${boot.status || "waiting"} (${boot.note || "need more distinct dates"}).`)
        : "Diagnostics appear once current-book calls settle. Official gates are unchanged.";
    }
    const ex = (d.experiments || {}).experiments || {};
    const exNames = {E1: "E1 &middot; first prompt, earnings book", E2a: "E2a &middot; v2 prompt, earnings book",
      E2: "E2 &middot; v2 prompt, volume-up book (gated to Nov 10)", E3: "E3 &middot; v3 challenger (on)", E3x: "E3x &middot; v3 prompt, v2 inputs", E4: "E4 &middot; v3 prompt, confirmed volume-up (gated)"};
    const exBody = document.querySelector("#lookout-experiments tbody");
    if (exBody) {
      exBody.innerHTML = Object.keys(exNames).filter(k => ex[k]).map(k => {
        const m = ex[k];
        return `<tr><td>${exNames[k]}</td><td>${esc(m.status)}</td><td class="num">${m.made ?? 0}</td>`
          + `<td class="num">${m.n ?? 0}</td><td class="num">${m.abstained ?? 0}</td>`
          + `<td class="num">${m.hit_rate == null ? "—" : pct(m.hit_rate)}</td>`
          + `<td class="num">${m.skill == null ? "—" : Number(m.skill).toFixed(3)}</td></tr>`;
      }).join("") || `<tr><td colspan="7" class="note">No versions yet.</td></tr>`;
    }
    const mt = (d.experiments || {}).matched_20d || {};
    if ($("lookout-matched")) {
      const part = (k, label) => mt[k] && mt[k].n
        ? `vs ${label}: ${mt[k].n} shared stocks, ${mt[k].n_disagree} disagreements`
        : `vs ${label}: no shared settled stocks yet`;
      $("lookout-matched").textContent = `Same stocks, same 20-day window (E3): ${part("E2", "E2")}; ${part("volume_fade", "the volume-up fade rule")}.`;
    }
    const eod = (d.experiments || {}).volume_up_eod;
    if ($("lookout-eod") && eod && eod.flags) {
      const f = eod.volume_fade_20_met_at_close || {}, g = eod.volume_fade_20_not_met || {};
      const hr = (m) => m.n ? `${m.n} settled, ${pct(m.hit_rate)} right` : "none settled yet";
      $("lookout-eod").textContent = `Of ${eod.flags} live volume-up flags, ${eod.met_at_close} met the studied event at the close `
        + `(full-day volume at least 3x, move at least 2%, ahead of the sector ETF) and ${eod.not_met} did not. `
        + `Fade rule at 20 days, flags that met it: ${hr(f)}; flags that did not: ${hr(g)}.`;
    }
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
        + (c.wrong_if ? `<p class="lk-wrong"><b>Wrong if:</b> ${esc(c.wrong_if)}`
          + (c.invalidation_status ? ` <span class="note">(${esc(String(c.invalidation_status).replace(/_/g, " "))})</span>` : "")
          + `</p>` : "")
        + ((c.review && (c.review.extension || c.review.hedge_quality || c.evidence_coverage))
          ? `<p class="note">Review: ext ${esc(c.review.extension || "—")}`
            + ` · hedge ${esc(c.review.hedge_quality || "—")}`
            + ` · catalyst ${esc(c.review.catalyst || "—")}`
            + (c.evidence_coverage ? ` · evidence ${esc(c.evidence_coverage)}` : "")
            + `</p>` : "")
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
