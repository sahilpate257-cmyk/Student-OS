// app.js — bootstrap: auth gate, load store, seed first run, init all modules

import { Store, auth, db, todayISO } from "./store.js";
import { CalendarModule } from "./calendar.js";
import { EnergyRanker } from "./energy.js";
import { LedgerModule } from "./ledger.js";
import { BrainDump } from "./notes.js";
import { GymModule } from "./gym.js";
import { PortfolioModule } from "./portfolio.js";

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

function bootstrapApp() {
  document.getElementById("header-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  [CalendarModule, EnergyRanker, LedgerModule, BrainDump, GymModule, PortfolioModule].forEach((m) => m.init());

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
}

const AuthGate = {
  started: false,

  init() {
    const shell = document.getElementById("app-shell");
    const overlay = document.getElementById("auth-overlay");
    const authForm = document.getElementById("auth-form");
    const errorEl = document.getElementById("auth-error");
    const statusEl = document.getElementById("auth-status");
    const signOutBtn = document.getElementById("sign-out");

    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");
      const mode = e.submitter?.dataset.mode || "login";
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      statusEl.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
      try {
        if (mode === "signup") {
          await auth.createUserWithEmailAndPassword(email, password);
        } else {
          await auth.signInWithEmailAndPassword(email, password);
        }
      } catch (err) {
        statusEl.textContent = "";
        errorEl.textContent = err.message;
        errorEl.classList.remove("hidden");
      }
    });

    signOutBtn.addEventListener("click", () => auth.signOut());

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        this.started = false;
        Store._uid = null;
        overlay.classList.remove("hidden");
        shell.classList.add("hidden");
        return;
      }
      overlay.classList.add("hidden");
      shell.classList.remove("hidden");
      if (this.started) return; // avoid double-init on token refresh
      this.started = true;
      await this.bootstrap(user.uid);
    });
  },

  async bootstrap(uid) {
    Store._uid = uid;
    const docRef = db.collection("users").doc(uid);

    try {
      const snap = await docRef.get();
      if (snap.exists) {
        Store.applyRemote(snap.data());
      } else {
        Store.load();
        if (Store.isFirstRun) seedDemoData();
        else Store.pushToCloud();
      }
    } catch (e) {
      console.warn("Could not reach cloud, using local data", e);
      Store.load();
      if (Store.isFirstRun) seedDemoData();
    }

    // real-time sync: pick up changes made from any other signed-in device
    docRef.onSnapshot((snap) => {
      if (snap.exists) Store.applyRemote(snap.data());
    });

    bootstrapApp();
  },
};

AuthGate.init();
