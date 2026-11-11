// fitplus.js — Fitness extras shared with the phone: the weekly plan (gym.plan), a plate calculator,
// and AI meal plans (nutrition.plan) with one-click logging and a shopping list for Notes.

import { Store, escapeHtml, todayISO } from "./store.js";
import { icon } from "./icons.js";
import { api } from "./marketdata.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const PLATE_COL = { 25: "#e5484d", 20: "#2f7bff", 15: "#f5c400", 10: "#2fbf71", 5: "#e8e8e8", 2.5: "#9aa0a6", 1.25: "#9aa0a6" };
const BARS = [["Olympic bar", 20], ["Women's bar", 15], ["EZ bar", 10], ["Smith machine", 15], ["Plate-loaded machine", 0]];
// Same starter routines the phone ships with, used when none have been saved yet.
const DEFAULT_ROUTINES = [
  { id: "chest-tris", name: "Chest & Tris" }, { id: "back-bis", name: "Back & Bis" },
  { id: "shoulders", name: "Shoulders" }, { id: "knee-physio", name: "Knee physio" },
];
const dayKey = () => "d" + todayISO().replace(/-/g, "");

export const FitExtras = {
  tab: "plan",
  target: Number(localStorage.getItem("ledgerly_plate_target") || 60),
  bar: Number(localStorage.getItem("ledgerly_plate_bar") || 20),
  mealDay: 0,
  working: false,
  msg: "",

  mount(parent) {
    injectStyles();
    let box = parent.querySelector("#fx-root");
    if (!box) {
      box = document.createElement("div");
      box.id = "fx-root";
      box.addEventListener("click", (e) => this.onClick(e));
      box.addEventListener("change", (e) => this.onChange(e));
    }
    parent.appendChild(box);
    this.box = box;
    this.render();
  },

  get routines() { return Store.state.gym?.routines?.length ? Store.state.gym.routines : DEFAULT_ROUTINES; },
  get plan() { return Store.state.gym?.plan || { days: {} }; },

  onClick(e) {
    const b = e.target.closest("[data-fx]");
    if (!b) return;
    const a = b.dataset.fx;
    if (a === "tab") { this.tab = b.dataset.tab; return this.render(); }
    if (a === "plate") { this.target = Math.max(this.bar, this.target + Number(b.dataset.d)); localStorage.setItem("ledgerly_plate_target", this.target); return this.render(); }
    if (a === "day") { this.mealDay = Number(b.dataset.i); return this.render(); }
    if (a === "log") return this.logMeal(Number(b.dataset.i));
    if (a === "shop") return this.shoppingToNotes();
    if (a === "gen") return this.generate();
  },

  onChange(e) {
    const t = e.target;
    if (t.dataset.fxday) {
      const days = { ...(this.plan.days || {}) };
      if (t.value) days[t.dataset.fxday] = t.value; else delete days[t.dataset.fxday];
      Store.setPath(["gym", "plan"], { ...this.plan, days });
      return this.render();
    }
    if (t.id === "fx-bar") { this.bar = Number(t.value); localStorage.setItem("ledgerly_plate_bar", this.bar); return this.render(); }
    if (t.id === "fx-target") { this.target = Number(t.value) || this.bar; localStorage.setItem("ledgerly_plate_target", this.target); return this.render(); }
  },

  render() {
    if (!this.box) return;
    const t = (id, label, ic) => `<button data-fx="tab" data-tab="${id}" class="${this.tab === id ? "on" : ""}">${icon(ic, 14)} ${label}</button>`;
    this.box.innerHTML = `<div class="ix-tabs fx-tabs">${t("plan", "Weekly plan", "calendar")}${t("plates", "Plates", "dumbbell")}${t("meals", "Meal plan", "utensils")}</div>
      <div class="fx-panel">${this.tab === "plates" ? this.platesHTML() : this.tab === "meals" ? this.mealsHTML() : this.planHTML()}</div>`;
  },

  planHTML() {
    const today = ((new Date().getDay() + 6) % 7) + 1;
    const opts = (sel) => `<option value="">Rest</option>` + this.routines.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("");
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - (today - 1)); weekStart.setHours(0, 0, 0, 0);
    const done = new Set((Store.state.workouts || []).filter((w) => new Date(w.date + "T12:00") >= weekStart).map((w) => ((new Date(w.date + "T12:00").getDay() + 6) % 7) + 1));
    return `<div class="fx-week">${DAYS.map((d, i) => {
      const k = String(i + 1), sel = this.plan.days?.[k];
      return `<label class="fx-day ${i + 1 === today ? "is-today" : ""} ${sel ? "" : "is-rest"}">
        <span>${d.slice(0, 3)}${done.has(i + 1) && sel ? ` ${icon("check", 12)}` : ""}</span>
        <select data-fxday="${k}" class="input">${opts(sel)}</select></label>`;
    }).join("")}</div>
    <p class="text-[12px] faint mt-3">Syncs with the phone, where "Up next" follows this plan. Programs (PPL, Upper/Lower…) are in the phone app's Gym → Weekly plan.</p>`;
  },

  platesHTML() {
    let rem = Math.max(0, (this.target - this.bar) / 2);
    const side = [];
    for (const p of PLATES) while (rem + 1e-4 >= p) { side.push(p); rem -= p; }
    const left = Math.round(rem * 2 * 100) / 100;
    const plate = (p) => `<i style="height:${30 + Math.min(p, 25) * 2.6}px;width:${p >= 10 ? 14 : 10}px;background:${PLATE_COL[p]}"></i>`;
    return `<div class="fx-plates">
      <div class="fx-target"><input id="fx-target" type="number" step="0.5" value="${this.target}" class="num" /><span>kg</span></div>
      <div class="flex gap-2 justify-center">${[-5, -2.5, 2.5, 5].map((d) => `<button class="chip" data-fx="plate" data-d="${d}">${d > 0 ? "+" : "−"}${Math.abs(d)}</button>`).join("")}</div>
      <div class="fx-bar">${[...side].reverse().map(plate).join("")}<b></b>${side.map(plate).join("")}</div>
      <p class="font-bold">${side.length ? "Each side: " + side.join(" + ") + " kg" : this.bar ? "Just the bar" : "No plates"}</p>
      ${left > 0 ? `<p class="text-[12.5px]" style="color:var(--gold)">${left} kg can't be made — closest is ${this.target - left} kg.</p>` : ""}
      <select id="fx-bar" class="input" style="max-width:260px">${BARS.map(([n, w]) => `<option value="${w}" ${w === this.bar ? "selected" : ""}>${n} · ${w} kg</option>`).join("")}</select>
    </div>`;
  },

  targets() {
    const n = Store.state.nutrition || {}, p = n.profile;
    if (!p) return null;
    const w = [...(n.weighIns || [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.kg ?? p.weightKg;
    const bmr = 10 * w + 6.25 * p.heightCm - 5 * p.age + (p.sex === "female" ? -161 : 5);
    return { kcal: Math.round(p.kcalOverride || bmr * (p.activity || 1.55) - (p.deficit ?? 500)), protein: Math.round((p.proteinPerKg || 2) * w) };
  },

  mealsHTML() {
    const plan = Store.state.nutrition?.plan, t = this.targets();
    const head = `<div class="fx-mhead"><div><p class="eyebrow">Daily target</p><b>${t ? `${t.kcal} kcal · ${t.protein} g protein` : "Set your food profile on the phone first"}</b></div>
      <button class="btn btn-primary btn-sm" data-fx="gen" ${this.working || !t ? "disabled" : ""}>${this.working ? "Planning…" : plan ? "New 5-day plan" : "Plan my meals"}</button></div>
      ${this.msg ? `<p class="text-[12.5px] mt-2 ${this.msg.startsWith("✓") ? "pos" : "neg"}">${escapeHtml(this.msg)}</p>` : ""}`;
    if (!plan?.days?.length) return head + `<p class="faint mt-3 text-[13.5px]">AI plans that hit your cut's calories and protein, with a shopping list.</p>`;
    const d = plan.days[Math.min(this.mealDay, plan.days.length - 1)];
    const k = d.meals.reduce((a, m) => a + m.kcal, 0), pr = d.meals.reduce((a, m) => a + m.protein, 0);
    return head + `
      <div class="fx-daytabs">${plan.days.map((x, i) => `<button data-fx="day" data-i="${i}" class="${i === this.mealDay ? "on" : ""}">${escapeHtml(x.day.slice(0, 3))}</button>`).join("")}</div>
      <p class="faint text-[13px] mb-2">${escapeHtml(d.day)}: ${Math.round(k)} kcal · ${Math.round(pr)} g protein</p>
      <div class="fx-meals">${d.meals.map((m, i) => `<div class="fx-meal">
        <div class="flex justify-between"><small>${escapeHtml(m.slot)}</small><small class="num">${Math.round(m.kcal)} kcal · ${Math.round(m.protein)}P ${Math.round(m.carbs)}C ${Math.round(m.fat)}F</small></div>
        <b>${escapeHtml(m.name)}</b><p>${escapeHtml(m.ingredients.join(", "))}</p>
        <button class="btn btn-ghost btn-sm" data-fx="log" data-i="${i}">${icon("plus", 13)} Log it today</button></div>`).join("")}</div>
      <div class="fx-shop"><p class="eyebrow mb-2">Shopping list</p>${plan.shopping.map((a) => `<p><b>${escapeHtml(a.aisle)}</b> <span class="faint">${escapeHtml(a.items.join(" · "))}</span></p>`).join("")}
        <button class="btn btn-ghost btn-sm mt-2" data-fx="shop">${icon("checkSquare", 14)} Save as a checklist in Notes</button></div>`;
  },

  logMeal(i) {
    const plan = Store.state.nutrition?.plan;
    const m = plan?.days?.[this.mealDay]?.meals?.[i];
    if (!m) return;
    const day = [...(Store.state.nutrition?.days?.[dayKey()] || [])];
    day.push({ id: crypto.randomUUID(), name: m.name, portion: "1 meal (plan)", kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, source: "plan" });
    Store.setPath(["nutrition", "days", dayKey()], day);
    this.msg = `✓ Logged ${m.name} to today.`;
    this.render();
  },

  shoppingToNotes() {
    const plan = Store.state.nutrition?.plan;
    if (!plan) return;
    const text = plan.shopping.map((a) => `## ${a.aisle}\n` + a.items.map((x) => `- [ ] ${x}`).join("\n")).join("\n\n");
    Store.add("notes", { id: Store.uid("nt"), text, title: "Shopping list · " + new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" }), folder: "Food", createdAt: new Date().toISOString(), promoted: false });
    this.msg = "✓ Saved to Notes → Food.";
    this.render();
  },

  async generate() {
    const t = this.targets();
    if (!t || this.working) return;
    this.working = true; this.msg = ""; this.render();
    try {
      const plan = await api("/ai", { task: "food.plan", input: { days: 5, startDay: new Date().toLocaleDateString(undefined, { weekday: "long" }), kcal: t.kcal, protein: t.protein, preferences: localStorage.getItem("ledgerly_meal_prefs") || "" } });
      Store.setPath(["nutrition", "plan"], { ...plan, createdAt: new Date().toISOString(), kcal: t.kcal, protein: t.protein });
      this.mealDay = 0;
    } catch (err) { this.msg = err.message; }
    this.working = false;
    this.render();
  },
};

function injectStyles() {
  if (document.getElementById("fx-css")) return;
  const s = document.createElement("style");
  s.id = "fx-css";
  s.textContent = `
#fx-root{margin-top:22px;padding-top:18px;border-top:1px solid var(--border)}
.fx-tabs{margin-bottom:14px}
.fx-panel{animation:fade .35s ease}
.fx-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
@media(max-width:800px){.fx-week{grid-template-columns:repeat(2,1fr)}}
.fx-day{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:16px;background:var(--sunken);border:1px solid var(--border);transition:.2s}
.fx-day span{font-size:12px;font-weight:800;color:var(--ink-muted);display:flex;gap:4px;align-items:center}
.fx-day.is-today{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.fx-day.is-today span{color:var(--accent)}
.fx-day.is-rest{opacity:.7}
.fx-day select{padding:6px 26px 6px 8px;font-size:12.5px}
.fx-plates{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
.fx-target{display:flex;align-items:baseline;gap:6px}
.fx-target input{width:150px;text-align:center;background:transparent;border:0;outline:0;color:var(--ink);font:800 48px/1 Manrope,system-ui}
.fx-target span{font-size:18px;font-weight:700;color:var(--ink-muted)}
.fx-bar{display:flex;align-items:center;gap:2px;height:100px}
.fx-bar b{width:110px;height:8px;border-radius:4px;background:var(--ink-faint)}
.fx-bar i{border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.2);animation:rise .4s cubic-bezier(.22,1,.36,1) backwards}
.fx-mhead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.fx-mhead b{font-size:15px}
.fx-daytabs{display:flex;gap:6px;margin:14px 0 8px}
.fx-daytabs button{padding:6px 12px;border-radius:10px;font-size:13px;font-weight:700;background:var(--sunken);color:var(--ink-muted)}
.fx-daytabs button.on{background:var(--accent);color:var(--accent-ink)}
.fx-meals{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.fx-meal{display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:18px;background:var(--sunken);border:1px solid var(--border);animation:rise .45s cubic-bezier(.22,1,.36,1) backwards}
.fx-meal small{font-size:11.5px;font-weight:700;color:var(--ink-faint);text-transform:capitalize}
.fx-meal b{font-size:15px}.fx-meal p{font-size:12.5px;color:var(--ink-muted)}
.fx-meal .btn{align-self:flex-start;margin-top:auto}
.fx-shop{margin-top:14px;padding:14px;border-radius:18px;background:var(--sunken);font-size:13.5px;line-height:1.7}
`;
  document.head.appendChild(s);
}
