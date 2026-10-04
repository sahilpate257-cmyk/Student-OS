// portfolio.js — PortfolioModule: global-market holdings monitor.
// Quotes + company names via Yahoo Finance (all exchanges, through a CORS proxy),
// Finnhub as US-only fallback, live multi-currency FX via frankfurter (ECB),
// buy-merging, editable holdings, refined allocation donut.

import { Store, auth, escapeHtml } from "./store.js";
import { icon } from "./icons.js";
import { MarketData, logoHtml, yahooSymbol, isUS } from "./marketdata.js";
import { lineChart, sparkline } from "./chart.js";

const FINNHUB_KEY = "d98ii7hr01qkl0vtf940d98ii7hr01qkl0vtf94g";
const WORKER_URL = "https://ledgerly-ai-intake.sahilpatel-ledgerly.workers.dev";

const proxied = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;

async function yahooJson(url) {
  const res = await fetch(proxied(url));
  if (!res.ok) throw new Error("quote service unavailable");
  return res.json();
}

function normQuote(meta) {
  let price = meta.regularMarketPrice;
  let currency = meta.currency || "USD";
  if (currency === "GBp" || currency === "GBX") { price = price / 100; currency = "GBP"; }
  return { symbol: meta.symbol, name: meta.longName || meta.shortName || meta.symbol, currency, price };
}

async function yahooChart(symbol) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error("no data");
  return normQuote(meta);
}

async function yahooSearch(q) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`);
  const quotes = (j.quotes || []).filter((x) => x.symbol && ["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY"].includes(x.quoteType));
  if (!quotes.length) throw new Error("not found");
  const Q = q.toUpperCase();
  const exact = quotes.find((x) => x.symbol.toUpperCase() === Q || x.symbol.toUpperCase().startsWith(Q + "."));
  return (exact || quotes[0]).symbol;
}

async function resolveTicker(input) {
  const q = input.trim().toUpperCase();
  try { return await yahooChart(q); } catch (e) {}
  try { return await yahooChart(await yahooSearch(q)); } catch (e) {}
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`);
    if (res.ok) {
      const d = await res.json();
      if (d.c) return { symbol: q, name: q, currency: "USD", price: d.c };
    }
  } catch (e) {}
  throw new Error("not found");
}

// ---- Trading 212 ----
// Proxied through the Worker: T212 sends no CORS headers, and its key is a
// brokerage credential that must never reach the browser.
async function fetchT212Holdings() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch(`${WORKER_URL}/t212/portfolio`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Trading 212 sync failed");
  return data;
}

// ---- FX: generic pair cache backed by frankfurter (ECB) ----
const fxCache = {};
const fxPending = {};
const rateKey = (f, t) => `${f}->${t}`;
const getRateSync = (f, t) => (f === t ? 1 : fxCache[rateKey(f, t)] ?? null);

function fetchRate(from, to) {
  const k = rateKey(from, to);
  if (fxCache[k] != null) return Promise.resolve(fxCache[k]);
  if (!fxPending[k]) {
    fxPending[k] = (async () => {
      const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
      if (!r.ok) throw new Error("fx failed");
      fxCache[k] = (await r.json()).rates[to];
      return fxCache[k];
    })().finally(() => { delete fxPending[k]; });
  }
  return fxPending[k];
}

const PIE_CSS = `
#portfolio-module { position: relative; }
#pie-tooltip { position:absolute; pointer-events:none; background:var(--surface); border:1px solid var(--border-2); border-radius:10px; padding:8px 11px; font-size:12px; line-height:1.5; color:var(--ink); box-shadow:var(--shadow-md); opacity:0; transition:opacity .14s; z-index:30; white-space:nowrap; max-width:240px; }

/* Hero: the account total carries the weight, the split beneath explains it. */
.hero { border:1px solid var(--border); border-radius:var(--r-card); overflow:hidden; background:var(--surface-2); }
.hero-main { padding:18px 18px 16px; }
.hero-fig { font-size:38px; font-weight:500; line-height:1; letter-spacing:-.5px; color:var(--ink); }
.hero-split { display:grid; grid-template-columns:1fr 1fr; border-top:1px solid var(--border); }
.hero-part { padding:11px 18px 13px; }
.hero-part + .hero-part { border-left:1px solid var(--border); }
@media (max-width: 380px) { .hero-fig { font-size:32px; } }

/* Allocation dial: a deliberately dark instrument panel, not a generic chart card. */
.allocation-stage { position:relative; overflow:hidden; border:1px solid rgba(111,160,239,.18); border-radius:18px; background:#090d16; box-shadow:inset 0 1px 0 rgba(255,255,255,.045), 0 14px 30px rgba(0,0,0,.2); }
.allocation-stage::before { content:""; position:absolute; inset:0; pointer-events:none; background:linear-gradient(135deg, rgba(104,158,255,.10), transparent 39%), radial-gradient(circle at 50% 48%, rgba(44,105,202,.11), transparent 42%); }
.allocation-stage::after { content:""; position:absolute; inset:12px; border:1px solid rgba(147,184,246,.07); border-radius:13px; pointer-events:none; }
.allocation-kicker { position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; padding:15px 16px 0; }
.allocation-dot { width:7px; height:7px; border-radius:99px; background:#66a6ff; box-shadow:0 0 12px rgba(102,166,255,.8); }
.pie-anim { position:relative; z-index:1; animation:pieIn .75s cubic-bezier(.22,1,.36,1) backwards; filter:drop-shadow(0 15px 18px rgba(0,0,0,.44)); }
@keyframes pieIn { from { opacity:0; transform:scale(.94) rotate(-4deg); } }
.pie-seg { stroke:#090d16; stroke-width:3; cursor:pointer; transform-origin:110px 110px; transition:transform .22s cubic-bezier(.22,1,.36,1), filter .22s ease; animation:segIn .45s ease backwards; }
@keyframes segIn { from { opacity:0; } }
.pie-seg:hover { filter:brightness(1.22) saturate(1.06); transform:translate(var(--tx), var(--ty)); }
.allocation-legend { position:relative; z-index:1; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; padding:0 16px 16px; }
.allocation-item { min-width:0; padding:9px 10px; border:1px solid rgba(141,181,246,.10); border-radius:10px; background:rgba(255,255,255,.025); }
.allocation-item:last-child:nth-child(odd) { grid-column:1 / -1; }
.allocation-item:hover { background:rgba(91,148,238,.10); border-color:rgba(116,168,247,.24); }
/* Holdings rows and the over-time card */
.pf-hit { cursor:pointer; border-radius:12px; padding:6px 8px; margin:-6px -8px; transition:background .15s; }
.pf-hit:hover, .pf-hit:focus-visible { background:var(--sunken); outline:none; }
.pf-pills { display:flex; gap:2px; padding:3px; border-radius:11px; background:var(--sunken); }
.pf-pill { min-width:44px; height:34px; padding:0 10px; border-radius:8px; font-size:13px; font-weight:600; color:var(--ink-muted); transition:background .15s,color .15s; }
.pf-pill:hover { color:var(--ink); }
.pf-pill.on { background:var(--ink); color:var(--on-ink); }
.pf-skel { height:220px; border-radius:12px; background:linear-gradient(100deg,var(--sunken) 30%,var(--surface-2) 50%,var(--sunken) 70%); background-size:300% 100%; animation:pfShimmer 1.3s linear infinite; }
@keyframes pfShimmer { to { background-position:-100% 0; } }
.allocation-swatch { width:7px; height:7px; border-radius:99px; flex:none; box-shadow:0 0 8px currentColor; }
`;

export const PortfolioModule = {
  el: null,
  refreshing: false,
  showBuyForm: false,
  editingId: null,
  resolved: null,
  t212Error: null,
  t212SyncedAt: null,
  pending: null, // "reset" | "clear" - inline confirmation state
  sparks: {},
  sparkKey: null,
  histRange: "1M",
  histSig: null,
  histSeq: 0,
  histChart: null,

  init() {
    this.el = document.getElementById("portfolio-module");

    if (!document.getElementById("portfolio-css")) {
      const style = document.createElement("style");
      style.id = "portfolio-css";
      style.textContent = PIE_CSS;
      document.head.appendChild(style);
    }

    this.el.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "delete-holding") {
        Store.remove("holdings", id);
      } else if (action === "reset-reimport") {
        // Native confirm() is suppressed in embedded webviews and in-app browsers,
        // so destructive steps confirm inline instead.
        this.pending = "reset";
        this.render();
      } else if (action === "clear-manual") {
        this.pending = "clear";
        this.render();
      } else if (action === "cancel-pending") {
        this.pending = null;
        this.render();
      } else if (action === "confirm-pending") {
        const kind = this.pending;
        this.pending = null;
        if (kind === "clear") {
          Store.state.holdings.filter((h) => h.source !== "t212").forEach((h) => Store.remove("holdings", h.id));
          this.render();
        } else if (kind === "reset") {
          [...Store.state.holdings].forEach((h) => Store.remove("holdings", h.id));
          this.refreshing = true;
          this.t212Error = null;
          this.render();
          try {
            await this.syncT212();
          } catch (err) {
            this.t212Error = err.message || "Re-import failed";
          }
          this.refreshing = false;
          this.render();
        }
      } else if (action === "refresh-prices") {
        this.refreshAll();
      } else if (action === "toggle-buy-form") {
        this.showBuyForm = !this.showBuyForm;
        this.editingId = null;
        this.resolved = null;
        this.render();
        this.el.querySelector("#buy-form input[name=ticker]")?.focus();
      } else if (action === "edit-holding") {
        this.editingId = id;
        this.showBuyForm = false;
        this.render();
        this.el.querySelector("#edit-form input[name=shares]")?.focus();
      } else if (action === "cancel-edit") {
        this.editingId = null;
        this.render();
      } else if (action === "set-portfolio-currency") {
        Store.setSetting("portfolioCurrency", btn.dataset.currency);
      } else if (action === "open-holding") {
        document.dispatchEvent(new CustomEvent("open-holding", { detail: { ticker: btn.dataset.ticker } }));
      } else if (action === "set-hist-range") {
        this.histRange = btn.dataset.range;
        this.syncHistory();
      }
    });

    this.el.addEventListener("keydown", (e) => {
      const hit = e.target.closest?.(".pf-hit");
      if (hit && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); hit.click(); }
    });

    this.el.addEventListener("change", async (e) => {
      if (e.target.name !== "ticker") return;
      const q = e.target.value.trim();
      const prev = this.el.querySelector("#ticker-preview");
      if (!q || !prev) return;
      prev.innerHTML = `<span class="faint">Looking up “${escapeHtml(q)}”…</span>`;
      try {
        const r = await resolveTicker(q);
        this.resolved = { query: q.toUpperCase(), ...r };
        const curPrev = this.el.querySelector("#ticker-preview");
        if (curPrev) curPrev.innerHTML = `
          <span class="font-semibold" style="color:var(--ink)">${escapeHtml(r.name)}</span>
          <span class="faint ml-1">${escapeHtml(r.symbol)} · trades in ${r.currency} · now ${r.currency === "GBP" ? "£" : r.currency === "USD" ? "$" : r.currency + " "}${r.price}</span>`;
      } catch {
        this.resolved = null;
        const curPrev = this.el.querySelector("#ticker-preview");
        if (curPrev) curPrev.innerHTML = `<span class="neg">Couldn’t find “${escapeHtml(q)}” on any exchange — try the company name or another symbol.</span>`;
      }
    });

    this.el.addEventListener("submit", async (e) => {
      if (e.target.id === "buy-form") { e.preventDefault(); this.submitBuy(e.target); }
      else if (e.target.id === "edit-form") { e.preventDefault(); this.submitEdit(e.target); }
    });

    this.el.addEventListener("mousemove", (e) => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (!tip) return;
      const seg = e.target.closest?.(".pie-seg");
      if (!seg) { tip.style.opacity = "0"; return; }
      const rect = this.el.getBoundingClientRect();
      tip.style.left = `${e.clientX - rect.left + 14}px`;
      tip.style.top = `${e.clientY - rect.top - 12}px`;
      tip.style.opacity = "1";
      tip.innerHTML = `<b>${seg.dataset.name}</b><br><span class="faint">${seg.dataset.value} · ${seg.dataset.pct}% of portfolio</span>`;
    });
    this.el.addEventListener("mouseleave", () => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (tip) tip.style.opacity = "0";
    });

    Store.subscribe("holdings:changed", () => this.render());

    // Pull Trading 212 positions once on load; a no-op for accounts without the link.
    this.syncT212().then(() => this.render()).catch(() => {});
    Store.subscribe("settings:changed", () => this.render());
    this.render();
  },

  async submitBuy(f) {
    const q = f.ticker.value.trim().toUpperCase();
    const shares = parseFloat(f.shares.value);
    const price = parseFloat(f.price.value);
    if (!q || !(shares > 0) || !(price > 0)) return;

    const errEl = this.el.querySelector("#buy-form-error");
    errEl.classList.add("hidden");
    const submitBtn = f.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";

    try {
      const r = this.resolved?.query === q ? this.resolved : await resolveTicker(q);
      this.showBuyForm = false;
      this.resolved = null;
      const existing = Store.state.holdings.find((h) => h.ticker === r.symbol);
      if (existing) {
        const totalShares = existing.shares + shares;
        const avgPrice = (existing.shares * existing.buyPrice + shares * price) / totalShares;
        Store.update("holdings", existing.id, {
          shares: +totalShares.toFixed(6),
          buyPrice: +avgPrice.toFixed(4),
          name: r.name,
          currency: r.currency,
          currentPrice: r.price,
          lastUpdated: new Date().toISOString(),
        });
      } else {
        Store.add("holdings", {
          id: Store.uid("hd"),
          ticker: r.symbol,
          name: r.name,
          currency: r.currency,
          shares,
          buyPrice: price,
          currentPrice: r.price,
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.showBuyForm = true;
      this.render();
      const restoredErr = this.el.querySelector("#buy-form-error");
      restoredErr.textContent = `Couldn’t find "${q}" on any exchange — try the company name or the full symbol (e.g. VUAG.L).`;
      restoredErr.classList.remove("hidden");
    }
  },

  submitEdit(f) {
    const shares = parseFloat(f.shares.value);
    const buyPrice = parseFloat(f.avgPrice.value);
    if (!(shares > 0) || !(buyPrice > 0)) return;
    const id = this.editingId;
    this.editingId = null;
    Store.update("holdings", id, { shares, buyPrice });
  },

  cur() { return Store.state.settings.portfolioCurrency ?? "£"; },
  displayCurrency() { return this.cur() === "£" ? "GBP" : "USD"; },
  conv(amount, fromCur) {
    const rate = getRateSync(fromCur || "USD", this.displayCurrency());
    return rate == null ? null : amount * rate;
  },
  fmt(v) {
    if (v == null) return "…";
    return `${this.cur()}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  ensureRates(holdings) {
    const target = this.displayCurrency();
    const cashCcy = Store.state.settings.t212Cash?.currency;
    const missing = [...new Set([...holdings.map((h) => h.currency || "USD"), ...(cashCcy ? [cashCcy] : [])])]
      .filter((c) => c !== target && getRateSync(c, target) == null);
    if (!missing.length) return;
    Promise.allSettled(missing.map((c) => fetchRate(c, target))).then(() => this.render());
  },

  // Trading 212 is authoritative for what is held and at what cost, so reconcile
  // those first; Yahoo then only has to price the manually-added holdings.
  async syncT212() {
    const { holdings: live, cash, syncedAt } = await fetchT212Holdings();
    Store.setSetting("t212Cash", cash || null);
    const incoming = new Map(live.map((h) => [h.t212Ticker, h]));

    Store.state.holdings
      .filter((h) => h.source === "t212")
      .forEach((h) => {
        const match = incoming.get(h.t212Ticker);
        if (!match) return Store.remove("holdings", h.id); // position closed
        Store.update("holdings", h.id, {
          ticker: match.ticker,
          name: match.name,
          currency: match.currency,
          shares: match.shares,
          buyPrice: match.buyPrice,
          currentPrice: match.currentPrice,
          lastUpdated: syncedAt,
        });
        incoming.delete(h.t212Ticker);
      });

    incoming.forEach((m) => {
      Store.add("holdings", {
        id: Store.uid("hd"),
        source: "t212",
        t212Ticker: m.t212Ticker,
        ticker: m.ticker,
        name: m.name,
        currency: m.currency,
        shares: m.shares,
        buyPrice: m.buyPrice,
        currentPrice: m.currentPrice,
        lastUpdated: syncedAt,
      });
    });

    this.t212SyncedAt = syncedAt;
    return live.length;
  },

  async refreshAll() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.t212Error = null;
    this.render();

    try {
      await this.syncT212();
    } catch (e) {
      // A signed-in account with no T212 link is a normal state, not an error.
      this.t212Error = /enabled for this account|Not signed in/.test(e.message) ? null : e.message;
    }

    // Manual holdings still price off Yahoo; synced ones already carry a live price.
    const manual = Store.state.holdings.filter((h) => h.source !== "t212");
    const results = await Promise.allSettled(manual.map((h) => resolveTicker(h.ticker)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        Store.update("holdings", manual[i].id, {
          currentPrice: r.value.price,
          name: r.value.name,
          currency: r.value.currency,
          lastUpdated: new Date().toISOString(),
        });
      }
    });
    Object.keys(fxCache).forEach((k) => delete fxCache[k]);

    this.refreshing = false;
    this.render();
  },

  // The dial keeps the four largest positions explicit and treats the rest as one
  // reserve segment. Beyond five wedges, a ring becomes decoration rather than data.
  renderPie(holdings, totalValue) {
    if (!holdings.length || totalValue == null || totalValue <= 0) {
      return `<div class="text-[13px] faint py-16 text-center">${holdings.length ? "Loading exchange rates…" : "Add a holding to see your allocation."}</div>`;
    }

    // A tight blue family, graded by depth rather than unrelated rainbow colours.
    const RAMP = ["#75AEFF", "#478BEA", "#2C65B7", "#1A417B"];
    const OTHER = "#263348";
    const TOP = 4;

    const sorted = holdings
      .map((h) => ({ label: h.ticker, name: h.name || h.ticker, val: this.conv(h.shares * h.currentPrice, h.currency) ?? 0 }))
      .sort((a, b) => b.val - a.val);

    const slices = sorted.slice(0, TOP).map((d, i) => ({ ...d, colour: RAMP[i] }));
    const rest = sorted.slice(TOP);
    if (rest.length) {
      slices.push({
        label: "Other",
        name: `${rest.length} smaller holding${rest.length === 1 ? "" : "s"}`,
        val: rest.reduce((t, d) => t + d.val, 0),
        colour: OTHER,
      });
    }

    const cx = 110, cy = 110, rO = 96, rI = 55;
    let a = -Math.PI / 2;
    let defs = "";

    const chrome = `
      <radialGradient id="pie-core" cx="36%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#1B2740"/>
        <stop offset="58%" stop-color="#111927"/>
        <stop offset="100%" stop-color="#090D16"/>
      </radialGradient>
      <linearGradient id="pie-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#B7D7FF" stop-opacity=".46"/>
        <stop offset="46%" stop-color="#5D97E9" stop-opacity=".08"/>
        <stop offset="100%" stop-color="#03060C" stop-opacity=".72"/>
      </linearGradient>
      <filter id="pie-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#00030A" flood-opacity=".78"/>
      </filter>`;

    const segs = slices.map((d, i) => {
      const frac = d.val / totalValue;
      const span = Math.min(Math.max(frac, 0) * 2 * Math.PI, 2 * Math.PI - 0.0001);
      const a0 = a, a1 = a + span;
      a = a1;
      defs += `<radialGradient id="pg${i}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${rO}">
          <stop offset="${((rI / rO) * 100).toFixed(0)}%" stop-color="${d.colour}" stop-opacity=".98"/>
          <stop offset="72%" stop-color="${d.colour}" stop-opacity=".86"/>
          <stop offset="100%" stop-color="${d.colour}" stop-opacity=".58"/>
        </radialGradient>`;
      const pt = (r, ang) => `${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const path = `M ${pt(rO, a0)} A ${rO} ${rO} 0 ${large} 1 ${pt(rO, a1)} L ${pt(rI, a1)} A ${rI} ${rI} 0 ${large} 0 ${pt(rI, a0)} Z`;
      const mid = (a0 + a1) / 2;
      return `<path class="pie-seg" d="${path}" fill="url(#pg${i})"
          style="--tx:${(Math.cos(mid) * 5).toFixed(1)}px; --ty:${(Math.sin(mid) * 5).toFixed(1)}px; animation-delay:${i * 80}ms"
          data-name="${escapeHtml(d.name)}" data-pct="${(frac * 100).toFixed(1)}" data-value="${this.fmt(d.val)}"></path>`;
    }).join("");

    const legend = slices.map((d) => `
      <div class="allocation-item" tabindex="0" title="${escapeHtml(d.name)} · ${this.fmt(d.val)}">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="allocation-swatch" style="color:${d.colour};background:${d.colour}"></span>
          <span class="ticker text-[11px] truncate" style="color:#DCEAFF">${escapeHtml(d.label)}</span>
        </div>
        <p class="text-[11px] mt-1 num" style="color:#8FA9CD">${this.fmt(d.val)}</p>
      </div>`).join("");

    return `
      <div class="allocation-stage">
        <div class="allocation-kicker">
          <div class="flex items-center gap-2"><span class="allocation-dot"></span><span class="eyebrow" style="color:#8FA9CD">Allocation</span></div>
          <span class="text-[10px] num" style="color:#65799A">LIVE HOLDINGS</span>
        </div>
        <div class="flex justify-center -mt-1">
          <svg viewBox="0 0 220 220" class="w-60 h-60 pie-anim" role="img" aria-label="Portfolio allocation chart">
            <defs>${defs}${chrome}</defs>
            <circle cx="${cx}" cy="${cy}" r="101" fill="none" stroke="#17233A" stroke-width="1"/>
            <circle cx="${cx}" cy="${cy}" r="99" fill="none" stroke="url(#pie-rim)" stroke-width="2"/>
            <g filter="url(#pie-shadow)">${segs}</g>
            <circle cx="${cx}" cy="${cy}" r="${rI - 3}" fill="url(#pie-core)" stroke="#314866" stroke-opacity=".65" stroke-width="1"/>
            <circle cx="${cx}" cy="${cy}" r="${rI - 8}" fill="none" stroke="#8CB7F2" stroke-opacity=".12" stroke-width="1"/>
            <text x="110" y="102" text-anchor="middle" fill="#8FA9CD" font-size="9" font-family="Manrope,sans-serif" font-weight="700" letter-spacing="1.65">PORTFOLIO</text>
            <text x="110" y="125" text-anchor="middle" fill="#F0F6FF" font-size="17" font-weight="600" font-family="IBM Plex Mono,ui-monospace,monospace">${this.fmt(totalValue)}</text>
          </svg>
        </div>
        <div class="allocation-legend">${legend}</div>
      </div>`;
  },

  render() {
    const keepHist = this.el.querySelector("#pf-history");
    const holdings = [...Store.state.holdings];
    this.ensureRates(holdings);

    const convValue = (h) => this.conv(h.shares * h.currentPrice, h.currency);
    holdings.sort((a, b) => (convValue(b) ?? 0) - (convValue(a) ?? 0));

    let totalCost = 0, totalValue = 0, ratesMissing = false;
    const rows = holdings.map((h, i) => {
      const cost = this.conv(h.shares * h.buyPrice, h.currency);
      const value = convValue(h);
      if (cost == null || value == null) { ratesMissing = true; }
      else { totalCost += cost; totalValue += value; }
      const gain = cost != null && value != null ? value - cost : null;
      const gainPct = gain != null && cost > 0 ? (gain / cost) * 100 : null;
      const up = (gain ?? 0) >= 0;
      const isEditing = this.editingId === h.id;
      const editForm = isEditing ? `
        <form id="edit-form" class="w-full flex flex-wrap items-end gap-2 mt-2 well p-3" style="border:1px solid var(--border-2)">
          <label class="text-[11px] faint">Shares<br>
            <input name="shares" type="number" step="any" min="0.000001" value="${h.shares}" class="input num mt-1" style="width:110px" /></label>
          <label class="text-[11px] faint">Avg price (${h.currency || "USD"})<br>
            <input name="avgPrice" type="number" step="any" min="0.000001" value="${h.buyPrice}" class="input num mt-1" style="width:110px" /></label>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
          <button type="button" data-action="cancel-edit" class="btn btn-ghost btn-sm">Cancel</button>
        </form>` : "";
      const spark = this.sparks[yahooSymbol(h)];
      const sparkTone = spark && spark[spark.length - 1] < spark[0] ? "neg" : "pos";
      return `
        <li class="flex items-center gap-2 py-3 group flex-wrap divide-row">
          <div class="pf-hit flex items-center gap-3 flex-1 min-w-0" data-action="open-holding" data-ticker="${escapeHtml(h.ticker)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(h.name || h.ticker)}">
            ${logoHtml(h.ticker, 38)}
            <div class="flex-1 min-w-0">
              <p class="text-[15px] font-semibold truncate">${escapeHtml(h.name || h.ticker)}</p>
              <p class="text-[12.5px] faint num truncate"><span class="ticker">${escapeHtml(h.ticker)}</span>${
                h.source === "t212"
                  ? `<span class="text-[10.5px] font-semibold ml-1.5 px-1 py-px rounded align-middle" style="background:var(--sunken);color:var(--muted)">212</span>`
                  : ""
              } · ${h.shares} sh · avg ${this.fmt(this.conv(h.buyPrice, h.currency))}</p>
            </div>
            ${spark ? `<span class="flex-none" aria-hidden="true">${sparkline(spark, sparkTone, { w: 52, h: 26 })}</span>` : ""}
            <div class="text-right flex-none">
              <p class="text-[15px] font-semibold num">${this.fmt(value)}</p>
              <p class="text-[12.5px] num ${up ? "pos" : "neg"}">${gain == null ? "…" : `${up ? "+" : "−"}${this.fmt(Math.abs(gain))} · ${up ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%`}</p>
            </div>
          </div>
          <button data-action="edit-holding" data-id="${h.id}" class="reveal btn-icon" style="width:28px;height:28px" title="Edit">${icon("pencil", 14)}</button>
          <button data-action="delete-holding" data-id="${h.id}" class="reveal btn-icon" style="width:28px;height:28px" title="Remove">${icon("x", 15)}</button>
          ${editForm}
        </li>`;
    }).join("");

    const totalGain = totalValue - totalCost;
    const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const up = totalGain >= 0;
    const cur = this.cur();

    const currencyToggle = ["£", "$"].map((c) => `
      <button data-action="set-portfolio-currency" data-currency="${c}"
              class="w-7 h-7 rounded-md text-[13px] font-semibold transition ${cur === c ? "" : "faint"}"
              style="${cur === c ? "background:var(--ink);color:var(--on-ink)" : ""}">${c}</button>`).join("");

    const buyForm = this.showBuyForm ? `
      <p id="buy-form-error" class="hidden text-[12px] neg mb-2"></p>
      <form id="buy-form" class="well p-3.5 mb-4" style="border:1px solid var(--border-2)">
        <div class="flex flex-wrap gap-2">
          <input name="ticker" placeholder="Ticker or company name" required class="input uppercase" style="width:200px" />
          <input name="shares" type="number" step="any" min="0.000001" placeholder="Shares" required class="input num" style="width:110px" />
          <input name="price" type="number" step="any" min="0.000001" placeholder="Price paid" required class="input num" style="width:130px" />
          <button type="submit" class="btn btn-primary">Add buy</button>
        </div>
        <p id="ticker-preview" class="text-[12px] min-h-4 mt-2"></p>
        <p class="text-[11.5px] faint mt-1">Any exchange — US, LSE and more. Enter the price in the stock's own currency (for LSE use £, not pence). A new ticker creates a holding; an existing one merges and re-averages your cost.</p>
      </form>` : "";

    const fxNote = `Values shown in ${cur === "£" ? "GBP (£)" : "USD ($)"} at live ECB rates · each stock priced in its own market's currency.`;

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("trending", 18)}</span>
          <h2 class="sect-title">Investments</h2>
        </div>
        <div class="flex items-center gap-2 flex-wrap justify-end">
          <div class="flex items-center gap-0.5 p-0.5 rounded-lg" style="background:var(--sunken)">${currencyToggle}</div>
          <button data-action="toggle-buy-form" class="btn ${this.showBuyForm ? "btn-ghost" : "btn-primary"} btn-sm">
            ${this.showBuyForm ? icon("x", 15) + "Close" : icon("plus", 15) + "Log buy"}
          </button>
          ${Store.state.holdings.some((h) => h.source === "t212") && Store.state.holdings.some((h) => h.source !== "t212")
            ? `<button data-action="clear-manual" class="btn btn-ghost btn-sm">Clear ${Store.state.holdings.filter((h) => h.source !== "t212").length} manual</button>`
            : ""}
          ${this.t212SyncedAt || Store.state.holdings.some((h) => h.source === "t212")
            ? `<button data-action="reset-reimport" ${this.refreshing ? "disabled" : ""} class="btn btn-ghost btn-sm">Reset &amp; re-import</button>`
            : ""}
          <button data-action="refresh-prices" ${this.refreshing ? "disabled" : ""} class="btn btn-ghost btn-sm">
            ${icon("refresh", 15)}${this.refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>
      <p class="text-[11.5px] faint mb-4">${fxNote}${
        this.t212Error
          ? ` · <span class="neg">Trading 212: ${escapeHtml(this.t212Error)}</span>`
          : this.t212SyncedAt
            ? ` · Trading 212 synced ${new Date(this.t212SyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : ""
      }</p>

      ${buyForm}

      ${(() => {
        if (!this.pending) return "";
        const all = Store.state.holdings;
        const manual = all.filter((h) => h.source !== "t212");
        const isReset = this.pending === "reset";
        return `
          <div class="well p-4 mb-4" style="border:1px solid var(--neg)">
            <p class="text-[13px] font-semibold mb-1">${isReset ? "Reset and re-import from Trading 212?" : `Remove ${manual.length} manual holding${manual.length === 1 ? "" : "s"}?`}</p>
            <p class="text-[12.5px] muted mb-2">${isReset ? `Deletes all ${all.length} holdings, then pulls your account fresh from Trading 212.` : "Your Trading 212 positions are not affected."}</p>
            ${manual.length ? `<p class="text-[12.5px] mb-3">Added by hand - these will <b>not</b> come back:<br><span class="num" style="color:var(--ink)">${manual.map((h) => escapeHtml(h.ticker)).join(", ")}</span></p>` : ""}
            <div class="flex items-center gap-2">
              <button data-action="confirm-pending" class="btn btn-primary btn-sm">${isReset ? "Delete &amp; re-import" : `Remove ${manual.length}`}</button>
              <button data-action="cancel-pending" class="btn btn-ghost btn-sm">Cancel</button>
            </div>
          </div>`;
      })()}

      ${(() => {
        // One headline figure, not a row of equal-weight boxes: the account total is
        // the number being looked for, so everything else is supporting detail under it.
        const c = Store.state.settings.t212Cash;
        const cash = c && c.free > 0 ? this.conv(c.free, c.currency) : null;
        const account = ratesMissing || totalValue == null ? null : totalValue + (cash || 0);
        const dash = `<span class="faint">…</span>`;
        return `
        <div class="hero mb-5">
          <div class="hero-main">
            <p class="eyebrow mb-1.5">${cash != null ? "Account total" : "Portfolio value"}</p>
            <p class="font-display hero-fig num">${account == null ? dash : this.fmt(account)}</p>
            <p class="text-[12.5px] num mt-1.5 ${up ? "pos" : "neg"}">
              ${ratesMissing ? "" : `${up ? "+" : "−"}${this.fmt(Math.abs(totalGain))} · ${up ? "+" : "−"}${Math.abs(totalGainPct).toFixed(1)}%`}
            </p>
          </div>
          <div class="hero-split">
            <div class="hero-part">
              <p class="eyebrow mb-1">Holdings</p>
              <p class="num text-[14.5px] font-semibold">${ratesMissing ? dash : this.fmt(totalValue)}</p>
              <p class="text-[11px] faint num mt-0.5">${ratesMissing ? "" : `${this.fmt(totalCost)} invested`}</p>
            </div>
            ${cash != null ? `
            <div class="hero-part">
              <p class="eyebrow mb-1">Cash</p>
              <p class="num text-[14.5px] font-semibold">${this.fmt(cash)}</p>
              <p class="text-[11px] faint num mt-0.5">${account ? ((cash / account) * 100).toFixed(1) : "0"}% uninvested</p>
            </div>` : ""}
          </div>
        </div>`;
      })()}

      <div id="pf-history"></div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <ul class="max-h-[28rem] overflow-y-auto pr-1" style="border-top:1px solid var(--border)">
          ${rows || `<li class="py-6 text-[13px] faint text-center">No holdings yet — press <span class="font-semibold" style="color:var(--ink)">Log buy</span> to add your first.</li>`}
        </ul>
        <div>${this.renderPie(holdings, ratesMissing ? null : totalValue)}</div>
      </div>

      <div id="pie-tooltip"></div>`;

    if (keepHist) this.el.querySelector("#pf-history").replaceWith(keepHist);
    this.syncHistory();
    this.loadSparks();
  },

  // One 1M history call for every holding (sparklines), plus logos for US names.
  loadSparks() {
    const hs = Store.state.holdings;
    const syms = [...new Set(hs.map(yahooSymbol))].sort();
    const key = syms.join(",");
    if (!syms.length || this.sparkKey === key) return;
    this.sparkKey = key;
    const chunks = [];
    for (let i = 0; i < syms.length; i += 12) chunks.push(syms.slice(i, i + 12));
    Promise.all(chunks.map((c) => MarketData.history(c, "1M").catch(() => null))).then((res) => {
      const sparks = {};
      res.forEach((r) => r?.series && Object.entries(r.series).forEach(([sym, d]) => { sparks[sym] = d.c; }));
      this.sparks = sparks;
      this.render();
    });
    MarketData.loadProfiles(hs.filter(isUS).map((h) => String(h.ticker).toUpperCase())).then(() => this.render());
  },

  // Value of today's holdings through time: shares x price x today's FX, summed per date.
  buildHistory(range, hs, rates, seriesMap) {
    const keyOf = range === "ALL"
      ? (t) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
      : range === "5Y" ? (t) => Math.floor((Math.floor(t / 86400) + 3) / 7)
      : (t) => Math.floor(t / 86400);
    const per = [];
    const skipped = [];
    const keys = new Set();
    const timeOf = new Map();
    hs.forEach((h, i) => {
      const d = seriesMap[yahooSymbol(h)];
      if (!d) { skipped.push(h.ticker); return; }
      const m = new Map();
      d.t.forEach((t, j) => {
        const k = keyOf(t);
        m.set(k, d.c[j]);
        keys.add(k);
        if (!timeOf.has(k) || t < timeOf.get(k)) timeOf.set(k, t);
      });
      const sorted = [...m.keys()].sort((a, b) => a - b);
      per.push({ h, rate: rates[i], m, keys: sorted, i: -1 });
    });
    if (!per.length) return null;
    const start = Math.max(...per.map((p) => p.keys[0]));
    const ks = [...keys].filter((k) => k >= start).sort((a, b) => a - b);
    if (ks.length < 2) return null;
    const points = ks.map((k) => {
      let v = 0;
      for (const p of per) {
        while (p.i + 1 < p.keys.length && p.keys[p.i + 1] <= k) p.i++;
        v += p.h.shares * p.m.get(p.keys[p.i]) * p.rate;
      }
      return { t: timeOf.get(k) * 1000, v };
    });
    return { points, skipped };
  },

  async syncHistory() {
    const host = this.el.querySelector("#pf-history");
    if (!host) return;
    const hs = Store.state.holdings.filter((h) => h.shares > 0);
    if (!hs.length) { this.histChart?.destroy(); this.histChart = null; host.innerHTML = ""; this.histSig = null; return; }
    const rates = hs.map((h) => this.conv(1, h.currency));
    if (rates.some((r) => r == null)) return; // render() runs again once FX arrives
    const range = this.histRange;
    const sig = [range, this.displayCurrency(), hs.map((h, i) => `${yahooSymbol(h)}:${h.shares}:${rates[i].toFixed(4)}`).sort().join("|")].join("#");
    if (sig === this.histSig && host.firstChild) return;
    this.histSig = sig;
    const seq = ++this.histSeq;

    const pills = ["1M", "3M", "1Y", "5Y", "ALL"].map((r) =>
      `<button class="pf-pill ${r === range ? "on" : ""}" data-action="set-hist-range" data-range="${r}">${r}</button>`).join("");
    const shell = (inner) => `
      <div class="card card-pad mb-5">
        <div class="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div class="min-w-0">
            <h3 class="sect-title">Holdings over time</h3>
            <p class="font-display num mt-1.5" id="pfh-val" style="font-size:30px;font-weight:600;letter-spacing:-.03em;line-height:1.1"></p>
            <p class="text-[14px] font-semibold num mt-1" id="pfh-chg"></p>
          </div>
          <div class="pf-pills" role="tablist" aria-label="Time range">${pills}</div>
        </div>
        ${inner}
      </div>`;
    this.histChart?.destroy();
    this.histChart = null;
    host.innerHTML = shell(`<div class="pf-skel"></div>`);

    const syms = [...new Set(hs.map(yahooSymbol))];
    const chunks = [];
    for (let i = 0; i < syms.length; i += 12) chunks.push(syms.slice(i, i + 12));
    const res = await Promise.all(chunks.map((c) => MarketData.history(c, range).catch(() => null)));
    if (seq !== this.histSeq) return;
    const seriesMap = {};
    res.forEach((r) => r?.series && Object.assign(seriesMap, r.series));
    const built = this.buildHistory(range, hs, rates, seriesMap);
    if (!built) {
      host.innerHTML = shell(`<p class="text-[14px] faint py-10 text-center">Price history isn't available right now.</p>`);
      return;
    }

    const { points, skipped } = built;
    const label = { "1M": "Past month", "3M": "Past 3 months", "1Y": "Past year", "5Y": "Past 5 years", ALL: "All available history" }[range];
    const base = points[0].v;
    const head = (p) => {
      const v = p ? p.v : points[points.length - 1].v;
      const diff = v - base;
      const pct = base ? (v / base - 1) * 100 : 0;
      const tn = diff >= 0 ? "pos" : "neg";
      host.querySelector("#pfh-val").textContent = this.fmt(v);
      const chg = host.querySelector("#pfh-chg");
      chg.className = `text-[14px] font-semibold num mt-1 ${tn}`;
      chg.innerHTML = `${diff >= 0 ? "▲" : "▼"} ${this.fmt(Math.abs(diff))} (${diff >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)${p ? "" : ` <span class="faint font-medium ml-1">${label}</span>`}`;
    };
    const since = new Date(points[0].t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    host.innerHTML = shell(`<div id="pfh-chart" style="margin-top:24px"></div>
      <p class="text-[12.5px] faint mt-3" style="line-height:1.5">Your current holdings at today's exchange rates, from ${since}. It shows how today's mix has moved, not your past account balance.${skipped.length ? ` Leaves out ${skipped.map(escapeHtml).join(", ")} (no price history available).` : ""}</p>`);
    head(null);
    this.histChart = lineChart(host.querySelector("#pfh-chart"), {
      points,
      range,
      tone: points[points.length - 1].v >= base ? "pos" : "neg",
      height: window.matchMedia("(min-width:900px)").matches ? 280 : 220,
      fmt: (v) => this.fmt(v),
      label: `Holdings value, ${label}`,
      onScrub: head,
    });
  },
};
