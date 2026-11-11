// demo.js — sample data for previewing the signed-in app on localhost (?demo). Never used on the live site.
const iso = (d) => d.toISOString().slice(0, 10);
const ago = (n) => iso(new Date(Date.now() - n * 864e5));
const ahead = (n) => iso(new Date(Date.now() + n * 864e5));
const key = (n) => "d" + ago(n).replace(/-/g, "");

export function demoState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    settings: { userName: "Sahil", currency: "£", currentEnergy: "high", t212Cash: { amount: 420.5, currency: "GBP" } },
    deadlines: [
      { id: "dl1", title: "Stochastic Calculus problem sheet 4", dueDate: ahead(2), source: "uni", done: false },
      { id: "dl2", title: "Dissertation literature review draft", dueDate: ahead(5), source: "uni", done: false },
      { id: "dl3", title: "Send October invoices", dueDate: ago(1), source: "hustle", done: false },
    ],
    tasks: [
      { id: "tk1", title: "Book physio follow-up", energy: "low", done: false },
      { id: "tk2", title: "Review Q4 commission sheet", energy: "medium", done: false },
    ],
    transactions: [
      { id: "t1", type: "income", amount: 1250, category: "Commission", description: "Sales commission", date: ago(3) },
      { id: "t2", type: "expense", amount: 64.2, category: "Groceries", description: "Tesco", date: ago(1) },
      { id: "t3", type: "expense", amount: 38, category: "Eating out", description: "Nando's", date: ago(2) },
      { id: "t4", type: "expense", amount: 11.99, category: "Subscriptions", description: "Spotify", date: ago(4) },
      { id: "t5", type: "expense", amount: 24.5, category: "Transport", description: "Uber", date: ago(5) },
    ].filter((t) => t.date.slice(0, 7) === iso(new Date()).slice(0, 7) || true),
    notes: [
      { id: "n1", title: "Itô's lemma — lecture 7", text: "# Itô's lemma\n\nFor $f(t, X_t)$ with **dX = μ dt + σ dW**:\n\n- Second-order term survives because *dW² = dt*\n- Links to [[Black–Scholes derivation]]\n\n## To revise\n- [x] Quadratic variation\n- [ ] Product rule\n- [ ] Worked example 3\n\n> Key idea: Taylor expand and keep dt terms.", createdAt: ago(2) + "T10:00:00Z", updatedAt: ago(1) + "T18:00:00Z", folder: "Uni", pinned: true },
      { id: "n2", title: "Black–Scholes derivation", text: "Start from a delta-hedged portfolio.\n\n1. Build Π = V − ΔS\n2. Apply Itô\n3. Choose Δ = ∂V/∂S\n\n---\n\nSee [[Itô's lemma — lecture 7]].", createdAt: ago(3) + "T09:00:00Z", folder: "Uni" },
      { id: "n3", text: "- [ ] Chicken breast\n- [ ] Greek yoghurt\n- [x] Oats\n- [ ] Berries", createdAt: ago(0) + "T08:00:00Z" },
      { id: "n4", title: "Ideas for the app", text: "**Space focus game** — fuel a rocket by staying focused.\n\n* Planets to unlock\n* Ship upgrades", createdAt: ago(6) + "T21:00:00Z", folder: "Ideas", source: "voice" },
    ],
    workouts: [
      { id: "w1", date: ago(1), label: "Chest & Tris", exercises: [{ name: "Incline chest press", sets: [{ reps: 10, weight: 50 }, { reps: 9, weight: 50 }, { reps: 8, weight: 50 }] }] },
      { id: "w2", date: ago(3), label: "Back & Bis", exercises: [{ name: "Diverging lat pull down", sets: [{ reps: 12, weight: 45 }, { reps: 10, weight: 45 }] }] },
    ],
    holdings: [
      { id: "h1", ticker: "NVDA", name: "NVIDIA", shares: 6, buyPrice: 98, currentPrice: 182.4, currency: "USD" },
      { id: "h2", ticker: "VUAG", name: "Vanguard S&P 500", shares: 40, buyPrice: 82.1, currentPrice: 96.3, currency: "GBP" },
      { id: "h3", ticker: "TSLA", name: "Tesla", shares: 3, buyPrice: 260, currentPrice: 241.2, currency: "USD" },
    ],
    accounts: [
      { id: "ac1", provider: "chase", name: "Chase", kind: "current", last4: "4412", balances: [{ date: ago(4), amount: 1340 }] },
      { id: "ac2", provider: "revolut", name: "Revolut", kind: "current", balances: [{ date: ago(6), amount: 400.5 }] },
      { id: "ac3", provider: "amex", name: "Amex Gold", kind: "credit", balances: [{ date: ago(3), amount: 270 }] },
    ],
    nutrition: {
      profile: { sex: "male", age: 21, heightCm: 180, weightKg: 82, activity: 1.55, deficit: 500, proteinPerKg: 2 },
      days: { [key(0)]: [{ name: "Oats & whey", kcal: 520, protein: 42, carbs: 60, fat: 12 }, { name: "Chicken wrap", kcal: 610, protein: 48, carbs: 55, fat: 18 }] },
    },
    habits: [{ id: "protein", name: "Protein" }, { id: "water", name: "Water" }, { id: "physio", name: "Knee physio" }, { id: "study", name: "Study" }],
    habitLog: { [key(0)]: { water: 1, study: 1 }, [key(1)]: { protein: 1 }, [key(2)]: { physio: 1 } },
    focusLog: { [key(0)]: 50, [key(1)]: 90, [key(3)]: 25 },
    updatedAt: now,
  };
}
