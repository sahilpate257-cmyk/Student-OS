// calendar.js — CalendarModule: month grid + unified deadline list

import { Store, todayISO, escapeHtml, formatDate, SOURCE } from "./store.js";

export const CalendarModule = {
  el: null,
  view: { y: 0, m: 0 }, // m is 0-indexed

  init() {
    this.el = document.getElementById("calendar-module");
    const now = new Date();
    this.view = { y: now.getFullYear(), m: now.getMonth() };

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "prev-month") {
        this.view.m--;
        if (this.view.m < 0) { this.view.m = 11; this.view.y--; }
        this.render();
      } else if (action === "next-month") {
        this.view.m++;
        if (this.view.m > 11) { this.view.m = 0; this.view.y++; }
        this.render();
      } else if (action === "toggle-deadline") {
        const dl = Store.state.deadlines.find((d) => d.id === id);
        if (dl) Store.update("deadlines", id, { done: !dl.done });
      } else if (action === "delete-deadline") {
        Store.remove("deadlines", id);
      }
    });

    this.el.addEventListener("submit", (e) => {
      if (e.target.id !== "deadline-form") return;
      e.preventDefault();
      const f = e.target;
      const title = f.title.value.trim();
      const dueDate = f.dueDate.value;
      if (!title || !dueDate) return;
      Store.add("deadlines", {
        id: Store.uid("dl"),
        title,
        source: f.source.value,
        dueDate,
        done: false,
        notes: "",
      });
      f.reset();
      f.dueDate.value = todayISO();
    });

    Store.subscribe("deadlines:changed", () => this.render());
    this.render();
  },

  render() {
    const { y, m } = this.view;
    const today = todayISO();
    const monthName = new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

    // deadlines grouped by date for dot markers
    const byDate = {};
    for (const dl of Store.state.deadlines) {
      (byDate[dl.dueDate] ??= []).push(dl);
    }

    // month grid, Monday-start
    const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < firstWeekday; i++) cells += `<div></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = iso === today;
      const dots = (byDate[iso] ?? [])
        .slice(0, 3)
        .map((dl) => `<span class="w-1.5 h-1.5 rounded-full ${SOURCE[dl.source].dot}"></span>`)
        .join("");
      cells += `
        <div class="aspect-square flex flex-col items-center justify-center rounded-lg text-sm
                    ${isToday ? "bg-indigo-500/20 ring-1 ring-indigo-400 font-bold text-indigo-200" : "text-slate-300 hover:bg-slate-800/60"}">
          <span>${d}</span>
          <span class="flex gap-0.5 h-1.5 mt-0.5">${dots}</span>
        </div>`;
    }

    // deadline list: pending first (soonest on top), then done
    const sorted = [...Store.state.deadlines].sort((a, b) =>
      a.done - b.done || a.dueDate.localeCompare(b.dueDate)
    );
    const rows = sorted.map((dl) => {
      const overdue = !dl.done && dl.dueDate < today;
      const s = SOURCE[dl.source];
      return `
        <li class="flex items-center gap-3 py-2 group">
          <button data-action="toggle-deadline" data-id="${dl.id}"
                  class="w-5 h-5 shrink-0 rounded border ${dl.done ? "bg-emerald-500 border-emerald-500" : "border-slate-600 hover:border-slate-400"} flex items-center justify-center text-xs text-slate-950 font-bold">
            ${dl.done ? "✓" : ""}
          </button>
          <div class="flex-1 min-w-0">
            <p class="truncate ${dl.done ? "line-through text-slate-500" : ""}">${escapeHtml(dl.title)}</p>
          </div>
          <span class="text-[11px] px-2 py-0.5 rounded-full ${s.badge}">${s.label}</span>
          <span class="text-xs w-16 text-right ${overdue ? "text-rose-400 font-semibold" : "text-slate-400"}">
            ${overdue ? "⚠ " : ""}${formatDate(dl.dueDate)}
          </span>
          <button data-action="delete-deadline" data-id="${dl.id}"
                  class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1">✕</button>
        </li>`;
    }).join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-slate-100">📅 Calendar &amp; Deadlines</h2>
        <div class="flex items-center gap-2 text-sm">
          <button data-action="prev-month" class="px-2 py-1 rounded hover:bg-slate-800">‹</button>
          <span class="w-32 text-center text-slate-300">${monthName}</span>
          <button data-action="next-month" class="px-2 py-1 rounded hover:bg-slate-800">›</button>
        </div>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center text-xs text-slate-500 mb-1">
        ${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => `<div>${d}</div>`).join("")}
      </div>
      <div class="grid grid-cols-7 gap-1 mb-4">${cells}</div>

      <div class="flex items-center gap-3 text-xs text-slate-400 mb-2">
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-400"></span> Uni</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Hustle</span>
      </div>

      <ul class="divide-y divide-slate-800 mb-3 max-h-56 overflow-y-auto">
        ${rows || `<li class="py-3 text-sm text-slate-500">No deadlines yet — add one below.</li>`}
      </ul>

      <form id="deadline-form" class="flex flex-wrap gap-2">
        <input name="title" placeholder="New deadline…" required
               class="flex-1 min-w-40 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
        <select name="source" class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm">
          <option value="uni">🎓 Uni</option>
          <option value="hustle">💼 Hustle</option>
        </select>
        <input name="dueDate" type="date" value="${todayISO()}" required
               class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-300" />
        <button class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Add</button>
      </form>`;
  },
};
