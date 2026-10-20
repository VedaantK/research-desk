"use strict";

const PALETTE = ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316", "#14b8a6"];
const CRISES = [
  ["Dot-com bust", "2000-03-24", "2002-10-09"],
  ["Financial crisis", "2007-10-09", "2009-03-09"],
  ["COVID", "2020-02-19", "2020-03-23"],
  ["", "2022-01-03", "2022-10-12"],
];
const START = 100000;
const state = { data: null, selected: new Set(), scale: "log", range: "all", filter: "all", charts: {} };

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pct = (v, d = 1, sign = true) =>
  v == null || !isFinite(v) ? "–" : (v > 0 && sign ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%";
const num = (v, d = 2) => (v == null || !isFinite(v) ? "–" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(d));
const money = (v) => "$" + (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1000) + "k");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const verdictClass = (v) => (v === "Passed" ? "Passed" : v === "Rejected" || v === "Not testable yet" ? "Rejected" : "Running");

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) {
    return null;
  }
}

// ---------- data shaping ----------

function chain(exp, from) {
  // Research curve rebased to $100k at the chart start, holdout appended on top of it.
  const h = exp.headline;
  if (!h) return null;
  let pts = h.growth.filter((p) => p[0] >= from);
  if (!pts.length) return null;
  const base = pts[0][1];
  pts = pts.map(([d, v]) => [d, (v / base) * START]);
  let holdout = null;
  if (exp.holdout) {
    const last = pts[pts.length - 1][1];
    const hp = exp.holdout.growth.map(([d, v]) => [d, v * last]);
    holdout = [hp[0][0], hp[hp.length - 1][0]];
    pts = pts.concat(hp.slice(1));
  }
  return { pts, holdout };
}

function drawdown(pts) {
  let peak = -Infinity;
  return pts.map(([d, v]) => {
    peak = Math.max(peak, v);
    return [d, v / peak - 1];
  });
}

function prepare(data) {
  const from = data.experiments.length ? "2000-01-03" : "";
  let colorIndex = 0;
  data.experiments.forEach((e) => {
    e.color = PALETTE[colorIndex++ % PALETTE.length];
    e.series = chain(e, from);
    e.m = e.headline ? e.headline.metrics : null;
  });
  const sp = data.sp500.growth || [];
  const base = sp.length ? sp[0][1] : 1;
  data.sp = sp.map(([d, v]) => [d, (v / base) * START]);
  const charted = data.experiments.filter((e) => e.series);
  const ranked = [...charted].sort((a, b) => (b.m.sharpe ?? -9) - (a.m.sharpe ?? -9));
  charted.forEach((e) => {
    if (e.verdict === "Passed" || e.verdict === "Running" || ranked.indexOf(e) < 3) state.selected.add(e.id);
  });
}

// ---------- hero ----------

function renderStats(data) {
  const exps = data.experiments;
  const passed = exps.filter((e) => e.verdict === "Passed").length;
  const tiles = [
    [exps.length, "ideas tested"],
    [data.totals.versions, "strategy versions"],
    [data.totals.backtests, "backtests"],
    [data.totals.engine_runs, "engine runs reconciled"],
    [passed, passed === 1 ? "passed the holdout" : "passed the holdout", true],
  ];
  $("#stats").innerHTML = tiles
    .map(([v, l, hl]) => `<div class="stat${hl ? " hl" : ""}"><b data-count="${v}">0</b><span>${l}</span></div>`)
    .join("");
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = +el.dataset.count;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return void (el.textContent = target);
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const running = exps.filter((e) => e.verdict === "Running");
  if (running.length) {
    $("#live-dot").classList.add("live");
    $("#live-text").textContent = "Now testing: " + running.map((e) => e.title).join(", ");
  } else {
    $("#live-text").textContent = "Research desk · idle";
  }
  const g = new Date(data.generated);
  $("#generated").textContent = "Last update " + g.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + ".";
}

// ---------- charts ----------

function base() {
  const ink2 = css("--ink-2"), line = css("--line"), panel = css("--panel");
  return {
    ink: css("--ink"), ink2, ink3: css("--ink-3"), line, panel,
    accent: css("--accent"), bad: css("--bad"),
    text: { color: ink2, fontFamily: "Inter, sans-serif", fontSize: 12 },
    tooltip: {
      backgroundColor: panel, borderColor: line, textStyle: { color: css("--ink"), fontSize: 12 },
      extraCssText: "box-shadow:0 8px 24px rgba(0,0,0,.18);border-radius:10px;",
    },
  };
}

function chart(id) {
  const el = document.getElementById(id);
  if (state.charts[id]) state.charts[id].dispose();
  state.charts[id] = echarts.init(el, null, { renderer: "canvas" });
  return state.charts[id];
}

function rangeWindow() {
  if (state.range === "all") return {};
  const [a, b] = state.range.split("-");
  return { startValue: `${a}-01-01`, endValue: `${b}-12-31` };
}

function renderGrowth() {
  const t = base(), data = state.data;
  const exps = data.experiments.filter((e) => e.series && state.selected.has(e.id));
  const crisisAreas = CRISES.map(([name, a, b]) => [
    { name, xAxis: a, itemStyle: { color: t.ink3, opacity: 0.08 }, label: { color: t.ink3, fontSize: 10, position: "insideTopLeft" } },
    { xAxis: b },
  ]);
  const series = [
    {
      name: "S&P 500", type: "line", data: data.sp, showSymbol: false, smooth: false,
      lineStyle: { width: 1.6, type: "dashed", color: t.ink2 }, itemStyle: { color: t.ink2 }, z: 1,
      markArea: { silent: true, data: crisisAreas },
    },
    ...exps.map((e) => ({
      name: e.title, type: "line", data: e.series.pts, showSymbol: false,
      lineStyle: { width: 2.2, color: e.color }, itemStyle: { color: e.color },
      emphasis: { focus: "series", lineStyle: { width: 3 } }, z: 3,
      markArea: e.series.holdout
        ? {
            silent: true,
            data: [[
              { name: "Sealed holdout", xAxis: e.series.holdout[0], itemStyle: { color: e.color, opacity: 0.1, decal: { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: -0.8, color: e.color } }, label: { color: e.color, fontSize: 10, fontWeight: 600, position: "insideTopRight" } },
              { xAxis: e.series.holdout[1] },
            ]],
          }
        : undefined,
      endLabel: { show: window.innerWidth > 760, formatter: () => money(e.series.pts[e.series.pts.length - 1][1]), color: e.color, fontSize: 11, fontFamily: "JetBrains Mono" },
    })),
  ];
  const c = chart("growth");
  c.group = "perf";
  c.setOption({
    animationDuration: 700,
    textStyle: t.text,
    grid: { left: 64, right: window.innerWidth > 760 ? 72 : 16, top: 16, bottom: 28 },
    tooltip: {
      ...t.tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.ink3 } },
      formatter: (ps) => {
        const d = new Date(ps[0].value[0]).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
        const rows = [...ps].sort((a, b) => b.value[1] - a.value[1])
          .map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${esc(p.seriesName)}</span><b style="font-family:JetBrains Mono">${money(p.value[1])}</b></div>`).join("");
        return `<div style="font-weight:600;margin-bottom:4px">${d}</div>${rows}`;
      },
    },
    xAxis: { type: "time", axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.ink3 }, splitLine: { show: false } },
    yAxis: {
      type: state.scale, logBase: 10, scale: true,
      min: state.scale === "log" ? 40000 : undefined,
      max: state.scale === "log" ? (v) => Math.pow(10, Math.ceil(Math.log10(v.max * 1.05) * 2) / 2) : undefined,
      axisLabel: { color: t.ink3, formatter: (v) => money(v) },
      splitLine: { lineStyle: { color: t.line } },
    },
    dataZoom: [{ type: "inside", ...rangeWindow() }],
    series,
  });
  renderDrawdown(exps);
}

function renderDrawdown(exps) {
  const t = base(), data = state.data;
  const c = chart("drawdown");
  c.group = "perf";
  const area = (color) => ({ color, opacity: 0.08 });
  c.setOption({
    animationDuration: 700,
    textStyle: t.text,
    grid: { left: 64, right: window.innerWidth > 760 ? 72 : 16, top: 8, bottom: 24 },
    tooltip: {
      ...t.tooltip, trigger: "axis",
      formatter: (ps) => [...ps].sort((a, b) => a.value[1] - b.value[1])
        .map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${esc(p.seriesName)}</span><b style="font-family:JetBrains Mono">${pct(p.value[1], 1)}</b></div>`).join(""),
    },
    xAxis: { type: "time", axisLine: { lineStyle: { color: t.line } }, axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: "value", max: 0, axisLabel: { color: t.ink3, formatter: (v) => Math.round(v * 100) + "%" }, splitLine: { lineStyle: { color: t.line } }, splitNumber: 3 },
    dataZoom: [{ type: "inside", ...rangeWindow() }],
    series: [
      { name: "S&P 500", type: "line", data: drawdown(data.sp), showSymbol: false, lineStyle: { width: 1.2, type: "dashed", color: t.ink2 }, itemStyle: { color: t.ink2 } },
      ...exps.map((e) => ({ name: e.title, type: "line", data: drawdown(e.series.pts), showSymbol: false, lineStyle: { width: 1.6, color: e.color }, itemStyle: { color: e.color }, areaStyle: area(e.color) })),
    ],
  });
  echarts.connect("perf");
}

function renderChips() {
  const exps = state.data.experiments.filter((e) => e.series);
  $("#chips").innerHTML =
    `<span class="chip on" style="--c:${css("--ink-2")}" title="Always shown"><i></i>S&amp;P 500</span>` +
    exps.map((e) => `<button class="chip${state.selected.has(e.id) ? " on" : ""}" data-id="${e.id}" style="--c:${e.color}" aria-pressed="${state.selected.has(e.id)}"><i></i>${esc(e.title)}</button>`).join("");
  $("#chips").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      b.classList.toggle("on");
      b.setAttribute("aria-pressed", state.selected.has(id));
      renderGrowth();
    })
  );
}

function renderScatter() {
  const t = base(), data = state.data;
  const groups = data.experiments.filter((e) => e.versions.length);
  const spr = data.sp.filter((p) => p[0] <= "2019-12-01");
  const spDD = Math.min(...drawdown(spr).map((p) => p[1]));
  const spSharpe = (data.experiments.find((e) => e.m && e.m.start === "2000-01-03" && e.m.end <= "2019-12-01") || {}).m?.benchmark_sharpe;
  const sharpes = groups.flatMap((e) => e.versions.map((v) => v.metrics.sharpe));
  const ymax = Math.ceil((Math.max(1.0, ...sharpes) + 0.15) * 10) / 10;
  const ymin = Math.floor((Math.min(-0.2, ...sharpes) - 0.1) * 10) / 10;
  const c = chart("scatter");
  c.setOption({
    textStyle: t.text,
    grid: { left: 48, right: 20, top: 20, bottom: 44 },
    tooltip: {
      ...t.tooltip, trigger: "item",
      formatter: (p) => {
        if (p.seriesName === "S&P 500") return `<b>S&amp;P 500</b><br>Sharpe ${num(p.value[1])} · worst drop ${p.value[0].toFixed(0)}%`;
        const v = p.data.v, m = v.metrics;
        return `<div style="max-width:280px;white-space:normal"><b>${esc(p.seriesName)}</b> · v${v.version}<br><span style="color:${t.ink2}">${esc(v.label)}</span><br>
          Sharpe <b>${num(m.sharpe)}</b> · worst drop <b>${pct(m.max_drawdown, 0)}</b><br>Return ${pct(m.cagr)}/yr · alpha t ${num(m.factor_alpha_t, 1)}${v.stress_sharpe != null ? `<br>With 2× costs: Sharpe ${num(v.stress_sharpe)}` : ""}</div>`;
      },
    },
    xAxis: { type: "value", name: "Worst drop (%)", nameLocation: "middle", nameGap: 28, min: -100, max: 0, axisLabel: { color: t.ink3 }, nameTextStyle: { color: t.ink3 }, splitLine: { lineStyle: { color: t.line } } },
    yAxis: { type: "value", name: "Sharpe", min: ymin, max: ymax, axisLabel: { color: t.ink3 }, nameTextStyle: { color: t.ink3 }, splitLine: { lineStyle: { color: t.line } } },
    series: [
      {
        name: "Pass zone", type: "scatter", data: [], silent: true,
        markArea: { silent: true, itemStyle: { color: t.accent, opacity: 0.1, borderColor: t.accent, borderWidth: 1, borderType: "dashed" }, label: { show: true, position: "insideTopRight", color: t.accent, fontWeight: 600, formatter: "PASS ZONE" }, data: [[{ coord: [-35, 0.5] }, { coord: [0, ymax] }]] },
      },
      ...groups.map((e) => ({
        name: e.title, type: "scatter", symbolSize: 13,
        itemStyle: { color: e.color, borderColor: t.panel, borderWidth: 1.5, opacity: 0.92 },
        emphasis: { scale: 1.5 },
        data: e.versions.map((v) => ({ value: [v.metrics.max_drawdown * 100, v.metrics.sharpe], v })),
      })),
      {
        name: "S&P 500", type: "scatter", symbol: "diamond", symbolSize: 16,
        itemStyle: { color: t.ink2, borderColor: t.panel, borderWidth: 1.5 },
        label: { show: true, formatter: "S&P 500", position: "right", color: t.ink2, fontSize: 11 },
        data: spSharpe != null ? [[spDD * 100, spSharpe]] : [],
      },
    ],
  });
}

function renderAlpha() {
  const t = base();
  const exps = state.data.experiments.filter((e) => e.m && e.m.factor_alpha_annual != null)
    .sort((a, b) => a.m.factor_alpha_annual - b.m.factor_alpha_annual);
  const c = chart("alpha");
  c.setOption({
    textStyle: t.text,
    grid: { left: 8, right: 64, top: 12, bottom: 28, containLabel: true },
    tooltip: {
      ...t.tooltip, trigger: "item",
      formatter: (p) => {
        const e = exps[p.dataIndex], m = e.m;
        return `<b>${esc(e.title)}</b><br>Alpha ${pct(m.factor_alpha_annual)}/yr · t = ${num(m.factor_alpha_t, 2)}<br><span style="color:${t.ink2}">Market beta ${num(m.factor_betas?.mktrf)} · momentum ${num(m.factor_betas?.umd)}</span>`;
      },
    },
    xAxis: { type: "value", axisLabel: { color: t.ink3, formatter: (v) => Math.round(v * 100) + "%" }, splitLine: { lineStyle: { color: t.line } } },
    yAxis: { type: "category", data: exps.map((e) => e.title), axisLabel: { color: t.ink2, width: 170, overflow: "truncate" }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    series: [{
      type: "bar", barWidth: 16,
      data: exps.map((e) => {
        const sig = Math.abs(e.m.factor_alpha_t) >= 2;
        return {
          value: e.m.factor_alpha_annual,
          itemStyle: { color: e.color, opacity: sig ? 1 : 0.35, borderColor: e.color, borderWidth: sig ? 0 : 1.2, borderRadius: 4 },
        };
      }),
      label: { show: true, position: "right", color: t.ink2, fontFamily: "JetBrains Mono", fontSize: 11, formatter: (p) => "t " + num(exps[p.dataIndex].m.factor_alpha_t, 1) },
    }],
  });
}

function renderHeatmap() {
  const t = base(), data = state.data;
  const rows = [{ title: "S&P 500", yearly: data.sp500.yearly || {} }].concat(
    data.experiments.filter((e) => e.headline).map((e) => ({ title: e.title, yearly: { ...e.headline.yearly, ...(e.holdout ? e.holdout.yearly : {}) }, holdout: e.holdout }))
  );
  const lastYear = Math.max(...rows.flatMap((r) => Object.keys(r.yearly).map(Number)));
  const years = [];
  for (let y = 2000; y <= lastYear; y++) years.push(String(y));
  const cells = [];
  rows.forEach((r, i) => years.forEach((y, j) => { if (r.yearly[y] != null) cells.push([j, i, r.yearly[y]]); }));
  const el = $("#heatmap");
  el.style.height = rows.length * 30 + 70 + "px";
  el.style.minWidth = "860px";
  const c = chart("heatmap");
  c.setOption({
    textStyle: t.text,
    grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
    tooltip: { ...t.tooltip, formatter: (p) => `<b>${esc(rows[p.value[1]].title)}</b> · ${years[p.value[0]]}<br>${pct(p.value[2])}` },
    xAxis: { type: "category", data: years, axisLabel: { color: t.ink3, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false } },
    yAxis: { type: "category", data: rows.map((r) => r.title), inverse: true, axisLabel: { color: t.ink2, width: 190, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: {
      min: -0.4, max: 0.4, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 160, itemWidth: 10,
      text: ["+40%", "−40%"], textStyle: { color: t.ink3, fontSize: 11 },
      inRange: { color: [t.bad, t.panel, t.accent] },
    },
    series: [{
      type: "heatmap", data: cells,
      itemStyle: { borderColor: t.panel, borderWidth: 2, borderRadius: 4 },
      label: { show: true, fontSize: 10, fontFamily: "JetBrains Mono", color: t.ink, formatter: (p) => Math.round(p.value[2] * 100) },
      emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
    }],
  });
}

// ---------- cards ----------

function spark(e, width = 320, height = 56) {
  if (!e.series) return "";
  const pts = e.series.pts;
  const sp = state.data.sp.filter((p) => p[0] >= pts[0][0] && p[0] <= pts[pts.length - 1][0]);
  const spBase = sp.length ? sp[0][1] : 1;
  const sps = sp.map(([d, v]) => [d, (v / spBase) * START]);
  const all = pts.concat(sps).map((p) => Math.log(p[1]));
  const lo = Math.min(...all), hi = Math.max(...all);
  const t0 = Date.parse(pts[0][0]), t1 = Date.parse(pts[pts.length - 1][0]);
  const xy = ([d, v]) => [((Date.parse(d) - t0) / (t1 - t0)) * width, height - 3 - ((Math.log(v) - lo) / (hi - lo || 1)) * (height - 6)];
  const path = (arr) => arr.map((p, i) => (i ? "L" : "M") + xy(p).map((n) => n.toFixed(1)).join(" ")).join("");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${path(sps)}" fill="none" stroke="${css("--ink-3")}" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <path d="${path(pts)}" fill="none" stroke="${e.color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderCards() {
  const exps = [...state.data.experiments].reverse()
    .filter((e) => state.filter === "all" || verdictClass(e.verdict) === state.filter);
  $("#cards").innerHTML = exps.map((e) => {
    const m = e.m || {};
    const cls = verdictClass(e.verdict);
    const ho = e.holdout
      ? `<p><b>Holdout ${e.holdout.metrics.start.slice(0, 4)}–${e.holdout.metrics.end.slice(0, 4)}:</b> ${pct(e.holdout.metrics.cagr)}/yr, Sharpe ${num(e.holdout.metrics.sharpe)}, worst drop ${pct(e.holdout.metrics.max_drawdown)} (S&amp;P ${pct(e.holdout.metrics.benchmark_cagr)}/yr)</p>`
      : "";
    const versions = e.versions.map((v) => `<tr><td>v${v.version}</td><td>${esc(v.label)}</td><td class="num">${num(v.metrics.sharpe)}</td><td class="num">${pct(v.metrics.max_drawdown, 0)}</td><td class="num">${v.stress_sharpe != null ? num(v.stress_sharpe) : "–"}</td></tr>`).join("");
    return `<article class="panel card" style="--c:${e.color}">
      <div class="card-top"><span class="tag">${esc(e.family)} · ${esc(e.created)}</span><span class="badge ${cls}">${esc(e.verdict)}</span></div>
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.summary)}</p>
      ${spark(e)}
      <div class="mini">
        <div>Return/yr<b class="${m.cagr > (m.benchmark_cagr ?? 0) ? "pos" : ""}">${pct(m.cagr)}</b></div>
        <div>Sharpe<b class="${m.sharpe >= 0.5 ? "pos" : m.sharpe < 0 ? "neg" : ""}">${num(m.sharpe)}</b></div>
        <div>Worst drop<b class="${m.max_drawdown < -0.35 ? "neg" : ""}">${pct(m.max_drawdown, 0)}</b></div>
        <div>Alpha t<b class="${Math.abs(m.factor_alpha_t) >= 2 ? "pos" : ""}">${num(m.factor_alpha_t, 1)}</b></div>
      </div>
      ${ho}
      ${e.takeaway ? `<p class="takeaway">${esc(e.takeaway)}</p>` : ""}
      <details class="more"><summary>Hypothesis, versions and verdict</summary>
        <div class="label">Verdict</div><p>${esc(e.reason || "In progress")}</p>
        ${versions ? `<div class="label">Versions tried</div><table class="versions"><thead><tr><th>#</th><th>Change</th><th class="num">Sharpe</th><th class="num">Drop</th><th class="num">2× cost</th></tr></thead><tbody>${versions}</tbody></table>` : ""}
        <div class="label">Original hypothesis, as submitted</div><div class="hyp">${esc(e.hypothesis)}</div>
      </details>
    </article>`;
  }).join("");
}

// ---------- wiring ----------

function renderAll() {
  renderChips();
  renderGrowth();
  renderScatter();
  renderAlpha();
  renderHeatmap();
  renderCards();
}

function segmented(id, key, after) {
  $(id).addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state[key] = b.dataset[key];
    after();
  });
}

function initTheme() {
  const saved = store("theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store("theme", next);
    if (state.data) renderAll();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.data && renderAll());
}

async function main() {
  initTheme();
  const res = await fetch("data.json", { cache: "no-cache" });
  state.data = await res.json();
  prepare(state.data);
  renderStats(state.data);
  renderAll();
  segmented("#scale", "scale", renderGrowth);
  segmented("#range", "range", renderGrowth);
  segmented("#filter", "filter", renderCards);
  let pending;
  window.addEventListener("resize", () => {
    clearTimeout(pending);
    pending = setTimeout(() => Object.values(state.charts).forEach((c) => c.resize()), 120);
  });
}

main().catch((err) => {
  console.error(err);
  $("#stats").innerHTML = `<p class="sub">Couldn't load the results data.</p>`;
});
