// One head and one top bar for every page (board, task, connect, hosted pages), on the ui-design kit.
// The kit is inlined (lib/ui/kit-css.mjs, synced from warOnSaaS/ui-design main); APP_CSS is only the
// furniture the kit leaves to an app: the top bar, page widths, and a few page layouts. Kit tokens only.
import kit from './kit-css.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const APP_CSS = `
body{font-size:15px}
a{text-decoration:none}
.ak-top{position:sticky;top:0;z-index:15;background:color-mix(in srgb,var(--ui-bg) 82%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--ui-line)}
.ak-top-in{display:flex;align-items:center;gap:var(--ui-s4);min-height:58px;width:min(var(--ak-w,1160px),100%);margin:0 auto;padding:0 clamp(16px,3vw,28px)}
.ak-top .ui-brand{font-size:15.5px;min-width:0}
.ak-top .ui-brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ak-logo{width:24px;height:24px;flex:none;border-radius:calc(var(--ui-radius-xs) + 3px);display:grid;place-items:center;background:var(--ui-accent);box-shadow:0 6px 18px -8px var(--ui-accent-line)}
.ak-logo::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--ui-on-accent)}
.ak-top .ui-brand img{height:26px;width:auto;border-radius:calc(var(--ui-radius-xs) + 2px)}
.ak-nav{display:flex;align-items:center;gap:2px;margin-left:auto;min-width:0}
.ak-nav>a{display:inline-flex;align-items:center;min-height:34px;padding:0 11px;border-radius:var(--ui-radius-sm);font-size:14px;color:var(--ui-ink-2);white-space:nowrap;transition:background-color var(--ui-dur) var(--ui-ease),color var(--ui-dur)}
.ak-nav>a:hover{background:var(--ui-hover);color:var(--ui-ink)}
.ak-nav>a[aria-current=page]{color:var(--ui-ink);background:var(--ui-surface-2);box-shadow:inset 0 0 0 1px var(--ui-line)}
.ak-nav .ui-badge{margin-left:6px}
.ak-wrap{width:min(var(--ak-w,1160px),100%);margin:0 auto;padding:var(--ui-s8) clamp(16px,3vw,28px) 96px}
.ak-wrap.is-wide{--ak-w:1600px}
.ak-top.is-wide{--ak-w:1600px}
.ak-narrow{--ak-w:820px}
.ak-stack{display:grid;gap:var(--ui-s5);align-content:start;min-width:0;grid-template-columns:minmax(0,1fr)}
.ak-stack>*{min-width:0}
.ui-input[type=date]{min-width:0;max-width:100%}
.ak-row{display:flex;align-items:center;gap:var(--ui-s2);flex-wrap:wrap}
.ak-h1{margin:0;font-family:var(--ui-display);font-weight:var(--ui-display-weight);font-size:clamp(28px,3.4vw,40px);letter-spacing:calc(var(--ui-display-track) * .9);line-height:1.08;text-wrap:balance}
.ak-lede{margin:0;color:var(--ui-ink-2);font-size:16px;line-height:1.6;max-width:62ch}
.ak-lede b{color:var(--ui-ink);font-weight:var(--ui-weight-strong)}
.ak-h2{margin:0;font-family:var(--ui-display);font-weight:var(--ui-weight-strong);font-size:18px;letter-spacing:calc(var(--ui-display-track) / 3)}
.ak-h3{margin:0;font-size:15px;font-weight:var(--ui-weight-strong)}
.ak-small{font-size:13px;color:var(--ui-ink-3);margin:0}
.ak-small a,.ak-lede a{color:var(--ui-ask-ink)}
.ak-err{margin:0;color:color-mix(in oklab,var(--ui-bad) 70%,var(--ui-ink));font-size:13.5px;min-height:0}
.ak-err:empty{display:none}
.dim{color:var(--ui-ink-3)}
code{font-family:var(--ui-mono);font-size:.88em;padding:1px 6px;border-radius:var(--ui-radius-xs);background:var(--ui-hover);color:var(--ui-ink)}
.ui-copy code{padding:0;background:none}
.ui-toast{max-width:calc(100vw - 32px);text-align:center}
.ui-dialog form{display:grid;gap:var(--ui-s3)}
.ui-dialog .ui-field{margin:0}
@media(max-width:700px){.ak-wrap{padding-top:var(--ui-s6)}.ak-top-in{gap:var(--ui-s2);min-height:54px}.ak-nav{overflow-x:auto;scrollbar-width:none}.ak-nav::-webkit-scrollbar{display:none}.ak-nav>a{padding:0 9px;font-size:13.5px}.ak-hide-sm{display:none!important}}
`;

// <html ...><head>...</head>: the kit, the brand on top, then the page's own CSS.
export function head({ title, brand, css = '' }) {
  return `<!doctype html><html lang="en"${brand.attrs ?? ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><meta name="color-scheme" content="${brand.scheme ?? 'dark'}">${brand.fonts}
<style>${kit}${brand.css ?? ''}${APP_CSS}${css}</style></head>`;
}

// The top bar: the brand (logo or mark, and name) and the links on the right.
export function topBar({ brand, home = '/', nav = '', wide = false }) {
  return `<header class="ak-top${wide ? ' is-wide' : ''}"><div class="ak-top-in">
  <a class="ui-brand" href="${esc(home)}">${brand.logo ? `<img src="/brand/${esc(brand.logo)}" alt="">` : '<span class="ak-logo" aria-hidden="true"></span>'}<span>${esc(brand.name)}</span></a>
  <nav class="ak-nav" aria-label="Main">${nav}</nav>
</div></header>`;
}

export { kit };
