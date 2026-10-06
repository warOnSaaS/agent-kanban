// White label. An instance can restyle the board for its team with brand/brand.json and a logo in the
// workspace repo (content, not code). Only kit tokens change: colours, accent, fonts, corner radius.
//
// brand/brand.json
// { "name": "Acme Ops", "logo": "logo.png", "scheme": "light",
//   "fonts": { "head": "Anybody", "body": "Poppins", "google": "family=Anybody:wght@700&family=Poppins:wght@400;600" },
//   "radius": "8px",
//   "colors": { "bg": "#fff", "cell": "#f5f3ff", "fg": "#12162b", "body": "#3d4145", "dim": "#696969",
//               "rule": "#e5e1e8", "ruleStrong": "#12162b", "accent": "#4635ff", "accentInk": "#fff" } }

const KIT_FONTS = 'family=Geist+Mono:wght@700&family=JetBrains+Mono:wght@400;700';
const TOKENS = { bg: '--bg', cell: '--cell', fg: '--fg', body: '--body', dim: '--dim', rule: '--rule', ruleStrong: '--rule-strong', accent: '--accent', accentInk: '--accent-ink' };
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

function build(b, fallbackName) {
  if (!b) return { name: fallbackName, logo: null, css: '', fonts: fontLink(KIT_FONTS), scheme: null };
  const vars = Object.entries(TOKENS).map(([k, v]) => (safe(b.colors?.[k]) ? `${v}:${b.colors[k]};` : '')).join('');
  const head = safe(b.fonts?.head), body = safe(b.fonts?.body);
  const extra = [head && `--font-head:"${head.replace(/"/g, '')}",system-ui,sans-serif;`, body && `--font-body:"${body.replace(/"/g, '')}",system-ui,sans-serif;`, safe(b.radius) && `--radius:${b.radius};`].filter(Boolean).join('');
  const google = typeof b.fonts?.google === 'string' && /^[\w=:;@&+.,-]+$/.test(b.fonts.google) ? b.fonts.google : KIT_FONTS;
  return {
    name: safe(b.name) ?? fallbackName,
    logo: typeof b.logo === 'string' && /^[\w.-]+\.(png|svg|jpg|jpeg|webp)$/i.test(b.logo) ? b.logo : null,
    scheme: b.scheme === 'light' || b.scheme === 'dark' ? b.scheme : null,
    // Same tokens for both schemes when the brand has one look; the kit's own dark/light rules are overridden.
    css: `:root,:root[data-theme="light"],:root[data-theme="dark"]{${vars}${extra}}.label{letter-spacing:.06em}`,
    fonts: fontLink(google),
  };
}

const fontLink = (q) => `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`;

const TYPES = { png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export async function handleBrandFile(req, res, ws, file) {
  const brand = await loadBrand(ws);
  if (!brand.logo || file !== brand.logo) return res.writeHead(404).end();
  const bytes = await ws.store.readRaw(`brand/${file}`);
  if (!bytes) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[file.split('.').pop().toLowerCase()], 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }).end(bytes);
}
