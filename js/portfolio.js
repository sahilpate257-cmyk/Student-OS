// portfolio.js — PortfolioModule: global-market holdings monitor.
// Quotes + company names via Yahoo Finance (all exchanges, through a CORS proxy),
// Finnhub as US-only fallback, live multi-currency FX via frankfurter (ECB),
// buy-merging, editable holdings, refined allocation donut.

import { Store, auth, escapeHtml } from "./store.js";
import { icon } from "./icons.js";

const FINNHUB_KEY = "d98ii7hr01qkl0vtf940d98ii7hr01qkl0vtf94g";
const WORKER_URL = "https://ledgerly-ai-intake.sahilpatel-ledgerly.workers.dev";

const proxied = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;

async function yahooJson(url) {
  const res = await fetch(proxied(url));
  if (!res.ok) throw new Error("quote service unavailable");
  return res.json();
}

function normQuote(meta) {
  let price = meta.regularMarketPrice;
  let currency = meta.currency || "USD";
  if (currency === "GBp" || currency === "GBX") { price = price / 100; currency = "GBP"; }
  return { symbol: meta.symbol, name: meta.longName || meta.shortName || meta.symbol, currency, price };
}

async function yahooChart(symbol) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error("no data");
  return normQuote(meta);
}

async function yahooSearch(q) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`);
  const quotes = (j.quotes || []).filter((x) => x.symbol && ["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY"].includes(x.quoteType));
  if (!quotes.length) throw new Error("not found");
  const Q = q.toUpperCase();
  const exact = quotes.find((x) => x.symbol.toUpperCase() === Q || x.symbol.toUpperCase().startsWith(Q + "."));
  return (exact || quotes[0]).symbol;
}

async function resolveTicker(input) {
  const q = input.trim().toUpperCase();
  try { return await yahooChart(q); } catch (e) {}
  try { return await yahooChart(await yahooSearch(q)); } catch (e) {}
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`);
    if (res.ok) {
      const d = await res.json();
      if (d.c) return { symbol: q, name: q, currency: "USD", price: d.c };
    }
  } catch (e) {}
  throw new Error("not found");
}

// ---- Trading 212 ----
// Proxied through the Worker: T212 sends no CORS headers, and its key is a
// brokerage credential that must never reach the browser.
async function fetchT212Holdings() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch(`${WORKER_URL}/t212/portfolio`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Trading 212 sync failed");
  return data;
}

// ---- FX: generic pair cache backed by frankfurter (ECB) ----
const fxCache = {};
const fxPending = {};
const rateKey = (f, t) => `${f}->${t}`;
const getRateSync = (f, t) => (f === t ? 1 : fxCache[rateKey(f, t)] ?? null);

function fetchRate(from, to) {
  const k = rateKey(from, to);
  if (fxCache[k] != null) return Promise.resolve(fxCache[k]);
  if (!fxPending[k]) {
    fxPending[k] = (async () => {
      const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
      if (!r.ok) throw new Error("fx failed");
      fxCache[k] = (await r.json()).rates[to];
      return fxCache[k];
    })().finally(() => { delete fxPending[k]; });
  }
  return fxPending[k];
}

const PIE_CSS = `
#portfolio-module { position: relative; }
#pie-tooltip { position:absolute; pointer-events:none; background:var(--surface); border:1px solid var(--border-2); border-radius:10px; padding:8px 11px; font-size:12px; line-height:1.5; color:var(--ink); box-shadow:var(--shadow-md); opacity:0; transition:opacity .14s; z-index:30; white-space:nowrap; max-width:240px; }

/* Hero: the account total carries the weight, the split beneath explains it. */
.hero { border:1px solid var(--border); border-radius:var(--r-card); overflow:hidden; background:var(--surface-2); }
.hero-main { padding:18px 18px 16px; }
.hero-fig { font-size:38px; font-weight:500; line-height:1; letter-spacing:-.5px; color:var(--ink); }
.hero-split { display:grid; grid-template-columns:1fr 1fr; border-top:1px solid var(--border); }
.hero-part { padding:11px 18px 13px; }
.hero-part + .hero-part { border-left:1px solid var(--border); }
@media (max-width: 380px) { .hero-fig { font-size:32px; } }

/* Donut: light hairline between segments, soft lift off the surface. */
.pie-anim { animation: pieIn .85s cubic-bezier(.22,1,.36,1) backwards; filter: drop-shadow(0 6px 16px rgba(0,0,0,.28)); }
@keyframes pieIn { from { opacity:0; transform: scale(.92); } }
.pie-seg { stroke: var(--surface); stroke-width:2.5; cursor:pointer; transform-origin:110px 110px; transition: transform .22s cubic-bezier(.22,1,.36,1), filter .22s ease; animation: segIn .55s ease backwards; }
@keyframes segIn { from { opacity:0; } }
.pie-seg:hover { filter: brightness(1.12); transform: translate(var(--tx), var(--ty)); }
`;

export const PortfolioModule = {
  el: null,
  refreshing: false,
  showBuyForm: false,
  editingId: null,
  resolved: null,
  t212Error: null,
  t212SyncedAt: null,
  pending: null, // "reset" | "clear" - inline confirmation state

  init() {
    this.el = document.getElementById("portfolio-module");

    if (!document.getElementById("portfolio-css")) {
      const style = document.createElement("style");
      style.id = "portfolio-css";
      style.textContent = PIE_CSS;
      document.head.appendChild(style);
    }

    this.el.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "delete-holding") {
        Store.remove("holdings", id);
      } else if (action === "reset-reimport") {
        // Native confirm() is suppressed in embedded webviews and in-app browsers,
        // so destructive steps confirm inline instead.
        this.pending = "reset";
        this.render();
      } else if (action === "clear-manual") {
        this.pending = "clear";
        this.render();
      } else if (action === "cancel-pending") {
        this.pending = null;
        this.render();
      } else if (action === "confirm-pending") {
        const kind = this.pending;
        this.pending = null;
        if (kind === "clear") {
          Store.state.holdings.filter((h) => h.source !== "t212").forEach((h) => Store.remove("holdings", h.id));
          this.render();
        } else if (kind === "reset") {
          [...Store.state.holdings].forEach((h) => Store.remove("holdings", h.id));
          this.refreshing = true;
          this.t212Error = null;
          this.render();
          try {
            await this.syncT212();
          } catch (err) {
            this.t212Error = err.message || "Re-import failed";
          }
          this.refreshing = false;
          this.render();
        }
      } else if (action === "refresh-prices") {
        this.refreshAll();
      } else if (action === "toggle-buy-form") {
        this.showBuyForm = !this.showBuyForm;
        this.editingId = null;
        this.resolved = null;
        this.render();
        this.el.querySelector("#buy-form input[name=ticker]")?.focus();
      } else if (action === "edit-holding") {
        this.editingId = id;
        this.showBuyForm = false;
        this.render();
        this.el.querySelector("#edit-form input[name=shares]")?.focus();
      } else if (action === "cancel-edit") {
        this.editingId = null;
        this.render();
      } else if (action === "set-portfolio-currency") {
        Store.setSetting("portfolioCurrency", btn.dataset.currency);
      }
    });

    this.el.addEventListener("change", async (e) => {
      if (e.target.name !== "ticker") return;
      const q = e.target.value.trim();
      const prev = this.el.querySelector("#ticker-preview");
      if (!q || !prev) return;
      prev.innerHTML = `<span class="faint">Looking up “${escapeHtml(q)}”…</span>`;
      try {
        const r = await resolveTicker(q);
        this.resolved = { query: q.toUpperCase(), ...r };
        const curPrev = this.el.querySelector("#ticker-preview");
        if (curPrev) curPrev.innerHTML = `
          <span class="font-semibold" style="color:var(--ink)">${escapeHtml(r.name)}</span>
          <span class="faint ml-1">${escapeHtml(r.symbol)} · trades in ${r.currency} · now ${r.currency === "GBP" ? "£" : r.currency === "USD" ? "$" : r.currency + " "}${r.price}</span>`;
      } catch {
        this.resolved = null;
        const curPrev = this.el.querySelector("#ticker-preview");
        if (curPrev) curPrev.innerHTML = `<span class="neg">Couldn’t find “${escapeHtml(q)}” on any exchange — try the company name or another symbol.</span>`;
      }
    });

    this.el.addEventListener("submit", async (e) => {
      if (e.target.id === "buy-form") { e.preventDefault(); this.submitBuy(e.target); }
      else if (e.target.id === "edit-form") { e.preventDefault(); this.submitEdit(e.target); }
    });

    this.el.addEventListener("mousemove", (e) => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (!tip) return;
      const seg = e.target.closest?.(".pie-seg");
      if (!seg) { tip.style.opacity = "0"; return; }
      const rect = this.el.getBoundingClientRect();
      tip.style.left = `${e.clientX - rect.left + 14}px`;
      tip.style.top = `${e.clientY - rect.top - 12}px`;
      tip.style.opacity = "1";
      tip.innerHTML = `<b>${seg.dataset.name}</b><br><span class="faint">${seg.dataset.value} · ${seg.dataset.pct}% of portfolio</span>`;
    });
    this.el.addEventListener("mouseleave", () => {
      const tip = this.el.querySelector("#pie-tooltip");
      if (tip) tip.style.opacity = "0";
    });

    Store.subscribe("holdings:changed", () => this.render());

    // Pull Trading 212 positions once on load; a no-op for accounts without the link.
    this.syncT212().then(() => this.render()).catch(() => {});
    Store.subscribe("settings:changed", () => this.render());
    this.render();
  },

  async submitBuy(f) {
    const q = f.ticker.value.trim().toUpperCase();
    const shares = parseFloat(f.shares.value);
    const price = parseFloat(f.price.value);
    if (!q || !(shares > 0) || !(price > 0)) return;

    const errEl = this.el.querySelector("#buy-form-error");
    errEl.classList.add("hidden");
    const submitBtn = f.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";

    try {
      const r = this.resolved?.query === q ? this.resolved : await resolveTicker(q);
      this.showBuyForm = false;
      this.resolved = null;
      const existing = Store.state.holdings.find((h) => h.ticker === r.symbol);
      if (existing) {
        const totalShares = existing.shares + shares;
        const avgPrice = (existing.shares * existing.buyPrice + shares * price) / totalShares;
        Store.update("holdings", existing.id, {
          shares: +totalShares.toFixed(6),
          buyPrice: +avgPrice.toFixed(4),
          name: r.name,
          currency: r.currency,
          currentPrice: r.price,
          lastUpdated: new Date().toISOString(),
        });
      } else {
        Store.add("holdings", {
          id: Store.uid("hd"),
          ticker: r.symbol,
          name: r.name,
          currency: r.currency,
          shares,
          buyPrice: price,
          currentPrice: r.price,
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.showBuyForm = true;
      this.render();
      const restoredErr = this.el.querySelector("#buy-form-error");
      restoredErr.textContent = `Couldn’t find "${q}" on any exchange — try the company name or the full symbol (e.g. VUAG.L).`;
      restoredErr.classList.remove("hidden");
    }
  },

  submitEdit(f) {
    const shares = parseFloat(f.shares.value);
    const buyPrice = parseFloat(f.avgPrice.value);
    if (!(shares > 0) || !(buyPrice > 0)) return;
    const id = this.editingId;
    this.editingId = null;
    Store.update("holdings", id, { shares, buyPrice });
  },

  cur() { return Store.state.settings.portfolioCurrency ?? "£"; },
  displayCurrency() { return this.cur() === "£" ? "GBP" : "USD"; },
  conv(amount, fromCur) {
    const rate = getRateSync(fromCur || "USD", this.displayCurrency());
    return rate == null ? null : amount * rate;
  },
  fmt(v) {
    if (v == null) return "…";
    return `${this.cur()}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  ensureRates(holdings) {
    const target = this.displayCurrency();
    const cashCcy = Store.state.settings.t212Cash?.currency;
    const missing = [...new Set([...holdings.map((h) => h.currency || "USD"), ...(cashCcy ? [cashCcy] : [])])]
      .filter((c) => c !== target && getRateSync(c, target) == null);
    if (!missing.length) return;
    Promise.allSettled(missing.map((c) => fetchRate(c, target))).then(() => this.render());
  },

  // Trading 212 is authoritative for what is held and at what cost, so reconcile
  // those first; Yahoo then only has to price the manually-added holdings.
  async syncT212() {
    const { holdings: live, cash, syncedAt } = await fetchT212Holdings();
    Store.setSetting("t212Cash", cash || null);
    const incoming = new Map(live.map((h) => [h.t212Ticker, h]));

    Store.state.holdings
      .filter((h) => h.source === "t212")
      .forEach((h) => {
        const match = incoming.get(h.t212Ticker);
        if (!match) return Store.remove("holdings", h.id); // position closed
        Store.update("holdings", h.id, {
          ticker: match.ticker,
          name: match.name,
          currency: match.currency,
          shares: match.shares,
          buyPrice: match.buyPrice,
          currentPrice: match.currentPrice,
          lastUpdated: syncedAt,
        });
        incoming.delete(h.t212Ticker);
      });

    incoming.forEach((m) => {
      Store.add("holdings", {
        id: Store.uid("hd"),
        source: "t212",
        t212Ticker: m.t212Ticker,
        ticker: m.ticker,
        name: m.name,
        currency: m.currency,
        shares: m.shares,
        buyPrice: m.buyPrice,
        currentPrice: m.currentPrice,
        lastUpdated: syncedAt,
      });
    });

    this.t212SyncedAt = syncedAt;
    return live.length;
  },

  async refreshAll() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.t212Error = null;
    this.render();

    try {
      await this.syncT212();
    } catch (e) {
      // A signed-in account with no T212 link is a normal state, not an error.
      this.t212Error = /enabled for this account|Not signed in/.test(e.message) ? null : e.message;
    }

    // Manual holdings still price off Yahoo; synced ones already carry a live price.
    const manual = Store.state.holdings.filter((h) => h.source !== "t212");
    const results = await Promise.allSettled(manual.map((h) => resolveTicker(h.ticker)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        Store.update("holdings", manual[i].id, {
          currentPrice: r.value.price,
          name: r.value.name,
          currency: r.value.currency,
          lastUpdated: new Date().toISOString(),
        });
      }
    });
    Object.keys(fxCache).forEach((k) => delete fxCache[k]);

    this.refreshing = false;
    this.render();
  },

  // Donut, grouped to the top 5 plus "Other". A ring stops being readable past
  // ~6 segments, so the grouping is what makes this form legitimate for a 12-stock
  // portfolio. Segments are one hue in validated steps (an 8-step version of this
  // ramp failed the adjacent-lightness check), with "Other" held back in neutral
  // grey so it reads as a remainder rather than a sixth holding.
  renderPie(holdings, totalValue) {
    if (!holdings.length || totalValue == null || totalValue <= 0) {
      return `<div class="text-[13px] faint py-16 text-center">${holdings.length ? "Loading exchange rates…" : "Add a holding to see your allocation."}</div>`;
    }

    // Validated ordinal ramp (dark surface): passes monotone lightness, adjacent
    // dL and the dark-end contrast floor. Deliberately starts vivid rather than
    // near-white - a pale top step plus the specular sweep washes the ring out.
    const RAMP = ["#9ec9f9", "#62a8f2", "#3081e0", "#2063b4", "#184f95"];
    const OTHER = "#2b3347";   // recessive navy-grey: a remainder, not a holding
    const TOP = 5;

    const sorted = holdings
      .map((h) => ({ label: h.ticker, name: h.name || h.ticker, val: this.conv(h.shares * h.currentPrice, h.currency) ?? 0 }))
      .sort((a, b) => b.val - a.val);

    const slices = sorted.slice(0, TOP).map((d, i) => ({ ...d, colour: RAMP[i] }));
    const rest = sorted.slice(TOP);
    if (rest.length) {
      slices.push({
        label: "Other",
        name: `${rest.length} smaller holding${rest.length === 1 ? "" : "s"}`,
        val: rest.reduce((t, d) => t + d.val, 0),
        colour: OTHER,
      });
    }

    const cx = 110, cy = 110, rO = 100, rI = 58;
    let a = -Math.PI / 2;
    let defs = "";

    const sheen = `
      <linearGradient id="pie-sheen" gradientUnits="userSpaceOnUse" x1="30" y1="18" x2="178" y2="200">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
        <stop offset="34%" stop-color="#ffffff" stop-opacity="0.04"/>
        <stop offset="62%" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="pie-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="7" result="b"/>
        <feColorMatrix in="b" type="matrix"
          values="0 0 0 0 0.22  0 0 0 0 0.53  0 0 0 0 0.90  0 0 0 0.55 0" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;

    const segs = slices.map((d, i) => {
      const frac = d.val / totalValue;
      const span = Math.min(Math.max(frac, 0) * 2 * Math.PI, 2 * Math.PI - 0.0001);
      const a0 = a, a1 = a + span;
      a = a1;
      // Depth the way the reference does it: lift at the inner edge, deepen at the rim.
      // Gloss, the way the reference does it: the band is lit along its inner edge,
      // deepens toward the rim, then a soft specular sweep rides over the top-left.
      defs += `<radialGradient id="pg${i}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${rO}">
          <stop offset="${((rI / rO) * 100).toFixed(0)}%" stop-color="${d.colour}" stop-opacity="1"/>
          <stop offset="${(((rI / rO) + 0.16) * 100).toFixed(0)}%" stop-color="${d.colour}" stop-opacity="0.96"/>
          <stop offset="88%" stop-color="${d.colour}" stop-opacity="0.70"/>
          <stop offset="100%" stop-color="${d.colour}" stop-opacity="0.46"/>
        </radialGradient>`;
      const pt = (r, ang) => `${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const path = `M ${pt(rO, a0)} A ${rO} ${rO} 0 ${large} 1 ${pt(rO, a1)} L ${pt(rI, a1)} A ${rI} ${rI} 0 ${large} 0 ${pt(rI, a0)} Z`;
      const mid = (a0 + a1) / 2;
      return `<path class="pie-seg" d="${path}" fill="url(#pg${i})"
          style="--tx:${(Math.cos(mid) * 5).toFixed(1)}px; --ty:${(Math.sin(mid) * 5).toFixed(1)}px; animation-delay:${i * 80}ms"
          data-name="${escapeHtml(d.name)}" data-pct="${(frac * 100).toFixed(1)}" data-value="${this.fmt(d.val)}"></path>`;
    }).join("");

    const legend = slices.map((d) => `
      <span class="flex items-center gap-1.5 text-[12px] muted">
        <span class="w-2.5 h-2.5 rounded-[3px]" style="background:${d.colour}"></span>${escapeHtml(d.label)}
        <span class="faint num">${((d.val / totalValue) * 100).toFixed(0)}%</span>
      </span>`).join("");

    return `
      <div class="flex flex-col items-center gap-4 pt-1">
        <svg viewBox="0 0 220 220" class="w-56 h-56 pie-anim">
          <defs>${defs}${sheen}</defs>
          <g filter="url(#pie-glow)">${segs}</g>
          <circle cx="${cx}" cy="${(cy + rO) / 2 + 2}" r="0"/>
          <path d="M ${cx} ${cy - rO} A ${rO} ${rO} 0 1 1 ${cx - 0.01} ${cy - rO} Z M ${cx} ${cy - rI} A ${rI} ${rI} 0 1 0 ${cx + 0.01} ${cy - rI} Z"
                fill="url(#pie-sheen)" fill-rule="evenodd" pointer-events="none"/>
          <text x="110" y="105" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="Manrope,sans-serif" letter-spacing="1.4">TOTAL</text>
          <text x="110" y="127" text-anchor="middle" fill="var(--ink)" font-size="19" font-weight="500" font-family="Fraunces,Georgia,serif">${this.fmt(totalValue)}</text>
        </svg>
        <div class="flex flex-wrap justify-center gap-x-3.5 gap-y-1.5">${legend}</div>
      </div>`;
  },

  render() {
    const holdings = [...Store.state.holdings];
    this.ensureRates(holdings);

    const convValue = (h) => this.conv(h.shares * h.currentPrice, h.currency);
    holdings.sort((a, b) => (convValue(b) ?? 0) - (convValue(a) ?? 0));

    let totalCost = 0, totalValue = 0, ratesMissing = false;
    const rows = holdings.map((h, i) => {
      const cost = this.conv(h.shares * h.buyPrice, h.currency);
      const value = convValue(h);
      if (cost == null || value == null) { ratesMissing = true; }
      else { totalCost += cost; totalValue += value; }
      const gain = cost != null && value != null ? value - cost : null;
      const gainPct = gain != null && cost > 0 ? (gain / cost) * 100 : null;
      const up = (gain ?? 0) >= 0;
      const isEditing = this.editingId === h.id;
      const editForm = isEditing ? `
        <form id="edit-form" class="w-full flex flex-wrap items-end gap-2 mt-2 well p-3" style="border:1px solid var(--border-2)">
          <label class="text-[11px] faint">Shares<br>
            <input name="shares" type="number" step="any" min="0.000001" value="${h.shares}" class="input num mt-1" style="width:110px" /></label>
          <label class="text-[11px] faint">Avg price (${h.currency || "USD"})<br>
            <input name="avgPrice" type="number" step="any" min="0.000001" value="${h.buyPrice}" class="input num mt-1" style="width:110px" /></label>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
          <button type="button" data-action="cancel-edit" class="btn btn-ghost btn-sm">Cancel</button>
        </form>` : "";
      return `
        <li class="flex items-center gap-3 py-2.5 group flex-wrap divide-row">
          <div class="flex-1 min-w-0">
            <p class="text-[13.5px] font-semibold truncate">${escapeHtml(h.name || h.ticker)}
              <span class="text-[11px] faint font-normal ml-0.5">${escapeHtml(h.ticker)}</span>${
                h.source === "t212"
                  ? `<span class="text-[9.5px] font-semibold ml-1 px-1 py-px rounded align-middle" style="background:var(--sunken);color:var(--muted)">212</span>`
                  : ""
              }</p>
            <p class="text-[11.5px] faint num">${h.shares} sh · avg ${this.fmt(this.conv(h.buyPrice, h.currency))} → ${this.fmt(this.conv(h.currentPrice, h.currency))}</p>
          </div>
          <div class="text-right">
            <p class="text-[13.5px] font-semibold num">${this.fmt(value)}</p>
            <p class="text-[11.5px] num ${up ? "pos" : "neg"}">${gain == null ? "…" : `${up ? "+" : "−"}${this.fmt(Math.abs(gain))} · ${up ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%`}</p>
          </div>
          <button data-action="edit-holding" data-id="${h.id}" class="reveal btn-icon" style="width:28px;height:28px" title="Edit">${icon("pencil", 14)}</button>
          <button data-action="delete-holding" data-id="${h.id}" class="reveal btn-icon" style="width:28px;height:28px" title="Remove">${icon("x", 15)}</button>
          ${editForm}
        </li>`;
    }).join("");

    const totalGain = totalValue - totalCost;
    const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const up = totalGain >= 0;
    const cur = this.cur();

    const currencyToggle = ["£", "$"].map((c) => `
      <button data-action="set-portfolio-currency" data-currency="${c}"
              class="w-7 h-7 rounded-md text-[13px] font-semibold transition ${cur === c ? "" : "faint"}"
              style="${cur === c ? "background:var(--ink);color:var(--on-ink)" : ""}">${c}</button>`).join("");

    const buyForm = this.showBuyForm ? `
      <p id="buy-form-error" class="hidden text-[12px] neg mb-2"></p>
      <form id="buy-form" class="well p-3.5 mb-4" style="border:1px solid var(--border-2)">
        <div class="flex flex-wrap gap-2">
          <input name="ticker" placeholder="Ticker or company name" required class="input uppercase" style="width:200px" />
          <input name="shares" type="number" step="any" min="0.000001" placeholder="Shares" required class="input num" style="width:110px" />
          <input name="price" type="number" step="any" min="0.000001" placeholder="Price paid" required class="input num" style="width:130px" />
          <button type="submit" class="btn btn-primary">Add buy</button>
        </div>
        <p id="ticker-preview" class="text-[12px] min-h-4 mt-2"></p>
        <p class="text-[11.5px] faint mt-1">Any exchange — US, LSE and more. Enter the price in the stock's own currency (for LSE use £, not pence). A new ticker creates a holding; an existing one merges and re-averages your cost.</p>
      </form>` : "";

    const fxNote = `Values shown in ${cur === "£" ? "GBP (£)" : "USD ($)"} at live ECB rates · each stock priced in its own market's currency.`;

    this.el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-[10px]" style="background:var(--sunken);color:var(--ink)">${icon("trending", 18)}</span>
          <h2 class="sect-title">Investments</h2>
        </div>
        <div class="flex items-center gap-2 flex-wrap justify-end">
          <div class="flex items-center gap-0.5 p-0.5 rounded-lg" style="background:var(--sunken)">${currencyToggle}</div>
          <button data-action="toggle-buy-form" class="btn ${this.showBuyForm ? "btn-ghost" : "btn-primary"} btn-sm">
            ${this.showBuyForm ? icon("x", 15) + "Close" : icon("plus", 15) + "Log buy"}
          </button>
          ${Store.state.holdings.some((h) => h.source === "t212") && Store.state.holdings.some((h) => h.source !== "t212")
            ? `<button data-action="clear-manual" class="btn btn-ghost btn-sm">Clear ${Store.state.holdings.filter((h) => h.source !== "t212").length} manual</button>`
            : ""}
          ${this.t212SyncedAt || Store.state.holdings.some((h) => h.source === "t212")
            ? `<button data-action="reset-reimport" ${this.refreshing ? "disabled" : ""} class="btn btn-ghost btn-sm">Reset &amp; re-import</button>`
            : ""}
          <button data-action="refresh-prices" ${this.refreshing ? "disabled" : ""} class="btn btn-ghost btn-sm">
            ${icon("refresh", 15)}${this.refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>
      <p class="text-[11.5px] faint mb-4">${fxNote}${
        this.t212Error
          ? ` · <span class="neg">Trading 212: ${escapeHtml(this.t212Error)}</span>`
          : this.t212SyncedAt
            ? ` · Trading 212 synced ${new Date(this.t212SyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : ""
      }</p>

      ${buyForm}

      ${(() => {
        if (!this.pending) return "";
        const all = Store.state.holdings;
        const manual = all.filter((h) => h.source !== "t212");
        const isReset = this.pending === "reset";
        return `
          <div class="well p-4 mb-4" style="border:1px solid var(--neg)">
            <p class="text-[13px] font-semibold mb-1">${isReset ? "Reset and re-import from Trading 212?" : `Remove ${manual.length} manual holding${manual.length === 1 ? "" : "s"}?`}</p>
            <p class="text-[12.5px] muted mb-2">${isReset ? `Deletes all ${all.length} holdings, then pulls your account fresh from Trading 212.` : "Your Trading 212 positions are not affected."}</p>
            ${manual.length ? `<p class="text-[12.5px] mb-3">Added by hand - these will <b>not</b> come back:<br><span class="num" style="color:var(--ink)">${manual.map((h) => escapeHtml(h.ticker)).join(", ")}</span></p>` : ""}
            <div class="flex items-center gap-2">
              <button data-action="confirm-pending" class="btn btn-primary btn-sm">${isReset ? "Delete &amp; re-import" : `Remove ${manual.length}`}</button>
              <button data-action="cancel-pending" class="btn btn-ghost btn-sm">Cancel</button>
            </div>
          </div>`;
      })()}

      ${(() => {
        // One headline figure, not a row of equal-weight boxes: the account total is
        // the number being looked for, so everything else is supporting detail under it.
        const c = Store.state.settings.t212Cash;
        const cash = c && c.free > 0 ? this.conv(c.free, c.currency) : null;
        const account = ratesMissing || totalValue == null ? null : totalValue + (cash || 0);
        const dash = `<span class="faint">…</span>`;
        return `
        <div class="hero mb-5">
          <div class="hero-main">
            <p class="eyebrow mb-1.5">${cash != null ? "Account total" : "Portfolio value"}</p>
            <p class="font-display hero-fig num">${account == null ? dash : this.fmt(account)}</p>
            <p class="text-[12.5px] num mt-1.5 ${up ? "pos" : "neg"}">
              ${ratesMissing ? "" : `${up ? "+" : "−"}${this.fmt(Math.abs(totalGain))} · ${up ? "+" : "−"}${Math.abs(totalGainPct).toFixed(1)}%`}
            </p>
          </div>
          <div class="hero-split">
            <div class="hero-part">
              <p class="eyebrow mb-1">Holdings</p>
              <p class="num text-[14.5px] font-semibold">${ratesMissing ? dash : this.fmt(totalValue)}</p>
              <p class="text-[11px] faint num mt-0.5">${ratesMissing ? "" : `${this.fmt(totalCost)} invested`}</p>
            </div>
            ${cash != null ? `
            <div class="hero-part">
              <p class="eyebrow mb-1">Cash</p>
              <p class="num text-[14.5px] font-semibold">${this.fmt(cash)}</p>
              <p class="text-[11px] faint num mt-0.5">${account ? ((cash / account) * 100).toFixed(1) : "0"}% uninvested</p>
            </div>` : ""}
          </div>
        </div>`;
      })()}

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <ul class="max-h-80 overflow-y-auto pr-1" style="border-top:1px solid var(--border)">
          ${rows || `<li class="py-6 text-[13px] faint text-center">No holdings yet — press <span class="font-semibold" style="color:var(--ink)">Log buy</span> to add your first.</li>`}
        </ul>
        <div>${this.renderPie(holdings, ratesMissing ? null : totalValue)}</div>
      </div>

      <div id="pie-tooltip"></div>`;
  },
};
