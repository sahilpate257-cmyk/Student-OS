// home.js — the dashboard: one glance across money, notes, training, food and plans.
// Widgets are chosen, ordered and sized per device ("Customise"), in a cards or compact layout.

import { Store, escapeHtml, todayISO } from "./store.js";
import { icon } from "./icons.js";
import { PortfolioModule } from "./portfolio.js";
import { noteTitle } from "./notes.js";

const WIDGETS_KEY = "ledgerly_home_widgets";
const LAYOUT_KEY = "ledgerly_home_layout";   // "cards" | "compact"

const WIDGETS = {
  today:    { label: "Today", icon: "calendar", tint: "var(--accent)" },
  networth: { label: "Net worth", icon: "wallet", tint: "var(--pos)" },
  money:    { label: "Money this month", icon: "insights", tint: "var(--neg)" },
  portfolio:{ label: "Portfolio", icon: "trending", tint: "var(--accent)" },
  notes:    { label: "Recent notes", icon: "notebook", tint: "var(--gold)" },
  training: { label: "Training", icon: "dumbbell", tint: "var(--neg)" },
  food:     { label: "Fuel today", icon: "utensils", tint: "var(--pos)" },
  habits:   { label: "Habits", icon: "flame", tint: "var(--gold)" },
  focus:    { label: "Focus", icon: "rocket", tint: "var(--accent)" },
  accounts: { label: "Bank accounts", icon: "shield", tint: "var(--accent)" },
};
const DEFAULT = [
  { id: "today", wide: true }, { id: "networth" }, { id: "money" }, { id: "notes", wide: true },
  { id: "portfolio" }, { id: "training" }, { id: "food" }, { id: "habits" }, { id: "focus" }, { id: "accounts" },
];

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Same day keys the phone writes: dYYYYMMDD.
const dayKey = (d = new Date()) => "d" + isoOf(d).replace(/-/g, "");
const gbp = (v) => (v < 0 ? "−" : "") + "£" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

export const HomeModule = {
  el: null,
  customising: false,

  init() {
    this.el = document.getElementById("home-module");
    this.el.classList.remove("card", "card-pad");
    injectStyles();
    this.el.addEventListener("click", (e) => this.onClick(e));
    ["transactions", "notes", "workouts", "holdings", "deadlines", "tasks", "settings"].forEach((c) => Store.subscribe(`${c}:changed`, () => this.render()));
    this.render();
  },

  widgets() {
    try {
      const saved = JSON.parse(localStorage.getItem(WIDGETS_KEY) || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter((w) => WIDGETS[w.id]);
        const missing = Object.keys(WIDGETS).filter((id) => !known.some((w) => w.id === id)).map((id) => ({ id, hidden: true }));
        return [...known, ...missing];
      }
    } catch (e) {}
    return DEFAULT.map((w) => ({ ...w }));
  },
  saveWidgets(list) { try { localStorage.setItem(WIDGETS_KEY, JSON.stringify(list)); } catch (e) {} this.render(); },
  layout() { try { return localStorage.getItem(LAYOUT_KEY) || "cards"; } catch (e) { return "cards"; } },

  onClick(e) {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const { action, id } = b.dataset;
    const list = this.widgets();
    const i = list.findIndex((w) => w.id === id);
    if (action === "customise") { this.customising = !this.customising; return this.render(); }
    if (action === "layout") { try { localStorage.setItem(LAYOUT_KEY, b.dataset.layout); } catch (err) {} return this.render(); }
    if (action === "w-toggle") { list[i].hidden = !list[i].hidden; return this.saveWidgets(list); }
    if (action === "w-wide") { list[i].wide = !list[i].wide; return this.saveWidgets(list); }
    if (action === "w-up" && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; return this.saveWidgets(list); }
    if (action === "w-down" && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; return this.saveWidgets(list); }
    if (action === "w-reset") { try { localStorage.removeItem(WIDGETS_KEY); } catch (err) {} return this.render(); }
    if (action === "go") { window.ledgerlyShowTab?.(b.dataset.tab); }
    if (action === "open-note") { window.ledgerlyShowTab?.("notes-module"); import("./notes.js").then(({ NotesModule }) => { NotesModule.openId = id; NotesModule.render(); }); }
  },

  render() {
    if (!this.el) return;
    const s = Store.state;
    const hour = new Date().getHours();
    const greet = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const name = s.settings?.userName || "";
    const layout = this.layout();
    const list = this.widgets();
    const shown = list.filter((w) => !w.hidden);

    this.el.innerHTML = `
      <div class="hm-head">
        <div>
          <p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 class="hm-title">${greet}${name ? `, <span class="hm-name">${escapeHtml(name)}</span>` : ""}</h1>
        </div>
        <div class="hm-actions">
          <div class="hm-seg">
            <button class="${layout === "cards" ? "on" : ""}" data-action="layout" data-layout="cards">${icon("layout", 14)} Cards</button>
            <button class="${layout === "compact" ? "on" : ""}" data-action="layout" data-layout="compact">${icon("list", 14)} Compact</button>
          </div>
          <button class="btn btn-ghost btn-sm" data-action="customise">${icon("sliders", 14)} ${this.customising ? "Done" : "Customise"}</button>
        </div>
      </div>
      ${this.customising ? this.customiser(list) : ""}
      <div class="hm-grid hm-${layout}">
        ${shown.map((w) => this.widget(w)).join("") || `<p class="faint">All widgets are hidden — press Customise to bring some back.</p>`}
      </div>`;
  },

  customiser(list) {
    return `<div class="card hm-custom">
      <p class="eyebrow" style="margin-bottom:8px">Widgets · saved on this device</p>
      ${list.map((w, i) => `<div class="hm-crow ${w.hidden ? "is-off" : ""}">
        <span class="hm-cic" style="color:${WIDGETS[w.id].tint}">${icon(WIDGETS[w.id].icon, 15)}</span>
        <span class="flex-1">${WIDGETS[w.id].label}</span>
        <button class="btn-icon" data-action="w-up" data-id="${w.id}" ${i === 0 ? "disabled" : ""} title="Move up">${icon("chevronUp", 15)}</button>
        <button class="btn-icon" data-action="w-down" data-id="${w.id}" ${i === list.length - 1 ? "disabled" : ""} title="Move down">${icon("chevronDown", 15)}</button>
        <button class="chip ${w.wide ? "chip-on" : ""}" data-action="w-wide" data-id="${w.id}">Wide</button>
        <button class="chip ${w.hidden ? "" : "chip-on"}" data-action="w-toggle" data-id="${w.id}">${w.hidden ? "Hidden" : "Shown"}</button>
      </div>`).join("")}
      <button class="btn btn-ghost btn-sm" data-action="w-reset" style="margin-top:10px">Reset to default</button>
    </div>`;
  },

  frame(w, inner, tab) {
    const m = WIDGETS[w.id];
    return `<section class="hm-w ${w.wide ? "is-wide" : ""}" style="--tint:${m.tint}">
      <header class="hm-wh">
        <span class="hm-wic">${icon(m.icon, 15)}</span><span>${m.label}</span>
        ${tab ? `<button class="hm-more" data-action="go" data-tab="${tab}" title="Open">${icon("chevronRight2", 15)}</button>` : ""}
      </header>
      ${inner}
    </section>`;
  },

  widget(w) {
    try { return this[`w_${w.id}`](w); } catch (e) { console.warn("Widget failed", w.id, e); return ""; }
  },

  big(v, sub, tone, count) {
    const c = count != null && isFinite(count) ? ` data-count="${count}" data-prefix="${v.replace(/[\d,.].*$/, "")}"` : "";
    return `<p class="hm-big ${tone || ""}"${c}>${v}</p>${sub ? `<p class="hm-sub">${sub}</p>` : ""}`;
  },

  w_today(w) {
    const s = Store.state;
    const today = todayISO();
    const week = isoOf(new Date(Date.now() + 7 * 864e5));
    const dues = (s.deadlines || []).filter((d) => !d.done && d.dueDate && d.dueDate <= week).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
    const tasks = (s.tasks || []).filter((t) => !t.done);
    const label = (iso) => {
      if (iso < today) return `<span class="neg">Overdue</span>`;
      if (iso === today) return `<span style="color:var(--accent)">Today</span>`;
      const d = new Date(iso + "T12:00");
      return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    };
    const inner = `
      <div class="hm-split">
        <div>${this.big(String(dues.length), dues.length === 1 ? "deadline this week" : "deadlines this week")}</div>
        <div>${this.big(String(tasks.length), tasks.length === 1 ? "open task" : "open tasks")}</div>
      </div>
      ${dues.length ? `<ul class="hm-list">${dues.map((d) => `<li><span class="hm-dot"></span><span class="flex-1 truncate">${escapeHtml(d.title)}</span><span class="hm-when">${label(d.dueDate)}</span></li>`).join("")}</ul>`
        : `<p class="hm-sub" style="margin-top:8px">Nothing due in the next 7 days.</p>`}`;
    return this.frame(w, inner, "calendar-module");
  },

  accountsTotals() {
    const txs = Store.state.transactions || [];
    let banks = 0, cards = 0, any = false;
    for (const a of Store.state.accounts || []) {
      const last = [...(a.balances || [])].sort((x, y) => (x.date + (x.at || "")).localeCompare(y.date + (y.at || ""))).pop();
      if (!last) continue;
      any = true;
      // Estimated: last confirmed balance, adjusted by spending tagged to this account since.
      let v = last.amount;
      for (const t of txs) {
        if (t.account !== a.id || !(t.date > last.date)) continue;
        const delta = (t.type === "income" ? 1 : -1) * t.amount;   // money in raises a bank balance…
        v += a.kind === "credit" ? -delta : delta;                  // …and lowers what's owed on a card
      }
      if (a.kind === "credit") cards += v; else banks += v;
    }
    return any ? { banks, cards } : null;
  },

  portfolioGBP() {
    const P = PortfolioModule;
    let total = 0;
    for (const h of Store.state.holdings || []) {
      const v = P.conv?.(h.shares * h.currentPrice, h.currency);
      if (v == null) return null;
      total += v;
    }
    const c = Store.state.settings?.t212Cash;
    if (c?.amount) { const v = P.conv?.(c.amount, c.currency); if (v != null) total += v; }
    return total;
  },

  w_networth(w) {
    const acc = this.accountsTotals();
    const inv = this.portfolioGBP();
    const sym = PortfolioModule.cur?.() || "£";
    if (!acc && inv == null) return this.frame(w, `<p class="hm-sub">Add bank balances on the phone app to see this.</p>`);
    const net = (acc ? acc.banks - acc.cards : 0) + (sym === "£" ? (inv || 0) : 0);
    const inner = `${this.big(gbp(net), "", "", net)}
      <div class="hm-rows">
        ${acc ? `<p><span>Banks</span><b>${gbp(acc.banks)}</b></p><p><span>Cards owed</span><b class="${acc.cards > 0 ? "neg" : ""}">${gbp(-acc.cards)}</b></p>` : ""}
        ${inv != null && sym === "£" ? `<p><span>Investments</span><b>${gbp(inv)}</b></p>` : ""}
      </div>`;
    return this.frame(w, inner);
  },

  w_money(w) {
    const month = todayISO().slice(0, 7);
    const txs = (Store.state.transactions || []).filter((t) => (t.date || "").startsWith(month));
    const inc = txs.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const out = txs.filter((t) => t.type !== "income").reduce((a, t) => a + t.amount, 0);
    const cats = {};
    for (const t of txs) if (t.type !== "income") cats[t.category || "Other"] = (cats[t.category || "Other"] || 0) + t.amount;
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const max = top[0]?.[1] || 1;
    const inner = `${this.big((inc - out >= 0 ? "+" : "") + gbp(inc - out), `in ${gbp(inc)} · out ${gbp(out)}`, inc - out >= 0 ? "pos" : "neg", inc - out)}
      ${top.length ? `<div class="hm-bars">${top.map(([c, v]) => `<div><span>${escapeHtml(c)}</span><i style="width:${Math.max(6, (v / max) * 100)}%"></i><b>${gbp(v)}</b></div>`).join("")}</div>` : ""}`;
    return this.frame(w, inner, "ledger-module");
  },

  w_portfolio(w) {
    const hs = Store.state.holdings || [];
    if (!hs.length) return this.frame(w, `<p class="hm-sub">No holdings yet.</p>`, "portfolio-module");
    const P = PortfolioModule;
    let cost = 0, value = 0;
    for (const h of hs) {
      const c = P.conv?.(h.shares * h.buyPrice, h.currency), v = P.conv?.(h.shares * h.currentPrice, h.currency);
      if (c == null || v == null) return this.frame(w, `<p class="hm-sub">Loading prices…</p>`, "portfolio-module");
      cost += c; value += v;
    }
    const gain = value - cost, pct = cost > 0 ? (gain / cost) * 100 : 0;
    const top = [...hs].sort((a, b) => (P.conv(b.shares * b.currentPrice, b.currency) || 0) - (P.conv(a.shares * a.currentPrice, a.currency) || 0)).slice(0, 3);
    const inner = `${this.big(P.fmt(value), `${gain >= 0 ? "+" : "−"}${P.fmt(Math.abs(gain))} · ${gain >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}% all time`, gain >= 0 ? "" : "")}
      <div class="hm-rows">${top.map((h) => {
        const g = h.buyPrice > 0 ? (h.currentPrice / h.buyPrice - 1) * 100 : 0;
        return `<p><span class="ticker">${escapeHtml(h.ticker)}</span><b class="${g >= 0 ? "pos" : "neg"}">${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)}%</b></p>`;
      }).join("")}</div>`;
    return this.frame(w, inner, "portfolio-module");
  },

  w_notes(w) {
    const notes = [...(Store.state.notes || [])].sort((a, b) => ((b.pinned === true) - (a.pinned === true)) || (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")).slice(0, w.wide ? 4 : 3);
    const inner = notes.length ? `<div class="hm-notes">${notes.map((n) => `<button class="hm-note" data-action="open-note" data-id="${n.id}">
        <strong>${n.pinned ? icon("pin", 11) + " " : ""}${escapeHtml(noteTitle(n))}</strong>
        <span>${escapeHtml((n.summary || (n.cleaned ?? n.text) || "").replace(/[#*>\[\]`-]/g, "").slice(0, 110))}</span></button>`).join("")}</div>`
      : `<p class="hm-sub">No notes yet.</p>`;
    return this.frame(w, inner, "notes-module");
  },

  w_training(w) {
    const ws = [...(Store.state.workouts || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const weekAgo = isoOf(new Date(Date.now() - 6 * 864e5));
    const thisWeek = ws.filter((x) => x.date >= weekAgo).length;
    const last = ws[0];
    const sets = last ? (last.exercises || []).reduce((a, e) => a + (e.sets?.length || 0), 0) : 0;
    const days = last ? Math.round((new Date(todayISO()) - new Date(last.date)) / 864e5) : null;
    const inner = `${this.big(String(thisWeek), thisWeek === 1 ? "session in the last 7 days" : "sessions in the last 7 days")}
      ${last ? `<div class="hm-rows"><p><span>Last</span><b>${escapeHtml(last.label || "Workout")}</b></p><p><span>When</span><b>${days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`}</b></p><p><span>Sets</span><b>${sets}</b></p></div>` : `<p class="hm-sub">No sessions logged yet.</p>`}`;
    return this.frame(w, inner, "gym-module");
  },

  w_food(w) {
    const n = Store.state.nutrition || {};
    const day = n.days?.[dayKey()] || [];
    const kcal = day.reduce((a, f) => a + (f.kcal || 0), 0), protein = day.reduce((a, f) => a + (f.protein || 0), 0);
    const p = n.profile;
    let tk = null, tp = null;
    if (p) {
      const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "female" ? -161 : 5);
      tk = Math.round(p.kcalOverride || bmr * (p.activity || 1.55) - (p.deficit ?? 500));
      tp = Math.round((p.proteinPerKg || 2) * p.weightKg);
    }
    const ring = (v, t, label, color) => {
      const f = t ? Math.min(1, v / t) : 0, C = 2 * Math.PI * 26;
      return `<div class="hm-ring"><svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--sunken)" stroke-width="7"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C * f} ${C}" transform="rotate(-90 32 32)"/></svg>
        <div><b class="num">${Math.round(v)}</b><span>${t ? `/ ${t}` : ""} ${label}</span></div></div>`;
    };
    const inner = `<div class="hm-rings">${ring(kcal, tk, "kcal", "var(--accent)")}${ring(protein, tp, "g protein", "var(--pos)")}</div>
      <p class="hm-sub">${day.length} item${day.length === 1 ? "" : "s"} logged today</p>`;
    return this.frame(w, inner);
  },

  w_habits(w) {
    const s = Store.state;
    const defs = s.habits?.length ? s.habits : [];
    const log = s.habitLog || {};
    const today = log[dayKey()] || {};
    // Streak: consecutive days (ending yesterday or today) with at least one habit done.
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.now() - i * 864e5);
      const done = Object.values(log[dayKey(d)] || {}).some((v) => v > 0);
      if (done) streak++; else if (i > 0) break;
    }
    const doneToday = Object.values(today).filter((v) => v > 0).length;
    const inner = `${this.big(`${streak}`, `day streak · ${doneToday}${defs.length ? `/${defs.length}` : ""} done today`)}
      ${defs.length ? `<div class="hm-chips">${defs.slice(0, 6).map((h) => `<span class="${(today[h.id] || 0) > 0 ? "on" : ""}">${escapeHtml(h.name || h.title || h.id)}</span>`).join("")}</div>` : ""}`;
    return this.frame(w, inner);
  },

  w_focus(w) {
    const log = Store.state.focusLog || {};
    const today = Math.round(log[dayKey()] || 0);
    let week = 0;
    for (let i = 0; i < 7; i++) week += log[dayKey(new Date(Date.now() - i * 864e5))] || 0;
    const missions = Store.state.space?.missions || [];
    const inner = `${this.big(`${today}m`, `focused today · ${Math.round(week / 60 * 10) / 10}h this week`)}
      ${missions.length ? `<p class="hm-sub">${icon("rocket", 12)} ${missions.filter((m) => m.ok).length} missions flown</p>` : `<p class="hm-sub">Start a focus mission from the phone app.</p>`}`;
    return this.frame(w, inner);
  },

  w_accounts(w) {
    const accs = Store.state.accounts || [];
    if (!accs.length) return this.frame(w, `<p class="hm-sub">No accounts set up yet.</p>`);
    const inner = `<div class="hm-rows">${accs.map((a) => {
      const last = [...(a.balances || [])].sort((x, y) => x.date.localeCompare(y.date)).pop();
      return `<p><span>${escapeHtml(a.name)}${a.last4 ? ` ·${escapeHtml(a.last4)}` : ""}</span><b class="${a.kind === "credit" && last?.amount > 0 ? "neg" : ""}">${last ? gbp(a.kind === "credit" ? -last.amount : last.amount) : "—"}</b></p>`;
    }).join("")}</div>`;
    return this.frame(w, inner);
  },
};

function injectStyles() {
  if (document.getElementById("hm-css")) return;
  const s = document.createElement("style");
  s.id = "hm-css";
  s.textContent = `
.hm-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin:6px 2px 18px}
.hm-title{font:800 clamp(28px,4vw,40px)/1.08 Manrope,system-ui;letter-spacing:-.035em;margin-top:4px}
.hm-name{background:linear-gradient(90deg,var(--accent),var(--pos));-webkit-background-clip:text;background-clip:text;color:transparent}
.hm-actions{display:flex;gap:8px;align-items:center}
.hm-seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--surface);border:1px solid var(--border);backdrop-filter:blur(20px)}
.hm-seg button{display:inline-flex;gap:5px;align-items:center;padding:6px 11px;border-radius:9px;font-size:12.5px;font-weight:700;color:var(--ink-muted)}
.hm-seg button.on{background:var(--accent);color:var(--accent-ink)}
.hm-custom{padding:16px 18px;margin-bottom:16px}
.hm-crow{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border);font-size:13.5px;font-weight:600}
.hm-crow:first-of-type{border-top:0}
.hm-crow.is-off{opacity:.55}
.hm-cic{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--sunken)}
.hm-grid{display:grid;gap:14px;grid-template-columns:1fr}
@media (min-width:700px){.hm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hm-w.is-wide{grid-column:span 2}}
@media (min-width:1200px){.hm-grid.hm-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
.hm-w{position:relative;overflow:hidden;padding:18px 18px 16px;border-radius:24px;background:var(--surface);border:1px solid var(--border);box-shadow:inset 0 1px 0 var(--edge),var(--shadow-md);backdrop-filter:blur(24px) saturate(1.35);animation:fade .45s ease backwards}
.hm-w::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(420px 220px at 0% 0%,color-mix(in srgb,var(--tint) 22%,transparent),transparent 70%)}
.hm-w>*{position:relative}
.hm-wh{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink-muted);margin-bottom:10px}
.hm-wic{display:grid;place-items:center;width:26px;height:26px;border-radius:9px;color:var(--tint);background:color-mix(in srgb,var(--tint) 16%,transparent)}
.hm-more{margin-left:auto;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;color:var(--ink-faint)}
.hm-more:hover{background:var(--sunken);color:var(--ink)}
.hm-big{font:800 34px/1.05 Manrope,system-ui;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.hm-sub{font-size:13px;color:var(--ink-muted);margin-top:4px}
.hm-split{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.hm-list{margin-top:12px;display:grid;gap:2px}
.hm-list li{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border);font-size:14px;font-weight:600}
.hm-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
.hm-when{font-size:12.5px;font-weight:700;color:var(--ink-muted)}
.hm-rows{margin-top:10px;display:grid;gap:6px}
.hm-rows p{display:flex;justify-content:space-between;gap:10px;font-size:13.5px}
.hm-rows span{color:var(--ink-muted)}
.hm-rows b{font-weight:700;font-variant-numeric:tabular-nums}
.hm-bars{margin-top:12px;display:grid;gap:7px}
.hm-bars div{display:grid;grid-template-columns:90px 1fr 60px;align-items:center;gap:8px;font-size:12.5px}
.hm-bars span{color:var(--ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-bars i{height:7px;border-radius:99px;background:var(--neg)}
.hm-bars b{text-align:right;font-variant-numeric:tabular-nums}
.hm-notes{display:grid;gap:8px;grid-template-columns:1fr}
.hm-w.is-wide .hm-notes{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.hm-note{display:flex;flex-direction:column;gap:3px;text-align:left;padding:11px 12px;border-radius:14px;background:var(--sunken);border:1px solid var(--border);transition:.15s}
.hm-note:hover{border-color:var(--accent)}
.hm-note strong{font-size:14px;display:flex;gap:4px;align-items:center}
.hm-note span{font-size:12.5px;color:var(--ink-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hm-rings{display:flex;gap:18px;flex-wrap:wrap}
.hm-ring{display:flex;align-items:center;gap:10px}
.hm-ring b{display:block;font:800 20px/1 Manrope,system-ui}
.hm-ring span{font-size:12px;color:var(--ink-muted)}
.hm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.hm-chips span{padding:4px 10px;border-radius:99px;font-size:12px;font-weight:700;background:var(--sunken);color:var(--ink-muted)}
.hm-chips span.on{background:var(--pos-soft);color:var(--pos)}
.hm-compact{gap:10px}
.hm-compact .hm-w{padding:13px 15px;border-radius:18px}
.hm-compact .hm-big{font-size:24px}
.hm-compact .hm-wh{margin-bottom:6px}
.hm-compact .hm-rows,.hm-compact .hm-list,.hm-compact .hm-bars{margin-top:6px}
@media (min-width:1200px){.hm-grid.hm-compact{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
  document.head.appendChild(s);
}
