// icons.js — inline SVG line icons (Lucide geometry) replacing all emoji.
// icon(name, size) → SVG string; stroke = currentColor so colour is controlled by CSS.

const P = {
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  notebook: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9-3.9 1 1-3.9z"/>',
  dumbbell: '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
  trending: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  pencil: '<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.3a.5.5 0 0 0 .6.7l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.7 9.7 0 0 1 6.7 2.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.7 9.7 0 0 1-6.7-2.7L3 16"/><path d="M8 16H3v5"/>',
  arrowUp: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  arrowDown: '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  cap: '<path d="M21.4 10.9a1 1 0 0 0 0-1.8L12.8 5.2a2 2 0 0 0-1.6 0L2.6 9.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  sparkle: '<path d="M9.9 2.6 8.5 6.4a2 2 0 0 1-1.1 1.1l-3.8 1.4a.5.5 0 0 0 0 .9l3.8 1.4a2 2 0 0 1 1.1 1.1l1.4 3.8a.5.5 0 0 0 .9 0l1.4-3.8a2 2 0 0 1 1.1-1.1l3.8-1.4a.5.5 0 0 0 0-.9l-3.8-1.4a2 2 0 0 1-1.1-1.1l-1.4-3.8a.5.5 0 0 0-.9 0z"/><path d="M18 5h4"/><path d="M20 3v4"/>',
  logo: '<path d="M12 2 4 7v10l8 5 8-5V7z"/><path d="m12 22V12"/><path d="m4 7 8 5 8-5"/>',
};

export function icon(name, size = 18, extraClass = "") {
  const inner = P[name];
  if (!inner) return "";
  return `<svg class="ic ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
