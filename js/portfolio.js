// portfolio.js — PortfolioModule: global-market holdings monitor.
// Quotes + company names via Yahoo Finance (all exchanges, through a CORS proxy),
// Finnhub as US-only fallback, live multi-currency FX via frankfurter (ECB),
// buy-merging, editable holdings, gradient neon allocation pie.

import { Store, escapeHtml } from "./store.js";

const FINNHUB_KEY = "d98ii7hr01qkl0vtf940d98ii7hr01qkl0vtf94g";
const NEON = ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fb923c", "#818cf8", "#facc15", "#2dd4bf", "#f87171", "#c084fc"];

const proxied = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;

async function yahooJson(url) {
  const res = await fetch(proxied(url));
  if (!res.ok) throw new Error("quote service unavailable");
  return res.json();
}

// normalize a Yahoo chart meta into {symbol, name, currency, price}; LSE pence → pounds
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

// accepts anything: exact Yahoo symbol, bare ticker (SMSN → SMSN.IL), or company name
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

// mix hex color toward target by t (0..1)
function mixHex(hex, target, t) {
  const h = (s, i) => parseInt(s.slice(i, i + 2), 16);
  const m = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
  return `#${m(h(hex, 1), h(target, 1))}${m(h(hex, 3), h(target, 3))}${m(h(hex, 5), h(target, 5))}`;
}

const PIE_CSS = `
#portfolio-module { position: relative; }
#pie-tooltip { position: absolute; pointer-events: none; background: rgba(2,6,23,.94); border: 1px solid rgba(129,140,248,.45); border-radius: 8px; padding: 6px 10px; font-size: 12px; line-height: 1.5; color: #e2e8f0; opacity: 0; transition: opacity .15s; z-index: 30; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.pie-anim { animation: pieIn .9s cubic-bezier(.22,1,.36,1) backwards; }
@keyframes pieIn { from { opacity: 0; transform: scale(.82) rotate(-12deg); } }
.pie-glow { animation: pieBreathe 5s ease-in-out infinite alternate; }
@keyframes pieBreathe { from { filter: drop-shadow(0 0 8px rgba(129,140,248,.18)); } to { filter: drop-shadow(0 0 18px rgba(129,140,248,.4)); } }
.pie-seg { stroke: #020617; stroke-width: 2; cursor: pointer; transition: transform .25s ease, filter .25s ease; animation: segIn .7s ease backwards; }
@keyframes segIn { from { opacity: 0; } }
.pie-seg:hover { transform: translate(var(--tx), var(--ty)); filter: brightness(1.35) drop-shadow(0 0 14px var(--glow)); }
`;

export const PortfolioModule = {
  el: null,
  refreshing: false,
  showBuyForm: false,
  editingId: null,
  resolved: null, // { query, symbol, name, currency, price } for the buy form preview

  init() {
    this.el = document.getElementById("portfolio-module");

    if (!document.getElementById("portfolio-css")) {
      const style = document.createElement("style");
      style.id = "portfolio-css";
      style.textContent = PIE_CSS;
      document.head.appendChild(style);
    }

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "delete-holding") {
        Store.remove("holdings", id);
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
      }
    });

    // live ticker lookup on blur: show full company name + resolved symbol + native currency
    this.el.addEventListener("change", async (e) => {
      if (e.target.name !== "ticker") return;
      const q = e.target.value.trim();
      const prev = this.el.querySelector("#ticker-preview");
      if (!q || !prev) return;
      prev.innerHTML = `<span class="text-slate-500">Looking up “${escapeHtml(q)}”…</span>`;
      try {
        const r = await resolveTicker(q);
        this.resolved = { query: q.toUpperCase(), ...r };
        const curPrev = this.el.querySelector("#ticker-preview");
        if (curPrev) curPrev.innerHTML = `
          <span class="text-slate-100 font-medium">${escapeHtml(r.name)}</span>
          <span class="text-[10px] text-slate-500 ml-1">${escapeHtml(r.symbol)} · trades in ${r.currency} · now ${r.currency === "GBP" ? "£" : r.currency === "USD" ? "$" : r.currency + " "}${r.price}</span>`;
      } catch {
        this.resolved = null;
        const curPrev = this.el.querySelector("#ticker-preview");
        if (curPrev) curPrev.innerHTML = `<span class="text-rose-400">Couldn’t find “${escapeHtml(q)}” on any exchange — try the company name or another symbol.</span>`;
      }
    });

    this.el.addEventListener("submit", async (e) => {
      if (e.target.id === "buy-form") { e.preventDefault(); this.submitBuy(e.target); }
      else if (e.target.id === "edit-form") { e.preventDefault(); this.submitEdit(e.target); }
    });

    // pie hover tooltip (delegated, survives re-renders)
    this.el.addEventListener("mousemove", (e) => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (!tip) return;
      const seg = e.target.closest?.(".pie-seg");
      if (!seg) { tip.style.opacity = "0"; return; }
      const rect = this.el.getBoundingClientRect();
      tip.style.left = `${e.clientX - rect.left + 14}px`;
      tip.style.top = `${e.clientY - rect.top - 12}px`;
      tip.style.opacity = "1";
      tip.innerHTML = `<b>${seg.dataset.name}</b><br>${seg.dataset.value} · ${seg.dataset.pct}% of total`;
    });
    this.el.addEventListener("mouseleave", () => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (tip) tip.style.opacity = "0";
    });

    Store.subscribe("holdings:changed", () => this.render());
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
        // merge the buy: add shares, recompute weighted-average cost
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

  cur() {
    return Store.state.settings.portfolioCurrency ?? "£";
  },

  displayCurrency() {
    return this.cur() === "£" ? "GBP" : "USD";
  },

  // convert a native-currency amount to the display currency; null while rate loads
  conv(amount, fromCur) {
    const rate = getRateSync(fromCur || "USD", this.displayCurrency());
    return rate == null ? null : amount * rate;
  },

  fmt(v) {
    if (v == null) return "…";
    return `${this.cur()}${v.toFixed(2)}`;
  },

  ensureRates(holdings) {
    const target = this.displayCurrency();
    const missing = [...new Set(holdings.map((h) => h.currency || "USD"))]
      .filter((c) => c !== target && getRateSync(c, target) == null);
    if (!missing.length) return;
    Promise.allSettled(missing.map((c) => fetchRate(c, target))).then(() => this.render());
  },

  async refreshAll() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.render();

    const holdings = Store.state.holdings;
    const results = await Promise.allSettled(holdings.map((h) => resolveTicker(h.ticker)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        Store.update("holdings", holdings[i].id, {
          currentPrice: r.value.price,
          name: r.value.name,
          currency: r.value.currency,
          lastUpdated: new Date().toISOString(),
        });
      }
    });
    // refresh FX too
    Object.keys(fxCache).forEach((k) => delete fxCache[k]);

    this.refreshing = false;
    this.render();
  },

  renderPie(holdings, totalValue) {
    if (!holdings.length || totalValue == null || totalValue <= 0) {
      return `<div class="text-sm text-slate-500 py-10 text-center">${holdings.length ? "Loading exchange rates…" : "Log a buy to see your allocation."}</div>`;
    }
    const cx = 110, cy = 110, rO = 100, rI = 62;
    let a = -Math.PI / 2;
    let defs = "";
    const segs = holdings.map((h, i) => {
      const val = this.conv(h.shares * h.currentPrice, h.currency) ?? 0;
      const frac = val / totalValue;
      const span = Math.min(Math.max(frac, 0) * 2 * Math.PI, 2 * Math.PI - 0.0001);
      const a0 = a, a1 = a + span;
      a = a1;
      const mid = (a0 + a1) / 2;
      const color = NEON[i % NEON.length];
      // dark-to-neon radial gradient: deep core, dark body, bright glowing rim
      defs += `<radialGradient id="pgrad${i}" gradientUnits="userSpaceOnUse" cx="110" cy="110" r="100">
        <stop offset="58%" stop-color="${mixHex(color, "#040918", 0.78)}"/>
        <stop offset="80%" stop-color="${mixHex(color, "#040918", 0.5)}"/>
        <stop offset="95%" stop-color="${color}"/>
        <stop offset="100%" stop-color="${mixHex(color, "#ffffff", 0.35)}"/>
      </radialGradient>`;
      const p = (r, ang) => `${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M ${p(rO, a0)} A ${rO} ${rO} 0 ${large} 1 ${p(rO, a1)} L ${p(rI, a1)} A ${rI} ${rI} 0 ${large} 0 ${p(rI, a0)} Z`;
      return `<path class="pie-seg" d="${d}" fill="url(#pgrad${i})"
        style="--tx:${(Math.cos(mid) * 7).toFixed(1)}px; --ty:${(Math.sin(mid) * 7).toFixed(1)}px; --glow:${color}; animation-delay:${i * 110}ms"
        data-name="${escapeHtml(h.name || h.ticker)}" data-pct="${(frac * 100).toFixed(1)}" data-value="${this.fmt(val)}"></path>`;
    }).join("");

    const legend = holdings.map((h, i) => `
      <span class="flex items-center gap-1.5 text-xs text-slate-400">
        <span class="w-2.5 h-2.5 rounded-full" style="background:${NEON[i % NEON.length]}; box-shadow:0 0 6px ${NEON[i % NEON.length]}"></span>${escapeHtml(h.ticker)}
      </span>`).join("");

    return `
      <div class="flex flex-col items-center gap-3">
        <svg viewBox="0 0 220 220" class="w-60 h-60 pie-anim">
          <defs>${defs}</defs>
          <g class="pie-glow">${segs}
            <circle cx="110" cy="110" r="100" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
            <circle cx="110" cy="110" r="62" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
          </g>
          <text x="110" y="103" text-anchor="middle" fill="#64748b" font-size="11">Total</text>
          <text x="110" y="123" text-anchor="middle" fill="#f1f5f9" font-size="16" font-weight="600">${this.fmt(totalValue)}</text>
        </svg>
        <div class="flex flex-wrap justify-center gap-3">${legend}</div>
      </div>`;
  },

  render() {
    const holdings = [...Store.state.holdings];
    this.ensureRates(holdings);

    // sort by converted value, largest first
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
        <form id="edit-form" class="w-full flex flex-wrap items-center gap-2 mt-2 bg-slate-800/40 border border-indigo-500/20 rounded-lg p-2">
          <label class="text-[11px] text-slate-500">Shares
            <input name="shares" type="number" step="any" min="0.000001" value="${h.shares}"
                   class="ml-1 w-24 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400" /></label>
          <label class="text-[11px] text-slate-500">Avg price (${h.currency || "USD"})
            <input name="avgPrice" type="number" step="any" min="0.000001" value="${h.buyPrice}"
                   class="ml-1 w-24 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400" /></label>
          <button type="submit" class="bg-indigo-500 hover:bg-indigo-400 text-white rounded px-3 py-1 text-xs font-medium">Save</button>
          <button type="button" data-action="cancel-edit" class="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">Cancel</button>
        </form>` : "";
      return `
        <li class="flex items-center gap-3 py-2.5 group flex-wrap">
          <span class="w-2 h-2 shrink-0 rounded-full" style="background:${NEON[i % NEON.length]}; box-shadow:0 0 5px ${NEON[i % NEON.length]}"></span>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-sm truncate">${escapeHtml(h.name || h.ticker)}
              <span class="text-[10px] text-slate-500 font-normal">${escapeHtml(h.ticker)}</span></p>
            <p class="text-[11px] text-slate-500">${h.shares}sh · avg ${this.fmt(this.conv(h.buyPrice, h.currency))} → now ${this.fmt(this.conv(h.currentPrice, h.currency))}</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-medium">${this.fmt(value)}</p>
            <p class="text-xs ${up ? "text-emerald-400" : "text-rose-400"}">${gain == null ? "…" : `${up ? "+" : "−"}${this.fmt(Math.abs(gain))} (${up ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%)`}</p>
          </div>
          <button data-action="edit-holding" data-id="${h.id}"
                  class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-indigo-300 px-1" title="Edit">✎</button>
          <button data-action="delete-holding" data-id="${h.id}"
                  class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1" title="Delete">✕</button>
          ${editForm}
        </li>`;
    }).join("");

    const totalGain = totalValue - totalCost;
    const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const up = totalGain >= 0;
    const cur = this.cur();

    const currencyToggle = ["£", "$"].map((c) => `
      <button data-action="set-portfolio-currency" data-currency="${c}"
              class="w-7 h-7 rounded text-sm font-medium ${cur === c ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/60" : "text-slate-500 hover:text-slate-300 border border-transparent"}">
        ${c}
      </button>`).join("");

    const buyForm = this.showBuyForm ? `
      <p id="buy-form-error" class="hidden text-xs text-rose-400 mb-2"></p>
      <form id="buy-form" class="flex flex-wrap gap-2 mb-1 bg-slate-800/40 border border-indigo-500/20 rounded-xl p-3">
        <input name="ticker" placeholder="Ticker or company name" required
               class="w-44 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400 uppercase" />
        <input name="shares" type="number" step="any" min="0.000001" placeholder="Shares" required
               class="w-24 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="price" type="number" step="any" min="0.000001" placeholder="Price paid" required
               class="w-28 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <button type="submit" class="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">Add Buy</button>
        <p id="ticker-preview" class="w-full text-xs min-h-4"></p>
        <p class="w-full text-[11px] text-slate-500">Works with any exchange — US, LSE, etc. Enter the price in the stock’s own currency (shown above once the ticker resolves; for LSE use £, not pence). New ticker creates a holding · existing ticker merges and re-averages your cost.</p>
      </form>` : "";

    const fxNote = `Converted to ${cur === "£" ? "GBP (£)" : "USD ($)"} at live ECB rates · each stock is priced in its own market's currency.`;

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 class="font-semibold text-slate-100">📈 Stock Portfolio</h2>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-0.5 mr-1">${currencyToggle}</div>
          <button data-action="toggle-buy-form"
                  class="text-xs ${this.showBuyForm ? "text-slate-400 border-slate-600" : "text-indigo-300 hover:text-indigo-200 border-indigo-500/40"} border rounded-lg px-3 py-1.5">
            ${this.showBuyForm ? "✕ Close" : "＋ Log Buy"}
          </button>
          <button data-action="refresh-prices" ${this.refreshing ? "disabled" : ""}
                  class="text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-500/40 rounded-lg px-3 py-1.5 disabled:opacity-50">
            ${this.refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      <p class="text-[11px] text-slate-500 mb-3">${fxNote}</p>

      ${buyForm}

      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Invested</p>
          <p class="font-semibold">${ratesMissing ? "…" : this.fmt(totalCost)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Current Value</p>
          <p class="font-semibold">${ratesMissing ? "…" : this.fmt(totalValue)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2 ${up ? "ring-1 ring-emerald-500/30" : "ring-1 ring-rose-500/30"}">
          <p class="text-[11px] text-slate-500">Total Gain/Loss</p>
          <p class="${up ? "text-emerald-300" : "text-rose-300"} font-semibold">${ratesMissing ? "…" : `${up ? "+" : "−"}${this.fmt(Math.abs(totalGain))} (${up ? "+" : "−"}${Math.abs(totalGainPct).toFixed(1)}%)`}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <ul class="divide-y divide-slate-800 max-h-80 overflow-y-auto">
          ${rows || `<li class="py-3 text-sm text-slate-500">No holdings yet — hit ＋ Log Buy to add your first.</li>`}
        </ul>
        <div>${this.renderPie(holdings, ratesMissing ? null : totalValue)}</div>
      </div>

      <div id="pie-tooltip"></div>`;
  },
};
