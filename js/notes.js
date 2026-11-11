// notes.js — Notes: folders, pins, search, a markdown editor with a formatting toolbar and live
// preview, tickable checklists, [[links]] with backlinks, photos and voice dictation.
// Same note shape as the iPhone app (text/cleaned/title/folder/pinned/images/source/updatedAt).

import { Store, escapeHtml } from "./store.js";
import { icon } from "./icons.js";
import { api } from "./marketdata.js";

const VIEW_KEY = "ledgerly_notes_view";  // "split" | "edit" | "read"

const body = (n) => n.cleaned ?? n.text ?? "";
const sortDate = (n) => n.updatedAt || n.createdAt || "";
const isPinned = (n) => n.pinned === true;

const MARKERS = ["### ", "## ", "# ", "- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "> "];
function stripLine(l) {
  let t = l.trim();
  for (const p of MARKERS) if (t.startsWith(p)) { t = t.slice(p.length); break; }
  return t.replace(/\*\*/g, "").replace(/\[\[|\]\]/g, "").replace(/`/g, "").trim();
}

export function noteTitle(n) {
  if (n.title) return n.title;
  for (const l of body(n).split("\n")) { const t = stripLine(l); if (t && t !== "---") return t.slice(0, 60); }
  return "Untitled note";
}

function snippet(n) {
  const lines = body(n).split("\n").map(stripLine).filter((t) => t && t !== "---");
  return n.summary || (n.title ? lines : lines.slice(1)).join(" ");
}

function checklist(n) {
  const lines = body(n).split("\n").map((l) => l.trim());
  const total = lines.filter((l) => /^- \[( |x|X)\] /.test(l)).length;
  return total ? { done: lines.filter((l) => /^- \[(x|X)\] /.test(l)).length, total } : null;
}

const linkTitles = (n) => [...body(n).matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => m[1].trim());

// ---- markdown → HTML (mirrors the iPhone renderer) ----

function inline(s) {
  let h = escapeHtml(s);
  h = h.replace(/`([^`]+)`/g, '<code class="nt-code">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  h = h.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a href="#" class="nt-link" data-action="open-link" data-title="${t.replace(/"/g, "&quot;")}">${t}</a>`);
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="nt-url">$1</a>');
  return h;
}

export function renderMarkdown(text, { interactive = true } = {}) {
  const lines = text.split("\n");
  const out = [];
  let list = null;  // "ul" | "ol"
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], t = raw.trim();
    const indent = Math.min(3, Math.floor((raw.match(/^ */)[0].length) / 2));
    if (t.startsWith("```")) {
      close();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      out.push(`<pre class="nt-pre">${escapeHtml(code.join("\n"))}</pre>`);
      continue;
    }
    let m;
    if (!t) { close(); continue; }
    if (t === "---" || t === "***") { close(); out.push('<hr class="nt-hr">'); continue; }
    if ((m = t.match(/^(#{1,3}) (.*)$/))) { close(); out.push(`<h${m[1].length + 1} class="nt-h${m[1].length}">${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = t.match(/^- \[( |x|X)\] (.*)$/))) {
      close();
      const done = m[1] !== " ";
      out.push(`<div class="nt-check ${done ? "is-done" : ""}" style="margin-left:${indent * 18}px">
        <button type="button" class="nt-box" ${interactive ? `data-action="toggle-check" data-line="${i}"` : "tabindex=-1"} aria-label="${done ? "Untick" : "Tick"}">${done ? icon("check", 13) : ""}</button>
        <span>${inline(m[2])}</span></div>`);
      continue;
    }
    if ((m = t.match(/^[-*•] (.*)$/))) {
      if (list !== "ul") { close(); out.push('<ul class="nt-ul">'); list = "ul"; }
      out.push(`<li style="margin-left:${indent * 18}px">${inline(m[1])}</li>`);
      continue;
    }
    if ((m = t.match(/^(\d+)\. (.*)$/))) {
      if (list !== "ol") { close(); out.push(`<ol class="nt-ol" start="${m[1]}">`); list = "ol"; }
      out.push(`<li>${inline(m[2])}</li>`);
      continue;
    }
    if (t.startsWith("> ")) { close(); out.push(`<blockquote class="nt-quote">${inline(t.slice(2))}</blockquote>`); continue; }
    close();
    out.push(`<p>${inline(t)}</p>`);
  }
  close();
  return out.join("");
}

function toggleLine(text, index) {
  const lines = text.split("\n");
  const l = lines[index];
  if (l == null) return text;
  if (/^(\s*)- \[ \] /.test(l)) lines[index] = l.replace("- [ ] ", "- [x] ");
  else if (/^(\s*)- \[(x|X)\] /.test(l)) lines[index] = l.replace(/- \[(x|X)\] /, "- [ ] ");
  return lines.join("\n");
}

// ---- formatting edits on a <textarea> ----

function wrapSel(ta, marker) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  ta.value = v.slice(0, a) + marker + v.slice(a, b) + marker + v.slice(b);
  ta.setSelectionRange(a + marker.length, b + marker.length);
}

function prefixLines(ta, p) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  const start = v.lastIndexOf("\n", a - 1) + 1;
  let end = v.indexOf("\n", b); if (end < 0) end = v.length;
  const lines = v.slice(start, end).split("\n");
  const all = lines.every((l) => l.startsWith(p));
  const next = lines.map((l, i) => {
    if (all) return l.slice(p.length);
    let x = l;
    const known = MARKERS.find((k) => x.startsWith(k));
    if (known) x = x.slice(known.length); else x = x.replace(/^\d+\. /, "");
    return (p === "1. " ? `${i + 1}. ` : p) + x;
  }).join("\n");
  ta.value = v.slice(0, start) + next + v.slice(end);
  const pos = start + next.length;
  ta.setSelectionRange(pos, pos);
}

function insertAt(ta, s, back = 0) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  ta.value = v.slice(0, a) + s + v.slice(b);
  const pos = a + s.length - back;
  ta.setSelectionRange(pos, pos);
}

// Enter on a list line continues the list; Enter on an empty item ends it.
function continueList(ta, e) {
  const { selectionStart: a, value: v } = ta;
  if (a !== ta.selectionEnd) return false;
  const start = v.lastIndexOf("\n", a - 1) + 1;
  const line = v.slice(start, a);
  const ind = line.match(/^ */)[0];
  const t = line.slice(ind.length);
  let next = null, marker = 0, m;
  if ((m = t.match(/^- \[( |x|X)\] /))) { next = "- [ ] "; marker = 6; }
  else if (t.startsWith("- ")) { next = "- "; marker = 2; }
  else if (t.startsWith("* ")) { next = "* "; marker = 2; }
  else if (t.startsWith("> ")) { next = "> "; marker = 2; }
  else if ((m = t.match(/^(\d+)\. /))) { next = `${Number(m[1]) + 1}. `; marker = m[0].length; }
  if (!next) return false;
  e.preventDefault();
  if (t.length <= marker) {
    ta.value = v.slice(0, start) + v.slice(a);
    ta.setSelectionRange(start, start);
  } else {
    insertAt(ta, "\n" + ind + next);
  }
  return true;
}

// Photos are shrunk to a small JPEG kept inside the note's own document (each note can be up to 1 MB).
function shrink(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      for (const [side, q] of [[1280, 0.6], [1000, 0.5], [800, 0.45], [640, 0.4]]) {
        const scale = Math.min(1, side / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/jpeg", q).split(",")[1];
        if (data.length * 0.75 < 170000) return resolve(data);
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

export const NotesModule = {
  el: null,
  folder: "all",
  query: "",
  openId: null,
  draft: null,      // unsaved new note
  saveTimer: null,
  view: "split",
  listening: null,
  asking: false,
  answer: null,

  init() {
    this.el = document.getElementById("notes-module");
    this.el.classList.remove("card-pad");
    this.el.classList.add("nt-root");
    try { this.view = localStorage.getItem(VIEW_KEY) || "split"; } catch (e) {}
    injectStyles();

    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("input", (e) => this.onInput(e));
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("change", (e) => this.onChange(e));
    Store.subscribe("notes:changed", () => this.refresh());
    this.render();
  },

  get notes() {
    return [...(Store.state.notes || [])].sort((a, b) => (isPinned(b) - isPinned(a)) || sortDate(b).localeCompare(sortDate(a)));
  },
  get folders() { return [...new Set(this.notes.map((n) => n.folder).filter(Boolean))].sort(); },
  get current() {
    if (!this.openId) return null;
    return Store.state.notes.find((n) => n.id === this.openId) || (this.draft?.id === this.openId ? this.draft : null);
  },

  filtered() {
    const q = this.query.trim().toLowerCase();
    let list = this.notes;
    if (q) return list.filter((n) => noteTitle(n).toLowerCase().includes(q) || body(n).toLowerCase().includes(q) || (n.folder || "").toLowerCase().includes(q));
    if (this.folder === "pinned") return list.filter(isPinned);
    if (this.folder !== "all") return list.filter((n) => n.folder === this.folder);
    return list;
  },

  // ---- events ----

  onClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id, folder, fmt } = btn.dataset;
    const ta = this.el.querySelector("#nt-body");
    if (action === "open-link") { e.preventDefault(); return this.openLink(btn.dataset.title); }
    switch (action) {
      case "folder": this.folder = folder; this.query = ""; return this.render();
      case "open": this.flush(); this.openId = id; this.draft = null; return this.render();
      case "close": this.flush(); this.openId = null; this.draft = null; return this.render();
      case "new": return this.newNote(btn.dataset.starter || "");
      case "view": this.view = btn.dataset.view; try { localStorage.setItem(VIEW_KEY, this.view); } catch (err) {} return this.render();
      case "pin": { const n = this.current; if (n) this.save({ pinned: !isPinned(n) }); return; }
      case "move": return this.move();
      case "delete": {
        const n = this.current;
        if (!n || !confirm(`Delete "${noteTitle(n)}"?`)) return;
        clearTimeout(this.saveTimer);
        if (Store.state.notes.some((x) => x.id === n.id)) Store.remove("notes", n.id);
        this.openId = null; this.draft = null;
        return this.render();
      }
      case "toggle-check": {
        const n = this.current; if (!n) return;
        const next = toggleLine(body(n), Number(btn.dataset.line));
        this.save(n.cleaned != null ? { cleaned: next } : { text: next });
        if (ta) ta.value = next;
        return;
      }
      case "fmt": {
        if (!ta) return;
        ta.focus();
        if (fmt === "h1") prefixLines(ta, "# ");
        else if (fmt === "h2") prefixLines(ta, "## ");
        else if (fmt === "bold") wrapSel(ta, "**");
        else if (fmt === "italic") wrapSel(ta, "*");
        else if (fmt === "check") prefixLines(ta, "- [ ] ");
        else if (fmt === "list") prefixLines(ta, "- ");
        else if (fmt === "num") prefixLines(ta, "1. ");
        else if (fmt === "quote") prefixLines(ta, "> ");
        else if (fmt === "code") wrapSel(ta, "`");
        else if (fmt === "link") insertAt(ta, "[[]]", 2);
        else if (fmt === "hr") insertAt(ta, "\n---\n");
        return this.edited();
      }
      case "photo": return this.el.querySelector("#nt-photo")?.click();
      case "remove-image": { const n = this.current; if (n) this.save({ images: (n.images || []).filter((i) => i.id !== btn.dataset.img) }); return; }
      case "dictate": return this.dictate();
      case "tidy": return this.tidy();
      case "ask": return this.ask();
      case "task": {
        const n = this.current; if (!n || n.promoted) return;
        Store.add("tasks", { id: Store.uid("tk"), title: noteTitle(n), energy: "medium", done: false, linkedDeadlineId: null, createdAt: new Date().toISOString() });
        this.save({ promoted: true });
        return this.toast("Added to your tasks");
      }
      case "copy": {
        const n = this.current; if (!n) return;
        navigator.clipboard?.writeText(`# ${noteTitle(n)}\n\n${body(n)}`).then(() => this.toast("Copied as markdown"));
        return;
      }
    }
  },

  onInput(e) {
    if (e.target.id === "nt-search") {
      this.query = e.target.value;
      return this.renderList();
    }
    if (e.target.id === "nt-body" || e.target.id === "nt-title") this.edited();
  },

  onKey(e) {
    const ta = e.target.id === "nt-body" ? e.target : null;
    if (ta && e.key === "Enter" && !e.shiftKey && continueList(ta, e)) return this.edited();
    if (ta && (e.metaKey || e.ctrlKey) && ["b", "i", "k"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === "b") wrapSel(ta, "**"); else if (k === "i") wrapSel(ta, "*"); else insertAt(ta, "[[]]", 2);
      return this.edited();
    }
    if (e.target.id === "nt-title" && e.key === "Enter") { e.preventDefault(); this.el.querySelector("#nt-body")?.focus(); }
    if (e.target.id === "nt-ask" && e.key === "Enter") { e.preventDefault(); this.ask(); }
  },

  async onChange(e) {
    if (e.target.id !== "nt-photo" || !e.target.files?.length) return;
    const n = this.current;
    if (!n) return;
    if (!Store.notesInCollection()) { e.target.value = ""; return this.toast("Photos switch on once notes have their own storage"); }
    const imgs = [...(n.images || [])];
    for (const f of e.target.files) {
      if (imgs.length >= 4) { this.toast("Up to 4 photos per note"); break; }
      const data = await shrink(f);
      if (data) imgs.push({ id: "im_" + Math.random().toString(36).slice(2, 10), jpeg: data });
    }
    e.target.value = "";
    this.save({ images: imgs });
  },

  // ---- editing ----

  newNote(starter) {
    this.flush();
    this.draft = { id: Store.uid("nt"), text: starter, createdAt: new Date().toISOString(), promoted: false,
                   folder: ["all", "pinned"].includes(this.folder) ? undefined : this.folder };
    this.openId = this.draft.id;
    this.render();
    const target = starter ? this.el.querySelector("#nt-body") : this.el.querySelector("#nt-title");
    if (target) { target.focus(); if (starter) target.setSelectionRange(starter.length, starter.length); }
  },

  edited() {
    this.renderPreview();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 900);
  },

  // Writes the editor's title and body if they changed.
  flush() {
    clearTimeout(this.saveTimer);
    const n = this.current;
    const ta = this.el?.querySelector("#nt-body"), ti = this.el?.querySelector("#nt-title");
    if (!n || !ta || !ti) return;
    const title = ti.value.trim(), text = ta.value;
    const changed = (title || null) !== (n.title || null) || text !== body(n);
    if (!changed) return;
    // null (not undefined) so clearing a field also clears it in the cloud copy.
    const patch = { title: title || null };
    if (text !== body(n)) { patch.text = text; patch.cleaned = null; }
    this.save(patch);
  },

  save(patch) {
    const n = this.current;
    if (!n) return;
    const exists = Store.state.notes.some((x) => x.id === n.id);
    const next = { ...n, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (!exists) {
      if (!next.title && !body(next).trim() && !(next.images || []).length) return;
      this.draft = null;
      Store.add("notes", next);
    } else {
      Store.update("notes", n.id, next);
    }
  },

  openLink(title) {
    this.flush();
    const t = title.trim();
    const hit = this.notes.find((n) => noteTitle(n).toLowerCase() === t.toLowerCase());
    if (hit) { this.openId = hit.id; this.draft = null; return this.render(); }
    this.draft = { id: Store.uid("nt"), text: "", title: t, createdAt: new Date().toISOString(), promoted: false, folder: this.current?.folder };
    this.openId = this.draft.id;
    this.render();
    this.el.querySelector("#nt-body")?.focus();
  },

  move() {
    const n = this.current; if (!n) return;
    const f = prompt(`Move to folder (existing: ${this.folders.join(", ") || "none yet"}).\nLeave empty for no folder.`, n.folder || "");
    if (f === null) return;
    this.flush();
    this.save({ folder: f.trim() || null });
    this.render();
  },

  dictate() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return this.toast("Voice typing isn't supported in this browser");
    if (this.listening) { this.listening.stop(); return; }
    const ta = this.el.querySelector("#nt-body");
    const rec = new SR();
    rec.lang = "en-GB"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (ev) => {
      const said = [...ev.results].slice(ev.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript).join(" ").trim();
      if (!said || !ta) return;
      const pre = ta.value && !ta.value.endsWith("\n") && !ta.value.endsWith(" ") ? " " : "";
      ta.value += pre + said;
      this.edited();
    };
    rec.onend = () => { this.listening = null; this.el.querySelector('[data-action="dictate"]')?.classList.remove("nt-rec"); };
    rec.start();
    this.listening = rec;
    this.el.querySelector('[data-action="dictate"]')?.classList.add("nt-rec");
  },

  async tidy() {
    this.flush();
    const n = this.current; if (!n || !body(n).trim()) return;
    this.toast("Tidying with AI…");
    try {
      const r = await api("/ai", { task: "notes.process", input: { note: body(n) } });
      this.save({ title: n.title || r.title, summary: r.summary, cleaned: r.cleaned, flashcards: r.flashcards, examQuestions: r.examQuestions });
      this.render();
      this.toast("Tidied — title, summary and flashcards added");
    } catch (err) { this.toast(err.message); }
  },

  async ask() {
    const q = this.el.querySelector("#nt-ask")?.value.trim();
    if (!q || this.asking) return;
    this.asking = true; this.answer = null; this.renderAsk();
    let budget = 50000;
    const notes = [];
    for (const n of this.notes) {
      if (budget <= 0) break;
      notes.push({ id: n.id, title: noteTitle(n), date: n.createdAt || "", folder: n.folder || "", text: body(n).slice(0, budget) });
      budget -= body(n).length;
    }
    try { this.answer = await api("/ai", { task: "notes.ask", input: { question: q, notes } }); }
    catch (err) { this.answer = { answer: err.message, sources: [] }; }
    this.asking = false;
    this.renderAsk();
  },

  toast(msg) {
    const t = document.createElement("div");
    t.className = "nt-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  },

  // ---- rendering ----

  // Store updates (incl. our own saves) shouldn't wipe what's being typed.
  refresh() {
    const editing = document.activeElement?.id === "nt-body" || document.activeElement?.id === "nt-title";
    if (editing) { this.renderList(); this.renderSide(); return; }
    this.render();
  },

  render() {
    const n = this.current;
    this.el.innerHTML = `
      <div class="nt-wrap ${n ? "has-open" : ""}">
        <aside class="nt-side" id="nt-side"></aside>
        <section class="nt-listcol">
          <div class="nt-search">${icon("search", 16)}<input id="nt-search" placeholder="Search every note" value="${escapeHtml(this.query)}" /></div>
          <div class="nt-new">
            <button class="btn btn-primary btn-sm" data-action="new">${icon("pencil", 14)} New note</button>
            <button class="btn btn-ghost btn-sm" data-action="new" data-starter="- [ ] ">${icon("checkSquare", 14)} Checklist</button>
          </div>
          <div id="nt-list" class="nt-list"></div>
          <div id="nt-askbox" class="nt-ask card"></div>
        </section>
        <section class="nt-editor" id="nt-editor">${n ? this.editorHTML(n) : this.emptyHTML()}</section>
      </div>`;
    this.renderSide();
    this.renderList();
    this.renderPreview();
    this.renderAsk();
  },

  renderSide() {
    const side = this.el.querySelector("#nt-side");
    if (!side) return;
    const count = (f) => f === "all" ? this.notes.length : f === "pinned" ? this.notes.filter(isPinned).length : this.notes.filter((n) => n.folder === f).length;
    const item = (f, label, ic) => `<button class="nt-folder ${this.folder === f && !this.query ? "on" : ""}" data-action="folder" data-folder="${escapeHtml(f)}">
      ${icon(ic, 15)}<span>${escapeHtml(label)}</span><em>${count(f)}</em></button>`;
    side.innerHTML = `<p class="eyebrow nt-eyebrow">Notes</p>${item("all", "All notes", "notebook")}${item("pinned", "Pinned", "pin")}
      ${this.folders.length ? `<p class="eyebrow nt-eyebrow" style="margin-top:14px">Folders</p>` : ""}
      ${this.folders.map((f) => item(f, f, "folder")).join("")}`;
  },

  renderList() {
    const el = this.el.querySelector("#nt-list");
    if (!el) return;
    const list = this.filtered();
    const q = this.query.trim().toLowerCase();
    const row = (n) => {
      const c = checklist(n);
      let snip = escapeHtml(snippet(n).slice(0, 160));
      if (q) {
        const b = body(n), i = b.toLowerCase().indexOf(q);
        if (i >= 0) {
          const s = Math.max(0, i - 40);
          const piece = (s ? "…" : "") + b.slice(s, i + q.length + 80).replace(/\n/g, " ");
          snip = escapeHtml(piece).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), (m) => `<mark>${m}</mark>`);
        }
      }
      const d = sortDate(n) ? new Date(sortDate(n)).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
      const img = n.images?.[0];
      return `<button class="nt-item ${n.id === this.openId ? "on" : ""}" data-action="open" data-id="${n.id}">
        <span class="nt-item-top">${isPinned(n) ? `<span class="nt-pin">${icon("pin", 12)}</span>` : ""}<strong>${escapeHtml(noteTitle(n))}</strong></span>
        ${img ? `<img class="nt-thumb" src="data:image/jpeg;base64,${img.jpeg}" alt="">` : ""}
        <span class="nt-snip">${snip || "<i class='faint'>Empty</i>"}</span>
        <span class="nt-meta">${n.folder ? `<span>${icon("folder", 11)} ${escapeHtml(n.folder)}</span>` : ""}${n.source === "voice" ? `<span>${icon("mic", 11)}</span>` : ""}${c ? `<span>${icon("checkSquare", 11)} ${c.done}/${c.total}</span>` : ""}<span class="nt-date">${d}</span></span>
      </button>`;
    };
    el.innerHTML = list.length ? list.map(row).join("") : `<p class="faint nt-emptylist">${this.query ? `Nothing matches "${escapeHtml(this.query)}".` : "No notes here yet."}</p>`;
  },

  emptyHTML() {
    return `<div class="nt-empty">
      <span class="nt-empty-ic">${icon("notebook", 28)}</span>
      <p class="sect-title">Pick a note or start a new one</p>
      <p class="faint" style="font-size:13.5px;max-width:340px;margin:6px auto 0">Markdown works: <b>**bold**</b>, <i>*italic*</i>, # headings, - lists, - [ ] checklists and [[Note title]] links. ⌘B, ⌘I and ⌘K are shortcuts.</p>
    </div>`;
  },

  editorHTML(n) {
    const tool = (f, ic, label) => `<button type="button" class="nt-tool" data-action="fmt" data-fmt="${f}" title="${label}">${ic}</button>`;
    const viewBtn = (v, label) => `<button type="button" class="nt-seg ${this.view === v ? "on" : ""}" data-action="view" data-view="${v}">${label}</button>`;
    const saved = Store.state.notes.some((x) => x.id === n.id);
    const backlinks = this.notes.filter((x) => x.id !== n.id && linkTitles(x).some((t) => t.toLowerCase() === noteTitle(n).toLowerCase()));
    const study = (n.flashcards?.length || n.examQuestions?.length) ? `
      <details class="nt-study"><summary>${icon("sparkle", 14)} ${n.flashcards?.length || 0} flashcards · ${n.examQuestions?.length || 0} exam questions</summary>
        ${(n.flashcards || []).map((c) => `<div class="nt-card"><b>${escapeHtml(c.q)}</b><span>${escapeHtml(c.a)}</span></div>`).join("")}
        ${(n.examQuestions || []).length ? `<ol class="nt-ol">${n.examQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ol>` : ""}
      </details>` : "";
    return `
      <div class="nt-bar">
        <button class="btn-icon nt-back" data-action="close" title="Back">${icon("chevronLeft", 18)}</button>
        <div class="nt-segs">${viewBtn("edit", "Write")}${viewBtn("split", "Split")}${viewBtn("read", "Read")}</div>
        <span class="flex-1"></span>
        <button class="btn-icon" data-action="pin" title="${isPinned(n) ? "Unpin" : "Pin"}" ${saved ? "" : "disabled"} style="${isPinned(n) ? "color:var(--accent)" : ""}">${icon("pin", 16)}</button>
        <button class="btn-icon" data-action="move" title="Move to folder" ${saved ? "" : "disabled"}>${icon("folder", 16)}</button>
        <button class="btn-icon" data-action="tidy" title="Tidy with AI (title, summary, flashcards)" ${saved ? "" : "disabled"}>${icon("sparkle", 16)}</button>
        <button class="btn-icon" data-action="task" title="Make it a task" ${saved && !n.promoted ? "" : "disabled"}>${icon("check", 16)}</button>
        <button class="btn-icon" data-action="copy" title="Copy as markdown">${icon("link", 16)}</button>
        <button class="btn-icon" data-action="delete" title="Delete" style="color:var(--neg)">${icon("trash", 16)}</button>
      </div>
      <input id="nt-title" class="nt-title" placeholder="Title" value="${escapeHtml(n.title || "")}" />
      <p class="nt-sub">${n.folder ? `${icon("folder", 12)} ${escapeHtml(n.folder)} · ` : ""}${n.createdAt ? new Date(sortDate(n)).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}${n.source === "voice" ? " · voice note" : ""}</p>
      ${(n.images || []).length ? `<div class="nt-imgs">${n.images.map((i) => `<figure><img src="data:image/jpeg;base64,${i.jpeg}" alt=""><button data-action="remove-image" data-img="${i.id}" title="Remove">${icon("x", 12)}</button></figure>`).join("")}</div>` : ""}
      <div class="nt-tools ${this.view === "read" ? "hidden" : ""}">
        ${tool("h1", icon("heading", 16), "Heading")}${tool("h2", '<span style="font-weight:800;font-size:12px">H2</span>', "Subheading")}
        ${tool("bold", icon("bold", 16), "Bold (⌘B)")}${tool("italic", icon("italic", 16), "Italic (⌘I)")}
        <span class="nt-sep"></span>
        ${tool("check", icon("checkSquare", 16), "Checklist")}${tool("list", icon("list", 16), "Bullet list")}${tool("num", icon("listOrdered", 16), "Numbered list")}
        ${tool("quote", icon("quote", 15), "Quote")}${tool("code", icon("code", 16), "Code")}
        <span class="nt-sep"></span>
        ${tool("link", icon("link", 16), "Link a note (⌘K)")}${tool("hr", icon("minus", 16), "Divider")}
        <button type="button" class="nt-tool" data-action="photo" title="Add photo">${icon("image", 16)}</button>
        <button type="button" class="nt-tool" data-action="dictate" title="Voice typing">${icon("mic", 16)}</button>
        <input id="nt-photo" type="file" accept="image/*" multiple hidden />
      </div>
      <div class="nt-panes view-${this.view}">
        <textarea id="nt-body" class="nt-body" placeholder="Start writing…" spellcheck="true">${escapeHtml(body(n))}</textarea>
        <article id="nt-preview" class="nt-preview"></article>
      </div>
      ${n.summary && n.cleaned != null ? `<div class="nt-summary"><p class="eyebrow">Summary</p><p>${escapeHtml(n.summary)}</p></div>` : ""}
      ${study}
      ${backlinks.length ? `<div class="nt-backlinks"><p class="eyebrow">Linked from</p>${backlinks.map((b) => `<button class="nt-blink" data-action="open" data-id="${b.id}">${icon("link", 12)} ${escapeHtml(noteTitle(b))}</button>`).join("")}</div>` : ""}`;
  },

  renderPreview() {
    const pv = this.el.querySelector("#nt-preview"), ta = this.el.querySelector("#nt-body");
    if (!pv || !ta) return;
    pv.innerHTML = ta.value.trim() ? renderMarkdown(ta.value) : '<p class="faint">Nothing to preview yet.</p>';
  },

  renderAsk() {
    const box = this.el.querySelector("#nt-askbox");
    if (!box) return;
    if (!this.notes.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const prev = box.querySelector("#nt-ask")?.value || "";
    const a = this.answer;
    const used = (a?.sources || []).map((id) => this.notes.find((n) => n.id === id)).filter(Boolean);
    box.innerHTML = `
      <p class="eyebrow" style="display:flex;gap:6px;align-items:center">${icon("sparkle", 13)} Ask your notes</p>
      <div class="nt-askrow"><input id="nt-ask" class="input" placeholder="e.g. what did we cover on Itô's lemma?" value="${escapeHtml(prev)}" />
        <button class="btn btn-primary btn-sm" data-action="ask" ${this.asking ? "disabled" : ""}>${this.asking ? "…" : icon("arrowUp", 15)}</button></div>
      ${a ? `<div class="nt-answer">${renderMarkdown(a.answer, { interactive: false })}</div>
        ${used.length ? `<div class="nt-used">${used.map((n) => `<button class="chip" data-action="open" data-id="${n.id}">${escapeHtml(noteTitle(n))}</button>`).join("")}</div>` : ""}` : ""}`;
  },
};

// Old name, kept so app.js imports keep working.
export const BrainDump = NotesModule;

function injectStyles() {
  if (document.getElementById("nt-css")) return;
  const s = document.createElement("style");
  s.id = "nt-css";
  s.textContent = `
.nt-root{padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important}
.nt-wrap{display:grid;grid-template-columns:1fr;gap:14px}
.nt-side{display:none}
.nt-listcol{display:flex;flex-direction:column;gap:10px;min-width:0}
.nt-wrap.has-open .nt-listcol{display:none}
.nt-editor{display:none;min-width:0}
.nt-wrap.has-open .nt-editor{display:block}
.nt-search{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:16px;background:var(--surface);border:1px solid var(--border);color:var(--ink-faint);backdrop-filter:blur(20px)}
.nt-search input{flex:1;background:transparent;border:0;outline:0;color:var(--ink);font:inherit;font-size:14px}
.nt-new{display:flex;gap:8px}
.nt-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.nt-item{display:flex;flex-direction:column;gap:6px;text-align:left;padding:14px 15px;border-radius:18px;background:var(--surface);border:1px solid var(--border);box-shadow:inset 0 1px 0 var(--edge);backdrop-filter:blur(20px) saturate(1.3);transition:transform .15s ease,border-color .15s ease;min-height:118px;color:var(--ink)}
.nt-item:hover{transform:translateY(-2px);border-color:var(--border-2)}
.nt-item.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.nt-item-top{display:flex;gap:6px;align-items:center}
.nt-item-top strong{font-size:14.5px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nt-pin{color:var(--accent);flex:none}
.nt-snip{font-size:12.5px;color:var(--ink-muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.nt-snip mark{background:var(--accent-soft);color:var(--ink);border-radius:3px;padding:0 2px}
.nt-thumb{width:100%;height:70px;object-fit:cover;border-radius:10px}
.nt-meta{margin-top:auto;display:flex;gap:10px;align-items:center;font-size:11px;font-weight:600;color:var(--ink-faint)}
.nt-meta span{display:inline-flex;gap:3px;align-items:center}
.nt-date{margin-left:auto}
.nt-emptylist{padding:24px;text-align:center;font-size:13.5px}
.nt-folder{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:12px;font-size:13.5px;font-weight:600;color:var(--ink-muted);text-align:left}
.nt-folder span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nt-folder em{font-style:normal;font-size:11.5px;color:var(--ink-faint)}
.nt-folder:hover{background:var(--sunken);color:var(--ink)}
.nt-folder.on{background:var(--accent-soft);color:var(--ink)}
.nt-folder.on .ic{color:var(--accent)}
.nt-eyebrow{padding:0 10px 6px}
.nt-editor{padding:18px 20px 26px;border-radius:24px;background:var(--surface);border:1px solid var(--border);box-shadow:inset 0 1px 0 var(--edge),var(--shadow-md);backdrop-filter:blur(24px) saturate(1.3)}
.nt-bar{display:flex;align-items:center;gap:4px;margin-bottom:10px}
.nt-segs{display:inline-flex;padding:3px;border-radius:12px;background:var(--sunken);margin-left:4px}
.nt-seg{padding:5px 11px;border-radius:9px;font-size:12.5px;font-weight:700;color:var(--ink-muted)}
.nt-seg.on{background:var(--surface-2);color:var(--ink);box-shadow:var(--shadow-sm)}
.nt-title{width:100%;background:transparent;border:0;outline:0;color:var(--ink);font:800 30px/1.15 Manrope,system-ui,sans-serif;letter-spacing:-.03em;padding:4px 0}
.nt-title::placeholder{color:var(--ink-faint)}
.nt-sub{font-size:12px;font-weight:600;color:var(--ink-faint);display:flex;gap:4px;align-items:center;margin:2px 0 12px}
.nt-tools{position:sticky;top:64px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:5px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);backdrop-filter:blur(20px);margin-bottom:12px}
.nt-tool{display:grid;place-items:center;width:34px;height:32px;border-radius:9px;color:var(--ink-muted)}
.nt-tool:hover{background:var(--sunken);color:var(--ink)}
.nt-tool.nt-rec{color:#fff;background:var(--neg);animation:ntPulse 1.2s ease-in-out infinite}
@keyframes ntPulse{50%{opacity:.7}}
.nt-sep{width:1px;height:20px;background:var(--border-2);margin:0 4px}
.nt-panes{display:grid;gap:18px}
.nt-panes.view-split{grid-template-columns:1fr}
.nt-panes.view-edit .nt-preview,.nt-panes.view-read .nt-body{display:none}
.nt-body{width:100%;min-height:52vh;resize:vertical;background:transparent;border:0;outline:0;color:var(--ink);font:15px/1.7 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:-.01em}
.nt-preview{font-size:15.5px;line-height:1.7;color:var(--ink);min-width:0}
.nt-panes.view-split .nt-preview{padding:4px 0 0 18px;border-left:1px solid var(--border)}
.nt-preview p{margin:0 0 10px}
.nt-preview h2.nt-h1,.nt-answer h2{font:800 24px/1.25 Manrope,system-ui;letter-spacing:-.02em;margin:18px 0 8px}
.nt-preview h3.nt-h2,.nt-answer h3{font:800 19px/1.3 Manrope,system-ui;margin:16px 0 6px}
.nt-preview h4.nt-h3,.nt-answer h4{font:700 16px/1.3 Manrope,system-ui;margin:14px 0 4px}
.nt-ul,.nt-ol{margin:0 0 10px;padding-left:22px}
.nt-ul{list-style:disc}.nt-ol{list-style:decimal}
.nt-ul li::marker,.nt-ol li::marker{color:var(--accent)}
.nt-check{display:flex;gap:10px;align-items:flex-start;margin:4px 0}
.nt-box{flex:none;display:grid;place-items:center;width:20px;height:20px;margin-top:3px;border-radius:7px;border:1.6px solid var(--border-2);color:#fff;transition:.15s}
.nt-check.is-done .nt-box{background:var(--pos);border-color:var(--pos)}
.nt-check.is-done span{color:var(--ink-faint);text-decoration:line-through}
.nt-quote{margin:6px 0 12px;padding:4px 0 4px 14px;border-left:3px solid var(--accent);color:var(--ink-muted);font-style:italic}
.nt-pre{margin:8px 0 12px;padding:12px 14px;border-radius:12px;background:var(--sunken);font:13px/1.55 'IBM Plex Mono',monospace;overflow-x:auto}
.nt-code{padding:1px 6px;border-radius:6px;background:var(--sunken);font:.88em 'IBM Plex Mono',monospace}
.nt-hr{border:0;border-top:1px solid var(--border-2);margin:16px 0}
.nt-link{color:var(--accent);text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:3px}
.nt-url{color:var(--accent)}
.nt-imgs{display:flex;gap:10px;overflow-x:auto;margin:0 0 12px}
.nt-imgs figure{position:relative;flex:none}
.nt-imgs img{height:120px;border-radius:14px;display:block}
.nt-imgs button{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;opacity:0;transition:.15s}
.nt-imgs figure:hover button{opacity:1}
.nt-summary,.nt-backlinks,.nt-study{margin-top:18px;padding:14px 16px;border-radius:16px;background:var(--sunken);border:1px solid var(--border)}
.nt-summary p:last-child{font-size:14px;color:var(--ink-muted);margin-top:6px}
.nt-blink{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13.5px;font-weight:600;color:var(--accent)}
.nt-study summary{cursor:pointer;display:flex;gap:6px;align-items:center;font-size:13.5px;font-weight:700}
.nt-card{display:grid;gap:3px;padding:10px 0;border-top:1px solid var(--border);font-size:13.5px}
.nt-card span{color:var(--ink-muted)}
.nt-empty{text-align:center;padding:80px 20px}
.nt-empty-ic{display:inline-grid;place-items:center;width:58px;height:58px;border-radius:18px;background:var(--accent-soft);color:var(--accent);margin-bottom:14px}
.nt-ask{padding:14px!important}
.nt-askrow{display:flex;gap:8px;margin-top:8px}
.nt-answer{margin-top:12px;font-size:14px;line-height:1.6}
.nt-used{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.nt-toast{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:300;padding:10px 16px;border-radius:999px;background:var(--ink);color:var(--on-ink);font:600 13px Manrope,system-ui;box-shadow:var(--shadow-lg);animation:fade .25s ease}
@media (min-width:1024px){
  .nt-wrap{grid-template-columns:200px minmax(260px,320px) minmax(0,1fr);align-items:start}
  .nt-side{display:block;position:sticky;top:80px}
  .nt-wrap.has-open .nt-listcol{display:flex}
  .nt-editor{display:block}
  .nt-list{grid-template-columns:1fr;max-height:calc(100vh - 260px);overflow-y:auto;padding:2px 4px 8px 2px}
  .nt-back{display:none}
  .nt-panes.view-split{grid-template-columns:1fr 1fr}
}
@media (max-width:1023px){
  .nt-panes.view-split .nt-preview{padding:14px 0 0;border-left:0;border-top:1px solid var(--border)}
  .nt-editor{padding:14px 14px 22px}
  .nt-title{font-size:26px}
  .nt-tools{top:56px}
}`;
  document.head.appendChild(s);
}
