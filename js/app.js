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
import { icon } from "./icons.js";
import { CalendarModule } from "./calendar.js";
import { EnergyRanker } from "./energy.js";
import { LedgerModule } from "./ledger.js";
import { BrainDump } from "./notes.js";
import { GymModule } from "./gym.js";
import { PortfolioModule } from "./portfolio.js";
import { IntakeModule } from "./intake.js";
import { InsightsModule } from "./insights.js";

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

const NAV = [
  { id: "portfolio-module", icon: "trending", label: "Invest" },
  { id: "ledger-module", icon: "wallet", label: "Cash" },
  { id: "insights-module", icon: "insights", label: "Insights" },
  { id: "energy-module", icon: "gauge", label: "Focus" },
  { id: "calendar-module", icon: "calendar", label: "Due" },
  { id: "notes-module", icon: "notebook", label: "Notes" },
  { id: "gym-module", icon: "dumbbell", label: "Gym" },
];

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("ledgerly_theme", t); } catch (e) {}
  const b = document.getElementById("theme-btn");
  if (b) b.innerHTML = icon(t === "dark" ? "sun" : "moon", 17);
}

function bootstrapApp() {
  document.getElementById("header-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  // header chrome icons
  document.getElementById("security-btn").innerHTML = icon("shield", 17);
  document.getElementById("sign-out").innerHTML = icon("logout", 17);
  document.getElementById("quick-add").innerHTML = icon("plus", 16) + "<span>Capture</span>";

  // theme toggle (device-level preference, applied pre-paint by the head script)
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");
  document.getElementById("theme-btn").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  // mobile nav icons + labels
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const meta = NAV.find((n) => n.id === btn.dataset.nav);
    if (meta) btn.innerHTML = icon(meta.icon, 19) + `<span>${meta.label}</span>`;
  });

  [CalendarModule, EnergyRanker, LedgerModule, BrainDump, GymModule, PortfolioModule, IntakeModule, InsightsModule].forEach((m) => m.init());

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

    const landing = document.getElementById("landing");
    const showView = (name) => {
      landing.classList.toggle("hidden", name !== "landing");
      overlay.classList.toggle("hidden", name !== "auth");
      shell.classList.toggle("hidden", name !== "app");
      window.scrollTo(0, 0);
    };
    this._showView = showView;

    // landing CTAs → auth screen
    document.querySelectorAll('[data-goto="auth"]').forEach((b) =>
      b.addEventListener("click", () => { showView("auth"); document.getElementById("auth-email").focus(); })
    );
    // auth → back to landing
    document.getElementById("auth-back")?.addEventListener("click", () => showView("landing"));

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
        showView("landing");
        return;
      }
      this._mfaResolver = null;
      mfaForm.classList.add("hidden");
      authForm.classList.remove("hidden");
      clearMsgs();
      showView("app");
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
      const otpauthUrl = this.pendingSecret.generateQrCodeUrl(user.email, "Ledgerly");
      body = `
        <p class="text-[13.5px] muted mb-2"><span class="font-semibold" style="color:var(--ink)">1.</span> Open your authenticator app (Google Authenticator, Authy, 1Password) and add an account with this setup key:</p>
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <code class="well px-3 py-2 text-[13px] tracking-wider break-all num" style="border:1px solid var(--border-2)">${this.pendingSecret.secretKey}</code>
          <button data-action="copy-secret" class="btn btn-ghost btn-sm">Copy</button>
        </div>
        <p class="text-[12px] faint mb-4">On a phone with an app installed? <a href="${otpauthUrl}" class="underline" style="color:var(--ink)">Tap to add directly</a>. Choose "time-based" if asked.</p>
        <p class="text-[13.5px] muted mb-2"><span class="font-semibold" style="color:var(--ink)">2.</span> Enter the 6-digit code it now shows:</p>
        <form id="enroll-confirm-form" class="flex flex-wrap gap-2">
          <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" required class="input num text-center tracking-[.3em]" style="width:120px" />
          <button type="submit" class="btn btn-primary">Turn on 2FA</button>
          <button type="button" data-action="cancel-enroll" class="btn btn-ghost">Cancel</button>
        </form>`;
    } else if (has2fa) {
      body = `
        <div class="flex items-center gap-2 mb-3 text-[13.5px] pos font-semibold">${icon("check", 16)} Two-factor is on — every new sign-in needs a code.</div>
        <p class="text-[13.5px] muted mb-2">To turn it off, confirm your password and a current code:</p>
        <form id="disable-2fa-form" class="flex flex-wrap gap-2">
          <input name="password" type="password" placeholder="Password" required autocomplete="current-password" class="input" style="width:180px" />
          <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" required class="input num text-center tracking-[.3em]" style="width:120px" />
          <button type="submit" class="btn btn-danger">Turn off 2FA</button>
        </form>`;
    } else {
      body = `
        <p class="text-[13.5px] muted mb-3">Two-factor is <span class="font-semibold" style="color:var(--ink)">off</span>. Turn it on to require a code from an authenticator app at every new sign-in — your money data stays safe even if someone learns your password.</p>
        <form id="enroll-start-form" class="flex flex-wrap gap-2">
          <input name="password" type="password" placeholder="Confirm your password" required autocomplete="current-password" class="input" style="width:220px" />
          <button type="submit" class="btn btn-primary">Set up 2FA</button>
        </form>`;
    }

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-8 h-8 rounded-[9px]" style="background:var(--sunken);color:var(--ink)">${icon("shield", 17)}</span>
          <h2 class="sect-title">Security</h2>
        </div>
        <button data-action="close-security" class="btn-icon">${icon("x", 17)}</button>
      </div>
      <p class="text-[12.5px] faint mb-4">Signed in as ${user.email} · you stay signed in on this device until you sign out.</p>
      <p id="security-msg" class="text-xs mb-3"></p>
      ${body}`;
  },
};

AuthGate.init();
