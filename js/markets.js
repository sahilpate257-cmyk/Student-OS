// markets.js — the Markets tab: index snapshot, your week, saved weekly briefing,
// news about your holdings, and top business stories. Every headline opens the real article.
import { Store, escapeHtml } from "./store.js";
import { PortfolioModule } from "./portfolio.js";
import { api, MarketData, logoHtml } from "./marketdata.js";

const CACHE_KEY = "ledgerly_markets_v1";
const FRESH_MS = 15 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MOVERS_SHOWN = 6;
const STORIES_SHOWN = 6;

const pctText = (x) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%`);
const arrow = (x) => (x > 0 ? "▲" : x < 0 ? "▼" : "▬");
const dir = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "muted");

function ago(ts) {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function level(i) {
  const dp = i.name.includes("/") ? 4 : 2;
  return i.price.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function spark(closes, up) {
  if (!closes || closes.length < 2) return "";
  const min = Math.min(...closes);
  const span = Math.max(...closes) - min || 1;
  const pts = closes
    .map((c, i) => `${((i / (closes.length - 1)) * 96 + 2).toFixed(1)},${(26 - ((c - min) / span) * 22).toFixed(1)}`)
    .join(" ");
  return `<svg class="mk-spark ${dir(up)}" viewBox="0 0 100 30" preserveAspectRatio="none" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
}

// Headings use ## and emphasis uses ** in the briefing. Escape FIRST, then convert, so
// nothing the model returns can inject markup.
function renderBriefing(text, sources) {
  const byId = new Map((sources || []).map((s) => [s.id, s]));
  const inline = (t) =>
    escapeHtml(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[(\d+)\]/g, (m, n) => {
        const src = byId.get(Number(n));
        if (!src || !/^https?:\/\//.test(src.url)) return "";
        return `<a class="mk-cite" href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(src.title)}">${n}</a>`;
      });
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("## ") ? `<h4>${inline(l.slice(3))}</h4>` : `<p>${inline(l)}</p>`))
    .join("");
}

const section = (area, title, sub, body, action = "") => `
  <section class="mk-sec" style="grid-area:${area}">
    <div class="mk-sec-head">
      <div><h3 class="mk-h">${title}</h3>${sub ? `<p class="mk-hs">${sub}</p>` : ""}</div>
      ${action}
    </div>
    ${body}
  </section>`;

const story = (n) => `
  <a class="mk-story" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">
    <span class="mk-story-t">${escapeHtml(n.title)}</span>
    <span class="mk-story-m">${escapeHtml(n.publisher || "")}${n.ts ? " · " + ago(n.ts) : ""}</span>
  </a>`;

export const MarketsModule = {
  el: null,
  market: null,
  news: null,
  at: 0,
  loadingMarket: false,
  loadingNews: false,
  marketError: null,
  newsError: null,
  allMovers: false,
  allStories: false,
  briefBusy: false,
  briefError: null,

  init() {
    this.el = document.getElementById("markets-module");
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c) { this.market = c.market; this.news = c.news; this.at = c.at || 0; }
    } catch (e) {}
    Store.subscribe("settings:changed", () => this.render());
    this.el.addEventListener("keydown", (e) => {
      const o = e.target.closest?.("[data-open]");
      if (o && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); o.click(); }
    });
    this.el.addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]")?.dataset.open;
      if (open) return document.dispatchEvent(new CustomEvent("open-holding", { detail: { ticker: open } }));
      const a = e.target.closest("[data-mk]")?.dataset.mk;
      if (a === "refresh") this.refresh();
      else if (a === "movers") { this.allMovers = !this.allMovers; this.render(); }
      else if (a === "stories") { this.allStories = !this.allStories; this.render(); }
      else if (a === "brief") this.writeBriefing();
    });
    this.render();
  },

  onShow() {
    this.render();
    if (Date.now() - this.at > FRESH_MS) this.refresh();
  },

  holdingsList() {
    const seen = new Set();
    return Store.state.holdings
      .filter((h) => h.ticker && !seen.has(String(h.ticker).toUpperCase()) && seen.add(String(h.ticker).toUpperCase()))
      .map((h) => {
        const raw = (h.shares || 0) * (h.currentPrice || 0);
        const ticker = String(h.ticker).toUpperCase();
        // GBP-priced holdings are LSE listings; a bare ticker like BA is Boeing on Yahoo, not BAE Systems
        const gbp = h.currency === "GBP";
        return { ticker, sym: gbp ? `${ticker}.L` : ticker, us: !gbp, cur: h.currency || "USD", name: h.name || h.ticker, value: PortfolioModule.conv(raw, h.currency) ?? raw };
      })
      .sort((a, b) => b.value - a.value);
  },

  async refresh() {
    if (this.loadingMarket || this.loadingNews) return;
    const hs = this.holdingsList();
    const us = hs.filter((h) => h.us && /^[A-Z]{1,5}$/.test(h.ticker)).map((h) => h.ticker).slice(0, 8);
    const back = new Map(hs.map((h) => [h.sym, h.ticker]));
    this.loadingMarket = this.loadingNews = true;
    this.marketError = this.newsError = null;
    this.render();
    const [m, n] = await Promise.allSettled([api("/market-data", { tickers: hs.map((h) => h.sym) }), api("/news", { tickers: us })]);
    if (m.status === "fulfilled") {
      this.market = {
        ...m.value,
        holdings: m.value.holdings.map((h) => ({ ...h, ticker: back.get(h.ticker) || h.ticker })),
        missing: (m.value.missing || []).map((t) => back.get(t) || t),
      };
    }
    else this.marketError = this.market ? null : m.reason.message;
    if (n.status === "fulfilled") this.news = n.value;
    else this.newsError = this.news ? null : n.reason.message;
    if (m.status === "fulfilled" || n.status === "fulfilled") {
      this.at = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ market: this.market, news: this.news, at: this.at })); } catch (e) {}
    }
    this.loadingMarket = this.loadingNews = false;
    this.render();
    MarketData.loadProfiles(us).then(() => this.render());
  },

  async writeBriefing() {
    if (this.briefBusy) return;
    this.briefBusy = true;
    this.briefError = null;
    this.render();
    try {
      if (!this.market) await this.refresh();
      const hs = this.holdingsList();
      const names = new Map(hs.map((h) => [h.ticker, h.name]));
      const curOf = new Map(hs.map((h) => [h.ticker, h.cur]));
      const market = {
        indices: (this.market?.indices || []).map(({ name, price, dayPct, weekPct }) => ({ name, price, dayPct, weekPct })),
        holdings: (this.market?.holdings || []).map((h) => ({
          ticker: h.ticker,
          name: names.get(h.ticker) || h.ticker,
          dayPct: h.dayPct,
          weekPct: this.fxWeekPct(h.weekPct, curOf.get(h.ticker)).pct,
        })),
      };
      const data = await api("/weekly", { holdings: hs.map((h) => ({ ticker: h.ticker })), market });
      const cited = new Set([...data.update.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
      Store.setSetting("weeklyBriefing", {
        update: data.update,
        sources: data.sources.filter((s) => cited.has(s.id)).map(({ id, title, url, publisher }) => ({ id, title, url, publisher })),
        generatedAt: data.generatedAt,
        headlineCount: data.sources.length,
      });
    } catch (err) {
      this.briefError = err.message || "Something went wrong.";
    } finally {
      this.briefBusy = false;
      this.render();
    }
  },

  snapshotHtml() {
    const idx = this.market?.indices || [];
    if (!idx.length) {
      return `<p class="mk-note">${escapeHtml(this.marketError || (this.loadingMarket ? "Loading markets…" : "Market data isn't available right now."))}</p>`;
    }
    return `<div class="mk-tiles">${idx.map((i) => `
      <div class="mk-tile">
        <p class="mk-tile-name">${escapeHtml(i.name)}</p>
        <p class="mk-tile-level num">${level(i)}</p>
        <p class="mk-chg ${dir(i.dayPct)}">${arrow(i.dayPct)} ${pctText(i.dayPct)}<small>today</small></p>
        <p class="mk-chg2 ${dir(i.weekPct)}">${pctText(i.weekPct)}<small>5 days</small></p>
        ${spark(i.closes, i.weekPct)}
      </div>`).join("")}</div>`;
  },

  // Yahoo reports each stock's move in its own market's currency. A US stock up 2%
  // is not up 2% for someone whose account is in pounds, because the pound moved
  // too. Convert through the GBP/USD week move so the figure matches what actually
  // happened to their money. Currencies with no FX series here are left alone.
  fxWeekPct(pct, nativeCur) {
    const disp = PortfolioModule.displayCurrency();
    const native = nativeCur === "GBP" ? "GBP" : nativeCur === "USD" ? "USD" : null;
    if (pct == null || native == null || native === disp) return { pct, converted: false };
    const fx = (this.market?.indices || []).find((i) => i.symbol === "GBPUSD=X");
    if (!fx || typeof fx.weekPct !== "number") return { pct, converted: false };
    const g = 1 + pct / 100, f = 1 + fx.weekPct / 100;
    // GBPUSD is dollars per pound: a dollar asset is worth less in pounds when the pound rises.
    const out = native === "USD" ? g / f - 1 : g * f - 1;
    return { pct: Math.round(out * 10000) / 100, converted: true };
  },

  weekHtml() {
    const hs = this.holdingsList();
    if (!hs.length) return `<p class="mk-note">Add holdings in the Invest tab and their weekly moves will show here.</p>`;
    const names = new Map(hs.map((h) => [h.ticker, h.name]));
    const cur = new Map(hs.map((h) => [h.ticker, h.cur]));
    const rows = (this.market?.holdings || [])
      .map((h) => { const a = this.fxWeekPct(h.weekPct, cur.get(h.ticker)); return { ...h, weekPct: a.pct, converted: a.converted }; })
      .sort((a, b) => Math.abs(b.weekPct) - Math.abs(a.weekPct));
    if (!rows.length) {
      return `<p class="mk-note">${escapeHtml(this.marketError || (this.loadingMarket ? "Loading prices…" : "No price history available for your holdings yet."))}</p>`;
    }
    const shown = this.allMovers ? rows : rows.slice(0, MOVERS_SHOWN);
    const missing = this.market?.missing || [];
    return `<ul class="mk-movers">${shown.map((h) => `
        <li class="mk-mover mk-open" data-open="${escapeHtml(h.ticker)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(names.get(h.ticker) || h.ticker)}">
          <div class="flex items-center gap-3 min-w-0">${logoHtml(h.ticker, 34)}<div class="min-w-0"><p class="ticker mk-m-tk">${escapeHtml(h.ticker)}</p><p class="mk-m-nm">${escapeHtml(names.get(h.ticker) || "")}</p></div></div>
          ${spark(h.closes, h.weekPct)}
          <p class="mk-m-pct num ${dir(h.weekPct)}">${pctText(h.weekPct)}</p>
        </li>`).join("")}</ul>
      ${rows.length > MOVERS_SHOWN ? `<button data-mk="movers" class="btn btn-ghost btn-sm mt-2">${this.allMovers ? "Show fewer" : `Show all ${rows.length}`}</button>` : ""}
      ${rows.some((r) => r.converted) ? `<p class="mk-foot">Moves are shown in ${PortfolioModule.displayCurrency() === "GBP" ? "pounds" : "dollars"}, so they include the week's currency move as well as the share price.</p>` : ""}
      ${missing.length ? `<p class="mk-foot">No price history for ${missing.map(escapeHtml).join(", ")}.</p>` : ""}`;
  },

  briefingHtml() {
    const b = Store.state.settings.weeklyBriefing;
    const btn = (label, cls = "btn-primary") =>
      `<button data-mk="brief" class="btn ${cls} btn-sm" ${this.briefBusy ? "disabled" : ""}>${this.briefBusy ? "Reading the news…" : label}</button>`;
    const err = this.briefError ? `<p class="mk-note neg mb-2">${escapeHtml(this.briefError)}</p>` : "";
    if (!b) {
      return `${err}<p class="mk-note mb-3">A short written summary of the week: how the indices and your holdings moved, and the stories behind it. Every claim links to its source.</p>${btn("Write this week's briefing")}`;
    }
    const when = new Date(b.generatedAt);
    const stale = Date.now() - when.getTime() > WEEK_MS;
    const whenText = when.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `${err}
      <div class="mk-brief">${renderBriefing(b.update, b.sources)}</div>
      <p class="mk-foot">${stale ? "<strong>From more than a week ago.</strong> " : ""}Written ${escapeHtml(whenText)} from ${b.headlineCount || "recent"} headlines and market data. A summary of the news, not financial advice.</p>
      <div class="mt-2">${btn(stale ? "Write this week's briefing" : "Rewrite", stale ? "btn-primary" : "btn-ghost")}</div>`;
  },

  holdingsNewsHtml() {
    const hs = this.holdingsList();
    if (!hs.length) return `<p class="mk-note">News about the companies you own will show here.</p>`;
    if (!this.news) return `<p class="mk-note">${escapeHtml(this.newsError || (this.loadingNews ? "Loading news…" : "News isn't available right now."))}</p>`;
    const names = new Map(hs.map((h) => [h.ticker, h.name]));
    const withNews = hs.filter((h) => h.us && this.news.holdings?.[h.ticker]?.length);
    const without = hs.filter((h) => !(h.us && this.news.holdings?.[h.ticker]?.length)).map((h) => h.ticker);
    const groups = withNews.map((h) => `
      <div class="mk-hn">
        <p class="mk-hn-head mk-open" data-open="${escapeHtml(h.ticker)}" role="button" tabindex="0">${logoHtml(h.ticker, 22)}<span class="ticker">${escapeHtml(h.ticker)}</span><span class="mk-hn-name">${escapeHtml(names.get(h.ticker) || "")}</span></p>
        ${this.news.holdings[h.ticker].slice(0, 2).map(story).join("")}
      </div>`).join("");
    return `${groups || `<p class="mk-note">No recent headlines about your US-listed holdings.</p>`}
      ${without.length ? `<p class="mk-foot">No coverage for ${without.map(escapeHtml).join(", ")} (US-listed stocks only, and not every stock has news each week).</p>` : ""}`;
  },

  topHtml() {
    const items = this.news?.top || [];
    if (!items.length) return `<p class="mk-note">${escapeHtml(this.newsError || (this.loadingNews ? "Loading headlines…" : "No headlines available right now."))}</p>`;
    const shown = this.allStories ? items : items.slice(0, STORIES_SHOWN);
    return `${shown.map(story).join("")}
      ${items.length > STORIES_SHOWN ? `<button data-mk="stories" class="btn btn-ghost btn-sm mt-2">${this.allStories ? "Show fewer" : `Show all ${items.length}`}</button>` : ""}`;
  },

  render() {
    if (!this.el) return;
    const busy = this.loadingMarket || this.loadingNews;
    const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const updated = this.at ? ` · updated ${new Date(this.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";
    this.el.innerHTML = `
      <header class="mk-head">
        <div><h2 class="mk-title">Markets</h2><p class="mk-sub">${today}${updated}</p></div>
        <button data-mk="refresh" class="btn btn-ghost btn-sm" ${busy ? "disabled" : ""}>${busy ? "Updating…" : "Refresh"}</button>
      </header>
      <div class="mk-grid">
        ${section("snap", "Market snapshot", "Today's move and the last five trading days", this.snapshotHtml())}
        ${section("week", "Your week", "Your holdings, biggest moves first", this.weekHtml())}
        ${section("brief", "Weekly briefing", "The week in plain English", this.briefingHtml())}
        ${section("hnews", "In the news", "Headlines about companies you own", this.holdingsNewsHtml())}
        ${section("top", "Top stories", "Business and markets, tap to read", this.topHtml())}
      </div>`;
  },
};
