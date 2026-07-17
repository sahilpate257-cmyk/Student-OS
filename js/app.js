// app.js — bootstrap: auth gate (email/password, forgot-password, optional TOTP 2FA),
// persistent sessions, cloud sync wiring, module init

import { Store, auth, db, todayISO } from "./store.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential,
  multiFactor, getMultiFactorResolver, TotpMultiFactorGenerator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
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
  _unsubSnapshot: null,
  _mfaResolver: null,

  init() {
    const shell = document.getElementById("app-shell");
    const overlay = document.getElementById("auth-overlay");
    const authForm = document.getElementById("auth-form");
    const mfaForm = document.getElementById("mfa-form");
    const errorEl = document.getElementById("auth-error");
    const statusEl = document.getElementById("auth-status");

    const showError = (msg) => {
      statusEl.textContent = "";
      errorEl.textContent = msg;
      errorEl.classList.remove("hidden");
    };
    const clearMsgs = () => {
      errorEl.classList.add("hidden");
      statusEl.textContent = "";
    };

    // ---- email + password sign in / sign up ----
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs();
      const mode = e.submitter?.dataset.mode || "login";
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      statusEl.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
      try {
        if (mode === "signup") {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
      } catch (err) {
        if (err.code === "auth/multi-factor-auth-required") {
          // 2FA is enabled on this account — ask for the authenticator code
          this._mfaResolver = getMultiFactorResolver(auth, err);
          statusEl.textContent = "";
          authForm.classList.add("hidden");
          mfaForm.classList.remove("hidden");
          mfaForm.querySelector("input[name=code]").focus();
        } else {
          showError(this.friendlyError(err));
        }
      }
    });

    // ---- 2FA code step during sign-in ----
    mfaForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs();
      const code = mfaForm.querySelector("input[name=code]").value.trim();
      if (!/^\d{6}$/.test(code)) { showError("Enter the 6-digit code from your authenticator app."); return; }
      statusEl.textContent = "Verifying code…";
      try {
        const hint = this._mfaResolver.hints.find((h) => h.factorId === "totp") ?? this._mfaResolver.hints[0];
        const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
        await this._mfaResolver.resolveSignIn(assertion);
        // onAuthStateChanged takes it from here
      } catch (err) {
        showError(err.code === "auth/invalid-verification-code" ? "That code isn't right — try the current one in your app." : this.friendlyError(err));
      }
    });
    document.getElementById("mfa-cancel").addEventListener("click", () => {
      this._mfaResolver = null;
      mfaForm.classList.add("hidden");
      mfaForm.querySelector("input[name=code]").value = "";
      authForm.classList.remove("hidden");
      clearMsgs();
    });

    // ---- forgot password ----
    document.getElementById("forgot-password").addEventListener("click", async () => {
      clearMsgs();
      const email = document.getElementById("auth-email").value.trim();
      if (!email) { showError("Type your email in the box above first, then click this again."); return; }
      try {
        await sendPasswordResetEmail(auth, email);
        statusEl.textContent = `Password reset email sent to ${email} — check your inbox (and spam).`;
      } catch (err) {
        showError(this.friendlyError(err));
      }
    });

    // ---- sign out ----
    document.getElementById("sign-out").addEventListener("click", async () => {
      if (this._unsubSnapshot) { this._unsubSnapshot(); this._unsubSnapshot = null; }
      await signOut(auth);
    });

    // ---- security panel (2FA management) ----
    document.getElementById("security-btn").addEventListener("click", () => SecurityPanel.toggle());

    // ---- auth state: local persistence means this fires signed-in on return visits ----
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        this.started = false;
        Store._uid = null;
        if (this._unsubSnapshot) { this._unsubSnapshot(); this._unsubSnapshot = null; }
        overlay.classList.remove("hidden");
        shell.classList.add("hidden");
        return;
      }
      this._mfaResolver = null;
      mfaForm.classList.add("hidden");
      authForm.classList.remove("hidden");
      clearMsgs();
      overlay.classList.add("hidden");
      shell.classList.remove("hidden");
      if (this.started) return; // avoid double-init on token refresh
      this.started = true;
      await this.bootstrap(user.uid);
    });
  },

  friendlyError(err) {
    const map = {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/wrong-password": "Wrong email or password.",
      "auth/user-not-found": "No account with that email — use Sign Up to create one.",
      "auth/email-already-in-use": "That email already has an account — use Log In instead.",
      "auth/weak-password": "Password needs to be at least 6 characters.",
      "auth/invalid-email": "That doesn't look like a valid email address.",
      "auth/too-many-requests": "Too many attempts — wait a minute and try again.",
    };
    return map[err.code] ?? err.message;
  },

  async bootstrap(uid) {
    Store._uid = uid;
    const docRef = doc(db, "users", uid);

    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
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
    this._unsubSnapshot = onSnapshot(docRef, (snap) => {
      if (snap.exists()) Store.applyRemote(snap.data());
    });

    bootstrapApp();
    SecurityPanel.init();
  },
};

// ---- Security panel: enable / disable TOTP 2FA (authenticator app) ----
const SecurityPanel = {
  el: null,
  open: false,
  pendingSecret: null,

  init() {
    if (this.el) { this.render(); return; }
    this.el = document.getElementById("security-panel");

    this.el.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "close-security") this.toggle(false);
      else if (action === "copy-secret" && this.pendingSecret) {
        try { await navigator.clipboard.writeText(this.pendingSecret.secretKey); btn.textContent = "Copied!"; } catch {}
      } else if (action === "cancel-enroll") {
        this.pendingSecret = null;
        this.render();
      }
    });

    this.el.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (e.target.id === "enroll-start-form") this.startEnroll(e.target);
      else if (e.target.id === "enroll-confirm-form") this.confirmEnroll(e.target);
      else if (e.target.id === "disable-2fa-form") this.disable2fa(e.target);
    });

    this.render();
  },

  toggle(force) {
    this.open = force ?? !this.open;
    if (!this.open) this.pendingSecret = null;
    this.el.classList.toggle("hidden", !this.open);
    if (this.open) { this.render(); this.el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  },

  msg(text, isError = false) {
    const m = this.el.querySelector("#security-msg");
    if (!m) return;
    m.textContent = text;
    m.className = `text-xs mb-3 ${isError ? "text-rose-400" : "text-emerald-400"}`;
  },

  async startEnroll(f) {
    const password = f.password.value;
    if (!password) return;
    this.msg("Checking password…");
    try {
      const user = auth.currentUser;
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      const session = await multiFactor(user).getSession();
      this.pendingSecret = await TotpMultiFactorGenerator.generateSecret(session);
      this.render();
    } catch (err) {
      if (err.code === "auth/operation-not-allowed" || /TOTP/i.test(err.message)) {
        this.msg("2FA isn't switched on for this app yet in the Firebase console (Authentication → Sign-in method → Multi-factor → enable TOTP, which needs the free Identity Platform upgrade).", true);
      } else if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        this.msg("Wrong password.", true);
      } else {
        this.msg(err.message, true);
      }
    }
  },

  async confirmEnroll(f) {
    const code = f.code.value.trim();
    if (!/^\d{6}$/.test(code)) { this.msg("Enter the 6-digit code shown in your authenticator app.", true); return; }
    this.msg("Verifying…");
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(this.pendingSecret, code);
      await multiFactor(auth.currentUser).enroll(assertion, "Authenticator app");
      this.pendingSecret = null;
      this.render();
      this.msg("2FA is on. You'll be asked for a code at every new sign-in.");
    } catch (err) {
      this.msg(err.code === "auth/invalid-verification-code" ? "Code didn't match — check your app shows the newest code and try again." : err.message, true);
    }
  },

  async disable2fa(f) {
    const password = f.password.value;
    const code = f.code.value.trim();
    this.msg("Checking…");
    try {
      const user = auth.currentUser;
      const cred = EmailAuthProvider.credential(user.email, password);
      try {
        await reauthenticateWithCredential(user, cred);
      } catch (err) {
        if (err.code !== "auth/multi-factor-auth-required") throw err;
        const resolver = getMultiFactorResolver(auth, err);
        const hint = resolver.hints.find((h) => h.factorId === "totp") ?? resolver.hints[0];
        await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
      }
      const enrolled = multiFactor(user).enrolledFactors;
      for (const factor of enrolled) await multiFactor(user).unenroll(factor);
      this.render();
      this.msg("2FA is off — sign-in is back to just email + password.");
    } catch (err) {
      this.msg(err.code === "auth/invalid-verification-code" ? "That code isn't right." : err.code === "auth/invalid-credential" ? "Wrong password." : err.message, true);
    }
  },

  render() {
    const user = auth.currentUser;
    if (!user) return;
    const enrolled = multiFactor(user).enrolledFactors;
    const has2fa = enrolled.length > 0;

    let body;
    if (this.pendingSecret) {
      const otpauthUrl = this.pendingSecret.generateQrCodeUrl(user.email, "Student OS");
      body = `
        <p class="text-sm text-slate-300 mb-2">1 · Open your authenticator app (Google Authenticator, Authy, 1Password…) and add a new account using this setup key:</p>
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <code class="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm tracking-wider break-all">${this.pendingSecret.secretKey}</code>
          <button data-action="copy-secret" class="text-xs text-indigo-300 border border-indigo-500/40 rounded-lg px-3 py-1.5">Copy</button>
        </div>
        <p class="text-[11px] text-slate-500 mb-3">On this device with an authenticator installed? <a href="${otpauthUrl}" class="text-indigo-300 underline">Tap to add directly</a>. Pick "time-based" if asked.</p>
        <p class="text-sm text-slate-300 mb-2">2 · Enter the 6-digit code your app now shows, to prove it's linked:</p>
        <form id="enroll-confirm-form" class="flex gap-2">
          <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" required
                 class="w-28 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm tracking-widest text-center placeholder-slate-600 focus:outline-none focus:border-indigo-400" />
          <button type="submit" class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Turn on 2FA</button>
          <button type="button" data-action="cancel-enroll" class="text-sm text-slate-400 hover:text-slate-200 px-2">Cancel</button>
        </form>`;
    } else if (has2fa) {
      body = `
        <p class="text-sm text-emerald-300 mb-3">✓ 2FA is on — every new sign-in needs a code from your authenticator app.</p>
        <p class="text-sm text-slate-300 mb-2">To turn it off, confirm your password and a current code:</p>
        <form id="disable-2fa-form" class="flex flex-wrap gap-2">
          <input name="password" type="password" placeholder="Password" required autocomplete="current-password"
                 class="w-44 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
          <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" required
                 class="w-28 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm tracking-widest text-center placeholder-slate-600 focus:outline-none focus:border-indigo-400" />
          <button type="submit" class="bg-rose-500/80 hover:bg-rose-500 text-white rounded-lg px-4 py-2 text-sm font-medium">Turn off 2FA</button>
        </form>`;
    } else {
      body = `
        <p class="text-sm text-slate-300 mb-3">2FA is <span class="text-slate-100 font-medium">off</span>. Turn it on to require a 6-digit code from an authenticator app at every new sign-in — your data stays safe even if someone learns your password.</p>
        <form id="enroll-start-form" class="flex flex-wrap gap-2">
          <input name="password" type="password" placeholder="Confirm your password" required autocomplete="current-password"
                 class="w-52 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
          <button type="submit" class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Set up 2FA</button>
        </form>`;
    }

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <h2 class="font-semibold text-slate-100">🔐 Security</h2>
        <button data-action="close-security" class="text-slate-500 hover:text-slate-300 px-2">✕</button>
      </div>
      <p class="text-[11px] text-slate-500 mb-3">Signed in as ${user.email} · you stay signed in on this device until you sign out.</p>
      <p id="security-msg" class="text-xs mb-3"></p>
      ${body}`;
  },
};

AuthGate.init();
