// inbox.js — Gmail (read-only) on the web: the same AI-sorted digest as the phone, with one-click
// "add bill / deadline / spend" actions. Connecting uses the Worker's Google sign-in.

import { Store, escapeHtml, todayISO } from "./store.js";
import { icon } from "./icons.js";
import { api } from "./marketdata.js";

const CACHE = "ledgerly_gmail_digest";
const KINDS = [
  ["Needs you", (i) => i.important],
  ["Bills & deadlines", (i) => !i.important && ["bill", "deadline"].includes(i.kind)],
  ["Receipts", (i) => !i.important && i.kind === "receipt"],
  ["Deliveries", (i) => !i.important && i.kind === "delivery"],
  ["Everything else", (i) => !i.important && !["bill", "deadline", "receipt", "delivery"].includes(i.kind)],
];

export const InboxModule = {
  el: null,
  status: null,
  digest: null,
  loading: false,
  error: "",
  toast: "",

  init() {
    this.el = document.getElementById("inbox-module");
    injectStyles();
    try { this.digest = JSON.parse(localStorage.getItem(CACHE) || "null"); } catch (e) {}
    this.el.addEventListener("click", (e) => this.onClick(e));
    if (new URLSearchParams(location.search).get("gmail") === "connected") {
      history.replaceState(null, "", location.pathname);
      setTimeout(() => window.ledgerlyShowTab?.("inbox-module"), 300);
    }
    this.render();
  },

  async onShow() {
    if (!this.status) {
      try { this.status = await api("/gmail/status", {}); } catch (e) { this.error = e.message; }
    }
    this.render();
    if (this.status?.connected) this.load(false);
  },

  async load(force) {
    if (this.loading) return;
    this.loading = true; this.error = ""; this.render();
    try {
      this.digest = await api("/gmail/digest", { days: 3, force });
      localStorage.setItem(CACHE, JSON.stringify(this.digest));
      if (!this.digest.connected) this.status = { connected: false, expired: true };
    } catch (e) { this.error = e.message; }
    this.loading = false;
    this.render();
  },

  async onClick(e) {
    const b = e.target.closest("[data-ib]");
    if (!b) return;
    const a = b.dataset.ib, item = (this.digest?.items || []).find((x) => x.id === b.dataset.id);
    if (a === "connect") {
      try { const r = await api("/gmail/start", { return: "web" }); location.href = r.url; } catch (err) { this.error = err.message; this.render(); }
      return;
    }
    if (a === "refresh") return this.load(true);
    if (a === "disconnect") {
      if (!confirm("Disconnect Gmail from Orbit?")) return;
      await api("/gmail/disconnect", {}).catch(() => {});
      this.status = { connected: false }; this.digest = null; localStorage.removeItem(CACHE);
      return this.render();
    }
    if (!item) return;
    if (a === "bill") {
      Store.state.bills ||= [];
      Store.add("bills", { id: "bl_" + Math.random().toString(36).slice(2, 12), name: item.merchant || item.from || "Bill", amount: item.amount || 0, cycle: "monthly", next: item.due || todayISO(), category: "Subscriptions" });
      this.flash("Added to Bills");
    } else if (a === "deadline") {
      Store.add("deadlines", { id: Store.uid("dl"), title: item.line || item.subject, source: "uni", dueDate: item.due || todayISO(), done: false, notes: item.subject });
      this.flash("Added to Due");
    } else if (a === "spend") {
      Store.add("transactions", { id: Store.uid("tx"), type: "expense", amount: item.amount, category: "Shopping", description: item.merchant || item.from, date: item.paidOn || (item.date || "").slice(0, 10) || todayISO() });
      this.flash("Logged in Cash");
    }
  },

  flash(t) { this.toast = t; this.render(); setTimeout(() => { this.toast = ""; this.render(); }, 2200); },

  render() {
    if (!this.el) return;
    const s = this.status, d = this.digest;
    if (s && !s.connected) {
      this.el.innerHTML = `<div class="ib-connect">
        <span class="ib-big-ic">${icon("mail", 30)}</span>
        <h2 class="sect-title">${s.expired ? "Reconnect Gmail" : "Connect Gmail"}</h2>
        <p class="muted">Orbit reads your recent emails (read-only) and pulls out bills, receipts, deadlines and deliveries, and flags anything that needs you.</p>
        <button class="btn btn-primary" data-ib="connect">${icon("mail", 15)} Sign in with Google</button>
        <p class="faint text-[12px]">Google may say the app is unverified — it's your own personal app. Choose Advanced → Go to Orbit.</p>
        ${this.error ? `<p class="neg text-[12.5px]">${escapeHtml(this.error)}</p>` : ""}
      </div>`;
      return;
    }
    const items = d?.items || [];
    const fmtAmt = (i) => i.amount != null ? `${i.currency === "USD" ? "$" : i.currency === "EUR" ? "€" : "£"}${Number(i.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "";
    const row = (i) => `<div class="ib-row ${i.unread ? "is-unread" : ""}">
      <div class="ib-main">
        <div class="ib-top"><b>${escapeHtml(i.from || "")}</b><span class="faint">${i.date ? new Date(i.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : ""}</span></div>
        <p>${escapeHtml(i.line || i.subject || "")}</p>
        <div class="ib-meta">
          ${i.amount != null ? `<span class="ib-chip">${fmtAmt(i)}</span>` : ""}
          ${i.due ? `<span class="ib-chip neg">Due ${new Date(i.due + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : ""}
          <span class="flex-1"></span>
          ${i.kind === "bill" ? `<button class="btn btn-ghost btn-sm" data-ib="bill" data-id="${i.id}">Add bill</button>` : ""}
          ${i.kind === "deadline" ? `<button class="btn btn-ghost btn-sm" data-ib="deadline" data-id="${i.id}">Add deadline</button>` : ""}
          ${i.kind === "receipt" && i.amount != null ? `<button class="btn btn-ghost btn-sm" data-ib="spend" data-id="${i.id}">Log spend</button>` : ""}
          <a class="btn-icon" href="${i.link}" target="_blank" rel="noopener" title="Open in Gmail">${icon("chevronRight2", 15)}</a>
        </div>
      </div>
    </div>`;
    this.el.innerHTML = `
      <div class="ib-head">
        <div><p class="eyebrow">${escapeHtml(s?.email || d?.email || "Gmail")} · last 3 days</p>
          <h2 class="ib-title">${escapeHtml(d?.headline || (this.loading ? "Reading your inbox…" : "Inbox"))}</h2></div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" data-ib="refresh" ${this.loading ? "disabled" : ""}>${icon("refresh", 14)} ${this.loading ? "Loading…" : "Refresh"}</button>
          <button class="btn-icon" data-ib="disconnect" title="Disconnect Gmail">${icon("x", 15)}</button>
        </div>
      </div>
      ${this.error ? `<p class="neg text-[12.5px] mb-3">${escapeHtml(this.error)}</p>` : ""}
      ${KINDS.map(([title, f]) => { const list = items.filter(f); return list.length ? `<p class="ib-sec">${title} <span class="faint">${list.length}</span></p><div class="ib-list">${list.map(row).join("")}</div>` : ""; }).join("")}
      ${!items.length && !this.loading ? `<p class="faint py-6 text-center">Nothing new in the last 3 days.</p>` : ""}
      <p class="faint text-[12px] mt-4">Read-only — Orbit can't send, delete or change anything in your Gmail.</p>
      ${this.toast ? `<div class="nt-toast">${escapeHtml(this.toast)}</div>` : ""}`;
  },
};

function injectStyles() {
  if (document.getElementById("ib-css")) return;
  const s = document.createElement("style");
  s.id = "ib-css";
  s.textContent = `
#inbox-module{background:transparent!important}
.ib-connect{max-width:520px;margin:40px auto;text-align:center;display:grid;gap:14px;justify-items:center;padding:30px;border-radius:26px;background:var(--surface);border:1px solid var(--border)}
.ib-big-ic{display:grid;place-items:center;width:64px;height:64px;border-radius:20px;background:var(--accent-soft);color:var(--accent)}
.ib-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px;margin:4px 2px 16px}
.ib-title{font:800 clamp(22px,3vw,30px)/1.2 Manrope,system-ui;letter-spacing:-.02em;max-width:780px}
.ib-sec{font-size:13px;font-weight:800;color:var(--ink-muted);margin:16px 4px 8px;text-transform:uppercase;letter-spacing:.06em}
.ib-list{border-radius:20px;background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:inset 0 1px 0 var(--edge)}
.ib-row{padding:13px 16px;border-top:1px solid var(--border);transition:background .15s}
.ib-row:first-child{border-top:0}
.ib-row:hover{background:var(--sunken)}
.ib-row.is-unread .ib-top b::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-right:7px;vertical-align:middle}
.ib-top{display:flex;justify-content:space-between;gap:10px;font-size:13.5px}
.ib-main p{font-size:14px;margin:3px 0 6px}
.ib-meta{display:flex;align-items:center;gap:8px}
.ib-chip{font-size:11.5px;font-weight:800;padding:2px 9px;border-radius:99px;background:var(--sunken)}
`;
  document.head.appendChild(s);
}
