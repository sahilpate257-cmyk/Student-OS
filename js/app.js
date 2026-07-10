// app.js — bootstrap: load store, seed first run, init all modules

import { Store, todayISO } from "./store.js";
import { CalendarModule } from "./calendar.js";
import { EnergyRanker } from "./energy.js";
import { LedgerModule } from "./ledger.js";
import { BrainDump } from "./notes.js";
import { GymModule } from "./gym.js";

function seedDemoData() {
  const t = new Date();
  const iso = (offsetDays) => {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  Store.state.deadlines = [
    { id: Store.uid("dl"), title: "CS201 Assignment 3", source: "uni", dueDate: iso(8), done: false, notes: "" },
    { id: Store.uid("dl"), title: "Logo delivery — Café Verde", source: "hustle", dueDate: iso(4), done: false, notes: "" },
    { id: Store.uid("dl"), title: "Stats quiz", source: "uni", dueDate: iso(2), done: false, notes: "" },
  ];
  Store.state.tasks = [
    { id: Store.uid("tk"), title: "Draft essay outline", energy: "high", done: false, linkedDeadlineId: Store.state.deadlines[0].id, createdAt: new Date().toISOString() },
    { id: Store.uid("tk"), title: "Reply to client emails", energy: "medium", done: false, linkedDeadlineId: null, createdAt: new Date().toISOString() },
    { id: Store.uid("tk"), title: "Organize desktop files", energy: "low", done: false, linkedDeadlineId: null, createdAt: new Date().toISOString() },
  ];
  Store.state.transactions = [
    { id: Store.uid("tx"), type: "income", amount: 250, category: "Design work", description: "Café Verde deposit", date: iso(-2) },
    { id: Store.uid("tx"), type: "expense", amount: 12.99, category: "Software", description: "Figma monthly", date: iso(-6) },
  ];
  Store.state.notes = [
    { id: Store.uid("nt"), text: "Idea: sell Notion templates for exam revision", tag: "hustle", createdAt: new Date().toISOString(), promoted: false },
  ];
  Store.state.workouts = [
    { id: Store.uid("wo"), date: iso(-4), label: "Push Day", exercises: [
      { name: "Bench Press", sets: [{ reps: 10, weight: 60 }, { reps: 8, weight: 65 }, { reps: 6, weight: 70 }] },
      { name: "Overhead Press", sets: [{ reps: 10, weight: 30 }] },
    ]},
    { id: Store.uid("wo"), date: iso(-1), label: "Push Day", exercises: [
      { name: "Bench Press", sets: [{ reps: 10, weight: 62.5 }, { reps: 8, weight: 67.5 }, { reps: 5, weight: 72.5 }] },
    ]},
  ];
  Store.save();
}

Store.load();
if (Store.isFirstRun) seedDemoData();

document.getElementById("header-date").textContent =
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

[CalendarModule, EnergyRanker, LedgerModule, BrainDump, GymModule].forEach((m) => m.init());

// header quick-add jumps straight to brain dump input
document.getElementById("quick-add").addEventListener("click", () => {
  document.getElementById("notes-module").scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => document.getElementById("note-input")?.focus(), 350);
});

// mobile bottom nav
document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.dataset.nav)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
