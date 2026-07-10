// notes.js — BrainDump: rapid capture, tag filter, promote note → task

import { Store, escapeHtml, SOURCE } from "./store.js";

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
      { key: "uni", label: "🎓 Uni" },
      { key: "hustle", label: "💼 Hustle" },
    ];
    const filterChips = filters.map((f) => `
      <button data-action="set-filter" data-tag="${f.key}"
              class="px-3 py-1 rounded-full text-xs border transition
                     ${this.filter === f.key ? "bg-indigo-500/20 border-indigo-400/60 text-indigo-200" : "border-slate-700 text-slate-400 hover:border-slate-500"}">
        ${f.label}
      </button>`).join("");

    const tagChips = ["uni", "hustle"].map((t) => `
      <button data-action="pick-tag" data-tag="${t}" type="button"
              class="px-2.5 py-1.5 rounded-lg text-xs border transition
                     ${this.selectedTag === t ? SOURCE[t].badge : "border-slate-700 text-slate-500 hover:border-slate-500"}">
        ${t === "uni" ? "🎓" : "💼"} ${SOURCE[t].label}
      </button>`).join("");

    const notes = [...Store.state.notes]
      .filter((n) => this.filter === "all" || n.tag === this.filter)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const feed = notes.map((n) => {
      const s = n.tag ? SOURCE[n.tag] : null;
      return `
        <li class="bg-slate-800/50 rounded-xl px-3 py-2.5 group">
          <p class="text-sm whitespace-pre-wrap break-words">${escapeHtml(n.text)}</p>
          <div class="flex items-center gap-2 mt-1.5">
            ${s ? `<span class="text-[10px] px-2 py-0.5 rounded-full ${s.badge}">${s.label}</span>` : ""}
            <span class="text-[11px] text-slate-500">${this.relTime(n.createdAt)}</span>
            <span class="flex-1"></span>
            ${n.promoted
              ? `<span class="text-[11px] text-emerald-400">✓ tasked</span>`
              : `<button data-action="promote-note" data-id="${n.id}"
                         class="opacity-0 group-hover:opacity-100 text-[11px] text-indigo-300 hover:text-indigo-200 border border-indigo-500/40 rounded px-2 py-0.5">→ Task</button>`}
            <button data-action="delete-note" data-id="${n.id}"
                    class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-sm px-1">✕</button>
          </div>
        </li>`;
    }).join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 class="font-semibold text-slate-100">📝 Brain Dump</h2>
        <div class="flex gap-1.5">${filterChips}</div>
      </div>

      <div class="flex gap-2 mb-3">
        <input id="note-input" placeholder="Dump an idea, hit Enter…"
               class="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        ${tagChips}
        <button id="note-save" class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Save</button>
      </div>

      <ul class="space-y-2 max-h-80 overflow-y-auto pr-1">
        ${feed || `<li class="text-sm text-slate-500 py-2">Empty head? Lucky you.</li>`}
      </ul>`;
  },
};
