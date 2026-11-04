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
    const box = $("lookout-calls"), more = $("lookout-more"), FIRST = 12;
    const draw = (all) => {
      const list = all ? d.calls : d.calls.slice(0, FIRST);
      box.innerHTML = list.length ? list.map(card).join("")
        : `<p class="note">The first calls are made at 3:25 PM ET on the next trading day.</p>`;
      more.hidden = all || d.calls.length <= FIRST;
    };
    more.addEventListener("click", () => draw(true));
    draw(false);
  } catch (e) {
    $("lookout-status").textContent = e.message;
  }
})();
