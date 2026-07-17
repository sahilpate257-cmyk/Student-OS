// store.js — single source of truth: state, persistence, pub/sub, Firebase (modular SDK)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const KEY = "student_os_v1";

const firebaseConfig = {
  apiKey: "AIzaSyDSUuW6EdJ21CbECrvYbwM-ZmOWFLvkPVo",
  authDomain: "student-os-bae97.firebaseapp.com",
  projectId: "student-os-bae97",
  storageBucket: "student-os-bae97.firebasestorage.app",
  messagingSenderId: "756152469935",
  appId: "1:756152469935:web:83fdfba604eb3bc43a875a",
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

function defaultState() {
  return {
    version: 1,
    settings: { userName: "Sahil", currency: "£", currentEnergy: "high" },
    deadlines: [],
    tasks: [],
    transactions: [],
    notes: [],
    workouts: [],
    holdings: [],
  };
}

export const Store = {
  state: defaultState(),
  _listeners: {},
  isFirstRun: false,
  _uid: null,

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
    this.pushToCloud();
  },

  pushToCloud() {
    if (!this._uid) return;
    setDoc(
      doc(db, "users", this._uid),
      { ...this.state, updatedAt: serverTimestamp() },
      { merge: true }
    ).catch((e) => console.warn("Cloud sync failed", e));
  },

  // Applied when a Firestore snapshot arrives (this device's own write or another device's).
  // Deliberately does not call save()/pushToCloud() to avoid a write feedback loop.
  applyRemote(remoteState) {
    const { updatedAt, ...rest } = remoteState;
    this.state = { ...defaultState(), ...rest };
    localStorage.setItem(KEY, JSON.stringify(this.state));
    ["deadlines", "tasks", "transactions", "notes", "workouts", "holdings"].forEach((c) => this.emit(`${c}:changed`));
    this.emit("settings:changed");
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
  uni: { label: "Uni", dot: "#46688C", tag: "tag tag-uni" },
  hustle: { label: "Hustle", dot: "#7C8A4A", tag: "tag tag-hustle" },
};
