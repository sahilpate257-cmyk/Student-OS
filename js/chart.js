// chart.js — dependency-free interactive line chart (SVG) plus a tiny sparkline.
// lineChart(el, { points:[{t(ms), v}], range, tone:"pos"|"neg"|"accent", height,
//                 lines:[{value,label}], fmt(v), onScrub(point|null) })
// Drag or hover to scrub: a crosshair follows the pointer and onScrub reports the point
// so the page header can show the scrubbed price instead of the latest one.

const CSS = `
.lc{position:relative;user-select:none;-webkit-user-select:none}
.lc-svg{display:block;width:100%;touch-action:pan-y;overflow:visible}
.lc.pos{color:var(--pos)}.lc.neg{color:var(--neg)}.lc.accent{color:var(--accent)}
.lc-grid{stroke:var(--border);stroke-width:1}
.lc-axis{fill:var(--ink-faint);font:500 11.5px/1 Manrope,system-ui,sans-serif}
.lc-ref{stroke:var(--ink-faint);stroke-width:1;stroke-dasharray:3 4;opacity:.7}
.lc-ref-t{fill:var(--ink-faint);font:600 11px/1 Manrope,system-ui,sans-serif}
.lc-line{fill:none;stroke:currentColor;stroke-width:2.25;stroke-linejoin:round;stroke-linecap:round}
.lc-line.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:lcDraw .8s cubic-bezier(.22,1,.36,1) forwards}
.lc-area{opacity:0;animation:lcFade .6s .25s ease forwards}
@keyframes lcDraw{to{stroke-dashoffset:0}}
@keyframes lcFade{to{opacity:1}}
.lc-cross{stroke:var(--ink-faint);stroke-width:1}
.lc-dot{fill:currentColor;stroke:var(--surface);stroke-width:2.5}
.lc-tip{position:absolute;top:-2px;pointer-events:none;padding:5px 9px;border-radius:9px;font-size:12.5px;font-weight:600;white-space:nowrap;
  background:var(--ink);color:var(--on-ink);opacity:0;transition:opacity .12s;transform:translateY(-100%)}
.lc.scrub .lc-tip{opacity:1}
@media (prefers-reduced-motion:reduce){.lc-line.draw,.lc-area{animation:none;stroke-dasharray:none;stroke-dashoffset:0;opacity:1}}
`;

let uid = 0;
const NS = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n) => String(n).padStart(2, "0");

export function fmtAxis(ms, range) {
  const d = new Date(ms);
  if (range === "1D") return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (range === "1W") return DAYS[d.getDay()];
  if (range === "1M" || range === "3M") return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (range === "1Y" || range === "5Y") return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return String(d.getFullYear());
}

export function fmtScrub(ms, range) {
  const d = new Date(ms);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (range === "1D") return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (range === "1W") return `${DAYS[d.getDay()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (range === "ALL") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return day;
}

function niceTicks(lo, hi, n = 4) {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { ticks, dp: Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))) };
}

export function lineChart(el, initial) {
  if (!document.getElementById("lc-css")) {
    const s = document.createElement("style");
    s.id = "lc-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const id = `lc${++uid}`;
  let o = initial;
  let geo = null;
  let raf = 0;
  let drawn = false;
  let lastW = 0;

  el.classList.add("lc");
  el.innerHTML = `<svg class="lc-svg" role="img"></svg><div class="lc-tip"></div>`;
  const svg = el.querySelector("svg");
  const tip = el.querySelector(".lc-tip");

  function draw(animate) {
    const pts = o.points || [];
    const W = Math.max(240, el.clientWidth || 320);
    const H = o.height || 240;
    lastW = W;
    el.classList.remove("pos", "neg", "accent");
    el.classList.add(o.tone || "accent");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (pts.length < 2) { svg.innerHTML = ""; geo = null; return; }

    const padL = 2, padR = 50, padT = 14, padB = 26;
    const pw = W - padL - padR, ph = H - padT - padB;
    const vals = pts.map((p) => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // reference lines only widen the scale when they're close, so a far-off cost basis can't flatten the chart
    const near = (o.lines || []).filter((l) => l.value > lo - (hi - lo) * 0.35 && l.value < hi + (hi - lo) * 0.35);
    near.forEach((l) => { lo = Math.min(lo, l.value); hi = Math.max(hi, l.value); });
    const span = hi - lo || Math.abs(hi) * 0.02 || 1;
    lo -= span * 0.08; hi += span * 0.08;
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ph;

    const indexSpaced = o.range === "1D" || o.range === "1W";
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const x = indexSpaced
      ? (i) => padL + (i / (pts.length - 1)) * pw
      : (i) => padL + ((pts[i].t - t0) / (t1 - t0 || 1)) * pw;
    const xs = pts.map((_, i) => x(i));
    geo = { pts, xs, padL, pw, padT, ph, W, H, y };

    const line = pts.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
    const area = `${line}L${xs[xs.length - 1].toFixed(1)} ${padT + ph}L${xs[0].toFixed(1)} ${padT + ph}Z`;

    const nt = niceTicks(lo, hi);
    const grid = nt.ticks.map((v) => {
      const yy = y(v);
      return `<line class="lc-grid" x1="${padL}" x2="${padL + pw}" y1="${yy}" y2="${yy}"/><text class="lc-axis" x="${W}" y="${yy + 4}" text-anchor="end">${v.toLocaleString(undefined, { minimumFractionDigits: nt.dp, maximumFractionDigits: nt.dp })}</text>`;
    }).join("");

    const ticks = [0, 1 / 3, 2 / 3, 1].map((f, k) => {
      const i = Math.round(f * (pts.length - 1));
      const anchor = k === 0 ? "start" : k === 3 ? "end" : "middle";
      const tx = k === 0 ? padL : k === 3 ? padL + pw : xs[i];
      return `<text class="lc-axis" x="${tx}" y="${H - 6}" text-anchor="${anchor}">${fmtAxis(pts[i].t, o.range)}</text>`;
    }).join("");

    const refs = (o.lines || []).filter((l) => l.value >= lo && l.value <= hi).map((l) =>
      `<line class="lc-ref" x1="${padL}" x2="${padL + pw}" y1="${y(l.value)}" y2="${y(l.value)}"/><text class="lc-ref-t" x="${padL + 2}" y="${y(l.value) - 5}">${l.label}</text>`).join("");

    svg.setAttribute("aria-label", o.label || "Price chart");
    svg.innerHTML = `
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="currentColor" stop-opacity=".24"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      ${grid}${refs}
      <path class="lc-area" d="${area}" fill="url(#${id})" ${animate ? "" : 'style="animation:none;opacity:1"'}/>
      <path class="lc-line ${animate ? "draw" : ""}" pathLength="1" d="${line}"/>
      ${ticks}
      <g class="lc-hover" style="display:none"><line class="lc-cross" y1="${padT}" y2="${padT + ph}"/><circle class="lc-dot" r="5"/></g>
      <rect class="lc-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
    drawn = true;
  }

  function nearest(px) {
    const { xs } = geo;
    let a = 0, b = xs.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (xs[m] < px) a = m; else b = m; }
    return px - xs[a] <= xs[b] - px ? a : b;
  }

  function scrub(e) {
    if (!geo) return;
    const r = svg.getBoundingClientRect();
    const i = nearest(e.clientX - r.left);
    const p = geo.pts[i], px = geo.xs[i], py = geo.y(p.v);
    const g = svg.querySelector(".lc-hover");
    g.style.display = "";
    g.querySelector(".lc-cross").setAttribute("x1", px);
    g.querySelector(".lc-cross").setAttribute("x2", px);
    const dot = g.querySelector(".lc-dot");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    const fmt = o.fmt || ((v) => v.toFixed(2));
    tip.textContent = `${fmt(p.v)} · ${fmtScrub(p.t, o.range)}`;
    el.classList.add("scrub");
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(px - w / 2, 0), geo.W - w)}px`;
    o.onScrub?.(p, i);
  }

  function end() {
    const g = svg.querySelector(".lc-hover");
    if (g) g.style.display = "none";
    el.classList.remove("scrub");
    o.onScrub?.(null);
  }

  svg.addEventListener("pointermove", scrub);
  svg.addEventListener("pointerdown", scrub);
  svg.addEventListener("pointerleave", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") end(); });

  const ro = new ResizeObserver(() => {
    if (Math.max(240, el.clientWidth || 320) === lastW) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => drawn && draw(false));
  });
  ro.observe(el);
  draw(true);

  return {
    update(next) { o = { ...o, ...next }; draw(true); },
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); el.innerHTML = ""; },
  };
}

export function sparkline(values, tone, { w = 56, h = 24 } = {}) {
  if (!values || values.length < 2) return `<span style="display:inline-block;width:${w}px"></span>`;
  const lo = Math.min(...values), span = Math.max(...values) - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--${tone === "neg" ? "neg" : "pos"})" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
