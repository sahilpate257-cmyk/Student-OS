// ledger.js — LedgerModule: multi-stream income/expense tracker + monthly cashflow chart

import { Store, todayISO, escapeHtml, formatDate } from "./store.js";
import { icon } from "./icons.js";
import { api } from "./marketdata.js";
import { PortfolioModule } from "./portfolio.js";

const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;

export const LedgerModule = {
  el: null,
  view: { y: 0, m: 0 },
  pp: null,

  init() {
    if (!document.getElementById("cx-css")) {
      const st = document.createElement("style");
      st.id = "cx-css";
      st.textContent = CX_CSS;
      document.head.appendChild(st);
    }
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
      } else if (action === "cash-tab") {
        this.tab = btn.dataset.tab;
        this.render();
      } else if (action === "pp-load") {
        this.loadPaypal();
      } else if (action === "pp-close") {
        this.pp = null;
        this.render();
      } else if (action === "pp-toggle") {
        if (this.pp.sel.has(id)) this.pp.sel.delete(id); else this.pp.sel.add(id);
        this.render();
      } else if (action === "pp-import") {
        this.importPaypal();
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

  // PayPal pull. Gross lands as income and PayPal's fee as a separate expense, so
  // the "In" figure stays turnover - that is the number the £1,000 trading
  // allowance is measured against, not profit. extId makes re-pulling idempotent.
  async loadPaypal() {
    this.pp = { loading: true, error: null, items: [], sel: new Set() };
    this.render();
    try {
      const d = await api("/paypal/income", { days: 31 });
      const seen = new Set(Store.state.transactions.map((t) => t.extId).filter(Boolean));
      const target = PortfolioModule.displayCurrency();
      const items = (d.items || []).map((x) => {
        const same = x.currency === target;
        return {
          ...x,
          amt: same ? x.gross : PortfolioModule.conv(x.gross, x.currency),
          feeAmt: !x.fee ? 0 : same ? x.fee : PortfolioModule.conv(x.fee, x.currency),
          already: seen.has(`pp:${x.id}`),
        };
      });
      const sel = new Set(items.filter((x) => !x.already && x.amt != null).map((x) => x.id));
      this.pp = { loading: false, error: null, items, sel, from: d.from, to: d.to };
    } catch (e) {
      this.pp = { loading: false, error: String(e.message || e), items: [], sel: new Set() };
    }
    this.render();
  },

  importPaypal() {
    const p = this.pp;
    if (!p) return;
    this.pp = null;
    for (const x of p.items) {
      if (!p.sel.has(x.id) || x.already || x.amt == null) continue;
      const label = x.note || x.from || "PayPal payment";
      Store.add("transactions", {
        id: Store.uid("tx"), extId: `pp:${x.id}`, type: "income",
        amount: +x.amt.toFixed(2), category: "PayPal", description: label, date: x.date,
      });
      if (x.feeAmt) {
        Store.add("transactions", {
          id: Store.uid("tx"), extId: `pp:${x.id}:fee`, type: "expense",
          amount: +Math.abs(x.feeAmt).toFixed(2), category: "PayPal fee",
          description: `Fee on ${label}`, date: x.date,
        });
      }
    }
    this.render();
  },

  paypalHtml() {
    const p = this.pp;
    if (!p) return "";
    const cur = Store.state.settings.currency;
    const money = (n) => `${cur}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const wrap = (inner) => `<div class="well p-3.5 mb-4" style="border:1px solid var(--border-2)">${inner}</div>`;
    if (p.loading) return wrap(`<p class="text-[13px] faint">Checking PayPal…</p>`);
    if (p.error) {
      return wrap(`<p class="text-[13px] neg mb-2">${escapeHtml(p.error)}</p>
        <button data-action="pp-close" class="btn btn-ghost btn-sm">Close</button>`);
    }
    const fresh = p.items.filter((x) => !x.already);
    const skipped = p.items.length - fresh.length;
    if (!fresh.length) {
      return wrap(`<p class="text-[13px] faint mb-2">Nothing new from PayPal between ${escapeHtml(p.from || "")} and ${escapeHtml(p.to || "")}${skipped ? ` — all ${skipped} payment${skipped > 1 ? "s" : ""} already logged` : ""}.</p>
        <button data-action="pp-close" class="btn btn-ghost btn-sm">Close</button>`);
    }
    const rows = fresh.map((x) => {
      const on = p.sel.has(x.id);
      const bad = x.amt == null;
      return `<li class="flex items-center gap-2.5 py-2 divide-row">
        <button data-action="pp-toggle" data-id="${escapeHtml(x.id)}" class="cbx ${on && !bad ? "cbx-on" : ""}" ${bad ? "disabled" : ""} aria-pressed="${on && !bad}">${icon("check", 12)}</button>
        <div class="flex-1 min-w-0">
          <p class="text-[13px] font-medium truncate">${escapeHtml(x.note || x.from || "PayPal payment")}</p>
          <p class="text-[11.5px] faint">${formatDate(x.date)}${x.feeAmt ? ` · fee ${money(Math.abs(x.feeAmt))}` : ""}</p>
        </div>
        <span class="text-[13px] font-semibold num ${bad ? "faint" : "pos"}">${bad ? `${escapeHtml(x.currency)} — no rate` : `+${money(x.amt)}`}</span>
      </li>`;
    }).join("");
    const n = fresh.filter((x) => p.sel.has(x.id) && x.amt != null).length;
    return wrap(`
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <p class="text-[13px] font-semibold">PayPal · ${escapeHtml(p.from || "")} to ${escapeHtml(p.to || "")}</p>
        <button data-action="pp-close" class="btn-icon" style="width:26px;height:26px">${icon("x", 14)}</button>
      </div>
      <p class="text-[11.5px] faint mb-2">Payments in. The gross amount is logged as income and PayPal's fee separately as an expense, so your income total stays your turnover.${skipped ? ` ${skipped} already logged.` : ""}</p>
      <ul class="max-h-56 overflow-y-auto pr-1" style="border-top:1px solid var(--border)">${rows}</ul>
      <button data-action="pp-import" class="btn btn-primary btn-sm mt-3" ${n ? "" : "disabled"}>Add ${n} ${n === 1 ? "entry" : "entries"}</button>`);
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
    const fmt = (n) => `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

    const { income, expense, net } = this.totalsFor(key);
    const tab = this.tab || "trend";

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
    const bars = months.map((mo, i) => {
      const hIn = Math.round((mo.income / maxVal) * 100);
      const hEx = Math.round((mo.expense / maxVal) * 100);
      const isCurrent = mo.key === key;
      return `
        <div class="cx-bar ${isCurrent ? "is-on" : ""}" style="--d:${i * 50}ms" title="${mo.label}: in ${fmt(mo.income)} · out ${fmt(mo.expense)}">
          <div class="cx-bar-track">
            <i style="height:${Math.max(hIn, 2)}%;background:var(--pos)"></i>
            <i style="height:${Math.max(hEx, 2)}%;background:var(--neg)"></i>
          </div>
          <span>${mo.label}</span>
          <em>${mo.net >= 0 ? "+" : "−"}${fmt(Math.abs(Math.round(mo.net)))}</em>
        </div>`;
    }).join("");

    // Spend pace: cumulative spend by day, this month vs last month.
    const cumulative = (yy, mm, upTo) => {
      const k = monthKey(yy, mm), days = new Date(yy, mm + 1, 0).getDate();
      const by = {};
      for (const t of Store.state.transactions) if (t.type !== "income" && t.date.startsWith(k)) by[+t.date.slice(8, 10)] = (by[+t.date.slice(8, 10)] || 0) + t.amount;
      let run = 0;
      return Array.from({ length: Math.min(days, upTo ?? days) }, (_, i) => (run += by[i + 1] || 0));
    };
    const now = new Date();
    const isNow = now.getFullYear() === y && now.getMonth() === m;
    const thisPace = cumulative(y, m, isNow ? now.getDate() : null);
    const lastPace = cumulative(m === 0 ? y - 1 : y, (m + 11) % 12, null);
    const pmax = Math.max(1, ...thisPace, ...lastPace);
    const W = 300, H = 70;
    const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${(i / 30) * W},${H - (v / pmax) * (H - 6) - 3}`).join(" ");
    const diff = (thisPace.at(-1) || 0) - (lastPace[thisPace.length - 1] ?? lastPace.at(-1) ?? 0);
    const pace = thisPace.length > 1 ? `
      <svg class="cx-pace" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="cxg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--neg)" stop-opacity=".28"/><stop offset="1" stop-color="var(--neg)" stop-opacity="0"/></linearGradient></defs>
        <path d="${path(lastPace)}" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
        <path d="${path(thisPace)} L${((thisPace.length - 1) / 30) * W},${H} L0,${H} Z" fill="url(#cxg)"/>
        <path class="cx-draw" d="${path(thisPace)}" fill="none" stroke="var(--neg)" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <p class="cx-pace-note ${diff <= 0 ? "pos" : "neg"}">${fmt(Math.abs(Math.round(diff)))} ${diff <= 0 ? "less" : "more"} spent than this point last month</p>` : "";

    // Categories
    const cats = {};
    for (const t of Store.state.transactions) if (t.type !== "income" && t.date.startsWith(key)) cats[t.category || "Other"] = (cats[t.category || "Other"] || 0) + t.amount;
    const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const palette = ["var(--neg)", "var(--accent)", "var(--gold)", "var(--pos)", "var(--ink-muted)", "var(--accent-2)"];
    const catTotal = catList.reduce((a, c) => a + c[1], 0) || 1;
    let acc = 0;
    const donut = catList.slice(0, 6).map(([c, v], i) => {
      const f = v / catTotal, C = 2 * Math.PI * 40;
      const seg = `<circle cx="50" cy="50" r="40" fill="none" stroke="${palette[i]}" stroke-width="14" stroke-dasharray="${Math.max(0, f * C - 2)} ${C}" stroke-dashoffset="${-acc * C}" transform="rotate(-90 50 50)"/>`;
      acc += f;
      return seg;
    }).join("");
    const catRows = catList.slice(0, 6).map(([c, v], i) => `
      <div class="cx-cat"><span class="cx-dot" style="background:${palette[i]}"></span><span class="flex-1 truncate">${escapeHtml(c)}</span>
        <b>${fmt(Math.round(v))}</b><i style="--w:${(v / catList[0][1]) * 100}%;background:${palette[i]}"></i></div>`).join("");

    // Budgets (shared with the phone: doc.budgets)
    const budgets = (Store.state.budgets || []).map((b) => {
      const spent = cats[Object.keys(cats).find((c) => c.toLowerCase() === b.category.toLowerCase())] || 0;
      const f = b.monthly ? spent / b.monthly : 0;
      const dayF = isNow ? now.getDate() / new Date(y, m + 1, 0).getDate() : 1;
      const col = f > 1 ? "var(--neg)" : f > dayF + 0.1 ? "var(--gold)" : "var(--pos)";
      return `<div class="cx-bud"><div class="flex justify-between"><b>${escapeHtml(b.category)}</b><span class="faint num">${fmt(Math.round(spent))} / ${fmt(b.monthly)}</span></div>
        <div class="cx-bud-track"><i style="--w:${Math.min(100, f * 100)}%;background:${col}"></i><em style="left:${dayF * 100}%"></em></div></div>`;
    }).join("");

    // Tax (UK self-employed side income, same maths as the phone)
    const tyStart = (() => { const a = new Date(now.getFullYear(), 3, 6); return now < a ? new Date(now.getFullYear() - 1, 3, 6) : a; })();
    const tyISO = `${tyStart.getFullYear()}-04-06`;
    const earned = Store.state.transactions.filter((t) => t.type === "income" && t.date >= tyISO && t.category !== "Transfer").reduce((a, t) => a + t.amount, 0);
    const elapsed = Math.max(30, (now - tyStart) / 864e5);
    const projected = earned / elapsed * 365;
    const other = Store.state.settings?.taxOtherIncome || 0;
    const profit = Math.max(0, projected - 1000), free = Math.max(0, 12570 - other);
    const taxable = Math.max(0, profit - free);
    const owe = taxable * 0.2 + Math.max(0, Math.min(profit, 50270) - 12570) * 0.06;
    const dueDate = new Date(tyStart.getFullYear() + 2, 0, 31);
    const monthsLeft = Math.max(1, (dueDate.getFullYear() - now.getFullYear()) * 12 + dueDate.getMonth() - now.getMonth());

    // Shortcuts (read-only summaries; the phone app edits these)
    const bills = (Store.state.bills || []).reduce((a, b) => a + (b.cycle === "weekly" ? b.amount * 52 / 12 : b.cycle === "yearly" ? b.amount / 12 : b.amount), 0);
    const owed = (Store.state.owed || []).filter((o) => !o.paid).reduce((a, o) => a + o.amount, 0);
    const saved = (Store.state.goals || []).reduce((a, g) => a + (g.saved || 0), 0);
    const pill = (ic, label, val, col) => `<div class="cx-pill"><span style="color:${col};background:color-mix(in srgb, ${col} 15%, transparent)">${icon(ic, 17)}</span><b class="num">${val}</b><small>${label}</small></div>`;

    // Transactions grouped by day
    const txs = Store.state.transactions.filter((tx) => tx.date.startsWith(key)).sort((a, b) => b.date.localeCompare(a.date));
    const byDay = {};
    for (const t of txs) (byDay[t.date] ||= []).push(t);
    const groups = Object.entries(byDay).map(([d, list]) => `
      <p class="cx-day">${new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</p>
      <ul class="cx-list">${list.map((tx) => {
        const inc = tx.type === "income";
        return `<li class="group">
          <span class="cx-ic" style="background:${inc ? "var(--pos-soft)" : "var(--neg-soft)"};color:${inc ? "var(--pos)" : "var(--neg)"}">${icon(inc ? "arrowUp" : "arrowDown", 15)}</span>
          <div class="flex-1 min-w-0"><p class="truncate font-semibold text-[14px]">${escapeHtml(tx.description || tx.category)}</p><p class="text-[12px] faint">${escapeHtml(tx.category)}</p></div>
          <span class="num font-bold ${inc ? "pos" : "neg"}">${inc ? "+" : "−"}${fmt(tx.amount)}</span>
          <button data-action="delete-tx" data-id="${tx.id}" class="reveal btn-icon" style="width:28px;height:28px">${icon("x", 15)}</button>
        </li>`;
      }).join("")}</ul>`).join("");

    const currencyToggle = ["£", "$"].map((c) => `
      <button data-action="set-currency" data-currency="${c}"
              class="w-7 h-7 rounded-md text-[13px] font-semibold transition ${cur === c ? "" : "faint"}"
              style="${cur === c ? "background:var(--accent);color:var(--accent-ink)" : ""}">${c}</button>`).join("");
    const tabBtn = (id, label) => `<button data-action="cash-tab" data-tab="${id}" class="${tab === id ? "on" : ""}">${label}</button>`;
    const total = Math.max(1, income + expense);

    this.el.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p class="eyebrow">Cash</p>
          <h2 class="cx-title">${monthName}</h2>
        </div>
        <div class="flex items-center gap-2">
          <button data-action="pp-load" class="btn btn-ghost btn-sm" ${this.pp?.loading ? "disabled" : ""}>${this.pp?.loading ? "Checking…" : "Pull PayPal"}</button>
          <div class="flex items-center gap-0.5 p-0.5 rounded-lg" style="background:var(--sunken)">${currencyToggle}</div>
          <div class="flex items-center gap-0.5">
            <button data-action="prev-month" class="btn-icon" style="width:30px;height:30px">${icon("chevronLeft", 17)}</button>
            <button data-action="next-month" class="btn-icon" style="width:30px;height:30px">${icon("chevronRight", 17)}</button>
          </div>
        </div>
      </div>

      <div class="cx-grid">
        <section class="cx-hero ${net >= 0 ? "is-up" : "is-down"}">
          <p class="eyebrow">Net this month</p>
          <p class="cx-net num" data-count="${net}" data-prefix="${net >= 0 ? "+" : "−"}${cur}">${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}</p>
          <div class="cx-split"><i style="--w:${(income / total) * 100}%;background:var(--pos)"></i><i style="--w:${(expense / total) * 100}%;background:var(--neg)"></i></div>
          <div class="cx-flows">
            <div><span class="cx-ic" style="background:var(--pos-soft);color:var(--pos)">${icon("arrowDown", 14)}</span><div><small>In</small><b class="num">${fmt(income)}</b></div></div>
            <div><span class="cx-ic" style="background:var(--neg-soft);color:var(--neg)">${icon("arrowUp", 14)}</span><div><small>Out</small><b class="num">${fmt(expense)}</b></div></div>
          </div>
          ${pace}
        </section>

        <div class="cx-side">
          <div class="cx-pills">
            ${pill("calendar", "Bills /mo", bills ? fmt(Math.round(bills)) : "—", "var(--neg)")}
            ${pill("arrowDown", "Owed to you", owed ? fmt(Math.round(owed)) : "—", "var(--pos)")}
            ${pill("target", "Goals saved", saved ? fmt(Math.round(saved)) : "—", "var(--gold)")}
            ${pill("shield", "Accounts", String((Store.state.accounts || []).length), "var(--accent)")}
          </div>

          <section class="cx-card">
            <div class="cx-tabs">${tabBtn("trend", "Trend")}${tabBtn("spend", "Spending")}${tabBtn("budgets", "Budgets")}${tabBtn("tax", "Tax")}</div>
            <div class="cx-panel">
              ${tab === "trend" ? `<div class="cx-bars">${bars}</div>` : ""}
              ${tab === "spend" ? (catList.length ? `<div class="cx-donut"><svg viewBox="0 0 100 100" width="120" height="120">${donut}</svg>
                  <div><small class="faint">Top spend</small><b>${escapeHtml(catList[0][0])}</b><span class="neg num">${fmt(Math.round(catList[0][1]))}</span></div></div>${catRows}` : `<p class="faint">No spending yet this month.</p>`) : ""}
              ${tab === "budgets" ? (budgets || `<p class="faint">Set monthly budgets in the phone app's Cash tab; they show here too.</p>`) : ""}
              ${tab === "tax" ? `<p class="cx-big num">${owe < 1 ? "£0" : fmt(Math.round(owe / monthsLeft))}<small> /month to set aside</small></p>
                  <div class="cx-kv"><span>Earned since 6 Apr</span><b class="num">${fmt(Math.round(earned))}</b></div>
                  <div class="cx-kv"><span>On pace for</span><b class="num">${fmt(Math.round(projected))}</b></div>
                  <div class="cx-kv"><span>Estimated tax + NI</span><b class="num">${fmt(Math.round(owe))}</b></div>
                  <p class="text-[11.5px] faint mt-2">${projected > 1000 ? `Register for Self Assessment by 5 Oct; pay by 31 Jan ${dueDate.getFullYear()}.` : "On pace to stay under the £1,000 trading allowance."} Estimate only — not tax advice.</p>` : ""}
            </div>
          </section>
        </div>
      </div>

      ${this.paypalHtml()}

      <div class="cx-txs">
        <div class="flex items-center justify-between mb-1"><h3 class="sect-title">Transactions</h3><span class="faint text-[13px]">${txs.length}</span></div>
        ${groups || `<p class="py-6 text-[13px] faint text-center">No transactions logged this month.</p>`}
      </div>

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

const CX_CSS = `
.cx-title{font:800 clamp(26px,3.4vw,34px)/1.1 Manrope,system-ui;letter-spacing:-.03em}
.cx-grid{display:grid;gap:14px;margin-bottom:16px}
@media(min-width:900px){.cx-grid{grid-template-columns:1.05fr 1fr;align-items:start}}
.cx-hero{position:relative;overflow:hidden;padding:22px;border-radius:26px;background:var(--surface);border:1px solid var(--border);box-shadow:inset 0 1px 0 var(--edge),var(--shadow-md)}
.cx-hero::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(500px 260px at 0% 0%,color-mix(in srgb,var(--pos) 22%,transparent),transparent 70%),radial-gradient(400px 220px at 100% 0%,var(--accent-soft),transparent 70%)}
.cx-hero.is-down::before{background:radial-gradient(500px 260px at 0% 0%,color-mix(in srgb,var(--neg) 22%,transparent),transparent 70%),radial-gradient(400px 220px at 100% 0%,var(--accent-soft),transparent 70%)}
.cx-hero>*{position:relative}
.cx-net{font:800 clamp(40px,6vw,56px)/1 Manrope,system-ui;letter-spacing:-.04em;margin:6px 0 16px}
.is-up .cx-net{color:var(--pos)}.is-down .cx-net{color:var(--neg)}
.cx-split{display:flex;gap:4px;height:10px}
.cx-split i{display:block;width:var(--w);min-width:8px;border-radius:99px;animation:cxGrow .9s cubic-bezier(.22,1,.36,1) backwards}
.cx-flows{display:flex;justify-content:space-between;margin:14px 0 6px}
.cx-flows>div{display:flex;gap:10px;align-items:center}
.cx-flows small{display:block;font-size:11px;font-weight:700;color:var(--ink-faint)}
.cx-flows b{font-size:17px}
.cx-ic{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;flex:none}
.cx-pace{width:100%;height:76px;margin-top:10px;overflow:visible}
.cx-draw{stroke-dasharray:1000;stroke-dashoffset:1000;animation:cxDraw 1.4s .2s cubic-bezier(.22,1,.36,1) forwards}
.cx-pace-note{font-size:12.5px;font-weight:700;margin-top:4px}
.cx-side{display:grid;gap:14px}
.cx-pills{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.cx-pill{display:flex;flex-direction:column;align-items:center;gap:5px;padding:14px 6px;border-radius:20px;background:var(--surface);border:1px solid var(--border);box-shadow:inset 0 1px 0 var(--edge);transition:transform .2s ease}
.cx-pill:hover{transform:translateY(-2px)}
.cx-pill span{display:grid;place-items:center;width:38px;height:38px;border-radius:50%}
.cx-pill b{font-size:15px}
.cx-pill small{font-size:11px;font-weight:600;color:var(--ink-faint);text-align:center}
.cx-card{padding:16px 18px;border-radius:24px;background:var(--surface);border:1px solid var(--border);box-shadow:inset 0 1px 0 var(--edge),var(--shadow-md)}
.cx-tabs{display:grid;grid-template-columns:repeat(4,1fr);padding:3px;border-radius:12px;background:var(--sunken);margin-bottom:14px}
.cx-tabs button{padding:7px 4px;border-radius:9px;font-size:12.5px;font-weight:700;color:var(--ink-muted);transition:.2s}
.cx-tabs button.on{background:var(--surface-2);color:var(--ink);box-shadow:var(--shadow-sm)}
.cx-panel{animation:fade .35s ease}
.cx-bars{display:flex;gap:8px;align-items:flex-end}
.cx-bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.55;transition:opacity .2s}
.cx-bar.is-on,.cx-bar:hover{opacity:1}
.cx-bar-track{height:120px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:4px}
.cx-bar-track i{width:11px;border-radius:6px 6px 3px 3px;transform-origin:bottom;animation:cxRise .7s var(--d) cubic-bezier(.22,1,.36,1) backwards}
.cx-bar span{font-size:11.5px;font-weight:700;color:var(--ink-muted)}
.cx-bar em{font-style:normal;font-size:10.5px;color:var(--ink-faint)}
.cx-donut{display:flex;gap:18px;align-items:center;margin-bottom:10px}
.cx-donut circle{animation:fade .6s ease backwards}
.cx-donut b{display:block;font-size:20px}
.cx-cat{position:relative;display:flex;align-items:center;gap:8px;padding:7px 0 11px;font-size:13.5px}
.cx-cat i{position:absolute;left:0;bottom:3px;height:4px;width:var(--w);border-radius:99px;opacity:.75;animation:cxGrow .8s cubic-bezier(.22,1,.36,1) backwards}
.cx-dot{width:9px;height:9px;border-radius:50%;flex:none}
.cx-bud{margin-bottom:12px;font-size:13.5px}
.cx-bud-track{position:relative;height:8px;border-radius:99px;background:var(--sunken);margin-top:6px}
.cx-bud-track i{display:block;height:100%;width:var(--w);border-radius:99px;animation:cxGrow .8s cubic-bezier(.22,1,.36,1) backwards}
.cx-bud-track em{position:absolute;top:-3px;width:2px;height:14px;background:var(--ink-muted);border-radius:2px}
.cx-big{font:800 32px/1.1 Manrope,system-ui;margin-bottom:10px}
.cx-big small{font-size:14px;font-weight:600;color:var(--ink-muted)}
.cx-kv{display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border);font-size:13.5px}
.cx-kv span{color:var(--ink-muted)}
.cx-txs{margin-top:6px}
.cx-day{font-size:12.5px;font-weight:700;color:var(--ink-faint);margin:14px 4px 6px}
.cx-list{border-radius:18px;background:var(--surface);border:1px solid var(--border);overflow:hidden}
.cx-list li{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--border);transition:background .15s}
.cx-list li:first-child{border-top:0}
.cx-list li:hover{background:var(--sunken)}
#ledger-module{background:transparent!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;padding:0!important}
@keyframes cxGrow{from{width:0}}
@keyframes cxRise{from{transform:scaleY(0)}}
@keyframes cxDraw{to{stroke-dashoffset:0}}
@media(max-width:520px){.cx-pills{grid-template-columns:repeat(2,1fr)}}
`;
