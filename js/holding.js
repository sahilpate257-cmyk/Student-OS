// holding.js — the detail view for one holding: interactive price chart (1D to ALL),
// your position, key stats, next earnings and company news. Opened by dispatching
// `open-holding` ({ detail: { ticker } }) from the Invest and Markets tabs.
import { Store, escapeHtml } from "./store.js";
import { icon } from "./icons.js";
import { PortfolioModule } from "./portfolio.js";
import { MarketData, logoHtml, yahooSymbol, isUS } from "./marketdata.js";
import { lineChart } from "./chart.js";

const RANGES = [["1D", "Today"], ["1W", "Past week"], ["1M", "Past month"], ["3M", "Past 3 months"], ["1Y", "Past year"], ["5Y", "Past 5 years"], ["ALL", "All time"]];
const CCY = { GBP: "£", USD: "$", EUR: "€", JPY: "¥", CAD: "C$", AUD: "A$", HKD: "HK$", CHF: "CHF " };
const ccy = (c) => CCY[c] ?? (c ? `${c} ` : "");
const HOURS = { bmo: "before the open", amc: "after the close", dmh: "during trading" };

const CSS = `
.hd-ov{position:fixed;inset:0;z-index:60;display:flex;align-items:stretch;justify-content:center;background:rgba(8,10,16,.58);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:hdFade .18s ease}
.hd-ov.hidden{display:none}
.hd-panel{position:relative;width:100%;background:var(--bg);color:var(--ink);overflow-y:auto;overscroll-behavior:contain;animation:hdUp .26s cubic-bezier(.22,1,.36,1)}
.hd-top{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:12px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:var(--header-bg);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.hd-name{font:600 18px/1.2 Manrope,system-ui,sans-serif;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hd-sub{font-size:13px;color:var(--ink-faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hd-x{margin-left:auto;flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:var(--ink-muted);background:var(--sunken)}
.hd-x:hover{color:var(--ink)}
.hd-body{display:flex;flex-direction:column;gap:22px;padding:18px 16px calc(28px + env(safe-area-inset-bottom))}
.hd-col{display:contents}
.hd-main{order:1}.hd-pos{order:2}.hd-stats{order:3}.hd-news{order:4}
.hd-price{font-size:38px;font-weight:600;line-height:1.05;letter-spacing:-.03em}
.hd-chg{font-size:15px;font-weight:600;margin-top:7px}
.hd-chg small{font-size:13px;font-weight:500;color:var(--ink-faint);margin-left:6px}
.hd-today{font-size:13.5px;font-weight:600;margin-top:4px;color:var(--ink-muted)}
.hd-chart{margin-top:26px;min-height:220px}
.hd-skel{height:220px;border-radius:12px;background:linear-gradient(100deg,var(--sunken) 30%,var(--surface-2) 50%,var(--sunken) 70%);background-size:300% 100%;animation:hdShimmer 1.3s linear infinite}
.hd-empty{display:grid;place-items:center;min-height:220px;text-align:center;font-size:14px;color:var(--ink-faint);padding:0 24px}
.hd-pills{display:flex;gap:3px;margin-top:14px;padding:3px;border-radius:12px;background:var(--sunken)}
.hd-pill{flex:1;min-width:0;height:36px;border-radius:9px;font-size:13px;font-weight:600;color:var(--ink-muted);transition:background .15s,color .15s}
.hd-pill:hover{color:var(--ink)}
.hd-pill.on{background:var(--ink);color:var(--on-ink)}
.hd-sec{border:1px solid var(--border);border-radius:16px;padding:16px 16px 6px;background:var(--surface)}
.hd-h{font:600 16px/1.2 Manrope,system-ui,sans-serif;letter-spacing:-.02em;margin-bottom:6px}
.hd-kv{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:11px 0;border-top:1px solid var(--border);font-size:14.5px}
.hd-h+.hd-kv,.hd-h+.hd-rng,.hd-h+.hd-news-i{border-top:0}
.hd-kv>span:first-child{color:var(--ink-muted);flex:none}
.hd-kv>span:last-child{font-weight:600;text-align:right;min-width:0}
.hd-kv small{display:block;font-size:12.5px;font-weight:500;color:var(--ink-faint);margin-top:1px}
.hd-rng{padding:11px 0 14px;border-top:1px solid var(--border)}
.hd-rng-l{display:flex;justify-content:space-between;font-size:14.5px;color:var(--ink-muted);margin-bottom:9px}
.hd-rbar{position:relative;height:6px;border-radius:99px;background:var(--sunken);box-shadow:inset 0 0 0 1px var(--border)}
.hd-rbar i{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--ink);border:3px solid var(--surface)}
.hd-rng-v{display:flex;justify-content:space-between;margin-top:8px;font-size:13.5px;font-weight:600}
.hd-news-i{display:block;padding:12px 0;border-top:1px solid var(--border);color:inherit;text-decoration:none}
.hd-news-i:hover .hd-news-t{text-decoration:underline}
.hd-news-t{display:block;font-size:15px;font-weight:600;line-height:1.35}
.hd-news-m{display:block;font-size:13px;color:var(--ink-faint);margin-top:3px}
.hd-note{font-size:13.5px;line-height:1.5;color:var(--ink-faint);padding:4px 0 14px}
@keyframes hdFade{from{opacity:0}}
@keyframes hdUp{from{opacity:0;transform:translateY(28px)}}
@keyframes hdShimmer{to{background-position:-100% 0}}
@media (min-width:900px){
  .hd-ov{align-items:center;padding:4vh 24px}
  .hd-panel{max-width:1060px;max-height:92vh;border-radius:22px;border:1px solid var(--border-2);box-shadow:var(--shadow-lg);background:var(--bg);animation-name:hdPop}
  .hd-top{padding:18px 28px 16px}
  .hd-body{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:28px;align-items:start;padding:22px 28px 30px}
  .hd-col{display:flex;flex-direction:column;gap:22px;min-width:0}
  .hd-main,.hd-pos,.hd-stats,.hd-news{order:0}
  .hd-price{font-size:46px}
  @keyframes hdPop{from{opacity:0;transform:translateY(14px) scale(.985)}}
}
@media (prefers-reduced-motion:reduce){.hd-ov,.hd-panel,.hd-skel{animation:none}}
`;

const pctText = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}%`;
const arrow = (x) => (x > 0 ? "▲" : x < 0 ? "▼" : "▬");
const tone = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "faint");

function priceFmt(c) {
  return (v) => {
    const d = Math.abs(v) >= 1 ? 2 : 4;
    return `${ccy(c)}${v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  };
}

function compact(n) {
  if (n == null) return null;
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function capText(m) {
  if (m == null) return null;
  if (m >= 1e6) return `$${(m / 1e6).toFixed(2)}T`;
  if (m >= 1e3) return `$${(m / 1e3).toFixed(1)}B`;
  return `$${m.toFixed(0)}M`;
}

function ago(ts) {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export const HoldingModule = {
  ov: null,
  S: null,
  token: 0,
  chart: null,
  lastFocus: null,

  init() {
    if (!document.getElementById("hd-css")) {
      const s = document.createElement("style");
      s.id = "hd-css";
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.ov = document.createElement("div");
    this.ov.className = "hd-ov hidden";
    document.body.appendChild(this.ov);

    this.ov.addEventListener("click", (e) => {
      if (e.target === this.ov || e.target.closest("[data-hd=close]")) return this.close();
      const pill = e.target.closest("[data-range]");
      if (pill) this.setRange(pill.dataset.range);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.S) this.close();
    });
    document.addEventListener("open-holding", (e) => this.open(e.detail?.ticker));
    Store.subscribe("settings:changed", () => this.S && this.renderPosition());
    Store.subscribe("holdings:changed", () => this.S && this.renderPosition());
  },

  holding() {
    return this.S ? Store.state.holdings.find((h) => h.id === this.S.id) : null;
  },

  open(ticker) {
    const h = Store.state.holdings.find((x) => String(x.ticker).toUpperCase() === String(ticker).toUpperCase());
    if (!h) return;
    this.token++;
    this.lastFocus = document.activeElement;
    this.S = { id: h.id, ticker: h.ticker, sym: yahooSymbol(h), us: isUS(h), range: "1M", series: {}, loading: null, stock: null, stockErr: false, news: null, newsErr: false, scrub: null, retries: 0 };
    this.ov.classList.remove("hidden");
    document.documentElement.style.overflow = "hidden";
    this.renderShell();
    this.loadRange("1M");
    if (this.S.us) { this.loadStock(); this.loadNews(); }
    this.ov.querySelector(".hd-x")?.focus();
  },

  close() {
    if (!this.S) return;
    this.token++;
    this.chart?.destroy();
    this.chart = null;
    this.S = null;
    this.ov.classList.add("hidden");
    this.ov.innerHTML = "";
    document.documentElement.style.overflow = "";
    this.lastFocus?.focus?.();
  },

  // ---- data ----
  async loadRange(r) {
    const tok = this.token;
    const S = this.S;
    if (!(r in S.series)) {
      S.loading = r;
      if (S.range === r) this.renderChart();
      try {
        const d = await MarketData.history([S.sym], r);
        S.series[r] = d.series?.[S.sym] || null;
      } catch (e) {
        S.series[r] = null;
      }
      S.loading = null;
      if (tok !== this.token) return;
    }
    if (S.range === r) { this.renderHeader(); this.renderChart(); }
    this.renderTop();
    this.renderStats();
    this.renderPosition();
  },

  setRange(r) {
    if (!this.S || this.S.range === r) return;
    this.S.range = r;
    this.S.scrub = null;
    this.renderPills();
    this.renderHeader();
    this.loadRange(r);
  },

  async loadStock() {
    const tok = this.token;
    try {
      const d = await MarketData.stock(this.S.ticker);
      if (tok !== this.token) return;
      this.S.stock = d;
      if (d?.profile?.logo) MarketData.loadProfiles([this.S.ticker]).then(() => tok === this.token && this.renderTop());
    } catch (e) {
      if (tok !== this.token) return;
      this.S.stockErr = true;
    }
    this.renderStats();
  },

  async loadNews() {
    const tok = this.token;
    try {
      const d = await MarketData.news(this.S.ticker);
      if (tok !== this.token) return;
      this.S.news = d?.holdings?.[this.S.ticker] || [];
    } catch (e) {
      if (tok !== this.token) return;
      this.S.newsErr = true;
    }
    this.renderNews();
  },

  // ---- derived numbers ----
  meta() {
    const s = this.S.series;
    return (s["1M"] || s[this.S.range] || Object.values(s).find(Boolean))?.meta || null;
  },
  nativeCcy() {
    return this.meta()?.currency || this.holding()?.currency || "USD";
  },
  livePrice() {
    const h = this.holding();
    const m = this.meta();
    if (m?.price != null && (!h?.currency || m.currency === h.currency)) return m.price;
    return h?.currentPrice ?? m?.price ?? null;
  },
  dayChange() {
    const d = this.S.series["1M"];
    if (!d || d.c.length < 2) return null;
    const last = this.livePrice() ?? d.c[d.c.length - 1];
    const prev = d.c[d.c.length - 2];
    return prev ? { abs: last - prev, pct: (last / prev - 1) * 100 } : null;
  },
  rangeBase(d) {
    return this.S.range === "1D" && d.meta?.prevClose ? d.meta.prevClose : d.c[0];
  },

  // ---- rendering ----
  renderShell() {
    const h = this.holding();
    this.ov.innerHTML = `
      <div class="hd-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(h.name || h.ticker)} detail">
        <div class="hd-top" id="hd-top"></div>
        <div class="hd-body">
          <div class="hd-col">
            <div class="hd-main">
              <div id="hd-head"></div>
              <div class="hd-chart" id="hd-chart"></div>
              <div class="hd-pills" id="hd-pills" role="tablist" aria-label="Time range"></div>
            </div>
            <div class="hd-news" id="hd-news"></div>
          </div>
          <div class="hd-col">
            <div class="hd-pos" id="hd-pos"></div>
            <div class="hd-stats" id="hd-stats"></div>
          </div>
        </div>
      </div>`;
    this.renderTop();
    this.renderHeader();
    this.renderPills();
    this.renderChart();
    this.renderStats();
    this.renderPosition();
    this.renderNews();
  },

  $(id) { return this.ov.querySelector(`#${id}`); },

  renderTop() {
    const h = this.holding();
    const el = this.$("hd-top");
    if (!h || !el) return;
    const exch = this.meta()?.exchange || this.S.stock?.profile?.exchange;
    el.innerHTML = `
      ${logoHtml(h.ticker, 44)}
      <div class="min-w-0">
        <p class="hd-name">${escapeHtml(this.S.stock?.profile?.name || h.name || h.ticker)}</p>
        <p class="hd-sub"><span class="ticker">${escapeHtml(h.ticker)}</span>${exch ? ` · ${escapeHtml(exch)}` : ""}</p>
      </div>
      <button class="hd-x" data-hd="close" aria-label="Close">${icon("x", 20)}</button>`;
  },

  renderPills() {
    const el = this.$("hd-pills");
    if (!el) return;
    el.innerHTML = RANGES.map(([k]) => `<button class="hd-pill ${k === this.S.range ? "on" : ""}" role="tab" aria-selected="${k === this.S.range}" data-range="${k}">${k}</button>`).join("");
  },

  renderHeader() {
    const el = this.$("hd-head");
    if (!el) return;
    const S = this.S;
    const d = S.series[S.range];
    const fmt = priceFmt(this.nativeCcy());
    const live = this.livePrice();
    const shown = S.scrub ? S.scrub.v : live ?? d?.c?.[d.c.length - 1];
    if (shown == null) { el.innerHTML = `<p class="hd-price font-display num faint">…</p>`; return; }
    let chg = "";
    if (d && d.c.length > 1) {
      const base = this.rangeBase(d);
      const diff = shown - base;
      const pct = (shown / base - 1) * 100;
      const label = S.scrub ? "" : RANGES.find(([k]) => k === S.range)[1];
      chg = `<p class="hd-chg num ${tone(diff)}">${arrow(diff)} ${fmt(Math.abs(diff))} (${pctText(pct)})${label ? `<small>${label}</small>` : ""}</p>`;
    }
    const day = S.range !== "1D" && !S.scrub ? this.dayChange() : null;
    el.innerHTML = `
      <p class="hd-price font-display num" id="hd-price">${fmt(shown)}</p>
      <div id="hd-chg">${chg}</div>
      ${day ? `<p class="hd-today num">Today <span class="${tone(day.pct)}">${arrow(day.pct)} ${pctText(day.pct)}</span></p>` : ""}`;
  },

  scrubbed(p) {
    if (!this.S) return;
    this.S.scrub = p;
    this.renderHeader();
  },

  renderChart() {
    const S = this.S;
    const el = this.$("hd-chart");
    if (!el) return;
    this.chart?.destroy();
    this.chart = null;
    const d = S.series[S.range];
    if (!d) {
      el.innerHTML = S.loading === S.range || !(S.range in S.series)
        ? `<div class="hd-skel"></div>`
        : `<div class="hd-empty">No price history is available for ${escapeHtml(S.ticker)} on this range.<br>${S.us ? "" : "Some non-UK, non-US listings aren't covered by the free data source."}</div>`;
      return;
    }
    const pts = d.t.map((t, i) => ({ t: t * 1000, v: d.c[i] }));
    const base = this.rangeBase(d);
    const up = (this.livePrice() ?? d.c[d.c.length - 1]) >= base;
    const h = this.holding();
    const lines = [];
    if (S.range === "1D" && d.meta?.prevClose) lines.push({ value: d.meta.prevClose, label: "Previous close" });
    if (h?.buyPrice && (!h.currency || h.currency === d.meta?.currency)) lines.push({ value: h.buyPrice, label: "Your average cost" });
    this.chart = lineChart(el, {
      points: pts,
      range: S.range,
      tone: up ? "pos" : "neg",
      height: window.matchMedia("(min-width:900px)").matches ? 300 : 230,
      lines,
      fmt: priceFmt(d.meta?.currency || this.nativeCcy()),
      label: `${S.ticker} price, ${S.range}`,
      onScrub: (p) => this.scrubbed(p),
    });
  },

  renderPosition() {
    const el = this.$("hd-pos");
    const h = this.holding();
    if (!el || !h) return;
    const price = this.livePrice();
    const nat = this.nativeCcy();
    const cost = PortfolioModule.conv(h.shares * h.buyPrice, h.currency);
    const value = price != null ? PortfolioModule.conv(h.shares * price, h.currency) : null;
    let total = 0;
    let ok = true;
    Store.state.holdings.forEach((x) => {
      const v = PortfolioModule.conv(x.shares * x.currentPrice, x.currency);
      if (v == null) ok = false; else total += v;
    });
    const gain = cost != null && value != null ? value - cost : null;
    const gainPct = gain != null && cost > 0 ? (gain / cost) * 100 : null;
    const fmt = (v) => PortfolioModule.fmt(v);
    const vs = price != null && h.buyPrice ? (price / h.buyPrice - 1) * 100 : null;
    const sign = (x) => (x >= 0 ? "+" : "−");
    el.innerHTML = `
      <section class="hd-sec" aria-label="Your position">
        <h3 class="hd-h">Your position</h3>
        <div class="hd-kv"><span>Shares</span><span class="num">${h.shares.toLocaleString("en-GB", { maximumFractionDigits: 6 })}</span></div>
        <div class="hd-kv"><span>Market value</span><span class="num">${fmt(value)}</span></div>
        <div class="hd-kv"><span>Average cost</span><span class="num">${priceFmt(h.currency || nat)(h.buyPrice)}${h.currency && h.currency !== PortfolioModule.displayCurrency() ? `<small>${fmt(PortfolioModule.conv(h.buyPrice, h.currency))} per share</small>` : ""}</span></div>
        <div class="hd-kv"><span>Total return</span><span class="num ${gain == null ? "" : tone(gain)}">${gain == null ? "…" : `${sign(gain)}${fmt(Math.abs(gain))}<small class="${tone(gain)}">${sign(gainPct)}${Math.abs(gainPct).toFixed(2)}% on ${fmt(cost)} invested</small>`}</span></div>
        <div class="hd-kv"><span>Share of holdings</span><span class="num">${ok && value != null && total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "…"}</span></div>
        ${vs != null ? `<div class="hd-kv"><span>Price vs your cost</span><span class="num ${tone(vs)}">${sign(vs)}${Math.abs(vs).toFixed(1)}%<small>${vs >= 0 ? "above" : "below"} what you paid on average</small></span></div>` : ""}
      </section>`;
    if ((cost == null || value == null) && this.S.retries++ < 6) setTimeout(() => this.S && this.renderPosition(), 1200);
  },

  renderStats() {
    const el = this.$("hd-stats");
    if (!el) return;
    const S = this.S;
    const m = this.meta();
    const st = S.stock;
    const fmt = priceFmt(this.nativeCcy());
    const kv = (k, v, sub) => `<div class="hd-kv"><span>${k}</span><span class="num">${v}${sub ? `<small>${sub}</small>` : ""}</span></div>`;
    const rows = [];

    const price = this.livePrice();
    const hi = m?.hi52 ?? st?.metrics?.hi52;
    const lo = m?.lo52 ?? st?.metrics?.lo52;
    if (m?.dayLo != null && m?.dayHi != null) rows.push(kv("Day range", `${fmt(m.dayLo)} – ${fmt(m.dayHi)}`));
    if (hi != null && lo != null && hi > lo && price != null) {
      const pos = Math.max(0, Math.min(100, ((price - lo) / (hi - lo)) * 100));
      rows.push(`<div class="hd-rng">
        <div class="hd-rng-l"><span>52-week range</span><span class="num" style="font-weight:600;color:var(--ink)">${pos.toFixed(0)}% of the way up</span></div>
        <div class="hd-rbar"><i style="left:${pos}%"></i></div>
        <div class="hd-rng-v num"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div></div>`);
    }
    if (m?.volume) rows.push(kv("Volume", compact(m.volume)));
    if (st?.profile?.marketCap != null) rows.push(kv("Market cap", capText(st.profile.marketCap)));
    const x = st?.metrics;
    if (x?.pe != null) rows.push(kv("P/E ratio", x.pe.toFixed(1), "price ÷ last 12 months' earnings"));
    if (x?.eps != null) rows.push(kv("Earnings per share", `$${x.eps.toFixed(2)}`, "last 12 months"));
    if (x?.beta != null) rows.push(kv("Beta", x.beta.toFixed(2), "1.0 moves with the market"));
    if (x?.divYield != null && x.divYield > 0) rows.push(kv("Dividend yield", `${x.divYield.toFixed(2)}%`));
    if (st?.profile?.industry) rows.push(kv("Industry", escapeHtml(st.profile.industry)));
    const e = st?.nextEarnings;
    if (e?.date) {
      const days = Math.round((new Date(`${e.date}T12:00:00`) - new Date().setHours(12, 0, 0, 0)) / 864e5);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : "";
      const date = new Date(`${e.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      rows.push(kv("Next earnings", `${date}`, `${when}${e.hour && HOURS[e.hour] ? ` · ${HOURS[e.hour]}` : ""}${e.epsEstimate != null ? ` · analysts expect $${e.epsEstimate.toFixed(2)} a share` : ""}`));
    }

    const pending = S.us && !st && !S.stockErr ? `<p class="hd-note">Loading company data…</p>` : "";
    const foot = !S.us ? `<p class="hd-note">Company ratios, earnings dates and news come from US listings only; this stock shows price data.</p>` : S.stockErr ? `<p class="hd-note">Company data isn't available right now.</p>` : "";
    el.innerHTML = rows.length || pending || foot
      ? `<section class="hd-sec" aria-label="Key stats"><h3 class="hd-h">Key stats</h3>${rows.join("")}${pending}${foot}</section>`
      : "";
  },

  renderNews() {
    const el = this.$("hd-news");
    if (!el) return;
    const S = this.S;
    if (!S.us) { el.innerHTML = ""; return; }
    const items = S.news;
    const body = S.newsErr
      ? `<p class="hd-note">News isn't available right now.</p>`
      : items == null
        ? `<p class="hd-note">Loading news…</p>`
        : items.length
          ? items.map((n) => `<a class="hd-news-i" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer"><span class="hd-news-t">${escapeHtml(n.title)}</span><span class="hd-news-m">${escapeHtml(n.publisher || "")}${n.ts ? ` · ${ago(n.ts)}` : ""}</span></a>`).join("")
          : `<p class="hd-note">No recent headlines about ${escapeHtml(S.ticker)} this week.</p>`;
    el.innerHTML = `<section class="hd-sec" aria-label="News"><h3 class="hd-h">In the news</h3>${body}</section>`;
  },
};
