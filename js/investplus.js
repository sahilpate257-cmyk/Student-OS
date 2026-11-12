// investplus.js — Invest extras shared with the phone: watchlist (+ price alert levels), dividend income,
// and a breakdown of what made your return. Mounted under the portfolio on each render.

import { Store, escapeHtml } from "./store.js";
import { icon } from "./icons.js";
import { api, yahooSymbol, logoHtml } from "./marketdata.js";
import { sparkline } from "./chart.js";
import { PortfolioModule } from "./portfolio.js";

const P = () => PortfolioModule;

export const InvestExtras = {
  tab: "watch",
  watch: {},          // symbol → PriceSeries
  watchKey: "",
  divs: null,
  divKey: "",
  adding: false,
  error: "",

  mount(parent) {
    injectStyles();
    let box = parent.querySelector("#ix-root");
    if (!box) {
      box = document.createElement("div");
      box.id = "ix-root";
      box.addEventListener("click", (e) => this.onClick(e));
      box.addEventListener("keydown", (e) => { if (e.target.id === "ix-add" && e.key === "Enter") { e.preventDefault(); this.add(); } });
      box.addEventListener("change", (e) => this.onChange(e));
    }
    parent.appendChild(box);
    this.box = box;
    this.render();
    this.load();
  },

  get list() { return Store.state.watchlist || []; },
  get alerts() { return Store.state.priceAlerts || []; },

  async load() {
    const syms = this.list.map((w) => w.symbol);
    const k = syms.join(",");
    if (syms.length && k !== this.watchKey) {
      this.watchKey = k;
      try { const r = await api("/history", { symbols: syms, range: "1M" }); Object.assign(this.watch, r.series || {}); this.render(); } catch (e) {}
    }
    const hs = (Store.state.holdings || []).map(yahooSymbol);
    const dk = hs.join(",");
    if (hs.length && dk !== this.divKey) {
      this.divKey = dk;
      try { this.divs = (await api("/dividends", { symbols: hs })).dividends || {}; this.render(); } catch (e) {}
    }
  },

  onClick(e) {
    const b = e.target.closest("[data-ix]");
    if (!b) return;
    const { ix, id } = b.dataset;
    if (ix === "tab") { this.tab = b.dataset.tab; return this.render(); }
    if (ix === "add") return this.add();
    if (ix === "remove") {
      const w = this.list.find((x) => x.id === id);
      if (!w) return;
      Store.remove("watchlist", id);
      const a = this.alerts.find((x) => x.symbol === w.symbol);
      if (a) Store.remove("priceAlerts", a.id);
      return this.render();
    }
  },

  onChange(e) {
    const inp = e.target.closest("[data-alert]");
    if (!inp) return;
    const sym = inp.dataset.sym, side = inp.dataset.alert;
    const v = parseFloat(inp.value);
    Store.state.priceAlerts ||= [];
    let a = this.alerts.find((x) => x.symbol === sym);
    if (!a) {
      const w = this.list.find((x) => x.symbol === sym);
      a = { id: "pa_" + Math.random().toString(36).slice(2, 10), symbol: sym, name: w?.name || sym, currency: this.watch[sym]?.meta?.currency || "USD" };
      a[side] = isFinite(v) ? v : undefined;
      if (a.above == null && a.below == null) return;
      Store.add("priceAlerts", JSON.parse(JSON.stringify(a)));
    } else {
      const patch = { [side]: isFinite(v) ? v : null };
      const next = { ...a, ...patch };
      if (next.above == null && next.below == null) Store.remove("priceAlerts", a.id);
      else Store.update("priceAlerts", a.id, patch);
    }
    this.flash(inp);
    // The Worker checks alerts every 10 minutes and pushes to the phone.
    api("/alerts/sync", { alerts: (Store.state.priceAlerts || []) }).catch(() => {});
  },

  flash(el) { el.classList.add("ix-saved"); setTimeout(() => el.classList.remove("ix-saved"), 900); },

  // US tickers as-is; anything else is retried as a London listing (.L).
  async add() {
    const raw = this.box.querySelector("#ix-add")?.value.trim().toUpperCase();
    if (!raw || this.adding) return;
    this.adding = true; this.error = ""; this.render();
    for (const sym of raw.includes(".") || raw.startsWith("^") ? [raw] : [raw, raw + ".L"]) {
      try {
        const r = await api("/history", { symbols: [sym], range: "1M" });
        const s = r.series?.[sym];
        if (s) {
          this.watch[sym] = s;
          Store.state.watchlist ||= [];
          if (!this.list.some((w) => w.symbol === sym)) {
            Store.add("watchlist", { id: "wl_" + Math.random().toString(36).slice(2, 10), symbol: sym, name: s.meta?.name || sym, addedAt: new Date().toISOString() });
          }
          this.adding = false;
          return this.render();
        }
      } catch (e) {}
    }
    this.adding = false;
    this.error = `Couldn't find ${raw}. Try the exact ticker (e.g. VUAG, NVDA, BP.L).`;
    this.render();
  },

  render() {
    if (!this.box) return;
    const t = (id, label, ic) => `<button data-ix="tab" data-tab="${id}" class="${this.tab === id ? "on" : ""}">${icon(ic, 14)} ${label}</button>`;
    this.box.innerHTML = `
      <div class="ix-tabs">${t("watch", "Watchlist", "eye")}${t("div", "Dividends", "wallet")}${t("why", "Breakdown", "insights")}</div>
      <div class="ix-panel">${this.tab === "div" ? this.dividendsHTML() : this.tab === "why" ? this.breakdownHTML() : this.watchHTML()}</div>`;
  },

  watchHTML() {
    const rows = this.list.map((w) => {
      const s = this.watch[w.symbol];
      const price = s?.meta?.price, prev = s?.meta?.prevClose ?? s?.c?.at(-2);
      const day = price && prev ? price / prev - 1 : null;
      const cur = s?.meta?.currency === "GBP" ? "£" : "$";
      const a = this.alerts.find((x) => x.symbol === w.symbol) || {};
      return `<div class="ix-row">
        ${logoHtml(w.symbol.replace(/\.L$/, ""), 36)}
        <div class="ix-name"><b class="ticker">${escapeHtml(w.symbol)}</b><span>${escapeHtml(w.name || s?.meta?.name || "")}</span></div>
        <div class="ix-spark">${s?.c?.length > 1 ? sparkline(s.c, s.c.at(-1) >= s.c[0] ? "pos" : "neg", { w: 90, h: 30 }) : ""}</div>
        <div class="ix-price"><b class="num">${price ? cur + price.toFixed(2) : "…"}</b>${day != null ? `<span class="${day >= 0 ? "pos" : "neg"} num">${day >= 0 ? "+" : "−"}${Math.abs(day * 100).toFixed(2)}%</span>` : ""}</div>
        <div class="ix-alerts" title="Price alerts — the phone notifies you">
          ${icon("bell", 13)}
          <input data-alert="above" data-sym="${w.symbol}" placeholder="≥" value="${a.above ?? ""}" inputmode="decimal" />
          <input data-alert="below" data-sym="${w.symbol}" placeholder="≤" value="${a.below ?? ""}" inputmode="decimal" />
        </div>
        <button class="btn-icon reveal" data-ix="remove" data-id="${w.id}" title="Remove">${icon("x", 15)}</button>
      </div>`;
    }).join("");
    return `
      <div class="ix-addrow">${icon("search", 16)}<input id="ix-add" placeholder="Add a ticker, e.g. AAPL or VUAG" autocomplete="off" />
        <button class="btn btn-primary btn-sm" data-ix="add" ${this.adding ? "disabled" : ""}>${this.adding ? "Finding…" : "Add"}</button></div>
      ${this.error ? `<p class="neg text-[12.5px] mt-2">${escapeHtml(this.error)}</p>` : ""}
      <div class="ix-list">${rows || `<p class="faint text-[13.5px] py-4">Track stocks and funds you don't own yet. Set an alert level and your phone pings you when it's crossed.</p>`}</div>`;
  },

  dividendsHTML() {
    if (!this.divs) return `<p class="faint py-4">Loading dividends…</p>`;
    const p = P();
    const rows = (Store.state.holdings || []).map((h) => {
      const d = this.divs[yahooSymbol(h)];
      if (!d?.annual) return null;
      const v = p.conv(d.annual * h.shares, d.currency || h.currency);
      return v == null ? null : { h, v, d };
    }).filter(Boolean).sort((a, b) => b.v - a.v);
    const annual = rows.reduce((a, r) => a + r.v, 0);
    let value = 0, cost = 0;
    for (const h of Store.state.holdings || []) { value += p.conv(h.shares * h.currentPrice, h.currency) || 0; cost += p.conv(h.shares * h.buyPrice, h.currency) || 0; }
    const upcoming = rows.filter((r) => r.d.next).sort((a, b) => a.d.next.date.localeCompare(b.d.next.date)).slice(0, 6);
    const money = (n) => p.cur() + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `
      <div class="ix-stats">
        <div><small>A year</small><b class="num" data-count="${annual}" data-prefix="${p.cur()}">${money(annual)}</b></div>
        <div><small>A month</small><b class="num">${money(annual / 12)}</b></div>
        <div><small>Yield</small><b class="num">${value ? (annual / value * 100).toFixed(2) : "—"}%</b></div>
        <div><small>On cost</small><b class="num">${cost ? (annual / cost * 100).toFixed(2) : "—"}%</b></div>
      </div>
      ${upcoming.length ? `<p class="eyebrow mt-4 mb-2">Coming up</p>${upcoming.map((r) => `<div class="ix-kv"><span>${logoHtml(r.h.ticker, 24)} ${escapeHtml(r.h.name || r.h.ticker)}</span>
        <span class="faint">${new Date(r.d.next.date + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}${r.d.next.estimated ? " · est." : ""}</span>
        <b class="pos num">≈ ${money(r.v / Math.max(1, r.d.perYear || 4))}</b></div>`).join("")}` : ""}
      <p class="eyebrow mt-4 mb-2">By holding</p>
      ${rows.map((r) => `<div class="ix-kv"><span><b class="ticker">${escapeHtml(r.h.ticker)}</b> <span class="faint">${r.d.yield != null ? r.d.yield.toFixed(2) + "% yield" : ""}</span></span><b class="num">${money(r.v)}/yr</b></div>`).join("") || `<p class="faint">None of your holdings pay a dividend.</p>`}
      <p class="text-[11.5px] faint mt-3">Latest payout × how often it pays, at today's share counts, before tax.</p>`;
  },

  breakdownHTML() {
    const p = P();
    const rows = (Store.state.holdings || []).map((h) => {
      const v = p.conv(h.shares * h.currentPrice, h.currency), c = p.conv(h.shares * h.buyPrice, h.currency);
      return v == null || c == null ? null : { h, v, gain: v - c, pct: c > 0 ? v / c - 1 : 0 };
    }).filter(Boolean).sort((a, b) => b.gain - a.gain);
    if (!rows.length) return `<p class="faint py-4">No holdings yet.</p>`;
    const total = rows.reduce((a, r) => a + r.v, 0), gainT = rows.reduce((a, r) => a + r.gain, 0);
    const maxAbs = Math.max(...rows.map((r) => Math.abs(r.gain)), 1);
    const top3 = [...rows].sort((a, b) => b.v - a.v).slice(0, 3).reduce((a, r) => a + r.v, 0);
    const usd = rows.filter((r) => r.h.currency !== "GBP").reduce((a, r) => a + r.v, 0);
    const best = [...rows].sort((a, b) => b.pct - a.pct)[0], worst = [...rows].sort((a, b) => a.pct - b.pct)[0];
    const money = (n) => (n < 0 ? "−" : "+") + p.cur() + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return `
      <p class="ix-big ${gainT >= 0 ? "pos" : "neg"} num">${money(gainT)} <small>unrealised</small></p>
      <div class="ix-bars">${rows.map((r, i) => `<div class="ix-gbar" style="--d:${i * 40}ms">
        <span class="ticker">${escapeHtml(r.h.ticker)}</span>
        <div class="ix-gtrack"><i class="${r.gain >= 0 ? "up" : "down"}" style="--w:${Math.abs(r.gain) / maxAbs * 50}%"></i></div>
        <b class="num ${r.gain >= 0 ? "pos" : "neg"}">${money(r.gain)}</b></div>`).join("")}</div>
      <div class="ix-stats mt-4">
        <div><small>Top 3 holdings</small><b>${Math.round(top3 / total * 100)}%</b></div>
        <div><small>In US dollars</small><b>${Math.round(usd / total * 100)}%</b></div>
        <div><small>Best</small><b class="pos">${escapeHtml(best.h.ticker)} +${Math.round(best.pct * 100)}%</b></div>
        <div><small>Worst</small><b class="${worst.pct >= 0 ? "pos" : "neg"}">${escapeHtml(worst.h.ticker)} ${worst.pct >= 0 ? "+" : "−"}${Math.abs(Math.round(worst.pct * 100))}%</b></div>
      </div>`;
  },
};

function injectStyles() {
  if (document.getElementById("ix-css")) return;
  const s = document.createElement("style");
  s.id = "ix-css";
  s.textContent = `
#ix-root{margin-top:22px;padding-top:18px;border-top:1px solid var(--border)}
.ix-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:13px;background:var(--sunken);margin-bottom:14px}
.ix-tabs button{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:10px;font-size:13px;font-weight:700;color:var(--ink-muted);transition:.2s}
.ix-tabs button.on{background:var(--surface-2);color:var(--ink);box-shadow:var(--shadow-sm)}
.ix-panel{animation:fade .35s ease}
.ix-addrow{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 14px;border-radius:14px;background:var(--sunken);border:1px solid var(--border);color:var(--ink-faint)}
.ix-addrow input{flex:1;background:transparent;border:0;outline:0;color:var(--ink);font:inherit;font-size:14px;text-transform:uppercase}
.ix-list{margin-top:10px}
.ix-row{display:grid;grid-template-columns:auto minmax(0,1fr) 90px 92px auto auto;gap:12px;align-items:center;padding:11px 4px;border-top:1px solid var(--border)}
.ix-row:first-child{border-top:0}
.ix-name{display:flex;flex-direction:column;min-width:0}.ix-name span{font-size:12px;color:var(--ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ix-price{text-align:right;display:flex;flex-direction:column}.ix-price span{font-size:12px;font-weight:700}
.ix-alerts{display:flex;align-items:center;gap:4px;color:var(--ink-faint)}
.ix-alerts input{width:58px;padding:5px 7px;border-radius:8px;background:var(--sunken);border:1px solid var(--border);color:var(--ink);font:12.5px 'IBM Plex Mono',monospace;transition:border-color .2s,box-shadow .3s}
.ix-alerts input.ix-saved{border-color:var(--pos);box-shadow:0 0 0 3px var(--pos-soft)}
.ix-row:hover .reveal{opacity:1}
@media(max-width:700px){.ix-row{grid-template-columns:auto minmax(0,1fr) auto auto}.ix-spark,.ix-alerts{display:none}}
.ix-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.ix-stats>div{padding:12px;border-radius:14px;background:var(--sunken)}
.ix-stats small{display:block;font-size:11.5px;font-weight:700;color:var(--ink-faint)}
.ix-stats b{font-size:17px}
@media(max-width:600px){.ix-stats{grid-template-columns:repeat(2,1fr)}}
.ix-kv{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px}
.ix-kv>span:first-child{display:flex;align-items:center;gap:8px;min-width:0}
.ix-big{font:800 30px/1.1 Manrope,system-ui;margin-bottom:12px}.ix-big small{font-size:13px;font-weight:600;color:var(--ink-muted)}
.ix-bars{display:grid;gap:7px}
.ix-gbar{display:grid;grid-template-columns:64px 1fr 84px;gap:10px;align-items:center;font-size:13px}
.ix-gbar b{text-align:right}
.ix-gtrack{position:relative;height:10px}
.ix-gtrack::before{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--border-2)}
.ix-gtrack i{position:absolute;top:0;height:100%;width:var(--w);border-radius:6px;animation:cxGrow .7s var(--d) cubic-bezier(.22,1,.36,1) backwards}
.ix-gtrack i.up{left:50%;background:var(--pos)}.ix-gtrack i.down{right:50%;background:var(--neg)}
@keyframes cxGrow{from{width:0}}
`;
  document.head.appendChild(s);
}
