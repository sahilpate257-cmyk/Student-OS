// gym.js — GymModule: full workout logger (exercises/sets/reps/weight) + per-lift progress chart

import { Store, todayISO, escapeHtml, formatDate } from "./store.js";
import { icon } from "./icons.js";

export const GymModule = {
  el: null,
  draft: null,
  selectedExercise: null,

  init() {
    this.el = document.getElementById("gym-module");
    this.resetDraft();

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, idx, sidx, id, name } = btn.dataset;
      if (action === "draft-add-exercise") {
        this.draft.exercises.push({ name: "", sets: [{ reps: "", weight: "" }] });
        this.render();
      } else if (action === "draft-remove-exercise") {
        this.draft.exercises.splice(Number(idx), 1);
        this.render();
      } else if (action === "draft-add-set") {
        this.draft.exercises[Number(idx)].sets.push({ reps: "", weight: "" });
        this.render();
      } else if (action === "draft-remove-set") {
        this.draft.exercises[Number(idx)].sets.splice(Number(sidx), 1);
        this.render();
      } else if (action === "save-workout") {
        this.saveWorkout();
      } else if (action === "delete-workout") {
        Store.remove("workouts", id);
      } else if (action === "select-progress-exercise") {
        this.selectedExercise = name;
        this.render();
      }
    });

    this.el.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.field === "draft-date") {
        this.draft.date = t.value;
      } else if (t.dataset.field === "draft-label") {
        this.draft.label = t.value;
      } else if (t.dataset.field === "ex-name") {
        this.draft.exercises[Number(t.dataset.exidx)].name = t.value;
      } else if (t.dataset.field === "set-reps") {
        this.draft.exercises[Number(t.dataset.exidx)].sets[Number(t.dataset.setidx)].reps = t.value;
      } else if (t.dataset.field === "set-weight") {
        this.draft.exercises[Number(t.dataset.exidx)].sets[Number(t.dataset.setidx)].weight = t.value;
      }
    });

    Store.subscribe("workouts:changed", () => this.render());
    this.render();
  },

  resetDraft() {
    this.draft = {
      date: todayISO(),
      label: "",
      exercises: [{ name: "", sets: [{ reps: "", weight: "" }] }],
    };
  },

  saveWorkout() {
    const exercises = this.draft.exercises
      .map((ex) => ({
        name: ex.name.trim(),
        sets: ex.sets
          .map((s) => ({ reps: parseFloat(s.reps), weight: parseFloat(s.weight) }))
          .filter((s) => s.reps > 0 && s.weight >= 0 && !isNaN(s.reps) && !isNaN(s.weight)),
      }))
      .filter((ex) => ex.name && ex.sets.length > 0);

    if (exercises.length === 0) return;

    Store.add("workouts", {
      id: Store.uid("wo"),
      date: this.draft.date || todayISO(),
      label: this.draft.label.trim(),
      exercises,
    });
    this.resetDraft();
  },

  allExerciseNames() {
    const names = new Set();
    Store.state.workouts.forEach((w) => w.exercises.forEach((ex) => names.add(ex.name)));
    return [...names].sort((a, b) => a.localeCompare(b));
  },

  render() {
    const draftHtml = this.draft.exercises.map((ex, exi) => `
      <div class="well p-3 space-y-2">
        <div class="flex items-center gap-2">
          <input data-field="ex-name" data-exidx="${exi}" value="${escapeHtml(ex.name)}" placeholder="Exercise name…" class="input flex-1" />
          <button data-action="draft-remove-exercise" data-idx="${exi}" class="btn-icon" style="width:30px;height:30px">${icon("x", 15)}</button>
        </div>
        <div class="space-y-1.5">
          ${ex.sets.map((s, si) => `
            <div class="flex items-center gap-2 pl-1">
              <span class="text-[11px] faint w-9">Set ${si + 1}</span>
              <input data-field="set-reps" data-exidx="${exi}" data-setidx="${si}" type="number" min="0" value="${s.reps}" placeholder="reps" class="input num" style="width:70px;padding:6px 10px" />
              <span class="faint text-xs">×</span>
              <input data-field="set-weight" data-exidx="${exi}" data-setidx="${si}" type="number" min="0" step="0.5" value="${s.weight}" placeholder="kg" class="input num" style="width:70px;padding:6px 10px" />
              <button data-action="draft-remove-set" data-idx="${exi}" data-sidx="${si}" class="btn-icon" style="width:26px;height:26px">${icon("x", 13)}</button>
            </div>`).join("")}
          <button data-action="draft-add-set" data-idx="${exi}" class="text-[12px] font-semibold pl-1 flex items-center gap-1" style="color:var(--ink)">${icon("plus", 13)} Add set</button>
        </div>
      </div>`).join("");

    const sortedWorkouts = [...Store.state.workouts].sort((a, b) => b.date.localeCompare(a.date));
    const historyHtml = sortedWorkouts.map((w) => `
      <li class="well px-3.5 py-3 group">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[13.5px] font-semibold">${escapeHtml(w.label || "Workout")}</span>
          <span class="text-[11px] faint">${formatDate(w.date)}</span>
          <span class="flex-1"></span>
          <button data-action="delete-workout" data-id="${w.id}" class="reveal btn-icon" style="width:26px;height:26px">${icon("x", 14)}</button>
        </div>
        <ul class="text-[12px] muted space-y-0.5 num">
          ${w.exercises.map((ex) => `<li>${escapeHtml(ex.name)}: ${ex.sets.map((s) => `${s.reps}×${s.weight}kg`).join(", ")}</li>`).join("")}
        </ul>
      </li>`).join("");

    const exerciseNames = this.allExerciseNames();
    if (!this.selectedExercise || !exerciseNames.includes(this.selectedExercise)) {
      this.selectedExercise = exerciseNames[exerciseNames.length - 1] ?? null;
    }

    let progressHtml = `<p class="text-[13px] faint py-4">Log a workout to track your progress.</p>`;
    if (this.selectedExercise) {
      const sessions = sortedWorkouts
        .slice()
        .reverse()
        .map((w) => {
          const ex = w.exercises.find((e) => e.name === this.selectedExercise);
          if (!ex) return null;
          const maxWeight = Math.max(...ex.sets.map((s) => s.weight));
          return { date: w.date, maxWeight };
        })
        .filter(Boolean);

      const maxVal = Math.max(1, ...sessions.map((s) => s.maxWeight));
      const bars = sessions.map((s) => {
        const h = Math.round((s.maxWeight / maxVal) * 100);
        return `
          <div class="flex-1 flex flex-col items-center gap-1.5 min-w-8">
            <span class="text-[10px] num" style="color:var(--ink)">${s.maxWeight}</span>
            <div class="w-full h-28 flex items-end justify-center">
              <div class="w-5 rounded-t-[3px]" style="height:${Math.max(h, 3)}%;background:var(--ink)" title="${s.maxWeight}kg on ${formatDate(s.date)}"></div>
            </div>
            <span class="text-[10px] faint num">${formatDate(s.date)}</span>
          </div>`;
      }).join("");

      const exerciseTabs = exerciseNames.map((name) => `
        <button data-action="select-progress-exercise" data-name="${escapeHtml(name)}" class="chip ${name === this.selectedExercise ? "chip-on" : ""}">${escapeHtml(name)}</button>`).join("");

      progressHtml = `
        <div class="flex flex-wrap gap-1.5 mb-4">${exerciseTabs}</div>
        <div class="flex gap-1.5 overflow-x-auto pb-1">${bars || `<p class="text-[13px] faint">No sessions logged for this exercise yet.</p>`}</div>`;
    }

    this.el.innerHTML = `
      <div class="flex items-center gap-2.5 mb-4">
        <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("dumbbell", 18)}</span>
        <h2 class="sect-title">Training</h2>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p class="eyebrow mb-2.5">Log a workout</p>
          <div class="flex gap-2 mb-2.5">
            <input data-field="draft-date" type="date" value="${this.draft.date}" class="input" style="width:auto" />
            <input data-field="draft-label" value="${escapeHtml(this.draft.label)}" placeholder="Session label (e.g. Push Day)" class="input flex-1" />
          </div>
          <div class="space-y-2 mb-3">${draftHtml}</div>
          <div class="flex items-center gap-2">
            <button data-action="draft-add-exercise" class="btn btn-ghost btn-sm">${icon("plus", 14)} Add exercise</button>
            <span class="flex-1"></span>
            <button data-action="save-workout" class="btn btn-primary">Save workout</button>
          </div>

          <p class="eyebrow mt-5 mb-2.5">History</p>
          <ul class="space-y-2 max-h-56 overflow-y-auto pr-1">
            ${historyHtml || `<li class="text-[13px] faint py-2">No workouts logged yet.</li>`}
          </ul>
        </div>

        <div>
          <p class="eyebrow mb-2.5">Progress</p>
          ${progressHtml}
        </div>
      </div>`;
  },
};
