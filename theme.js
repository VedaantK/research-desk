"use strict";
// Shared by every page: apply the saved light/dark choice before first paint, wire the
// toggle, and announce changes so each page can redraw its charts in the new colours.
(() => {
  const store = (value) => {
    try {
      if (value === undefined) return localStorage.getItem("theme");
      localStorage.setItem("theme", value);
    } catch (e) {
      return null;
    }
  };
  const root = document.documentElement;
  const saved = store();
  if (saved) root.dataset.theme = saved;
  const announce = () => window.dispatchEvent(new Event("themechange"));
  // Base ECharts options in the current theme, for the smaller pages' charts.
  window.chartTheme = () => {
    const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    const ink2 = css("--ink-2"), ink3 = css("--ink-3"), line = css("--line"), panel = css("--panel");
    return {
      animation: false,
      textStyle: { color: ink2, fontFamily: "Inter, sans-serif", fontSize: 12 },
      tooltip: {
        trigger: "axis", backgroundColor: panel, borderColor: line,
        textStyle: { color: css("--ink"), fontSize: 12 },
        extraCssText: "box-shadow:0 8px 24px rgba(0,0,0,.18);border-radius:10px;",
      },
      legend: { top: 4, type: "scroll", textStyle: { color: ink2 }, itemWidth: 14, itemHeight: 3 },
      grid: { left: 56, right: 20, top: 40, bottom: 32 },
      xAxis: { type: "time", axisLabel: { color: ink3 }, axisLine: { lineStyle: { color: line } }, splitLine: { show: false } },
      yAxis: { type: "value", axisLabel: { color: ink3 }, splitLine: { lineStyle: { color: line } } },
      accent: css("--accent"), bad: css("--bad"), warn: css("--warn"), ink3,
    };
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!root.dataset.theme) announce();
  });
  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("theme");
    if (!button) return;
    button.addEventListener("click", () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      root.dataset.theme = next;
      store(next);
      announce();
    });
  });
})();
