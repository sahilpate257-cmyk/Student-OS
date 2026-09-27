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
import { LedgerModule } from "./ledger.js";
import { BrainDump } from "./notes.js";
import { GymModule } from "./gym.js";
import { PortfolioModule } from "./portfolio.js";
import { IntakeModule } from "./intake.js";
import { InsightsModule } from "./insights.js";

// Each tab is a standalone view — only one is mounted visible at a time.
// Smart Paste isn't a tab — it's a modal reachable from the header and the
// persistent strip above these tabs, since one paste can fill several of them at once.
const TABS = [
  { id: "portfolio-module", icon: "trending", label: "Invest" },
  { id: "ledger-module", icon: "wallet", label: "Cash" },
  { id: "insights-module", icon: "insights", label: "Insights" },
  { id: "calendar-module", icon: "calendar", label: "Due" },
  { id: "notes-module", icon: "notebook", label: "Notes" },
  { id: "gym-module", icon: "dumbbell", label: "Gym" },
];
const TAB_KEY = "ledgerly_tab";
const TAB_ORDER_KEY = "ledgerly_tab_order";

// saved order, reconciled against TABS so added/removed tabs never break it
function orderedTabs() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || "[]"); } catch (e) {}
  const known = saved.map((id) => TABS.find((t) => t.id === id)).filter(Boolean);
  const missing = TABS.filter((t) => !known.some((k) => k.id === t.id));
  return [...known, ...missing];
}

function saveTabOrder(list) {
  try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(list.map((t) => t.id))); } catch (e) {}
}

function renderTabBar() {
  const bar = document.getElementById("tab-bar");
  const tabs = orderedTabs();
  bar.style.gridTemplateColumns = `repeat(${tabs.length}, minmax(0, 1fr))`;
  bar.innerHTML = tabs.map((t) => `
    <button data-nav="${t.id}" class="nav-btn" title="${t.label}">
      <span class="nav-ic">${icon(t.icon, 18)}</span><span>${t.label}</span>
    </button>`).join("");
  bar.querySelectorAll("[data-nav]").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.dataset.nav))
  );
  // keep the active highlight in sync with whatever view is showing
  const current = document.querySelector(".tab-view:not(.hidden)")?.id;
  if (current) bar.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === current));
}

function showTab(id) {
  if (!TABS.some((t) => t.id === id)) id = TABS[0].id;
  document.querySelectorAll(".tab-view").forEach((el) => {
    const on = el.id === id;
    el.classList.toggle("hidden", !on);
    // re-trigger the enter animation on each switch
    el.classList.remove("is-active");
    if (on) { void el.offsetWidth; el.classList.add("is-active"); }
  });
  document.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === id));
  try { localStorage.setItem(TAB_KEY, id); } catch (e) {}
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("ledgerly_theme", t); } catch (e) {}
  const b = document.getElementById("theme-btn");
  if (b) b.innerHTML = icon(t === "dark" ? "sun" : "moon", 17);
  // The allocation donut bakes hex values into the SVG, and each theme uses a
  // different palette, so it has to be redrawn rather than just recoloured.
  if (PortfolioModule.el) PortfolioModule.render();
}

function bootstrapApp() {
  document.getElementById("header-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  // header chrome icons
  document.getElementById("settings-btn").innerHTML = icon("cog", 18);
  document.getElementById("sign-out").innerHTML = icon("logout", 17);
  document.getElementById("quick-add").innerHTML = icon("sparkle", 15) + "<span>Smart Paste</span>";

  // theme toggle (device-level preference, applied pre-paint by the head script)
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");
  document.getElementById("theme-btn").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  // persistent strip above the tabs — same trigger as the header button
  const strip = document.getElementById("smart-paste-strip");
  strip.innerHTML = `
    <span class="grid place-items-center w-8 h-8 rounded-[9px] shrink-0" style="background:var(--sunken);color:var(--ink)">${icon("sparkle", 16)}</span>
    <span class="flex-1 min-w-0">
      <span class="block text-[13.5px] font-semibold">Smart Paste</span>
      <span class="block text-[11.5px] faint truncate">Paste a statement, syllabus or notes — it fills itself in</span>
    </span>
    <span class="faint shrink-0">${icon("chevronRight2", 16)}</span>`;
  strip.addEventListener("click", () => IntakeModule.open());
  document.getElementById("quick-add").addEventListener("click", () => IntakeModule.open());

  // build the bottom tab bar (respects the user's saved order)
  renderTabBar();
  SettingsPanel.init();

  [CalendarModule, LedgerModule, BrainDump, GymModule, PortfolioModule, IntakeModule, InsightsModule].forEach((m) => m.init());

  // restore the last tab this device was on
  let last = TABS[0].id;
  try { last = localStorage.getItem(TAB_KEY) || last; } catch (e) {}
  showTab(last);
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

    // 2FA lives inside Settings → Security → Manage

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
        if (!Store.isFirstRun) Store.pushToCloud();
      }
    } catch (e) {
      console.warn("Could not reach cloud, using local data", e);
      Store.load();
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
      if (action === "close-security") { this.toggle(false); SettingsPanel.toggle(true); }
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

// ---- Settings: appearance, tab order, security, account ----
const SettingsPanel = {
  el: null,
  open: false,
  _wired: false,

  init() {
    this.el = document.getElementById("settings-panel");
    if (this._wired) { this.render(); return; }
    this._wired = true;

    document.getElementById("settings-btn").addEventListener("click", () => this.toggle());

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id, theme } = btn.dataset;
      if (action === "close-settings") return this.toggle(false);
      if (action === "set-theme") { applyTheme(theme); return this.render(); }
      if (action === "open-security") { this.toggle(false); return SecurityPanel.toggle(true); }
      if (action === "reset-tabs") {
        try { localStorage.removeItem(TAB_ORDER_KEY); } catch (err) {}
        renderTabBar();
        return this.render();
      }
    });

    // press-and-drag reordering (pointer events cover mouse, touch and pen alike)
    this.el.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-drag]");
      if (!handle) return;
      e.preventDefault();
      this.dragId = handle.dataset.drag;
      const row = handle.closest("li");
      row.classList.add("dragging");
      document.body.style.userSelect = "none";

      const onMove = (ev) => this.handleDragMove(ev);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        this.el.querySelector(`li[data-id="${this.dragId}"]`)?.classList.remove("dragging");
        this.dragId = null;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  },

  handleDragMove(e) {
    if (!this.dragId) return;
    const ul = this.el.querySelector("#tab-order-list");
    if (!ul) return;
    const list = orderedTabs();
    const dragIdx = list.findIndex((t) => t.id === this.dragId);
    const rows = [...ul.children];
    const y = e.clientY;
    for (let i = 0; i < rows.length; i++) {
      if (i === dragIdx) continue;
      const r = rows[i].getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const movingDown = i > dragIdx;
      if ((movingDown && y > mid) || (!movingDown && y < mid)) {
        const [item] = list.splice(dragIdx, 1);
        list.splice(i, 0, item);
        saveTabOrder(list);
        renderTabBar();
        this.renderTabOrderList(list);
        this.el.querySelector(`li[data-id="${this.dragId}"]`)?.classList.add("dragging");
        break;
      }
    }
  },

  renderTabOrderList(list) {
    const ul = this.el.querySelector("#tab-order-list");
    if (!ul) return;
    ul.innerHTML = list.map((t, i) => `
      <li class="flex items-center gap-2.5" data-id="${t.id}" style="padding:6px 0">
        <span data-drag="${t.id}" class="drag-handle faint" style="cursor:grab;touch-action:none;display:flex">${icon("grip", 16)}</span>
        <span class="faint">${icon(t.icon, 15)}</span>
        <span class="flex-1 text-[13px]">${t.label}</span>
        <span class="text-[11px] faint num">${i + 1}</span>
      </li>`).join("");
  },

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.classList.toggle("hidden", !this.open);
    if (this.open) { SecurityPanel.toggle(false); this.render(); window.scrollTo({ top: 0 }); }
  },

  render() {
    const list = orderedTabs();
    const theme = document.documentElement.getAttribute("data-theme") || "light";
    const has2fa = auth.currentUser ? multiFactor(auth.currentUser).enrolledFactors.length > 0 : false;

    const themeBtn = (v, label) => `
      <button data-action="set-theme" data-theme="${v}" class="chip ${theme === v ? "chip-on" : ""}">${icon(v === "dark" ? "moon" : "sun", 13)} ${label}</button>`;

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("cog", 18)}</span>
          <h2 class="sect-title">Settings</h2>
        </div>
        <button data-action="close-settings" class="btn-icon">${icon("x", 17)}</button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
        <div>
          <p class="eyebrow mb-2.5">Appearance</p>
          <div class="flex gap-1.5">${themeBtn("light", "Light")}${themeBtn("dark", "Dark")}</div>

          <p class="eyebrow mt-6 mb-2.5">Security</p>
          <div class="flex items-center gap-3">
            <span class="text-[13px] flex-1">Two-factor authentication
              <span class="text-[11.5px] ${has2fa ? "pos" : "faint"} block">${has2fa ? "On" : "Off"}</span>
            </span>
            <button data-action="open-security" class="btn btn-ghost btn-sm">Manage</button>
          </div>

          <p class="eyebrow mt-6 mb-2.5">Account</p>
          <p class="text-[13px] muted">${auth.currentUser?.email ?? ""}</p>
        </div>

        <div>
          <p class="eyebrow mb-1">Tab order</p>
          <p class="text-[11.5px] faint mb-2">Press the grip and drag to reorder. Saved on this device.</p>
          <ul id="tab-order-list" class="mb-3"></ul>
          <button data-action="reset-tabs" class="btn btn-ghost btn-sm">Reset to default</button>
        </div>
      </div>`;
    this.renderTabOrderList(list);
  },
};

AuthGate.init();
