// insights.js — InsightsModule: the money-intelligence layer for lumpy student
// side-income. Income by source, effective hourly rate ("is this hustle worth it?"),
// and a UK tax-position estimate (clearly labelled as an estimate, not advice).

import { Store, auth, escapeHtml } from "./store.js";
import { icon } from "./icons.js";

const TRADING_ALLOWANCE = 1000;   // UK £1,000 trading allowance
const PERSONAL_ALLOWANCE = 12570; // UK personal allowance
const BASIC_RATE = 0.2;
const WORKER_URL = "https://ledgerly-ai-intake.sahilpatel-ledgerly.workers.dev";

// UK tax year runs 6 April → 5 April
function taxYearStartISO(d = new Date()) {
  const y = d.getFullYear();
  const startThisYear = new Date(y, 3, 6); // 6 April
  const start = d < startThisYear ? new Date(y - 1, 3, 6) : startThisYear;
  return `${start.getFullYear()}-04-06`;
}

export const InsightsModule = {
  el: null,
  review: null,
  reviewing: false,
  reviewError: null,

  init() {
    this.el = document.getElementById("insights-module");
    Store.subscribe("transactions:changed", () => this.render());
    Store.subscribe("settings:changed", () => this.render());
    this.el.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="review"]')) this.runReview();
      if (e.target.closest('[data-action="clear-review"]')) { this.review = null; this.reviewError = null; this.render(); }
    });
    this.render();
  },

  // Only the figures needed for a description - no ids, no personal fields.
  snapshot() {
    const cur = Store.state.settings.currency;
    const h = Store.state.holdings.map((x) => ({
      ticker: x.ticker, name: x.name, currency: x.currency, shares: x.shares,
      avgCost: x.buyPrice, price: x.currentPrice,
      value: +(x.shares * x.currentPrice).toFixed(2),
      gain: +((x.currentPrice - x.buyPrice) * x.shares).toFixed(2),
    }));
    const since = taxYearStartISO();
    const tx = Store.state.transactions.filter((t) => t.date >= since);
    const sum = (type) => +tx.filter((t) => t.type === type).reduce((a, t) => a + (+t.amount || 0), 0).toFixed(2);
    const cash = Store.state.settings.t212Cash;
    return {
      displayCurrency: cur,
      holdings: h,
      uninvestedCash: cash ? { amount: cash.free, currency: cash.currency } : null,
      taxYearStart: since,
      incomeThisTaxYear: sum("income"),
      spendingThisTaxYear: sum("expense"),
      transactionCount: tx.length,
    };
  },

  async runReview() {
    if (this.reviewing) return;
    this.reviewing = true;
    this.reviewError = null;
    this.render();
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("You need to be signed in.");
      const res = await fetch(`${WORKER_URL}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ snapshot: this.snapshot() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't generate a review.");
      this.review = data.review;
    } catch (err) {
      this.reviewError = err.message || "Something went wrong.";
    } finally {
      this.reviewing = false;
      this.render();
    }
  },

  renderReview() {
    if (this.reviewError) {
      return `<p class="text-[12.5px] neg">${escapeHtml(this.reviewError)}</p>
        <button data-action="review" class="btn btn-ghost btn-sm mt-2">Try again</button>`;
    }
    if (this.review) {
      const paras = this.review.split(/\n{2,}/).filter(Boolean)
        .map((t) => `<p class="text-[13px] mb-2.5" style="line-height:1.65">${escapeHtml(t)}</p>`).join("");
      return `${paras}
        <button data-action="clear-review" class="btn btn-ghost btn-sm mt-1">Close</button>`;
    }
    if (!Store.state.holdings.length) {
      return `<p class="text-[12.5px] faint">Add a holding and this will describe how your money is split.</p>`;
    }
    return `<p class="text-[12.5px] muted mb-2.5">A plain-English description of how your money is currently split, what is carrying the gains and losses, and where your cash sits.</p>
      <button data-action="review" class="btn btn-primary btn-sm" ${this.reviewing ? "disabled" : ""}>
        ${this.reviewing ? "Reading your portfolio…" : "Write my review"}
      </button>`;
  },

  render() {
    const cur = Store.state.settings.currency;
    const fmt = (n) => `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const startISO = taxYearStartISO();
    const startLabel = new Date(startISO).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

    const income = Store.state.transactions.filter((t) => t.type === "income" && t.date >= startISO);
    const totalIncome = income.reduce((s, t) => s + t.amount, 0);

    // ---- income by source ----
    const bySource = {};
    for (const t of income) {
      const cat = t.category || "General";
      (bySource[cat] ??= { total: 0, hours: 0, incomeWithHours: 0 });
      bySource[cat].total += t.amount;
      if (t.hours > 0) { bySource[cat].hours += t.hours; bySource[cat].incomeWithHours += t.amount; }
    }
    const sources = Object.entries(bySource)
      .map(([cat, v]) => ({ cat, ...v, rate: v.hours > 0 ? v.incomeWithHours / v.hours : null }))
      .sort((a, b) => b.total - a.total);

    const sourceRows = sources.map((s) => {
      const pct = totalIncome > 0 ? (s.total / totalIncome) * 100 : 0;
      return `
        <li class="py-2 divide-row">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-[13px] font-medium truncate">${escapeHtml(s.cat)}</span>
            <span class="text-[13px] font-semibold num">${fmt(s.total)} <span class="faint font-normal">· ${pct.toFixed(0)}%</span></span>
          </div>
          <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--sunken)">
            <div class="h-full rounded-full" style="width:${pct}%;background:var(--pos)"></div>
          </div>
        </li>`;
    }).join("");

    // ---- effective hourly rate ----
    const withRates = sources.filter((s) => s.rate != null).sort((a, b) => b.rate - a.rate);
    let hourlyHtml;
    if (withRates.length) {
      hourlyHtml = `<ul>${withRates.map((s, i) => `
        <li class="flex items-center justify-between gap-2 py-2 divide-row">
          <div class="flex items-center gap-2 min-w-0">
            ${i === 0 ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:var(--pos-soft);color:var(--pos)">BEST</span>` : ""}
            <span class="text-[13px] font-medium truncate">${escapeHtml(s.cat)}</span>
          </div>
          <div class="text-right">
            <p class="text-[14px] font-semibold num">${fmt(s.rate)}<span class="faint text-[11px] font-normal">/hr</span></p>
            <p class="text-[10.5px] faint num">${s.hours} hr${s.hours === 1 ? "" : "s"} logged</p>
          </div>
        </li>`).join("")}</ul>`;
    } else {
      hourlyHtml = `<p class="text-[12.5px] faint py-2">Add <b style="color:var(--ink)">hrs</b> when you log income and Ledgerly will show which hustle actually pays best per hour — the number most side-hustlers never work out.</p>`;
    }

    // ---- tax position (UK, £ only) ----
    let taxHtml;
    if (cur !== "£") {
      taxHtml = `<p class="text-[12.5px] faint py-2">UK tax insights show when your Cashflow currency is set to £.</p>`;
    } else {
      const over = Math.max(0, totalIncome - TRADING_ALLOWANCE);
      const pctAllowance = Math.min(100, (totalIncome / TRADING_ALLOWANCE) * 100);
      const setAside = over * BASIC_RATE;
      const withinAllowance = totalIncome <= TRADING_ALLOWANCE;

      taxHtml = `
        <div class="mb-3">
          <div class="flex items-center justify-between mb-1.5">
            <span class="eyebrow">Trading allowance used</span>
            <span class="text-[12px] num muted">£${totalIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })} / £1,000</span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" style="background:var(--sunken)">
            <div class="h-full rounded-full" style="width:${pctAllowance}%;background:${withinAllowance ? "var(--pos)" : "var(--gold)"}"></div>
          </div>
        </div>
        ${withinAllowance
          ? `<div class="flex items-start gap-2 text-[13px] pos mb-2">${icon("check", 15)}<span style="color:var(--ink)">You're within the £1,000 tax-free trading allowance — you likely don't need to report this side income yet.</span></div>`
          : `<div class="flex items-start gap-2 text-[13px] mb-2"><span style="color:var(--gold)">${icon("insights", 15)}</span><span style="color:var(--ink)">You've passed the £1,000 trading allowance. You'll likely need to <b>register for Self Assessment</b> and declare this income — even if you end up owing nothing.</span></div>
             <div class="well px-3.5 py-3 mb-2">
               <p class="eyebrow mb-1">Cautious buffer to set aside</p>
               <p class="font-display text-[20px] font-medium num leading-none">${fmt(setAside)}</p>
               <p class="text-[11px] faint mt-1.5">A safe cushion (20% of income above the allowance). If your <b>total</b> income for the year — including any job — stays under £12,570, you likely owe £0 income tax and this sits untouched.</p>
             </div>`}
        <p class="text-[10.5px] faint leading-relaxed">Rough UK estimate for guidance only, not tax advice — it assumes all logged income is self-employment income. Check <a href="https://www.gov.uk/self-assessment-tax-returns" target="_blank" rel="noopener" class="underline" style="color:var(--ink-muted)">gov.uk</a> or an accountant before acting.</p>`;
    }

    this.el.innerHTML = `
      <div class="flex items-center gap-2.5 mb-1">
        <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("insights", 18)}</span>
        <div>
          <h2 class="sect-title leading-tight">Money Insights</h2>
          <p class="text-[11.5px] faint">This tax year · since ${startLabel}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        <div>
          <p class="eyebrow mb-2">Income by source</p>
          <p class="font-display text-[22px] font-medium num leading-none mb-3">${fmt(totalIncome)}</p>
          <ul style="border-top:1px solid var(--border)">
            ${sourceRows || `<li class="py-3 text-[12.5px] faint">No income logged this tax year yet.</li>`}
          </ul>
        </div>
        <div>
          <p class="eyebrow mb-2 flex items-center gap-1.5">${icon("clock", 13)} Effective hourly rate</p>
          ${hourlyHtml}
        </div>
        <div>
          <p class="eyebrow mb-2">Tax position <span class="faint">· UK</span></p>
          ${taxHtml}
        </div>
        <div>
          <p class="eyebrow mb-2 flex items-center gap-1.5">${icon("sparkle", 13)} Portfolio review</p>
          <div class="well p-3.5">${this.renderReview()}</div>
        </div>
      </div>`;
  },
};
