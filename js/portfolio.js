// portfolio.js — PortfolioModule: holdings monitor with buy-merging, live prices (Finnhub),
// live USD→GBP conversion (ECB via frankfurter), and an animated allocation pie

import { Store, escapeHtml } from "./store.js";

const FINNHUB_KEY = "d98ii7hr01qkl0vtf940d98ii7hr01qkl0vtf94g";
const NEON = ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fb923c", "#818cf8", "#facc15", "#2dd4bf", "#f87171", "#c084fc"];

async function fetchQuote(ticker) {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error("Quote request failed");
  const data = await res.json();
  if (!data.c || data.c === 0) throw new Error("Unknown ticker or no data");
  return data.c;
}

async function fetchFxRate() {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP");
  if (!res.ok) throw new Error("FX request failed");
  return (await res.json()).rates.GBP;
}

// donut segment path between two angles (radians)
function arcPath(cx, cy, rO, rI, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(rO, a0)} A ${rO} ${rO} 0 ${large} 1 ${p(rO, a1)} L ${p(rI, a1)} A ${rI} ${rI} 0 ${large} 0 ${p(rI, a0)} Z`;
}

const PIE_CSS = `
#portfolio-module { position: relative; }
#pie-tooltip { position: absolute; pointer-events: none; background: rgba(2,6,23,.94); border: 1px solid rgba(129,140,248,.45); border-radius: 8px; padding: 6px 10px; font-size: 12px; line-height: 1.5; color: #e2e8f0; opacity: 0; transition: opacity .15s; z-index: 30; white-space: nowrap; }
.pie-anim { animation: pieIn .9s cubic-bezier(.22,1,.36,1) backwards; }
@keyframes pieIn { from { opacity: 0; transform: scale(.82) rotate(-12deg); } }
.pie-glow { animation: pieBreathe 5s ease-in-out infinite alternate; }
@keyframes pieBreathe { from { filter: drop-shadow(0 0 6px rgba(129,140,248,.22)); } to { filter: drop-shadow(0 0 14px rgba(129,140,248,.45)); } }
.pie-seg { fill-opacity: .55; stroke: #020617; stroke-width: 2; cursor: pointer; transition: transform .25s ease, fill-opacity .25s ease, filter .25s ease; animation: segIn .7s ease backwards; }
@keyframes segIn { from { fill-opacity: 0; } }
.pie-seg:hover { transform: translate(var(--tx), var(--ty)); fill-opacity: .9; filter: drop-shadow(0 0 12px var(--glow)); }
`;

export const PortfolioModule = {
  el: null,
  refreshing: false,
  showBuyForm: false,
  fxRate: null,

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
        this.render();
        this.el.querySelector("#buy-form input[name=ticker]")?.focus();
      } else if (action === "set-portfolio-currency") {
        Store.setSetting("portfolioCurrency", btn.dataset.currency);
      }
    });

    this.el.addEventListener("submit", async (e) => {
      if (e.target.id !== "buy-form") return;
      e.preventDefault();
      const f = e.target;
      const ticker = f.ticker.value.trim().toUpperCase();
      const shares = parseFloat(f.shares.value);
      const price = parseFloat(f.price.value);
      if (!ticker || !(shares > 0) || !(price > 0)) return;

      const errEl = this.el.querySelector("#buy-form-error");
      errEl.classList.add("hidden");
      const submitBtn = f.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Adding…";

      try {
        const existing = Store.state.holdings.find((h) => h.ticker === ticker);
        this.showBuyForm = false;
        if (existing) {
          // merge the buy: add shares, recompute weighted-average cost
          const totalShares = existing.shares + shares;
          const avgPrice = (existing.shares * existing.buyPrice + shares * price) / totalShares;
          Store.update("holdings", existing.id, { shares: +totalShares.toFixed(6), buyPrice: +avgPrice.toFixed(4) });
        } else {
          const currentPrice = await fetchQuote(ticker);
          Store.add("holdings", {
            id: Store.uid("hd"),
            ticker,
            shares,
            buyPrice: price,
            currentPrice,
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (err) {
        this.showBuyForm = true;
        this.render();
        const restoredErr = this.el.querySelector("#buy-form-error");
        restoredErr.textContent = `Couldn't fetch a price for "${ticker}" — check the ticker symbol.`;
        restoredErr.classList.remove("hidden");
      }
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
      tip.innerHTML = `<b>${seg.dataset.ticker}</b> · ${seg.dataset.value}<br>${seg.dataset.pct}% of total`;
    });
    this.el.addEventListener("mouseleave", () => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (tip) tip.style.opacity = "0";
    });

    Store.subscribe("holdings:changed", () => this.render());
    Store.subscribe("settings:changed", () => this.render());
    this.render();

    fetchFxRate().then((r) => { this.fxRate = r; this.render(); }).catch(() => {});
  },

  cur() {
    return Store.state.settings.portfolioCurrency ?? "£";
  },

  money(usd) {
    if (this.cur() === "£" && this.fxRate) return `£${(usd * this.fxRate).toFixed(2)}`;
    return `$${usd.toFixed(2)}`;
  },

  async refreshAll() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.render();

    const holdings = Store.state.holdings;
    const [quotes, fx] = await Promise.all([
      Promise.allSettled(holdings.map((h) => fetchQuote(h.ticker))),
      fetchFxRate().catch(() => null),
    ]);
    if (fx) this.fxRate = fx;
    quotes.forEach((r, i) => {
      if (r.status === "fulfilled") {
        Store.update("holdings", holdings[i].id, { currentPrice: r.value, lastUpdated: new Date().toISOString() });
      }
    });

    this.refreshing = false;
    this.render();
  },

  renderPie(holdings, totalValue) {
    if (!holdings.length || totalValue <= 0) {
      return `<div class="text-sm text-slate-500 py-10 text-center">Log a buy to see your allocation.</div>`;
    }
    const cx = 110, cy = 110, rO = 100, rI = 62;
    let a = -Math.PI / 2;
    const segs = holdings.map((h, i) => {
      const val = h.shares * h.currentPrice;
      const frac = val / totalValue;
      const span = Math.min(frac * 2 * Math.PI, 2 * Math.PI - 0.0001);
      const a0 = a, a1 = a + span;
      a = a1;
      const mid = (a0 + a1) / 2;
      const color = NEON[i % NEON.length];
      return `<path class="pie-seg" d="${arcPath(cx, cy, rO, rI, a0, a1)}" fill="${color}"
        style="--tx:${(Math.cos(mid) * 7).toFixed(1)}px; --ty:${(Math.sin(mid) * 7).toFixed(1)}px; --glow:${color}; animation-delay:${i * 110}ms"
        data-ticker="${escapeHtml(h.ticker)}" data-pct="${(frac * 100).toFixed(1)}" data-value="${this.money(val)}"></path>`;
    }).join("");

    const legend = holdings.map((h, i) => `
      <span class="flex items-center gap-1.5 text-xs text-slate-400">
        <span class="w-2.5 h-2.5 rounded-full" style="background:${NEON[i % NEON.length]}; box-shadow:0 0 6px ${NEON[i % NEON.length]}"></span>${escapeHtml(h.ticker)}
      </span>`).join("");

    return `
      <div class="flex flex-col items-center gap-3">
        <svg viewBox="0 0 220 220" class="w-60 h-60 pie-anim">
          <g class="pie-glow">${segs}</g>
          <text x="110" y="103" text-anchor="middle" fill="#64748b" font-size="11">Total</text>
          <text x="110" y="123" text-anchor="middle" fill="#f1f5f9" font-size="16" font-weight="600">${this.money(totalValue)}</text>
        </svg>
        <div class="flex flex-wrap justify-center gap-3">${legend}</div>
      </div>`;
  },

  render() {
    const holdings = [...Store.state.holdings].sort(
      (a, b) => b.shares * b.currentPrice - a.shares * a.currentPrice
    );

    let totalCost = 0, totalValue = 0;
    const rows = holdings.map((h, i) => {
      const cost = h.shares * h.buyPrice;
      const value = h.shares * h.currentPrice;
      const gain = value - cost;
      const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
      totalCost += cost;
      totalValue += value;
      const up = gain >= 0;
      return `
        <li class="flex items-center gap-3 py-2.5 group">
          <span class="w-2 h-2 shrink-0 rounded-full" style="background:${NEON[i % NEON.length]}; box-shadow:0 0 5px ${NEON[i % NEON.length]}"></span>
          <div class="w-16 shrink-0">
            <p class="font-semibold text-sm">${escapeHtml(h.ticker)}</p>
            <p class="text-[11px] text-slate-500">${h.shares}sh</p>
          </div>
          <div class="flex-1 min-w-0 text-xs text-slate-400">
            <p>Avg ${this.money(h.buyPrice)} → Now ${this.money(h.currentPrice)}</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-medium">${this.money(value)}</p>
            <p class="text-xs ${up ? "text-emerald-400" : "text-rose-400"}">${up ? "+" : "−"}${this.money(Math.abs(gain)).slice(0)} (${up ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%)</p>
          </div>
          <button data-action="delete-holding" data-id="${h.id}"
                  class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1">✕</button>
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

    const fxNote = cur === "£"
      ? (this.fxRate
          ? `1 USD = £${this.fxRate.toFixed(4)} · live ECB rate. Enter buy prices in the stock's native currency (USD for US stocks).`
          : `Fetching live £ rate — showing $ until it loads.`)
      : `Values in USD (each ticker's native currency).`;

    const buyForm = this.showBuyForm ? `
      <p id="buy-form-error" class="hidden text-xs text-rose-400 mb-2"></p>
      <form id="buy-form" class="flex flex-wrap gap-2 mb-4 bg-slate-800/40 border border-indigo-500/20 rounded-xl p-3">
        <input name="ticker" placeholder="Ticker (e.g. AAPL)" required
               class="w-36 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400 uppercase" />
        <input name="shares" type="number" step="any" min="0.000001" placeholder="Shares" required
               class="w-24 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="price" type="number" step="0.01" min="0.01" placeholder="Price paid ($)" required
               class="w-32 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <button type="submit" class="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">Add Buy</button>
        <p class="w-full text-[11px] text-slate-500">New ticker creates a holding · existing ticker adds the shares and updates your average cost automatically.</p>
      </form>` : "";

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
          <p class="font-semibold">${this.money(totalCost)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Current Value</p>
          <p class="font-semibold">${this.money(totalValue)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2 ${up ? "ring-1 ring-emerald-500/30" : "ring-1 ring-rose-500/30"}">
          <p class="text-[11px] text-slate-500">Total Gain/Loss</p>
          <p class="${up ? "text-emerald-300" : "text-rose-300"} font-semibold">${up ? "+" : "−"}${this.money(Math.abs(totalGain))} (${up ? "+" : "−"}${Math.abs(totalGainPct).toFixed(1)}%)</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <ul class="divide-y divide-slate-800 max-h-72 overflow-y-auto">
          ${rows || `<li class="py-3 text-sm text-slate-500">No holdings yet — hit ＋ Log Buy to add your first.</li>`}
        </ul>
        <div>${this.renderPie(holdings, totalValue)}</div>
      </div>

      <div id="pie-tooltip"></div>`;
  },
};
