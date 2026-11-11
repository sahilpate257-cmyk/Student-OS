// motion.js — the feel layer: view transitions between tabs, a circular reveal when the theme changes,
// numbers that count up, and staggered entrances. Everything respects prefers-reduced-motion.

const reduce = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let lastPoint = { x: innerWidth / 2, y: 80 };
addEventListener("pointerdown", (e) => { lastPoint = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });

/** Runs `update` inside a view transition when the browser supports it. */
export function transition(update, kind = "tab") {
  if (!document.startViewTransition || reduce()) { update(); return; }
  document.documentElement.dataset.vt = kind;
  const t = document.startViewTransition(update);
  t.finished.finally(() => { delete document.documentElement.dataset.vt; });
  return t;
}

/** Theme changes spread out in a circle from wherever you clicked. */
export function themeTransition(update) {
  if (!document.startViewTransition || reduce()) { update(); return; }
  const { x, y } = lastPoint;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.dataset.vt = "theme";
  const t = document.startViewTransition(update);
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
  t.finished.finally(() => { delete document.documentElement.dataset.vt; });
}

/** Elements with data-count="1234.5" tick up from 0 to their value, then show their real text. */
function countUp(el) {
  if (el.dataset.counted) return;
  el.dataset.counted = "1";
  const target = Math.abs(Number(el.dataset.count));
  if (!isFinite(target) || target === 0 || reduce()) return;
  const final = el.textContent;
  const prefix = el.dataset.prefix || "";
  const start = performance.now(), dur = 800;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + Math.round(target * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(tick); else el.textContent = final;
  };
  requestAnimationFrame(tick);
}

export function initMotion() {
  const scan = (root) => root.querySelectorAll?.("[data-count]:not([data-counted])").forEach(countUp);
  scan(document);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.("[data-count]")) countUp(n); scan(n); }
  }).observe(document.body, { childList: true, subtree: true });
}
