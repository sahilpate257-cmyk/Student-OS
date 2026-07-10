// ledger.js — LedgerModule: side hustle income/expense tracker + monthly P/L chart

import { Store, todayISO, escapeHtml, formatDate } from "./store.js";

const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;

export const LedgerModule = {
  el: null,
  view: { y: 0, m: 0 },

  init() {
    this.el = document.getElementById("ledger-module");
    const now = new Date();
    this.view = { y: now.getFullYear(), m: now.getMonth() };

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "prev-month") {
        this.view.m--;
        if (this.view.m < 0) { this.view.m = 11; this.view.y--; }
        this.render();
      } else if (action === "next-month") {
        this.view.m++;
        if (this.view.m > 11) { this.view.m = 0; this.view.y++; }
        this.render();
      } else if (action === "delete-tx") {
        Store.remove("transactions", id);
      } else if (action === "set-currency") {
        Store.setSetting("currency", btn.dataset.currency);
      }
    });

    this.el.addEventListener("submit", (e) => {
      if (e.target.id !== "tx-form") return;
      e.preventDefault();
      const f = e.target;
      const amount = parseFloat(f.amount.value);
      if (!amount || amount <= 0) return;
      Store.add("transactions", {
        id: Store.uid("tx"),
        type: f.type.value,
        amount,
        category: f.category.value.trim() || "General",
        description: f.description.value.trim(),
        date: f.date.value || todayISO(),
      });
      f.reset();
      f.date.value = todayISO();
    });

    Store.subscribe("transactions:changed", () => this.render());
    Store.subscribe("settings:changed", () => this.render());
    this.render();
  },

  totalsFor(key) {
    let income = 0, expense = 0;
    for (const tx of Store.state.transactions) {
      if (!tx.date.startsWith(key)) continue;
      if (tx.type === "income") income += tx.amount;
      else expense += tx.amount;
    }
    return { income, expense, net: income - expense };
  },

  render() {
    const { y, m } = this.view;
    const cur = Store.state.settings.currency;
    const key = monthKey(y, m);
    const monthName = new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const fmt = (n) => `${cur}${n.toFixed(2).replace(/\.00$/, "")}`;

    const { income, expense, net } = this.totalsFor(key);

    // last 6 months ending at viewed month
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - i, 1);
      months.push({
        key: monthKey(d.getFullYear(), d.getMonth()),
        label: d.toLocaleDateString(undefined, { month: "short" }),
        ...this.totalsFor(monthKey(d.getFullYear(), d.getMonth())),
      });
    }
    const maxVal = Math.max(1, ...months.flatMap((mo) => [mo.income, mo.expense]));
    const bars = months.map((mo) => {
      const hIn = Math.round((mo.income / maxVal) * 100);
      const hEx = Math.round((mo.expense / maxVal) * 100);
      const isCurrent = mo.key === key;
      return `
        <div class="flex-1 flex flex-col items-center gap-1">
          <div class="w-full h-24 flex items-end justify-center gap-1">
            <div class="w-3 rounded-t bg-emerald-400/80" style="height:${hIn}%" title="Income ${fmt(mo.income)}"></div>
            <div class="w-3 rounded-t bg-rose-400/80" style="height:${hEx}%" title="Expenses ${fmt(mo.expense)}"></div>
          </div>
          <span class="text-[10px] ${isCurrent ? "text-indigo-300 font-semibold" : "text-slate-500"}">${mo.label}</span>
          <span class="text-[10px] ${mo.net >= 0 ? "text-emerald-400" : "text-rose-400"}">${mo.net >= 0 ? "+" : "−"}${fmt(Math.abs(mo.net))}</span>
        </div>`;
    }).join("");

    const txs = Store.state.transactions
      .filter((tx) => tx.date.startsWith(key))
      .sort((a, b) => b.date.localeCompare(a.date));
    const rows = txs.map((tx) => `
      <li class="flex items-center gap-3 py-2 group text-sm">
        <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs
                     ${tx.type === "income" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}">
          ${tx.type === "income" ? "↑" : "↓"}
        </span>
        <div class="flex-1 min-w-0">
          <p class="truncate">${escapeHtml(tx.description || tx.category)}</p>
          <p class="text-[11px] text-slate-500">${escapeHtml(tx.category)} · ${formatDate(tx.date)}</p>
        </div>
        <span class="font-medium ${tx.type === "income" ? "text-emerald-300" : "text-rose-300"}">
          ${tx.type === "income" ? "+" : "−"}${fmt(tx.amount)}
        </span>
        <button data-action="delete-tx" data-id="${tx.id}"
                class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1">✕</button>
      </li>`).join("");

    const currencyToggle = ["£", "$"].map((c) => `
      <button data-action="set-currency" data-currency="${c}"
              class="w-7 h-7 rounded text-sm font-medium ${cur === c ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/60" : "text-slate-500 hover:text-slate-300 border border-transparent"}">
        ${c}
      </button>`).join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-slate-100">💰 Hustle Ledger</h2>
        <div class="flex items-center gap-2 text-sm">
          <div class="flex items-center gap-0.5 mr-1">${currencyToggle}</div>
          <button data-action="prev-month" class="px-2 py-1 rounded hover:bg-slate-800">‹</button>
          <span class="w-32 text-center text-slate-300">${monthName}</span>
          <button data-action="next-month" class="px-2 py-1 rounded hover:bg-slate-800">›</button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Income</p>
          <p class="text-emerald-300 font-semibold">${fmt(income)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2">
          <p class="text-[11px] text-slate-500">Expenses</p>
          <p class="text-rose-300 font-semibold">${fmt(expense)}</p>
        </div>
        <div class="rounded-lg bg-slate-800/60 py-2 ${net >= 0 ? "ring-1 ring-emerald-500/30" : "ring-1 ring-rose-500/30"}">
          <p class="text-[11px] text-slate-500">Net P/L</p>
          <p class="${net >= 0 ? "text-emerald-300" : "text-rose-300"} font-semibold">${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}</p>
        </div>
      </div>

      <div class="flex gap-1 mb-4 px-1">${bars}</div>

      <ul class="divide-y divide-slate-800 mb-3 max-h-44 overflow-y-auto">
        ${rows || `<li class="py-3 text-sm text-slate-500">No transactions this month.</li>`}
      </ul>

      <form id="tx-form" class="grid grid-cols-2 sm:grid-cols-6 gap-2">
        <select name="type" class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm">
          <option value="income">＋ Income</option>
          <option value="expense">− Expense</option>
        </select>
        <input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" required
               class="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="category" placeholder="Category"
               class="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="description" placeholder="Description"
               class="col-span-2 sm:col-span-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <input name="date" type="date" value="${todayISO()}"
               class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-300" />
        <button class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Log</button>
      </form>`;
  },
};
