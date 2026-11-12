// theme.js — turns a palette from themes.js (generated from ledgerly-design/themes.json, shared with
// the iPhone app) into the CSS variables every module already uses, plus the glass, glow and pattern layers.

import { THEMES, DEFAULT_THEME } from "./themes.js";

const PALETTE_KEY = "ledgerly_palette";
const MODE_KEY = "ledgerly_mode";      // "system" | "light" | "dark"
const CSS_KEY = "ledgerly_theme_css";  // last computed variables, applied pre-paint by index.html

const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const rgba = (h, a) => `rgba(${hex(h).join(",")},${a})`;
const mix = (a, b, t) => {
  const x = hex(a), y = hex(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

export const Theme = {
  palette() {
    let id = DEFAULT_THEME;
    try { id = localStorage.getItem(PALETTE_KEY) || id; } catch (e) {}
    return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME) || THEMES[0];
  },

  mode() {
    try { return localStorage.getItem(MODE_KEY) || "system"; } catch (e) { return "system"; }
  },

  isDark() {
    const m = this.mode();
    if (m === "dark") return true;
    if (m === "light") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  },

  vars(t, dark) {
    const p = dark ? t.dark : t.light;
    const g = p.glows;
    const v = {
      "--bg": "#" + p.bg,
      "--ink": "#" + p.ink,
      "--ink-muted": "#" + p.secondary,
      "--ink-faint": mix(p.secondary, p.bg, dark ? 0.32 : 0.28),
      "--pos": "#" + p.pos, "--pos-soft": rgba(p.pos, dark ? 0.15 : 0.12),
      "--neg": "#" + p.neg, "--neg-soft": rgba(p.neg, dark ? 0.15 : 0.11),
      "--accent": "#" + p.accent, "--accent-2": mix(p.accent, dark ? "FFFFFF" : "000000", 0.18),
      "--accent-soft": rgba(p.accent, dark ? 0.18 : 0.12), "--accent-ink": "#FFFFFF",
      "--gold": mix(p.accent, dark ? "FFFFFF" : "000000", 0.3),
      "--ring": "#" + p.accent,
      "--on-ink": "#" + p.bg,
      "--glow-1": rgba(g[0], p.glowAlpha * (dark ? 0.55 : 0.6)),
      "--glow-2": rgba(g[1] || g[0], p.glowAlpha * (dark ? 0.45 : 0.5)),
      "--glow-3": rgba(g[2] || g[0], p.glowAlpha * (dark ? 0.32 : 0.38)),
      "--pattern-ink": dark ? "rgba(255,255,255,.75)" : rgba(p.ink, 0.25),
      "--grid-ink": rgba(g[0], dark ? 0.5 : 0.32),
    };
    if (dark) Object.assign(v, {
      "--surface": "rgba(255,255,255,.055)", "--surface-2": "rgba(255,255,255,.09)", "--sunken": "rgba(255,255,255,.04)",
      "--surface-solid": mix(p.bg, "FFFFFF", 0.07),
      "--border": "rgba(255,255,255,.09)", "--border-2": "rgba(255,255,255,.16)",
      "--header-bg": rgba(p.bg, 0.55), "--nav-bg": rgba(p.bg, 0.6), "--scroll": "rgba(255,255,255,.16)",
      "--edge": "rgba(255,255,255,.10)",
      "--shadow-sm": "0 1px 2px rgba(0,0,0,.4)", "--shadow-md": "0 8px 28px rgba(0,0,0,.38)", "--shadow-lg": "0 24px 60px rgba(0,0,0,.55)",
    });
    else Object.assign(v, {
      "--surface": "rgba(255,255,255,.58)", "--surface-2": "rgba(255,255,255,.78)", "--sunken": rgba(p.ink, 0.045),
      "--surface-solid": mix(p.bg, "FFFFFF", 0.6),
      "--border": rgba(p.ink, 0.08), "--border-2": rgba(p.ink, 0.14),
      "--header-bg": rgba(p.bg, 0.6), "--nav-bg": rgba(p.bg, 0.66), "--scroll": rgba(p.ink, 0.18),
      "--edge": "rgba(255,255,255,.7)",
      "--shadow-sm": `0 1px 2px ${rgba(p.ink, 0.05)}`, "--shadow-md": `0 8px 26px ${rgba(p.ink, 0.07)}`, "--shadow-lg": `0 24px 56px ${rgba(p.ink, 0.12)}`,
    });
    return v;
  },

  apply() {
    const t = this.palette(), dark = this.isDark();
    const root = document.documentElement;
    const v = this.vars(t, dark);
    for (const [k, val] of Object.entries(v)) root.style.setProperty(k, val);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.setAttribute("data-palette", t.id);
    root.setAttribute("data-pattern", t.pattern || "none");
    root.setAttribute("data-uniform", t.uniform ? "true" : "false");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", v["--bg"]);
    try {
      localStorage.setItem(CSS_KEY, JSON.stringify({ v, dark, id: t.id, pattern: t.pattern || "none" }));
    } catch (e) {}
    this._listeners.forEach((fn) => fn());
  },

  setPalette(id) { try { localStorage.setItem(PALETTE_KEY, id); } catch (e) {} this.apply(); },
  setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} this.apply(); },

  _listeners: [],
  onChange(fn) { this._listeners.push(fn); },

  init() {
    this.apply();
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (this.mode() === "system") this.apply(); });
  },

  // Swatch markup for the picker: background, glow, and the three signal colours.
  swatch(t, dark) {
    const p = dark ? t.dark : t.light;
    return `<span class="th-sw" style="background:radial-gradient(circle at 25% 25%, #${p.glows[0]}cc, transparent 60%), radial-gradient(circle at 85% 80%, #${(p.glows[1] || p.glows[0])}aa, transparent 55%), #${p.bg}">
      <span style="background:#${p.pos}"></span><span style="background:#${p.accent}"></span><span style="background:#${p.neg}"></span>
    </span>`;
  },

  all: THEMES,
};
