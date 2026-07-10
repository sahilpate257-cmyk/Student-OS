// store.js — single source of truth: state, persistence, pub/sub

const KEY = "student_os_v1";

function defaultState() {
  return {
    version: 1,
    settings: { userName: "Sahil", currency: "$", currentEnergy: "high" },
    deadlines: [],
    tasks: [],
    transactions: [],
    notes: [],
    workouts: [],
  };
}

export const Store = {
  state: defaultState(),
  _listeners: {},
  isFirstRun: false,

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        this.state = { ...defaultState(), ...JSON.parse(raw) };
      } else {
        this.isFirstRun = true;
      }
    } catch (e) {
      console.warn("Store: could not load saved state, starting fresh", e);
    }
  },

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.state));
  },

  subscribe(event, fn) {
    (this._listeners[event] ??= []).push(fn);
  },

  emit(event) {
    (this._listeners[event] ?? []).forEach((fn) => fn());
  },

  uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  },

  add(collection, item) {
    this.state[collection].push(item);
    this.save();
    this.emit(`${collection}:changed`);
    return item;
  },

  update(collection, id, patch) {
    const item = this.state[collection].find((i) => i.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.save();
    this.emit(`${collection}:changed`);
  },

  remove(collection, id) {
    this.state[collection] = this.state[collection].filter((i) => i.id !== id);
    this.save();
    this.emit(`${collection}:changed`);
  },

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.save();
    this.emit("settings:changed");
  },
};

// ---- shared helpers ----

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const SOURCE = {
  uni: { label: "Uni", dot: "bg-blue-400", badge: "bg-blue-500/15 text-blue-300 border border-blue-500/30" },
  hustle: { label: "Hustle", dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
};
