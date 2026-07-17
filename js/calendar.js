// calendar.js — CalendarModule: month grid + unified deadline list

import { Store, todayISO, escapeHtml, formatDate, SOURCE } from "./store.js";
import { icon } from "./icons.js";

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
        .map((dl) => `<span class="w-1.5 h-1.5 rounded-full" style="background:${SOURCE[dl.source].dot}"></span>`)
        .join("");
      cells += `
        <div class="aspect-square flex flex-col items-center justify-center rounded-lg text-[13px] transition"
             style="${isToday ? "background:var(--ink);color:#FBFAF6;font-weight:600" : "color:var(--ink-muted)"}"
             ${isToday ? "" : 'onmouseover="this.style.background=\'var(--sunken)\'" onmouseout="this.style.background=\'\'"'}>
          <span class="num">${d}</span>
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
        <li class="flex items-center gap-3 py-2.5 group divide-row">
          <button data-action="toggle-deadline" data-id="${dl.id}" class="cbx ${dl.done ? "cbx-on" : ""}">
            ${dl.done ? icon("check", 13) : ""}
          </button>
          <div class="flex-1 min-w-0">
            <p class="text-[13.5px] truncate ${dl.done ? "line-through faint" : ""}">${escapeHtml(dl.title)}</p>
          </div>
          <span class="${s.tag}">${s.label}</span>
          <span class="text-[12px] w-16 text-right num ${overdue ? "neg font-semibold" : "faint"}">${formatDate(dl.dueDate)}</span>
          <button data-action="delete-deadline" data-id="${dl.id}" class="reveal btn-icon" style="width:28px;height:28px">${icon("x", 15)}</button>
        </li>`;
    }).join("");

    this.el.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("calendar", 18)}</span>
          <div>
            <h2 class="sect-title leading-tight">Deadlines</h2>
            <p class="text-[11.5px] faint">${monthName}</p>
          </div>
        </div>
        <div class="flex items-center gap-0.5">
          <button data-action="prev-month" class="btn-icon" style="width:30px;height:30px">${icon("chevronLeft", 17)}</button>
          <button data-action="next-month" class="btn-icon" style="width:30px;height:30px">${icon("chevronRight", 17)}</button>
        </div>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center eyebrow mb-1.5">
        ${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => `<div>${d}</div>`).join("")}
      </div>
      <div class="grid grid-cols-7 gap-1 mb-4">${cells}</div>

      <div class="flex items-center gap-4 text-[12px] muted mb-2">
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${SOURCE.uni.dot}"></span> Uni</span>
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${SOURCE.hustle.dot}"></span> Hustle</span>
      </div>

      <ul class="mb-4 max-h-56 overflow-y-auto pr-1" style="border-top:1px solid var(--border)">
        ${rows || `<li class="py-4 text-[13px] faint text-center">No deadlines yet — add one below.</li>`}
      </ul>

      <form id="deadline-form" class="flex flex-wrap gap-2">
        <input name="title" placeholder="New deadline…" required class="input flex-1" style="min-width:150px" />
        <select name="source" class="input" style="width:auto">
          <option value="uni">Uni</option>
          <option value="hustle">Hustle</option>
        </select>
        <input name="dueDate" type="date" value="${todayISO()}" required class="input" style="width:auto" />
        <button class="btn btn-primary">Add</button>
      </form>`;
  },
};
