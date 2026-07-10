// gym.js — GymModule: full workout logger (exercises/sets/reps/weight) + per-lift progress chart

import { Store, todayISO, escapeHtml, formatDate } from "./store.js";

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
      <div class="bg-slate-800/60 rounded-lg p-2.5 space-y-2">
        <div class="flex items-center gap-2">
          <input data-field="ex-name" data-exidx="${exi}" value="${escapeHtml(ex.name)}" placeholder="Exercise name…"
                 class="flex-1 bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
          <button data-action="draft-remove-exercise" data-idx="${exi}" class="text-slate-500 hover:text-rose-400 text-sm px-1">✕</button>
        </div>
        <div class="space-y-1.5">
          ${ex.sets.map((s, si) => `
            <div class="flex items-center gap-2 pl-2">
              <span class="text-[11px] text-slate-500 w-10">Set ${si + 1}</span>
              <input data-field="set-reps" data-exidx="${exi}" data-setidx="${si}" type="number" min="0" value="${s.reps}" placeholder="reps"
                     class="w-16 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
              <span class="text-slate-600 text-xs">×</span>
              <input data-field="set-weight" data-exidx="${exi}" data-setidx="${si}" type="number" min="0" step="0.5" value="${s.weight}" placeholder="kg"
                     class="w-16 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
              <button data-action="draft-remove-set" data-idx="${exi}" data-sidx="${si}" class="text-slate-600 hover:text-rose-400 text-xs px-1">✕</button>
            </div>`).join("")}
          <button data-action="draft-add-set" data-idx="${exi}" class="text-[11px] text-indigo-300 hover:text-indigo-200 pl-2">+ Add set</button>
        </div>
      </div>`).join("");

    const sortedWorkouts = [...Store.state.workouts].sort((a, b) => b.date.localeCompare(a.date));
    const historyHtml = sortedWorkouts.map((w) => `
      <li class="bg-slate-800/50 rounded-xl px-3 py-2.5 group">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm font-medium">${escapeHtml(w.label || "Workout")}</span>
          <span class="text-[11px] text-slate-500">${formatDate(w.date)}</span>
          <span class="flex-1"></span>
          <button data-action="delete-workout" data-id="${w.id}"
                  class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-sm px-1">✕</button>
        </div>
        <ul class="text-xs text-slate-400 space-y-0.5">
          ${w.exercises.map((ex) => `
            <li>${escapeHtml(ex.name)}: ${ex.sets.map((s) => `${s.reps}×${s.weight}kg`).join(", ")}</li>
          `).join("")}
        </ul>
      </li>`).join("");

    const exerciseNames = this.allExerciseNames();
    if (!this.selectedExercise || !exerciseNames.includes(this.selectedExercise)) {
      this.selectedExercise = exerciseNames[exerciseNames.length - 1] ?? null;
    }

    let progressHtml = `<p class="text-sm text-slate-500">Log a workout to see progress here.</p>`;
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
          <div class="flex-1 flex flex-col items-center gap-1 min-w-8">
            <div class="w-full h-24 flex items-end justify-center">
              <div class="w-4 rounded-t bg-indigo-400/80" style="height:${h}%" title="${s.maxWeight}kg on ${formatDate(s.date)}"></div>
            </div>
            <span class="text-[10px] text-slate-500">${formatDate(s.date)}</span>
            <span class="text-[10px] text-indigo-300">${s.maxWeight}kg</span>
          </div>`;
      }).join("");

      const exerciseTabs = exerciseNames.map((name) => `
        <button data-action="select-progress-exercise" data-name="${escapeHtml(name)}"
                class="px-2.5 py-1 rounded-full text-xs border transition
                       ${name === this.selectedExercise ? "bg-indigo-500/20 border-indigo-400/60 text-indigo-200" : "border-slate-700 text-slate-400 hover:border-slate-500"}">
          ${escapeHtml(name)}
        </button>`).join("");

      progressHtml = `
        <div class="flex flex-wrap gap-1.5 mb-3">${exerciseTabs}</div>
        <div class="flex gap-1 overflow-x-auto pb-1">${bars || `<p class="text-sm text-slate-500">No sessions logged for this exercise yet.</p>`}</div>`;
    }

    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-slate-100">🏋️ Gym Log</h2>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 class="text-sm font-semibold text-slate-300 mb-2">Log a workout</h3>
          <div class="flex gap-2 mb-2">
            <input data-field="draft-date" type="date" value="${this.draft.date}"
                   class="bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-300" />
            <input data-field="draft-label" value="${escapeHtml(this.draft.label)}" placeholder="Session label (e.g. Push Day)"
                   class="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-400" />
          </div>
          <div class="space-y-2 mb-2">${draftHtml}</div>
          <div class="flex items-center gap-2">
            <button data-action="draft-add-exercise" class="text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-500/40 rounded-lg px-3 py-1.5">+ Add exercise</button>
            <span class="flex-1"></span>
            <button data-action="save-workout" class="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-medium">Save Workout</button>
          </div>

          <h3 class="text-sm font-semibold text-slate-300 mt-4 mb-2">History</h3>
          <ul class="space-y-2 max-h-56 overflow-y-auto pr-1">
            ${historyHtml || `<li class="text-sm text-slate-500 py-2">No workouts logged yet.</li>`}
          </ul>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-slate-300 mb-2">Progress</h3>
          ${progressHtml}
        </div>
      </div>`;
  },
};
