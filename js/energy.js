// energy.js — EnergyRanker: tasks sorted into high/medium/low brainpower lanes

import { Store, escapeHtml } from "./store.js";

const LEVELS = [
  { key: "high", label: "High", icon: "🔥", accent: "text-rose-300", ring: "ring-rose-400/60", chip: "bg-rose-500/15 border-rose-500/40" },
  { key: "medium", label: "Medium", icon: "⚡", accent: "text-amber-300", ring: "ring-amber-400/60", chip: "bg-amber-500/15 border-amber-500/40" },
  { key: "low", label: "Low", icon: "🌙", accent: "text-sky-300", ring: "ring-sky-400/60", chip: "bg-sky-500/15 border-sky-500/40" },
];

export const EnergyRanker = {
  el: null,

  init() {
    this.el = document.getElementById("energy-module");

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id, level } = btn.dataset;
      if (action === "set-energy") {
        Store.setSetting("currentEnergy", level);
        this.render();
      } else if (action === "toggle-task") {
        const t = Store.state.tasks.find((t) => t.id === id);
        if (t) Store.update("tasks", id, { done: !t.done });
      } else if (action === "delete-task") {
        Store.remove("tasks", id);
      }
    });

    this.el.addEventListener("submit", (e) => {
      if (e.target.id !== "task-form") return;
      e.preventDefault();
      const f = e.target;
      const title = f.title.value.trim();
      if (!title) return;
      Store.add("tasks", {
        id: Store.uid("tk"),
        title,
        energy: f.energy.value,
        done: false,
        linkedDeadlineId: f.deadline.value || null,
        createdAt: new Date().toISOString(),
      });
      f.reset();
    });

    Store.subscribe("tasks:changed", () => this.render());
    Store.subscribe("deadlines:changed", () => this.render()); // linked badges
    this.render();
  },

  render() {
    const current = Store.state.settings.currentEnergy;
    const deadlineTitle = (id) => Store.state.deadlines.find((d) => d.id === id)?.title;

    const energyButtons = LEVELS.map((l) => `
      <button data-action="set-energy" data-level="${l.key}"
              class="px-3 py-1.5 rounded-full text-xs font-medium border transition
                     ${current === l.key ? `${l.chip} ${l.accent}` : "border-slate-700 text-slate-400 hover:border-slate-500"}">
        ${l.icon} ${l.label}
      </button>`).join("");

    const columns = LEVELS.map((l) => {
      const tasks = Store.state.tasks
        .filter((t) => t.energy === l.key)
        .sort((a, b) => a.done - b.done);
      const active = current === l.key;

      const cards = tasks.map((t) => {
        const linked = t.linkedDeadlineId ? deadlineTitle(t.linkedDeadlineId) : null;
        return `
          <li class="flex items-start gap-2 bg-slate-800/60 rounded-lg px-2.5 py-2 group">
            <button data-action="toggle-task" data-id="${t.id}"
                    class="mt-0.5 w-4 h-4 shrink-0 rounded border ${t.done ? "bg-emerald-500 border-emerald-500" : "border-slate-600 hover:border-slate-400"} flex items-center justify-center text-[10px] text-slate-950 font-bold">
              ${t.done ? "✓" : ""}
            </button>
            <div class="flex-1 min-w-0 text-sm">
              <p class="${t.done ? "line-through text-slate-500" : ""}">${escapeHtml(t.title)}</p>
              ${linked ? `<p class="text-[11px] text-slate-500 truncate">🔗 ${escapeHtml(linked)}</p>` : ""}
            </div>
            <button data-action="delete-task" data-id="${t.id}"
                    class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400">✕</button>
          </li>`;
      }).join("");

      return `
        <div class="rounded-xl bg-slate-900/80 border border-slate-800 p-3 ${active ? `ring-2 ${l.ring}` : ""}">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold ${l.accent}">${l.icon} ${l.label}</h3>
            ${active ? `<span class="text-[10px] uppercase tracking-wide text-slate-400">do these now</span>` : ""}
          </div>
          <ul class="space-y-1.5 min-h-10">
            ${cards || `<li class="text-xs text-slate-600 py-1">Nothing here.</li>`}
          </ul>
        </div>`;
    }).join("");

    const deadlineOptions = Store.state.deadlines
      .filter((d) => !d.done)
      .map((d) => `<option value="${d.id}">${escapeHtml(d.title)}</option>`)
      .join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 class="font-semibold text-slate-100">⚡ Energy Ranker</h2>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-slate-500 mr-1">My energy:</span>
          ${energyButtons}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 mb-3">${columns}</div>

      <form id="task-form" class="flex flex-wrap gap-2">
        <input name="title" placeholder="New task…" required
               class="flex-1 min-w-36 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <select name="energy" class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm">
          <option value="high">🔥 High</option>
          <option value="medium">⚡ Medium</option>
          <option value="low">🌙 Low</option>
        </select>
        <select name="deadline" class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm max-w-36">
          <option value="">No link</option>
          ${deadlineOptions}
        </select>
        <button class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Add</button>
      </form>`;
  },
};
