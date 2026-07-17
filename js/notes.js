// notes.js — BrainDump: rapid capture, tag filter, promote note → task

import { Store, escapeHtml, SOURCE } from "./store.js";
import { icon } from "./icons.js";

export const BrainDump = {
  el: null,
  filter: "all",
  selectedTag: null,

  init() {
    this.el = document.getElementById("notes-module");

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id, tag } = btn.dataset;
      if (action === "set-filter") {
        this.filter = tag;
        this.render();
      } else if (action === "pick-tag") {
        this.selectedTag = this.selectedTag === tag ? null : tag;
        const input = this.el.querySelector("#note-input");
        const text = input?.value ?? "";
        this.render();
        const restored = this.el.querySelector("#note-input");
        restored.value = text;
        restored.focus();
      } else if (action === "promote-note") {
        const note = Store.state.notes.find((n) => n.id === id);
        if (!note || note.promoted) return;
        Store.add("tasks", {
          id: Store.uid("tk"),
          title: note.text,
          energy: "medium",
          done: false,
          linkedDeadlineId: null,
          createdAt: new Date().toISOString(),
        });
        Store.update("notes", id, { promoted: true });
      } else if (action === "delete-note") {
        Store.remove("notes", id);
      }
    });

    this.el.addEventListener("keydown", (e) => {
      if (e.target.id === "note-input" && e.key === "Enter") {
        e.preventDefault();
        this.saveNote();
      }
    });
    this.el.addEventListener("click", (e) => {
      if (e.target.closest("#note-save")) this.saveNote();
    });

    Store.subscribe("notes:changed", () => this.render());
    this.render();
  },

  saveNote() {
    const input = this.el.querySelector("#note-input");
    const text = input.value.trim();
    if (!text) return;
    Store.add("notes", {
      id: Store.uid("nt"),
      text,
      tag: this.selectedTag,
      createdAt: new Date().toISOString(),
      promoted: false,
    });
    this.selectedTag = null;
    // render already happened via notes:changed; just refocus
    this.el.querySelector("#note-input").focus();
  },

  relTime(iso) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  },

  render() {
    const filters = [
      { key: "all", label: "All" },
      { key: "uni", label: "Uni" },
      { key: "hustle", label: "Hustle" },
    ];
    const filterChips = filters.map((f) => `
      <button data-action="set-filter" data-tag="${f.key}" class="chip ${this.filter === f.key ? "chip-on" : ""}">${f.label}</button>`).join("");

    const tagChips = ["uni", "hustle"].map((t) => `
      <button data-action="pick-tag" data-tag="${t}" type="button" class="chip ${this.selectedTag === t ? "chip-on" : ""}">
        <span class="w-2 h-2 rounded-full" style="background:${SOURCE[t].dot}"></span>${SOURCE[t].label}
      </button>`).join("");

    const notes = [...Store.state.notes]
      .filter((n) => this.filter === "all" || n.tag === this.filter)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const feed = notes.map((n) => {
      const s = n.tag ? SOURCE[n.tag] : null;
      return `
        <li class="well px-3.5 py-3 group">
          <p class="text-[13.5px] whitespace-pre-wrap break-words">${escapeHtml(n.text)}</p>
          <div class="flex items-center gap-2 mt-2">
            ${s ? `<span class="${s.tag}">${s.label}</span>` : ""}
            <span class="text-[11px] faint">${this.relTime(n.createdAt)}</span>
            <span class="flex-1"></span>
            ${n.promoted
              ? `<span class="text-[11px] pos flex items-center gap-1">${icon("check", 12)} Tasked</span>`
              : `<button data-action="promote-note" data-id="${n.id}" class="reveal btn btn-ghost btn-sm">${icon("plus", 13)} Task</button>`}
            <button data-action="delete-note" data-id="${n.id}" class="reveal btn-icon" style="width:26px;height:26px">${icon("x", 14)}</button>
          </div>
        </li>`;
    }).join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("notebook", 18)}</span>
          <h2 class="sect-title">Notes</h2>
        </div>
        <div class="flex gap-1.5">${filterChips}</div>
      </div>

      <div class="flex flex-wrap gap-2 mb-4">
        <input id="note-input" placeholder="Capture an idea, press Enter…" class="input flex-1" style="min-width:160px" />
        ${tagChips}
        <button id="note-save" class="btn btn-primary">Save</button>
      </div>

      <ul class="space-y-2 max-h-80 overflow-y-auto pr-1">
        ${feed || `<li class="text-[13px] faint py-3 text-center">Nothing captured yet.</li>`}
      </ul>`;
  },
};
