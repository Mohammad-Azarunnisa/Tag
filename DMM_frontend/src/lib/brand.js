// Per-organization brand theming.
//
// Light mode keeps the default indigo brand defined in index.css. In DARK mode
// we adopt the organization's brand colors so the product feels on-brand for
// each tenant. Colors are stored as "R G B" channel strings (Tailwind reads
// them via `rgb(var(--brand-500) / <alpha-value>)`).

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

// Curated palettes sampled from each organization's public website.
// Torii Minds (toriiminds.com) — orange/amber accent on dark.
// NCET (Nagarjuna College of Engineering & Technology) — institutional blue.
const PALETTES = {
  torii: ['255 246 241', '255 233 222', '255 207 184', '253 170 133', '247 129 84', '241 93 39', '222 72 19', '184 58 15', '147 49 18', '119 43 19'],
  ncet: ['239 246 255', '219 234 254', '191 219 254', '147 197 253', '96 165 250', '59 130 246', '37 99 235', '29 78 216', '30 64 175', '30 58 138'],
};
// Default Tag accent — the #f15d27 logo-orange ramp (matches index.css), used
// in dark mode when an org has no palette of its own.
const TAG_ORANGE = ['255 246 241', '255 233 222', '255 207 184', '253 170 133', '247 129 84', '241 93 39', '222 72 19', '184 58 15', '147 49 18', '119 43 19'];

const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '').trim();
  if (h.length !== 3 && h.length !== 6) return null;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (rgb, target, t) => rgb.map((c, i) => Math.round(c + (target[i] - c) * t));

// Build a full 50..900 palette from a single brand color (treated as the 600 step).
const paletteFromHex = (hex) => {
  const base = hexToRgb(hex);
  if (!base) return null;
  const white = [255, 255, 255], black = [0, 0, 0];
  const tints = { 50: 0.92, 100: 0.84, 200: 0.68, 300: 0.5, 400: 0.28, 500: 0.12 };
  const shades = { 700: 0.18, 800: 0.34, 900: 0.5 };
  return STEPS.map((s) => {
    if (s < 600) return mix(base, white, tints[s]).join(' ');
    if (s === 600) return base.join(' ');
    return mix(base, black, shades[s]).join(' ');
  });
};

const pickPalette = (org) => {
  const name = (org?.name || '').toLowerCase();
  if (name.includes('torii')) return PALETTES.torii;
  if (name.includes('ncet') || name.includes('nagarjuna')) return PALETTES.ncet;
  return paletteFromHex(org?.color); // generic: derive from the org's brand color
};

// Apply (or reset) the brand palette for the current theme + organization.
export const applyBrand = (org, theme) => {
  const root = document.documentElement;
  if (theme !== 'dark') {
    // Light mode: fall back to the indigo defaults from index.css.
    STEPS.forEach((s) => root.style.removeProperty(`--brand-${s}`));
    return;
  }
  const palette = pickPalette(org) || TAG_ORANGE;
  STEPS.forEach((s, i) => root.style.setProperty(`--brand-${s}`, palette[i]));
};
