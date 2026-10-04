// news.js — a short list of market headlines; each row opens the article in the browser
import { auth } from "./store.js";
import { escapeHtml } from "./store.js";

const WORKER_URL = "https://ledgerly-ai-intake.sahilpatel-ledgerly.workers.dev";
const CACHE_KEY = "ledgerly_headlines";
const SHOWN = 5;

function ago(ts) {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export const NewsModule = {
  el: null,
  items: [],
  loading: false,
  error: null,

  init() {
    this.el = document.getElementById("news-module");
    try { this.items = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); } catch (e) {}
    this.el.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="refresh-news"]')) this.load();
    });
    this.render();
    this.load();
  },

  async load() {
    if (this.loading) return;
    const user = auth.currentUser;
    if (!user) return;
    this.loading = true;
    this.error = null;
    this.render();
    try {
      const res = await fetch(`${WORKER_URL}/headlines`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load headlines.");
      this.items = data.items || [];
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.items)); } catch (e) {}
    } catch (err) {
      this.error = this.items.length ? null : (err.message || "Couldn't load headlines.");
    } finally {
      this.loading = false;
      this.render();
    }
  },

  render() {
    const rows = this.items.slice(0, SHOWN).map((n) => `
      <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer" class="news-row">
        <span class="news-title">${escapeHtml(n.title)}</span>
        <span class="news-meta">${escapeHtml(n.publisher || "")}${n.ts ? " · " + ago(n.ts) : ""}</span>
      </a>`).join("");
    this.el.innerHTML = `
      <div class="flex items-center justify-between mb-1.5">
        <p class="eyebrow">Market headlines</p>
        <button data-action="refresh-news" class="btn btn-ghost btn-sm" ${this.loading ? "disabled" : ""}>${this.loading ? "Loading…" : "Refresh"}</button>
      </div>
      ${rows || `<p class="text-[12.5px] faint">${escapeHtml(this.error || (this.loading ? "Loading headlines…" : "No headlines yet."))}</p>`}`;
  },
};
