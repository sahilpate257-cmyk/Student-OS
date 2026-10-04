// marketdata.js — one place for talking to the Worker's market routes, so Markets,
// Invest and the holding detail view share caches instead of each re-fetching.
import { Store, auth } from "./store.js";

const WORKER_URL = "https://ledgerly-ai-intake.sahilpatel-ledgerly.workers.dev";
const PROFILE_KEY = "ledgerly_profiles_v1";
const PROFILE_TTL = 7 * 24 * 60 * 60 * 1000;
const HISTORY_TTL = { "1D": 5, "1W": 10 };
const memo = new Map();

if (typeof document !== "undefined" && !document.getElementById("logo-css")) {
  const s = document.createElement("style");
  s.id = "logo-css";
  s.textContent = `.lg{display:inline-grid;place-items:center;border-radius:50%;overflow:hidden;position:relative;flex:none;background:var(--sunken);box-shadow:inset 0 0 0 1px var(--border)}
.lg img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;padding:12%;border-radius:50%}
.lg-mono{display:grid;place-items:center;width:100%;height:100%;font:700 .42em/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:-.02em}`;
  document.head.appendChild(s);
}

export async function api(path, body) {
  const user = auth.currentUser;
  if (!user) throw new Error("You need to be signed in.");
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// A bare ticker like BA is Boeing on Yahoo; GBP-priced holdings are LSE listings (BA.L).
export function yahooSymbol(h) {
  const t = String(h.ticker).toUpperCase();
  return h.currency === "GBP" ? `${t}.L` : t;
}
export const isUS = (h) => h.currency !== "GBP" && /^[A-Z]{1,5}$/.test(String(h.ticker).toUpperCase());

function cached(key, ttlMin, load) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMin * 60000) return hit.p;
  const p = load();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => memo.delete(key));
  return p;
}

export const MarketData = {
  // series for many holdings in one Worker call: { SYM: { t:[sec], c:[price], meta } }
  history(symbols, range) {
    const key = `h:${range}:${[...symbols].sort().join(",")}`;
    return cached(key, HISTORY_TTL[range] ?? 30, () => api("/history", { symbols, range }));
  },
  stock(ticker) {
    return cached(`s:${ticker}`, 60, () => api("/stock", { symbol: ticker }));
  },
  news(ticker) {
    return cached(`n:${ticker}`, 30, () => api("/news", { tickers: [ticker] }));
  },

  profiles() {
    try {
      const c = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      return c && Date.now() - c.at < PROFILE_TTL ? c.profiles : {};
    } catch (e) { return {}; }
  },
  async loadProfiles(tickers) {
    const have = this.profiles();
    const need = tickers.filter((t) => !(t in have));
    if (!need.length) return have;
    try {
      const { profiles } = await api("/profiles", { tickers });
      const merged = { ...have, ...profiles };
      tickers.forEach((t) => { if (!(t in merged)) merged[t] = null; });
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ at: Date.now(), profiles: merged })); } catch (e) {}
      return merged;
    } catch (e) { return have; }
  },
  logo(ticker) { return this.profiles()[ticker]?.logo || null; },
};

// Logo with a monogram fallback: LSE listings and anything Finnhub doesn't know get a
// tinted initial, so every row has the same visual rhythm.
const HUES = [212, 262, 158, 28, 340, 188, 96, 14];
export function logoHtml(ticker, size = 32) {
  const t = String(ticker).toUpperCase();
  const hue = HUES[[...t].reduce((a, ch) => a + ch.charCodeAt(0), 0) % HUES.length];
  const url = MarketData.logo(t);
  const mono = `<span class="lg-mono" style="background:hsl(${hue} 55% 46% / .18);color:hsl(${hue} 70% 62%)">${t.slice(0, t.length > 3 ? 2 : 1)}</span>`;
  return `<span class="lg" style="width:${size}px;height:${size}px;font-size:${size}px">${
    url ? `<img src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""
  }${mono}</span>`;
}
