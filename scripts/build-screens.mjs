// Bundles the wOS suite screen part (screens/index.mjs) into one browser module, dist/screens.mjs, with the
// board's own styles carried inside it and scoped to the screen's root (.wos-board), so nothing leaks into the
// suite's shell. The kit itself is loaded by the suite. --check fails if dist/screens.mjs is out of date.
//   node scripts/build-screens.mjs [--check]
import fs from 'node:fs';
import { build } from 'esbuild';
import { APP_CSS } from '../lib/ui/page.mjs';
import { PAGE_CSS } from '../lib/board.mjs';

const ROOT = '.wos-board';
const DROP = /\.ak-top|\.ak-nav|\.ak-logo|^\.ui-toast/;

// Prefix every selector with the root; rules for the page itself (body, html, :root) apply to the root.
function scopeSel(sel) {
  const s = sel.trim();
  if (!s || DROP.test(s)) return null;
  if (/^(html|body|:root)\b/.test(s)) return s.replace(/^(html|body|:root)/, ROOT);
  return `${ROOT} ${s}`;
}
function splitTop(sel) {
  const out = []; let depth = 0, cur = '';
  for (const c of sel) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && !depth) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur);
  return out;
}
export function scopeCss(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // find the matching close brace
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) out += `${head}{${scopeCss(body)}}`;
    else if (head.startsWith('@')) out += `${head}{${body}}`;
    else {
      const sels = splitTop(head).map(scopeSel).filter(Boolean);
      if (sels.length) out += `${sels.join(',')}{${body}}`;
    }
    i = j;
  }
  return out;
}

const css = scopeCss(APP_CSS + PAGE_CSS) + `
${ROOT}{display:block;min-width:0}
${ROOT} .wb-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ui-s3);flex-wrap:wrap}
${ROOT} .wb-head .ui-tabs{min-width:0;overflow-x:auto;scrollbar-width:none}
${ROOT} .ak-wrap{padding-top:var(--ui-s5)}
${ROOT} .ui-board{overflow-x:auto;-webkit-overflow-scrolling:touch}
${ROOT} .is-loading{opacity:.6;transition:opacity .15s}
`;

const tmp = 'dist/.board-css.mjs';
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(tmp, `export default ${JSON.stringify(css)};\n`);
const res = await build({
  entryPoints: ['screens/index.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  alias: { 'board-css': `./${tmp}` },
  legalComments: 'none',
  banner: { js: '// wOS Board screen part, built from screens/index.mjs by scripts/build-screens.mjs. AGPL-3.0. Do not edit.' },
});
fs.rmSync(tmp);
const out = res.outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (!fs.existsSync('dist/screens.mjs') || fs.readFileSync('dist/screens.mjs', 'utf8') !== out) { console.error('dist/screens.mjs is out of date: run node scripts/build-screens.mjs'); process.exit(1); }
  console.log('dist/screens.mjs is current');
} else {
  fs.writeFileSync('dist/screens.mjs', out);
  console.log(`wrote dist/screens.mjs (${Math.round(out.length / 1024)} KB)`);
}
