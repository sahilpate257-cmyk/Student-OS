// intake.js — Smart Paste: paste raw text (statement/syllabus/notes), Claude extracts
// structured deadlines/transactions via the Ledgerly Worker, user reviews and picks
// exactly what to commit — nothing saves without explicit confirmation.
// Presented as a modal (see #intake-modal in index.html), reachable from the header
// button and the persistent strip above the tabs — not a tab itself, since one paste
// can fill in several different tabs at once.

import { Store, auth, escapeHtml, todayISO } from "./store.js";
import { icon } from "./icons.js";

const WORKER_URL = "https://ledgerly-ai-intake.sahilpatel-ledgerly.workers.dev";

function uid(list) {
  return list.map((_, i) => i);
}

export const IntakeModule = {
  el: null,
  modal: null,
  isOpen: false,
  loading: false,
  error: null,
  result: null,      // { deadlines: [...], transactions: [...] }
  selected: null,    // { deadlines: Set, transactions: Set }

  init() {
    this.el = document.getElementById("intake-module");
    this.modal = document.getElementById("intake-modal");

    // click the dimmed backdrop (not the card itself) to close
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });

    this.el.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, kind, idx } = btn.dataset;
      if (action === "close-intake") {
        this.close();
      } else if (action === "extract") {
        this.extract();
      } else if (action === "toggle-item") {
        const set = this.selected[kind];
        const i = Number(idx);
        set.has(i) ? set.delete(i) : set.add(i);
        this.render();
      } else if (action === "commit") {
        this.commit();
      } else if (action === "discard") {
        this.reset();
        this.render();
      }
    });

    this.el.addEventListener("submit", (e) => {
      if (e.target.id !== "intake-form") return;
      e.preventDefault();
      this.extract();
    });

    this.render();
  },

  open() {
    this.isOpen = true;
    this.modal.classList.remove("hidden");
    this.render();
    setTimeout(() => this.el.querySelector("#intake-text")?.focus(), 60);
  },

  close() {
    this.isOpen = false;
    this.modal.classList.add("hidden");
    this.reset();
  },

  reset() {
    this.result = null;
    this.error = null;
    this.selected = null;
  },

  async extract() {
    const textarea = this.el.querySelector("#intake-text");
    const text = textarea?.value.trim();
    if (!text) return;

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("You need to be signed in.");
      const token = await user.getIdToken();

      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed — try again.");

      this.result = {
        deadlines: data.deadlines || [],
        transactions: data.transactions || [],
      };
      this.selected = {
        deadlines: new Set(uid(this.result.deadlines)),
        transactions: new Set(uid(this.result.transactions)),
      };

      if (!this.result.deadlines.length && !this.result.transactions.length) {
        this.error = "Nothing recognisable was found in that text — try pasting more context.";
        this.result = null;
      }
    } catch (err) {
      this.error = err.message || "Something went wrong.";
    } finally {
      this.loading = false;
      this.render();
    }
  },

  commit() {
    let count = 0;
    this.result.deadlines.forEach((d, i) => {
      if (!this.selected.deadlines.has(i)) return;
      Store.add("deadlines", {
        id: Store.uid("dl"),
        title: d.title,
        source: d.source === "hustle" ? "hustle" : "uni",
        dueDate: d.dueDate || todayISO(),
        done: false,
        notes: d.notes || "",
      });
      count++;
    });
    this.result.transactions.forEach((t, i) => {
      if (!this.selected.transactions.has(i)) return;
      Store.add("transactions", {
        id: Store.uid("tx"),
        type: t.type === "income" ? "income" : "expense",
        amount: Math.abs(parseFloat(t.amount)) || 0,
        category: t.category || "General",
        description: t.description || "",
        date: t.date || todayISO(),
      });
      count++;
    });

    this.close();
    this.flashMessage(`Added ${count} item${count === 1 ? "" : "s"}.`);
  },

  flashMessage(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--on-ink);padding:10px 18px;border-radius:999px;font-size:13px;font-weight:600;z-index:100;box-shadow:var(--shadow-lg);transition:opacity .4s;";
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, 2200);
  },

  renderReviewGroup(kind, label, items, fmt) {
    if (!items.length) return "";
    const rows = items.map((item, i) => {
      const checked = this.selected[kind].has(i);
      return `
        <li class="flex items-start gap-2.5 py-2 divide-row">
          <button data-action="toggle-item" data-kind="${kind}" data-idx="${i}" class="cbx mt-0.5 ${checked ? "cbx-on" : ""}">
            ${checked ? icon("check", 12) : ""}
          </button>
          <p class="text-[13px] flex-1 ${checked ? "" : "faint"}">${fmt(item)}</p>
        </li>`;
    }).join("");
    return `
      <div class="mb-4">
        <p class="eyebrow mb-1">${label} · ${items.length}</p>
        <ul>${rows}</ul>
      </div>`;
  },

  render() {
    if (!this.isOpen) { this.el.innerHTML = ""; return; }

    const header = `
      <div class="flex items-center justify-between gap-3 mb-1">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("sparkle", 18)}</span>
          <div>
            <h2 class="sect-title leading-tight">Smart Paste</h2>
            <p class="text-[11.5px] faint">Paste a statement, syllabus, or notes — it fills itself in</p>
          </div>
        </div>
        <button data-action="close-intake" class="btn-icon">${icon("x", 17)}</button>
      </div>`;

    let body;
    if (this.result) {
      const fmtD = (d) => `<b>${escapeHtml(d.title)}</b> <span class="faint">· ${d.source === "hustle" ? "Hustle" : "Uni"} · ${d.dueDate}</span>`;
      const fmtT = (t) => `<b class="${t.type === "income" ? "pos" : "neg"}">${t.type === "income" ? "+" : "−"}${Math.abs(t.amount)}</b> <span class="faint">${escapeHtml(t.description || t.category || "")} · ${t.date}</span>`;

      const totalSelected = this.selected.deadlines.size + this.selected.transactions.size;

      body = `
        <div class="well p-4 mt-4">
          <p class="text-[12.5px] muted mb-3">Review what was found, untick anything you don't want, then add the rest.</p>
          ${this.renderReviewGroup("deadlines", "Deadlines", this.result.deadlines, fmtD)}
          ${this.renderReviewGroup("transactions", "Transactions", this.result.transactions, fmtT)}
          <div class="flex items-center gap-2 pt-1">
            <button data-action="commit" class="btn btn-primary" ${totalSelected === 0 ? "disabled" : ""}>Add ${totalSelected} item${totalSelected === 1 ? "" : "s"}</button>
            <button data-action="discard" class="btn btn-ghost">Discard</button>
          </div>
        </div>`;
    } else {
      body = `
        <form id="intake-form" class="mt-4">
          <textarea id="intake-text" rows="6" placeholder="Paste a bank statement, a syllabus, lecture notes, anything…" class="input w-full resize-y" ${this.loading ? "disabled" : ""}></textarea>
          ${this.error ? `<p class="text-[12.5px] neg mt-2">${escapeHtml(this.error)}</p>` : ""}
          <div class="flex items-center justify-between mt-3">
            <p class="text-[11.5px] faint">Nothing is saved until you review and confirm on the next screen.</p>
            <button type="submit" class="btn btn-primary" ${this.loading ? "disabled" : ""}>${this.loading ? "Reading…" : "Extract"}</button>
          </div>
        </form>`;
    }

    this.el.innerHTML = header + body;
  },
};
