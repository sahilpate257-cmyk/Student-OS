// energy.js — EnergyRanker: tasks sorted into high/medium/low brainpower lanes

import { Store, escapeHtml } from "./store.js";
import { icon } from "./icons.js";

const LEVELS = [
  { key: "high", label: "High", color: "#B15C3C", hint: "Deep work" },
  { key: "medium", label: "Medium", color: "#C4913E", hint: "Steady" },
  { key: "low", label: "Low", color: "#2E6F5B", hint: "Easy wins" },
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
    Store.subscribe("deadlines:changed", () => this.render());
    this.render();
  },

  render() {
    const current = Store.state.settings.currentEnergy;
    const deadlineTitle = (id) => Store.state.deadlines.find((d) => d.id === id)?.title;

    const energyButtons = LEVELS.map((l) => `
      <button data-action="set-energy" data-level="${l.key}" class="chip ${current === l.key ? "chip-on" : ""}">
        <span class="w-2 h-2 rounded-full" style="background:${l.color}"></span>${l.label}
      </button>`).join("");

    const columns = LEVELS.map((l) => {
      const tasks = Store.state.tasks.filter((t) => t.energy === l.key).sort((a, b) => a.done - b.done);
      const active = current === l.key;

      const cards = tasks.map((t) => {
        const linked = t.linkedDeadlineId ? deadlineTitle(t.linkedDeadlineId) : null;
        return `
          <li class="flex items-start gap-2.5 rounded-lg px-3 py-2.5 group" style="background:var(--surface);border:1px solid var(--border)">
            <button data-action="toggle-task" data-id="${t.id}" class="cbx mt-0.5 ${t.done ? "cbx-on" : ""}" style="width:18px;height:18px">
              ${t.done ? icon("check", 12) : ""}
            </button>
            <div class="flex-1 min-w-0 text-[13.5px]">
              <p class="${t.done ? "line-through faint" : ""}">${escapeHtml(t.title)}</p>
              ${linked ? `<p class="text-[11px] faint truncate flex items-center gap-1 mt-0.5">${icon("link", 11)} ${escapeHtml(linked)}</p>` : ""}
            </div>
            <button data-action="delete-task" data-id="${t.id}" class="reveal btn-icon" style="width:26px;height:26px">${icon("x", 14)}</button>
          </li>`;
      }).join("");

      return `
        <div class="rounded-xl p-3.5" style="background:${active ? "var(--surface-2)" : "var(--sunken)"};border:1px solid ${active ? "var(--border-2)" : "transparent"}">
          <div class="flex items-center justify-between mb-2.5">
            <h3 class="text-[13px] font-semibold flex items-center gap-2" style="color:var(--ink)">
              <span class="w-2 h-2 rounded-full" style="background:${l.color}"></span>${l.label}
            </h3>
            <span class="text-[10.5px] faint">${active ? "Do these now" : l.hint}</span>
          </div>
          <ul class="space-y-2 min-h-[2.5rem]">
            ${cards || `<li class="text-[12px] faint py-1">Nothing here.</li>`}
          </ul>
        </div>`;
    }).join("");

    const deadlineOptions = Store.state.deadlines
      .filter((d) => !d.done)
      .map((d) => `<option value="${d.id}">${escapeHtml(d.title)}</option>`)
      .join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("gauge", 18)}</span>
          <div>
            <h2 class="sect-title leading-tight">Focus</h2>
            <p class="text-[11.5px] faint">Ranked by brainpower</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[11.5px] faint mr-0.5">I'm feeling</span>
          ${energyButtons}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-2.5 mb-4">${columns}</div>

      <form id="task-form" class="flex flex-wrap gap-2">
        <input name="title" placeholder="New task…" required class="input flex-1" style="min-width:140px" />
        <select name="energy" class="input" style="width:auto">
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select name="deadline" class="input" style="width:auto;max-width:150px">
          <option value="">No link</option>
          ${deadlineOptions}
        </select>
        <button class="btn btn-primary">Add</button>
      </form>`;
  },
};
