// portfolio.js — PortfolioModule: stock holdings with live prices via Finnhub

import { Store, todayISO, escapeHtml, formatDate } from "./store.js";

const FINNHUB_KEY = "d98ii7hr01qkl0vtf940d98ii7hr01qkl0vtf94g";

async function fetchQuote(ticker) {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error("Quote request failed");
  const data = await res.json();
  if (!data.c || data.c === 0) throw new Error("Unknown ticker or no data");
  return data.c; // current price
}

export const PortfolioModule = {
  el: null,
  refreshing: false,

  init() {
    this.el = document.getElementById("portfolio-module");

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "delete-holding") {
        Store.remove("holdings", id);
      } else if (action === "refresh-prices") {
        this.refreshAll();
      }
    });

    this.el.addEventListener("submit", async (e) => {
      if (e.target.id !== "holding-form") return;
      e.preventDefault();
      const f = e.target;
      const ticker = f.ticker.value.trim().toUpperCase();
      const shares = parseFloat(f.shares.value);
      const buyPrice = parseFloat(f.buyPrice.value);
      const buyDate = f.buyDate.value || todayISO();
      if (!ticker || !shares || !buyPrice) return;

      const errEl = this.el.querySelector("#holding-form-error");
      errEl.classList.add("hidden");
      const submitBtn = f.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Fetching price…";

      try {
        const currentPrice = await fetchQuote(ticker);
        Store.add("holdings", {
          id: Store.uid("hd"),
          ticker,
          shares,
          buyPrice,
          buyDate,
          currentPrice,
          lastUpdated: new Date().toISOString(),
        });
        f.reset();
        f.buyDate.value = todayISO();
      } catch (err) {
        errEl.textContent = `Couldn't fetch a price for "${ticker}" — check the ticker symbol.`;
        errEl.classList.remove("hidden");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Add Position";
      }
    });

    Store.subscribe("holdings:changed", () => this.render());
    this.render();
  },

  async refreshAll() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.render();

    const holdings = Store.state.holdings;
    const results = await Promise.allSettled(holdings.map((h) => fetchQuote(h.ticker)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        Store.update("holdings", holdings[i].id, { currentPrice: r.value, lastUpdated: new Date().toISOString() });
      }
    });

    this.refreshing = false;
    this.render();
  },

  render() {
    const holdings = [...Store.state.holdings].sort((a, b) => a.ticker.localeCompare(b.ticker));

    let totalCost = 0, totalValue = 0;
    const rows = holdings.map((h) => {
      const cost = h.shares * h.buyPrice;
      const value = h.shares * h.currentPrice;
      const gain = value - cost;
      const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
      totalCost += cost;
      totalValue += value;
      const up = gain >= 0;
      return `
        <li class="flex items-center gap-3 py-2.5 group">
          <div class="w-16 shrink-0">
            <p class="font-semibold text-sm">${escapeHtml(h.ticker)}</p>
            <p class="text-[11px] text-slate-500">${h.shares}sh</p>
          </div>
          <div class="flex-1 min-w-0 text-xs text-slate-400">
            <p>Bought ${formatDate(h.buyDate)} @ $${h.buyPrice}</p>
            <p>Now $${h.currentPrice}</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-medium">$${value.toFixed(2)}</p>
            <p class="text-xs ${up ? "text-emerald-400" : "text-rose-400"}">${up ? "+" : "−"}$${Math.abs(gain).toFixed(2)} (${up ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%)</p>
          </div>
          <button data-action="delete-holding" data-id="${h.id}"
                  class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1">✕</button>
        </li>`;
    }).join("");

    const totalGain = totalValue - totalCost;
    const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const up = totalGain >= 0;

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-slate-100">📈 Stock Portfolio</h2>
        <button data-action="refresh-prices" ${this.refreshing ? "disabled" : ""}
                class="text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-500/40 rounded-lg px-3 py-1.5 disabled:opacity-50">
          ${this.refreshing ? "Refreshing…" : "↻ Refresh prices"}
        </button>
      </div>

      <p class="text-[11px] text-slate-500 mb-3">Prices in each ticker's native currency (USD for US-listed stocks) — not converted to your Ledger currency.</p>

      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Invested</p>
          <p class="font-semibold">$${totalCost.toFixed(2)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Current Value</p>
          <p class="font-semibold">$${totalValue.toFixed(2)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2 ${up ? "ring-1 ring-emerald-500/30" : "ring-1 ring-rose-500/30"}">
          <p class="text-[11px] text-slate-500">Total Gain/Loss</p>
          <p class="${up ? "text-emerald-300" : "text-rose-300"} font-semibold">${up ? "+" : "−"}$${Math.abs(totalGain).toFixed(2)} (${up ? "+" : "−"}${Math.abs(totalGainPct).toFixed(1)}%)</p>
        </div>
      </div>

      <ul class="divide-y divide-slate-800 mb-3 max-h-64 overflow-y-auto">
        ${rows || `<li class="py-3 text-sm text-slate-500">No positions yet — add one below.</li>`}
      </ul>

      <p id="holding-form-error" class="hidden text-xs text-rose-400 mb-2"></p>
      <form id="holding-form" class="flex flex-wrap gap-2">
        <input name="ticker" placeholder="Ticker (e.g. AAPL)" required
               class="w-32 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400 uppercase" />
        <input name="shares" type="number" step="any" min="0.0001" placeholder="Shares" required
               class="w-24 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="buyPrice" type="number" step="0.01" min="0.01" placeholder="Buy price" required
               class="w-28 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="buyDate" type="date" value="${todayISO()}"
               class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-300" />
        <button type="submit" class="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">Add Position</button>
      </form>`;
  },
};
