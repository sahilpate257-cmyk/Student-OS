// ledger.js — LedgerModule: multi-stream income/expense tracker + monthly cashflow chart

import { Store, todayISO, escapeHtml, formatDate } from "./store.js";
import { icon } from "./icons.js";

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
      const hours = parseFloat(f.hours.value);
      Store.add("transactions", {
        id: Store.uid("tx"),
        type: f.type.value,
        amount,
        category: f.category.value.trim() || "General",
        description: f.description.value.trim(),
        date: f.date.value || todayISO(),
        ...(f.type.value === "income" && hours > 0 ? { hours } : {}),
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
    const fmt = (n) => `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

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
        <div class="flex-1 flex flex-col items-center gap-2">
          <div class="w-full h-20 flex items-end justify-center gap-1.5">
            <div class="w-2.5 rounded-t-[3px]" style="height:${Math.max(hIn, 2)}%;background:var(--pos)" title="Income ${fmt(mo.income)}"></div>
            <div class="w-2.5 rounded-t-[3px]" style="height:${Math.max(hEx, 2)}%;background:var(--neg);opacity:.85" title="Expenses ${fmt(mo.expense)}"></div>
          </div>
          <span class="text-[10.5px] num ${isCurrent ? "font-semibold" : "faint"}" ${isCurrent ? 'style="color:var(--ink)"' : ""}>${mo.label}</span>
        </div>`;
    }).join("");

    const txs = Store.state.transactions
      .filter((tx) => tx.date.startsWith(key))
      .sort((a, b) => b.date.localeCompare(a.date));
    const rows = txs.map((tx) => {
      const inc = tx.type === "income";
      return `
      <li class="flex items-center gap-3 py-2.5 group divide-row">
        <span class="grid place-items-center w-8 h-8 shrink-0 rounded-full"
              style="background:${inc ? "var(--pos-soft)" : "var(--neg-soft)"};color:${inc ? "var(--pos)" : "var(--neg)"}">
          ${icon(inc ? "arrowUp" : "arrowDown", 15)}
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-[13.5px] font-medium truncate">${escapeHtml(tx.description || tx.category)}</p>
          <p class="text-[11.5px] faint">${escapeHtml(tx.category)} · ${formatDate(tx.date)}</p>
        </div>
        <span class="text-[13.5px] font-semibold num ${inc ? "pos" : "neg"}">${inc ? "+" : "−"}${fmt(tx.amount)}</span>
        <button data-action="delete-tx" data-id="${tx.id}" class="reveal btn-icon" style="width:28px;height:28px">${icon("x", 15)}</button>
      </li>`;
    }).join("");

    const currencyToggle = ["£", "$"].map((c) => `
      <button data-action="set-currency" data-currency="${c}"
              class="w-7 h-7 rounded-md text-[13px] font-semibold transition ${cur === c ? "" : "faint"}"
              style="${cur === c ? "background:var(--ink);color:var(--on-ink)" : ""}">${c}</button>`).join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("wallet", 18)}</span>
          <div>
            <h2 class="sect-title leading-tight">Cashflow</h2>
            <p class="text-[11.5px] faint">${monthName}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-0.5 p-0.5 rounded-lg" style="background:var(--sunken)">${currencyToggle}</div>
          <div class="flex items-center gap-0.5">
            <button data-action="prev-month" class="btn-icon" style="width:30px;height:30px">${icon("chevronLeft", 17)}</button>
            <button data-action="next-month" class="btn-icon" style="width:30px;height:30px">${icon("chevronRight", 17)}</button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2.5 mb-5">
        <div class="well px-3.5 py-3">
          <p class="eyebrow mb-1.5">In</p>
          <p class="font-display text-[19px] font-medium num pos leading-none">${fmt(income)}</p>
        </div>
        <div class="well px-3.5 py-3">
          <p class="eyebrow mb-1.5">Out</p>
          <p class="font-display text-[19px] font-medium num neg leading-none">${fmt(expense)}</p>
        </div>
        <div class="px-3.5 py-3 rounded-xl" style="background:${net >= 0 ? "var(--pos-soft)" : "var(--neg-soft)"}">
          <p class="eyebrow mb-1.5">Net</p>
          <p class="font-display text-[19px] font-medium num leading-none ${net >= 0 ? "pos" : "neg"}">${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}</p>
        </div>
      </div>

      <div class="flex gap-1.5 mb-5 px-1">${bars}</div>

      <ul class="mb-4 max-h-48 overflow-y-auto pr-1" style="border-top:1px solid var(--border)">
        ${rows || `<li class="py-4 text-[13px] faint text-center">No transactions logged this month.</li>`}
      </ul>

      <form id="tx-form" class="grid grid-cols-2 sm:grid-cols-7 gap-2">
        <select name="type" class="input">
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" required class="input num" />
        <input name="hours" type="number" step="0.25" min="0" placeholder="hrs" title="Hours spent (income only) — powers your hourly-rate insight" class="input num" />
        <input name="category" placeholder="Category" class="input" />
        <input name="description" placeholder="Description" class="input col-span-2 sm:col-span-1" />
        <input name="date" type="date" value="${todayISO()}" class="input" />
        <button class="btn btn-primary">Log</button>
      </form>`;
  },
};
