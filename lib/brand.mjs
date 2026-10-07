// White label. An instance can restyle the board for its team with brand/brand.json and a logo in the
// workspace repo (content, not code). Only kit tokens change (ui-design's --ui-* custom properties):
// colours, accent, fonts, corners, and optionally any of the kit's look options.
//
// brand/brand.json
// { "name": "Acme Ops", "logo": "logo.png", "scheme": "light",
//   "fonts": { "head": "Anybody", "body": "Poppins", "google": "family=Anybody:wght@700&family=Poppins:wght@400;600" },
//   "radius": "8px",
//   "colors": { "bg": "#fff", "cell": "#f5f3ff", "fg": "#12162b", "body": "#3d4145", "dim": "#696969",
//               "rule": "#e5e1e8", "ruleStrong": "#12162b", "accent": "#4635ff", "accentInk": "#fff" },
//   "style": { "shape": "soft", "surface": "elevated" } }
//
// "scheme" is light or dark. "style" takes the kit's options (scheme, mode, shape, density, type, surface,
// motion) when a team wants a built-in look instead of, or under, its own colours.

const KIT_FONTS = 'family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500';
// The default look: the kit's midnight scheme, round, Geist.
const DEFAULT_STYLE = { scheme: 'midnight', shape: 'round', type: 'grotesk', surface: 'bordered', motion: 'subtle' };
const STYLE_VALUES = {
  scheme: ['ops', 'midnight', 'neutral', 'ember', 'tide', 'sage', 'arcade', 'warroom'],
  mode: ['light', 'dark', 'auto'],
  shape: ['sharp', 'soft', 'round'],
  density: ['compact', 'comfortable', 'spacious'],
  type: ['grotesk', 'mono', 'editorial', 'humanist', 'pixel', 'system'],
  surface: ['flat', 'bordered', 'elevated', 'glass'],
  motion: ['none', 'subtle', 'lively'],
};
// brand.json colour names (kept from the first kit) and the kit token each one sets.
const TOKENS = {
  bg: ['--ui-bg'], cell: ['--ui-surface-2', '--ui-lane'], fg: ['--ui-ink'], body: ['--ui-ink-2'], dim: ['--ui-ink-3'],
  rule: ['--ui-line'], accent: ['--ui-accent'], accentInk: ['--ui-on-accent'], accentSoft: ['--ui-accent-wash'],
  lane: ['--ui-lane'], chip: ['--ui-chip'], surface: ['--ui-surface'],
};
const FINISH = { pill: ['--ui-pill'], shadowSm: ['--ui-card-shadow'], track: ['--ui-label-track'] };
const safe = (v) => (typeof v === 'string' && /^[#\w\s.,%()'"-]{1,80}$/.test(v) ? v : null);
const cache = new Map();

export async function loadBrand(ws) {
  const hit = cache.get(ws);
  if (hit && hit.at > Date.now() - 60_000) return hit.brand;
  let raw = null;
  try {
    const f = await ws.store.read('brand/brand.json');
    raw = f ? JSON.parse(f.text) : null;
  } catch {
    raw = null;
  }
  const brand = build(raw, ws.name);
  cache.set(ws, { at: Date.now(), brand });
  return brand;
}

// The attributes for <html>: the kit's look options.
const attrs = (style) => Object.entries(style).map(([k, v]) => ` data-${k}="${v}"`).join('');

export function build(b, fallbackName) {
  if (!b) return { name: fallbackName, logo: null, css: '', fonts: fontLink(KIT_FONTS), scheme: null, attrs: attrs(DEFAULT_STYLE), style: { ...DEFAULT_STYLE } };
  const scheme = b.scheme === 'light' || b.scheme === 'dark' ? b.scheme : null;
  // A light brand sits on the neutral scheme, a dark one on midnight; its own colours go on top.
  const style = { ...DEFAULT_STYLE, ...(scheme === 'light' ? { scheme: 'neutral', mode: 'light' } : scheme === 'dark' ? { mode: 'dark' } : {}) };
  for (const [k, v] of Object.entries(b.style ?? {})) if (STYLE_VALUES[k]?.includes(v)) style[k] = v;
  const set = (map, from) => Object.entries(map).flatMap(([k, vars]) => (safe(from?.[k]) ? vars.map((v) => `${v}:${from[k]};`) : [])).join('');
  const head = safe(b.fonts?.head), body = safe(b.fonts?.body);
  const accent = safe(b.colors?.accent);
  const vars = set(TOKENS, b.colors) + set(FINISH, b.finish)
    + (head ? `--ui-display:"${head.replace(/"/g, '')}",system-ui,sans-serif;--ui-display-weight:700;--ui-display-track:-.02em;` : '')
    + (body ? `--ui-font:"${body.replace(/"/g, '')}",system-ui,sans-serif;--ui-numeric:"${body.replace(/"/g, '')}",system-ui,sans-serif;` : '')
    + (safe(b.radius) ? `--ui-r:${b.radius};` : '')
    // The brand's accent is its primary button, as before.
    + (accent ? '--ui-btn-bg:var(--ui-accent);--ui-btn-ink:var(--ui-on-accent);' : '')
    // A light brand gets white fields, not its tinted cell colour.
    + (scheme === 'light' ? '--ui-field:var(--ui-bg);' : '')
    // Firm lines follow the brand's own line colour.
    + (safe(b.colors?.rule) ? `--ui-line-2:color-mix(in srgb,${b.colors.rule} 70%,${safe(b.colors?.fg) ?? 'currentColor'});` : '');
  const google = typeof b.fonts?.google === 'string' && /^[\w=:;@&+.,-]+$/.test(b.fonts.google) ? `${b.fonts.google}&family=Geist+Mono:wght@400;500` : KIT_FONTS;
  return {
    name: safe(b.name) ?? fallbackName,
    logo: typeof b.logo === 'string' && /^[\w.-]+\.(png|svg|jpg|jpeg|webp)$/i.test(b.logo) ? b.logo : null,
    scheme,
    attrs: attrs(style),
    style,
    css: vars ? `:root{${vars}}` : '',
    fonts: fontLink(google),
  };
}

export function fontLink(q) {
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`;
}

const TYPES = { png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export async function handleBrandFile(req, res, ws, file) {
  const brand = await loadBrand(ws);
  if (!brand.logo || file !== brand.logo) return res.writeHead(404).end();
  const bytes = await ws.store.readRaw(`brand/${file}`);
  if (!bytes) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[file.split('.').pop().toLowerCase()], 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }).end(bytes);
}
