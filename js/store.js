// store.js — single source of truth: state, persistence, pub/sub, Firebase (modular SDK)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp, runTransaction,
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
// Keep the session on this device until the user deliberately presses Log out.
// Firebase defaults to this mode, but stating it explicitly prevents an SDK or
// embedded-browser default from quietly falling back to a temporary session.
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Could not set persistent sign-in", error);
});
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

  // Changes waiting to reach the cloud. Each is one item or setting, never the whole state, so a tab
  // left open with old data can't overwrite newer entries made on the phone.
  _ops: JSON.parse(localStorage.getItem(KEY + "_ops") || "[]"),
  _flushing: false,

  save(op) {
    localStorage.setItem(KEY, JSON.stringify(this.state));
    if (op) {
      this._ops.push(op);
      localStorage.setItem(KEY + "_ops", JSON.stringify(this._ops));
    }
    this.flush();
  },

  // Only used when the cloud document doesn't exist yet (first sign-in on this device).
  pushToCloud() {
    if (!this._uid) return;
    setDoc(doc(db, "users", this._uid), { ...this.state, updatedAt: serverTimestamp() }, { merge: true })
      .catch((e) => console.warn("Cloud sync failed", e));
  },

  // Re-applies queued changes onto the latest cloud copy inside a transaction (retried on conflict).
  async flush() {
    if (!this._uid || this._flushing || !this._ops.length) return;
    this._flushing = true;
    const batch = this._ops.slice();
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "users", this._uid);
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : {};
        const out = {};
        for (const op of batch) {
          if (op.setting) {
            (out.settings ??= {})[op.setting] = op.value ?? null;
            continue;
          }
          const list = out[op.coll] ?? (Array.isArray(data[op.coll]) ? data[op.coll].slice() : []);
          const i = list.findIndex((x) => x && x.id === op.id);
          if (op.kind === "remove") { if (i >= 0) list.splice(i, 1); }
          else if (i >= 0) list[i] = { ...list[i], ...op.item };
          else list.push(op.item);
          out[op.coll] = list;
        }
        out.updatedAt = serverTimestamp();
        // merge:true deep-merges the settings map, so only the touched keys change.
        tx.set(ref, out, { merge: true });
      });
      this._ops.splice(0, batch.length);
      localStorage.setItem(KEY + "_ops", JSON.stringify(this._ops));
    } catch (e) {
      console.warn("Cloud sync failed, will retry", e);
    } finally {
      this._flushing = false;
      if (this._ops.length) setTimeout(() => this.flush(), this._ops.length > batch.length ? 0 : 5000);
    }
  },

  // Applied when a Firestore snapshot arrives (this device's own write or another device's).
  // Deliberately does not call save()/pushToCloud() to avoid a write feedback loop.
  applyRemote(remoteState) {
    const { updatedAt, ...rest } = remoteState;
    this.state = { ...defaultState(), ...rest };
    // Anything not yet synced stays visible on top of the cloud copy.
    for (const op of this._ops) {
      if (op.setting) { this.state.settings = { ...this.state.settings, [op.setting]: op.value }; continue; }
      const list = (this.state[op.coll] = Array.isArray(this.state[op.coll]) ? this.state[op.coll].slice() : []);
      const i = list.findIndex((x) => x && x.id === op.id);
      if (op.kind === "remove") { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = { ...list[i], ...op.item };
      else list.push(op.item);
    }
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
    this.save({ coll: collection, kind: "upsert", id: item.id, item: JSON.parse(JSON.stringify(item)) });
    this.emit(`${collection}:changed`);
    return item;
  },

  update(collection, id, patch) {
    const item = this.state[collection].find((i) => i.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.save({ coll: collection, kind: "upsert", id, item: JSON.parse(JSON.stringify(item)) });
    this.emit(`${collection}:changed`);
  },

  remove(collection, id) {
    this.state[collection] = this.state[collection].filter((i) => i.id !== id);
    this.save({ coll: collection, kind: "remove", id });
    this.emit(`${collection}:changed`);
  },

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.save({ setting: key, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
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
