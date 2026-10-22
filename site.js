"use strict";

const PALETTE = ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316", "#14b8a6"];
const CRISES = [
  ["Dot-com bust", "2000-03-24", "2002-10-09"],
  ["Financial crisis", "2007-10-09", "2009-03-09"],
  ["COVID", "2020-02-19", "2020-03-23"],
  ["", "2022-01-03", "2022-10-12"],
];
const START = 100000;
const state = { data: null, selected: new Set(), scale: "log", range: "all", showArchive: false, charts: {} };

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pct = (v, d = 1, sign = true) =>
  v == null || !isFinite(v) ? "–" : (v > 0 && sign ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%";
const num = (v, d = 2) => (v == null || !isFinite(v) ? "–" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(d));
const money = (v) => "$" + (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1000) + "k");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const verdictClass = (v) => (v.startsWith("Passed") ? "Passed" : v === "Archived" ? "Archived" : v === "Rejected" || v === "Not testable yet" ? "Rejected" : "Running");
const shortlist = () => state.data.experiments.filter((e) => e.tier === "shortlist");
const SP_PROT = "sp-protected";

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
  const rebase = (g) => {
    const b = g.length ? g[0][1] : 1;
    return g.map(([d, v]) => [d, (v / b) * START]);
  };
  data.sp = rebase(data.sp500.growth || []);
  data.spProt = rebase((data.crash_protection || {}).growth || []);
  data.experiments.filter((e) => e.series && e.tier === "shortlist").forEach((e) => state.selected.add(e.id));
  if (data.spProt.length) state.selected.add(SP_PROT);
}

// ---------- hero ----------

function renderStats(data) {
  const exps = data.experiments;
  const passed = exps.filter((e) => e.tier === "shortlist" && e.verdict !== "Running").length;
  const tiles = [
    [exps.length, "ideas tested"],
    [data.totals.versions, "strategy versions"],
    [data.totals.backtests, "backtests"],
    [data.totals.engine_runs, "engine runs reconciled"],
    [passed, "on the shortlist", true],
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
    setTimeout(() => (el.textContent = target), 1200);
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
    ...(state.selected.has(SP_PROT) && data.spProt.length ? [{
      name: "S&P 500 + crash protection", type: "line", data: data.spProt, showSymbol: false,
      lineStyle: { width: 1.6, type: "dotted", color: t.ink2 }, itemStyle: { color: t.ink2 }, z: 2,
    }] : []),
    ...exps.map((e) => ({
      name: e.title + (e.headline.held ? " (as held)" : ""), type: "line", data: e.series.pts, showSymbol: false,
      lineStyle: { width: 2.2, color: e.color }, itemStyle: { color: e.color },
      emphasis: { focus: "series", lineStyle: { width: 3 } }, z: 3,
      markArea: e.series.holdout
        ? {
            silent: true,
            data: [[
              e.holdout.kind === "after"
                ? { name: "After-check (not sealed)", xAxis: e.series.holdout[0], itemStyle: { color: e.color, opacity: 0.06, decal: { symbol: "circle", symbolSize: 0.6, dashArrayX: [1, 4], dashArrayY: [1, 4], color: e.color } }, label: { color: t.ink3, fontSize: 10, fontWeight: 600, position: "insideTopLeft", distance: 14 } }
                : { name: "Sealed holdout", xAxis: e.series.holdout[0], itemStyle: { color: e.color, opacity: 0.1, decal: { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: -0.8, color: e.color } }, label: { color: e.color, fontSize: 10, fontWeight: 600, position: "insideTopRight" } },
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
      ...(state.selected.has(SP_PROT) && data.spProt.length ? [{ name: "S&P 500 + crash protection", type: "line", data: drawdown(data.spProt), showSymbol: false, lineStyle: { width: 1.2, type: "dotted", color: t.ink2 }, itemStyle: { color: t.ink2 } }] : []),
      ...exps.map((e) => ({ name: e.title, type: "line", data: drawdown(e.series.pts), showSymbol: false, lineStyle: { width: 1.6, color: e.color }, itemStyle: { color: e.color }, areaStyle: area(e.color) })),
    ],
  });
  echarts.connect("perf");
}

function renderChips() {
  const all = state.data.experiments.filter((e) => e.series);
  const archived = all.filter((e) => e.tier !== "shortlist");
  const exps = all.filter((e) => e.tier === "shortlist" || state.showArchive);
  const chip = (id, title, color, extra = "") =>
    `<button class="chip${extra}${state.selected.has(id) ? " on" : ""}" data-id="${id}" style="--c:${color}" aria-pressed="${state.selected.has(id)}"><i></i>${esc(title)}</button>`;
  $("#chips").innerHTML =
    `<span class="chip on" style="--c:${css("--ink-2")}" title="Always shown"><i></i>S&amp;P 500</span>` +
    (state.data.spProt.length ? chip(SP_PROT, "S&P 500 + crash protection", css("--ink-2")) : "") +
    exps.map((e) => chip(e.id, e.title, e.color, e.tier === "shortlist" ? "" : " ghost")).join("") +
    (archived.length ? `<button class="chip ghost" id="toggle-archive" style="--c:${css("--ink-3")}">${state.showArchive ? "Hide archived" : `+ ${archived.length} archived`}</button>` : "");
  $("#chips").querySelectorAll("button[data-id]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      b.classList.toggle("on");
      b.setAttribute("aria-pressed", state.selected.has(id));
      renderGrowth();
    })
  );
  const tog = $("#toggle-archive");
  if (tog) tog.addEventListener("click", () => {
    state.showArchive = !state.showArchive;
    if (!state.showArchive) archived.forEach((e) => state.selected.delete(e.id));
    renderChips();
    renderGrowth();
  });
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
      ...groups.map((e) => {
        const live = e.tier === "shortlist";
        return {
          name: e.title, type: "scatter", symbolSize: live ? 13 : 9, z: live ? 3 : 1,
          itemStyle: { color: live ? e.color : t.ink3, borderColor: t.panel, borderWidth: 1.5, opacity: live ? 0.92 : 0.35 },
          emphasis: { scale: 1.5 },
          data: e.versions.map((v) => ({ value: [v.metrics.max_drawdown * 100, v.metrics.sharpe], v })),
        };
      }),
      ...groups.filter((e) => e.headline && e.headline.held).map((e) => ({
        name: e.title + " (as held)", type: "scatter", symbolSize: 16, z: 4,
        itemStyle: { color: "transparent", borderColor: e.color, borderWidth: 3 },
        data: [{ value: [e.m.max_drawdown * 100, e.m.sharpe], v: { version: e.headline.version, label: "Crash-protected, as held (three engines)", metrics: e.m } }],
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
  const exps = shortlist().filter((e) => e.m && e.m.factor_alpha_annual != null)
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
  const rows = [{ title: "S&P 500", yearly: data.sp500.yearly || {} }]
    .concat(data.crash_protection ? [{ title: "S&P 500 + crash protection", yearly: data.crash_protection.yearly || {} }] : [])
    .concat(shortlist().filter((e) => e.headline).map((e) => ({ title: e.title, yearly: { ...e.headline.yearly, ...(e.holdout ? e.holdout.yearly : {}) }, holdout: e.holdout })));
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

function holdoutLine(e) {
  if (!e.holdout) return "";
  const h = e.holdout.metrics;
  const kind = e.holdout.kind === "after" ? "After-check" : "Sealed holdout";
  const tail = e.holdout.kind === "after" ? " · not sealed" : "";
  const bench = h.benchmark_cagr != null ? ` (S&amp;P ${pct(h.benchmark_cagr)}/yr)` : "";
  return `<p><b>${kind} ${h.start.slice(0, 4)}–${h.end.slice(0, 4)}${tail}:</b> ${pct(h.cagr)}/yr, Sharpe ${num(h.sharpe)}, worst drop ${pct(h.max_drawdown)}${bench}, alpha t ${num(h.factor_alpha_t, 1)}</p>`;
}

function renderCards() {
  const exps = shortlist().reverse();
  $("#cards").innerHTML = exps.map((e) => {
    const m = e.m || {};
    const cls = verdictClass(e.verdict);
    const asIs = m.as_is
      ? `<p class="held">As held with crash protection (out of stocks ${pct(m.share_protected, 0, false)} of the time). Without it: ${pct(m.as_is.cagr)}/yr, Sharpe ${num(m.as_is.sharpe)}, worst drop ${pct(m.as_is.max_drawdown, 0)}.</p>`
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
      ${asIs}
      ${holdoutLine(e)}
      ${e.takeaway ? `<p class="takeaway">${esc(e.takeaway)}</p>` : ""}
      <details class="more"><summary>Hypothesis, versions and verdict</summary>
        ${e.rescore ? `<div class="label">Re-scored</div><p>${esc(e.rescore)}</p>` : ""}
        <div class="label">Original verdict</div><p>${esc(e.reason || "In progress")}</p>
        ${versions ? `<div class="label">Versions tried</div><table class="versions"><thead><tr><th>#</th><th>Change</th><th class="num">Sharpe</th><th class="num">Drop</th><th class="num">2× cost</th></tr></thead><tbody>${versions}</tbody></table>` : ""}
        <div class="label">Original hypothesis, as submitted</div><div class="hyp">${esc(e.hypothesis)}</div>
      </details>
    </article>`;
  }).join("");
  renderArchive();
}

function renderArchive() {
  const rows = state.data.experiments.filter((e) => e.tier !== "shortlist").reverse();
  $("#archive").hidden = !rows.length;
  $("#archive-count").textContent = `${rows.length} idea${rows.length === 1 ? "" : "s"}`;
  const head = `<thead><tr><th>Strategy</th><th class="hide-sm">Family</th><th class="num">Return/yr</th><th class="num">S&amp;P</th><th class="num">Sharpe</th><th class="num">Worst drop</th><th class="num">Alpha t</th><th class="why">Why it's archived</th></tr></thead>`;
  const body = rows.map((e) => {
    const m = e.m || {};
    return `<tr><td><b>${esc(e.title)}</b><span class="badge ${verdictClass(e.verdict)}">${esc(e.verdict)}</span></td>
      <td class="hide-sm">${esc(e.family)}</td>
      <td class="num">${pct(m.cagr)}</td><td class="num">${pct(m.benchmark_cagr)}</td>
      <td class="num">${num(m.sharpe)}</td><td class="num">${pct(m.max_drawdown, 0)}</td>
      <td class="num">${num(m.factor_alpha_t, 1)}</td>
      <td class="why">${esc(e.takeaway || e.reason || "")}</td></tr>`;
  }).join("");
  $("#archive-table").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderRules() {
  const cp = state.data.crash_protection;
  if (!cp) return;
  const s = cp.summary;
  $("#cp-kpis").innerHTML = [
    `<div class="head">S&amp;P 500</div><div>Return/yr<b>${pct(s.index.cagr)}</b></div><div>Worst drop<b class="neg">${pct(s.index.max_drawdown, 0)}</b></div>`,
    `<div class="head">+ crash protection</div><div>Return/yr<b>${pct(s.tbills.cagr)}</b></div><div>Worst drop<b class="pos">${pct(s.tbills.max_drawdown, 0)}</b></div>`,
  ].join("");
  $("#cp-note").textContent = `${cp.start.slice(0, 4)}–${cp.end.slice(0, 4)}, after switching costs. Out of stocks ${pct(cp.share_protected, 0, false)} of the time; the price is false alarms (2011, 2018) and a late return after fast rebounds.`;
  const cell = (v) => `<td class="num ${v >= 0 ? "pos" : v < -0.2 ? "neg" : ""}">${pct(v)}</td>`;
  $("#episodes").innerHTML = `<thead><tr><th>Peak to trough</th><th class="num">S&amp;P 500</th><th class="num">Rule → T-bills</th><th class="num">Rule → bonds</th></tr></thead><tbody>` +
    cp.episodes.map((x) => `<tr><td>${esc(x.name)} <span class="tag">${x.start.slice(0, 7)}</span></td>${cell(x.index)}${cell(x.tbills)}${cell(x.bonds)}</tr>`).join("") + "</tbody>";
}

// ---------- live paper portfolio ----------

const sortState = { key: "weight", dir: -1, all: false };

function miniSpark(values, color) {
  if (!values || values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 96).toFixed(1)},${(22 - ((v - lo) / (hi - lo || 1)) * 20).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 96 24" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

function renderPaper() {
  const p = state.data.paper || { status: "not_started" };
  const t = base();
  const label = { not_started: "Not started", running: "Running", paused: "Paused", error: "Needs attention" }[p.status] || p.status;
  const badge = $("#paper-badge");
  badge.textContent = label;
  badge.className = "badge " + (p.status === "running" ? "Passed" : p.status === "not_started" ? "Running" : "Rejected");
  const title = p.title ? `<b>${esc(p.title)}</b>, ` : "";
  const pilot = p.kind === "pilot";
  const holdingName = { risk_on: "the S&P 500 (SPYM)", risk_off: "T-bills (SGOV)" }[p.rule_state];
  $("#paper-sub").innerHTML = pilot
    ? `<b>${esc(p.title)}</b>: the real-money pilot's rehearsal on an Interactive Brokers paper account since ${esc(p.started)}. At each month-end it holds the S&amp;P 500, or T-bills when SPY closes below its 200-day average. ${holdingName ? `Rule now: ${holdingName}${p.drill ? " (a scheduled test switch is in progress)" : ""}.` : ""} Percentages only.`
    : p.status === "not_started"
    ? `${title}the strategy that passed its holdout, is next. Paper trading on an Interactive Brokers paper account starts once the live data feed and broker connection are commissioned. ${p.trend ? "The market filter below already runs on live data." : ""}`
    : `${title}running forward on an Interactive Brokers paper account since ${esc(p.started)}. Returns and weights only. Data through ${esc(p.feed_as_of || "–")}.`;

  const last = (arr) => (arr && arr.length ? arr[arr.length - 1][1] - 1 : null);
  // Benchmarks come from the daily feed and can lag the portfolio by a session, so
  // compare on the latest date both series have rather than mixing dates.
  const versus = (arr) => {
    if (!p.growth || !arr || !arr.length) return null;
    const ours = new Map(p.growth);
    const common = arr.filter(([d]) => ours.has(d));
    if (common.length < 2) return null;
    const [d, v] = common[common.length - 1];
    return ours.get(d) - v;
  };
  const ret = last(p.growth), spy = versus(p.spy), bm = versus(p.beta_matched);
  const tiles = p.growth ? [
    [pct(ret), "return since start", ret >= 0],
    [spy == null ? "–" : pct(spy), "vs S&P 500"],
    ...(bm == null ? [] : [[pct(bm), `vs ${Math.round((p.benchmark_beta || 0) * 100)}% S&P (benchmark)`, bm >= 0]]),
    [String((p.holdings || []).length), "holdings"],
    [p.book_matches == null ? "–" : p.book_matches ? "Yes" : `${p.book_diff} off`, pilot ? "holding matches the rule" : "book matches backtest", p.book_matches],
    ...(pilot && p.next_rebalance ? [[new Date(p.next_rebalance + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }), "next month-end check"]] : []),
  ] : pilot ? [
    [p.trend ? (p.trend.risk_on ? "S&P" : "T-bills") : "–", "signal today", p.trend && p.trend.risk_on],
    [p.trend ? num(p.trend.index_vs_sma, 3) : "–", "SPY ÷ 200-day avg"],
    [p.next_rebalance ? new Date(p.next_rebalance + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–", "next month-end check"],
    [p.feed_as_of ? new Date(p.feed_as_of + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–", "data through"],
  ] : [
    [p.trend ? (p.trend.risk_on ? "In" : "Out") : "–", "market filter", p.trend && p.trend.risk_on],
    [p.trend ? num(p.trend.index_vs_sma, 3) : "–", "index ÷ 200-day avg"],
    [p.trend ? num(p.trend.band, 2) : "0.97", "exit below"],
    [p.next_rebalance ? new Date(p.next_rebalance + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–", "next rebalance"],
    [p.feed_as_of ? new Date(p.feed_as_of + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–", "data through"],
  ];
  $("#paper-kpis").innerHTML = tiles.map(([v, l, hl]) => `<div class="stat${hl ? " hl" : ""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

  // Growth chart (collapsed while there is nothing to draw)
  $("#paper-growth").classList.toggle("chart-empty", !p.growth);
  $("#trend").classList.toggle("chart-empty", !p.trend);
  const g = chart("paper-growth");
  if (p.growth) {
    // Few points: a time axis would label hours, so use one category per trading day.
    const days = p.growth.length < 15 ? p.growth.map(([d]) => d) : null;
    const toPts = (arr) => {
      if (!days) return arr.map(([d, v]) => [d, v - 1]);
      const byDay = new Map(arr);
      return days.map((d) => (byDay.has(d) ? byDay.get(d) - 1 : null));
    };
    const pick = state.data.experiments.find((e) => e.title === p.title) || shortlist()[0];
    g.setOption({
      textStyle: t.text,
      grid: { left: 52, right: 28, top: 36, bottom: 28 },
      legend: { top: 4, textStyle: { color: t.ink2 }, itemWidth: 14, itemHeight: 3 },
      tooltip: { ...t.tooltip, trigger: "axis", valueFormatter: (v) => pct(v) },
      xAxis: days
        ? { type: "category", boundaryGap: false, data: days, axisLabel: { color: t.ink3, formatter: (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) }, axisLine: { lineStyle: { color: t.line } } }
        : { type: "time", axisLabel: { color: t.ink3 }, axisLine: { lineStyle: { color: t.line } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: t.ink3, formatter: (v) => pct(v, Math.abs(v) < 0.02 ? 2 : 0) }, splitLine: { lineStyle: { color: t.line } } },
      series: [
        { name: pilot ? "Pilot (paper)" : "Paper portfolio", type: "line", data: toPts(p.growth), showSymbol: false, lineStyle: { width: 2.4, color: pick ? pick.color : t.accent }, itemStyle: { color: pick ? pick.color : t.accent }, areaStyle: { color: pick ? pick.color : t.accent, opacity: 0.08 } },
        p.beta_matched && { name: `${Math.round((p.benchmark_beta || 0) * 100)}% S&P + cash`, type: "line", data: toPts(p.beta_matched), showSymbol: false, lineStyle: { width: 1.6, color: t.ink2 }, itemStyle: { color: t.ink2 } },
        p.spy && { name: "S&P 500 (SPY)", type: "line", data: toPts(p.spy), showSymbol: false, lineStyle: { width: 1.4, type: "dashed", color: t.ink3 }, itemStyle: { color: t.ink3 } },
      ].filter(Boolean),
    });
  } else {
    g.setOption({ graphic: { type: "text", left: "center", top: "middle", style: { text: "Growth appears here once trading starts.", fill: t.ink3, font: "14px Inter" } } });
  }

  // Trend filter chart
  const tr = chart("trend");
  if (p.trend) {
    const on = p.trend.risk_on;
    $("#trend-label").innerHTML = `${pilot ? "Crash rule" : "Market filter"} · <span class="state-pill ${on ? "on" : "off"}">${on ? (pilot ? "Above: hold the S&amp;P 500" : "In the market") : (pilot ? "Below: hold T-bills" : "In cash")}</span>`;
    const band = p.trend.sma.filter((x) => x[1] != null).map(([d, v]) => [d, v * p.trend.band]);
    tr.setOption({
      textStyle: t.text,
      grid: { left: 52, right: 28, top: 36, bottom: 28 },
      legend: { top: 4, textStyle: { color: t.ink2 }, itemWidth: 14, itemHeight: 3 },
      tooltip: { ...t.tooltip, trigger: "axis", valueFormatter: (v) => num(v, 3) },
      xAxis: { type: "time", axisLabel: { color: t.ink3 }, axisLine: { lineStyle: { color: t.line } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: t.ink3 }, splitLine: { lineStyle: { color: t.line } } },
      series: [
        { name: p.trend.label || "Equal-weight S&P 500", type: "line", data: p.trend.index, showSymbol: false, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent } },
        { name: "200-day average", type: "line", data: p.trend.sma, showSymbol: false, lineStyle: { width: 1.4, color: t.ink2 }, itemStyle: { color: t.ink2 } },
        ...(p.trend.band < 1 ? [{ name: `Exit line (${p.trend.band}×)`, type: "line", data: band, showSymbol: false, lineStyle: { width: 1.2, type: "dashed", color: t.bad }, itemStyle: { color: t.bad } }] : []),
      ],
    });
  } else {
    tr.setOption({ graphic: { type: "text", left: "center", top: "middle", style: { text: "Waiting for the first live data build.", fill: t.ink3, font: "14px Inter" } } });
  }
  renderHoldings();
}

function renderHoldings() {
  const p = state.data.paper || {};
  const rows = [...(p.holdings || [])];
  const table = $("#holdings");
  if (!rows.length) {
    table.innerHTML = `<tr><td class="empty">No positions yet. Holdings appear after the first rebalance, each linked to its TradingView chart.</td></tr>`;
    $("#holdings-note").textContent = "";
    return;
  }
  const k = sortState.key, dir = sortState.dir;
  rows.sort((a, b) => (typeof a[k] === "string" ? a[k].localeCompare(b[k]) : (a[k] ?? -9) - (b[k] ?? -9)) * dir);
  $("#holdings-note").textContent = `Cash ${pct(p.cash_weight, 1, false)} · click a ticker for its TradingView chart`;
  const cols = [["symbol", "Ticker"], ["name", "Company"], ["weight", "Weight", 1], ["day", "Today", 1], ["since_entry", "Since bought", 1], [null, "3 months", 1]];
  const head = cols.map(([key, l, n]) => `<th class="${n ? "num" : ""}" ${key ? `data-key="${key}"` : ""} ${key === k ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${l}</th>`).join("");
  const shown = sortState.all ? rows : rows.slice(0, 12);
  const body = shown.map((h) => {
    const color = (h.spark && h.spark[h.spark.length - 1] >= h.spark[0]) ? css("--accent") : css("--bad");
    return `<tr>
      <td><a href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(h.tv)}" target="_blank" rel="noopener">${esc(h.symbol)}</a></td>
      <td class="nm">${esc(h.name)}</td>
      <td class="num">${pct(h.weight, 1, false)}</td>
      <td class="num ${h.day > 0 ? "pos" : h.day < 0 ? "neg" : ""}">${pct(h.day, 2)}</td>
      <td class="num ${h.since_entry > 0 ? "pos" : h.since_entry < 0 ? "neg" : ""}">${pct(h.since_entry)}</td>
      <td class="num">${miniSpark(h.spark, color)}</td></tr>`;
  }).join("");
  const more = rows.length > 12
    ? `<tfoot><tr><td colspan="6"><button class="more-btn" id="more-holdings">${sortState.all ? "Show top 12" : `Show all ${rows.length}`}</button></td></tr></tfoot>`
    : "";
  table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>${more}`;
  const btn = $("#more-holdings");
  if (btn) btn.addEventListener("click", () => { sortState.all = !sortState.all; renderHoldings(); });
  table.querySelectorAll("th[data-key]").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.key;
    sortState.dir = sortState.key === key ? -sortState.dir : (key === "symbol" || key === "name" ? 1 : -1);
    sortState.key = key;
    renderHoldings();
  }));
}

// ---------- wiring ----------

function renderAll() {
  renderPaper();
  renderRules();
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
  // theme.js owns the toggle and the saved choice; redraw the charts when it changes.
  window.addEventListener("themechange", () => state.data && renderAll());
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
