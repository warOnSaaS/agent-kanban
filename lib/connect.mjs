// The board's front door (/): pick your app, one click, then type "start". No instructions to read.
// /connect is the script behind the Claude Code and Codex tiles: curl -fsSL <board>/connect/claude | sh
import css from './ui/wos-css.mjs';
import { loadBrand } from './brand.mjs';
import { personFromRequest, usesAccount, promptScript, promptCss } from './auth.mjs';
import { CLAUDE, OPENAI, BOARD } from './logos.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Only plain web addresses go into the page and the script. Anything else (an odd Host header) is refused.
// Hosted boards live under a path (https://host/t/<team>), so that one path is allowed too.
export const safeHost = (host) => (/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(\/t\/[a-z0-9-]{1,40})?$/i.test(String(host ?? '')) ? String(host) : null);

// The team's shared ChatGPT GPT (see docs/chatgpt-gpt.md). Without it the ChatGPT tile is hidden.
export const gptUrl = (v = process.env.CHATGPT_GPT_URL) => {
  try {
    const u = new URL(String(v ?? ''));
    return u.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
};

// claude.ai opens "Add custom connector" with the name and address filled in. The person clicks Add.
export const claudeInstallLink = (name, mcp) => `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(name)}&connectorUrl=${encodeURIComponent(mcp)}`;

export const CHATGPT_APPS = 'https://chatgpt.com/#settings/Connectors';

export const connectLine = (host, app) => `curl -fsSL ${host}/connect${app ? `/${app}` : ''} | sh`;

export const APPS = ['claude', 'codex'];

// ---------- the page ----------

export function connectPage({ host, brand, gpt = null, demo = false, settings = false, signedIn = false, account = usesAccount() }) {
  const mcp = `${host}/mcp`;
  const name = brand.name;
  const signIn = demo ? 'No sign-in needed.' : account ? 'Your warOnSaaS account signs you in once.' : 'GitHub asks you to approve once.';
  const opens = account ? 'Your warOnSaaS account opens to sign in.' : 'GitHub opens to sign in.';
  const chat = [
    tile({
      id: 'claude', logo: CLAUDE, title: 'Claude', where: 'Web, desktop and phone',
      action: `<a class="btn" href="${esc(claudeInstallLink(name, mcp))}" target="_blank" rel="noopener" data-copy-also="${esc(mcp)}">Add to Claude</a>`,
      hint: `Click Add, then Connect. ${signIn}`,
    }),
    gpt && tile({
      id: 'chatgpt', logo: OPENAI, title: 'ChatGPT', where: 'Web and phone, any paid plan',
      action: `<a class="btn" href="${esc(gpt)}" target="_blank" rel="noopener">Open in ChatGPT</a>`,
      hint: demo ? 'Type start.' : 'Type start, then click Sign in when it asks.',
    }),
    // The demo has no GPT of its own until one is made: ChatGPT's developer mode takes the address directly.
    !gpt && demo && tile({
      id: 'chatgpt', logo: OPENAI, title: 'ChatGPT', where: 'Web, with developer mode on',
      action: `<a class="btn" href="${CHATGPT_APPS}" target="_blank" rel="noopener" data-copy-also="${esc(mcp)}" data-copy-note="Opening ChatGPT. The address is copied.">Open in ChatGPT</a>`,
      hint: 'Paste the copied address in Settings, Apps, Create.',
    }),
  ].filter(Boolean);
  const term = [
    tile({
      id: 'claude-code', logo: CLAUDE, title: 'Claude Code', where: 'Terminal', term: true,
      action: command(connectLine(host, 'claude')),
      hint: demo ? 'Paste it in your terminal.' : `Paste it in your terminal. ${opens}`,
    }),
    tile({
      id: 'codex', logo: OPENAI, title: 'Codex', where: 'Terminal', term: true,
      action: command(connectLine(host, 'codex')),
      hint: demo ? 'Paste it in your terminal.' : `Paste it in your terminal. ${opens}`,
    }),
  ];
  chat.push(
    tile({
      id: 'browser', logo: BOARD, title: 'Browser', where: 'Any device', plain: true,
      action: '<a class="btn btn-secondary" href="/board">Open the board</a>',
      hint: demo ? 'Click around. Changes reset.' : account ? 'Look freely. Sign in to change things.' : 'Sign in with GitHub.',
    }),
  );

  return `<!doctype html><html lang="en"${brand.scheme ? ` data-theme="${brand.scheme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect · ${esc(name)}</title><meta name="robots" content="noindex">${brand.fonts}
<style>${css}${brand.css}
${PAGE_CSS}
${demo ? '' : promptCss}
</style></head><body>
<header class="header"><div class="wrap">
  <a class="brand" href="/">${brand.logo ? `<img src="/brand/${esc(brand.logo)}" alt="">` : ''}<span>${esc(name)}</span></a>
  <nav class="nav" aria-label="Main"><a href="/board">Board</a>${settings ? '<a href="/settings">Settings</a>' : ''}</nav>
</div></header>
<main class="wrap connect">
  <div class="connect-head">
    ${demo ? '<p class="connect-tag"><span class="chip chip-soft">Demo board</span> Made-up team, no sign-in, changes reset.</p>' : ''}
    <h1>Use ${esc(name)} from your AI app</h1>
    <p class="lead">Pick your app. Then type <b>start</b>.</p>
  </div>
  <div class="apps-group"><h2 class="label">Chat apps</h2><div class="apps">${chat.join('')}</div></div>
  <div class="apps-group"><h2 class="label">Terminal</h2><div class="apps apps-term">${term.join('')}</div></div>
  <p class="connect-foot small dim">Works with any app that supports MCP: <code>${esc(mcp)}</code>. <a href="/INSTRUCTIONS.md">Setup file for agents</a> · <a href="/privacy">Privacy</a></p>
</main>
<div id="toast" role="status" aria-live="polite"></div>
<script>${CLIENT}</script>
${demo ? '' : promptScript({ signedIn })}
</body></html>`;
}

function tile({ id, logo, title, where, action, hint, term = false, plain = false }) {
  return `<section class="app" id="app-${id}" aria-labelledby="app-${id}-t">
  <div class="app-top"><span class="app-logo${plain ? ' app-logo-plain' : ''}">${logo}${term ? '<i class="app-term" aria-hidden="true">&gt;_</i>' : ''}</span>
  <div><h2 id="app-${id}-t">${esc(title)}</h2><p class="app-where">${esc(where)}</p></div></div>
  <div class="app-act" data-agent-tool="connect_links">${action}</div>
  <p class="app-hint">${esc(hint)}</p>
</section>`;
}

const command = (line) => `<div class="cmd"><code>${esc(line)}</code><button type="button" class="btn btn-sm" data-copy="${esc(line)}" aria-label="Copy the command">Copy</button></div>`;

const PAGE_CSS = `
.connect{padding-top:var(--s7);padding-bottom:var(--s8);display:grid;gap:var(--s6)}
.connect-head{display:grid;gap:var(--s2);max-width:640px}
.connect-head h1{font-size:clamp(28px,4.4vw,44px);margin:0;line-height:1.1}
.connect-head .lead{margin:0;color:var(--dim)}
.connect-head .lead b{color:var(--fg)}
.connect-tag{margin:0;font-size:var(--t-sm);color:var(--dim);display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap}
.apps-group{display:grid;gap:var(--s3)}
.apps-group > .label{margin:0;font-size:var(--t-xs);font-family:var(--font-body)}
.apps{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))}
.apps-term{grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))}
.app{display:grid;grid-template-rows:auto 1fr auto;gap:var(--s4);padding:var(--s5);border:1px solid var(--rule);border-radius:calc(var(--radius) + 6px);background:var(--bg);box-shadow:var(--shadow-sm,none);transition:border-color .15s,box-shadow .15s,transform .15s;min-width:0}
.app:hover{border-color:var(--accent);box-shadow:var(--shadow-md,none)}
.app-top{display:flex;gap:var(--s3);align-items:center}
.app-top h2{font-size:var(--t-xl);margin:0}
.app-where{margin:0;font-size:var(--t-sm);color:var(--dim)}
.app-logo{position:relative;flex:none;width:52px;height:52px;display:grid;place-items:center;border-radius:calc(var(--radius) + 6px);background:var(--cell);border:1px solid var(--rule);color:var(--fg)}
.app-logo svg{width:30px;height:30px}
.app-logo-plain svg{width:28px;height:28px}
.app-term{position:absolute;right:-6px;bottom:-6px;font:700 10px/1 var(--font-mono);font-style:normal;padding:3px 4px;border-radius:5px;background:var(--fg);color:var(--bg)}
.app-act{align-self:start;min-width:0}
.app-act .btn{width:100%}
.app-hint{margin:0;font-size:var(--t-sm);color:var(--dim)}
.cmd{display:flex;align-items:stretch;gap:var(--s2);background:var(--cell);border:1px solid var(--rule);border-radius:var(--radius);padding:var(--s1) var(--s1) var(--s1) var(--s3);min-width:0}
.cmd code{flex:1;min-width:0;background:none;border:0;padding:var(--s2) 0;white-space:nowrap;overflow-x:auto;font-size:var(--t-xs);align-self:center;scrollbar-width:thin}
.cmd .btn{flex:none;width:auto}
.connect-foot{margin:0;max-width:none;overflow-wrap:anywhere}
.connect-foot code{font-size:var(--t-xs)}
#toast{position:fixed;left:50%;bottom:var(--s5);transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:var(--s2) var(--s4);font-size:var(--t-sm);font-weight:700;border-radius:var(--radius);opacity:0;transition:opacity .2s;pointer-events:none;z-index:10;max-width:calc(100vw - 32px);text-align:center}
#toast.on{opacity:1}
@media (max-width:520px){.connect{padding-top:var(--s5);gap:var(--s5)}.app{padding:var(--s4)}}
`;

// Copy buttons, and the Claude tile also copies the address in case Claude asks for it by hand.
const CLIENT = `(function(){
var t=document.getElementById('toast'),h;
function toast(m){t.textContent=m;t.classList.add('on');clearTimeout(h);h=setTimeout(function(){t.classList.remove('on')},2400)}
function copy(s){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(s);var a=document.createElement('textarea');a.value=s;document.body.appendChild(a);a.select();try{document.execCommand('copy')}finally{a.remove()}return Promise.resolve()}
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-copy]');
  if(b){copy(b.dataset.copy).then(function(){b.textContent='Copied';toast('Copied. Paste it in your terminal.');setTimeout(function(){b.textContent='Copy'},2000)});return}
  var a=e.target.closest('[data-copy-also]');
  if(a)copy(a.dataset.copyAlso).then(function(){toast(a.dataset.copyNote||'Opening Claude. The address is copied too.')},function(){});
});
})();`;

// ---------- the script ----------

// A POSIX sh script with this board's address baked in. It finds Claude Code and Codex, adds the board,
// and starts sign-in. It prints each command before running it, and is safe to run again.
export function connectScript({ host, app = null, name = 'Team', account = usesAccount() }) {
  const where = account ? 'your warOnSaaS account opens in your browser. Sign in and it comes straight back.' : 'GitHub opens in your browser. Click Authorize.';
  const mcp = `${host}/mcp`;
  const slug = (new URL(host).hostname + new URL(host).pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
  const apps = app ? [app] : APPS;
  const label = String(name).replace(/[^\w .&+-]/g, '').slice(0, 60) || 'Team';
  return `#!/bin/sh
# Connects ${apps.map((a) => (a === 'claude' ? 'Claude Code' : 'Codex')).join(' and ')} to ${label} on agent-kanban (${host}).
# It prints each command before it runs it, and it is safe to run again.
#   Read it first:  curl -fsSL ${host}/connect${app ? `/${app}` : ''}
#   Dry run:        curl -fsSL ${host}/connect${app ? `/${app}` : ''} | sh -s -- --dry-run
set -eu

URL='${mcp}'
NAME='agent-kanban'
ALT='agent-kanban-${slug}'
APPS='${apps.join(' ')}'
DRY=0
DONE_IN=''

say() { printf '%s\\n' "$*"; }
show() { printf '  $ %s\\n' "$*"; }
run() { show "$@"; if [ "$DRY" = 0 ]; then "$@"; fi; }
# Sign-in opens a browser and may need the keyboard: give it the terminal, not this script's input.
run_tty() { show "$@"; if [ "$DRY" = 0 ]; then if (: </dev/tty) 2>/dev/null; then "$@" </dev/tty; else "$@"; fi; fi; }
added() { DONE_IN="\${DONE_IN:+$DONE_IN and }$1"; }

# Which name to use: ours if it is free or already points here, otherwise one with this board's address in it.
pick() {
  for n in "$NAME" "$ALT"; do
    out=$("$@" "$n" 2>/dev/null) || { CHOSEN=$n; EXISTS=0; return; }
    case "$out" in *"$URL"*) CHOSEN=$n; EXISTS=1; return ;; esac
  done
  say "  Both $NAME and $ALT are taken by other servers. Remove one and run this again."
  exit 1
}

claude_code() {
  say ''
  say 'Claude Code'
  pick claude mcp get
  if [ "$EXISTS" = 1 ]; then say "  Already added as $CHOSEN."
  else run claude mcp add --transport http --scope user "$CHOSEN" "$URL"; fi
  if [ "$DRY" = 1 ] && [ "$EXISTS" = 0 ]; then
    say '  If it asks you to sign in, ${where}'
    show claude mcp login "$CHOSEN"
  elif claude mcp get "$CHOSEN" 2>/dev/null | grep -q 'Needs authentication'; then
    say '  Signing in: ${where}'
    run_tty claude mcp login "$CHOSEN"
  else say '  Connected.'; fi
  added 'Claude Code'
}

codex_cli() {
  say ''
  say 'Codex'
  pick codex mcp get
  if [ "$EXISTS" = 1 ]; then say "  Already added as $CHOSEN."
  else
    say '  If it asks you to sign in, ${where}'
    run_tty codex mcp add "$CHOSEN" --url "$URL"
  fi
  if [ "$DRY" = 0 ] && codex mcp list 2>/dev/null | grep "^$CHOSEN " | grep -q 'Not logged in'; then
    say '  Signing in: ${where}'
    run_tty codex mcp login "$CHOSEN"
  elif [ "$EXISTS" = 1 ]; then say '  Connected.'; fi
  added 'Codex'
}

main() {
  for arg in "$@"; do
    case "$arg" in
      -n|--dry-run) DRY=1 ;;
      *) say "Unknown option: $arg (the only option is --dry-run)"; exit 2 ;;
    esac
  done
  say 'Connecting ${label} (agent-kanban) at '"$URL"
  [ "$DRY" = 1 ] && say 'Dry run: this shows what would run and changes nothing.'
  for app in $APPS; do
    case "$app" in
      claude) if command -v claude >/dev/null 2>&1; then claude_code; fi ;;
      codex) if command -v codex >/dev/null 2>&1; then codex_cli; fi ;;
    esac
  done
  if [ -z "$DONE_IN" ]; then
    say ''
    case "$APPS" in
      claude) say 'Claude Code is not installed here. Get it at https://claude.com/claude-code, then run this again.' ;;
      codex) say 'Codex is not installed here. Get it at https://developers.openai.com/codex, then run this again.' ;;
      *) say 'Neither Claude Code nor Codex is installed here. Install one, then run this again.' ;;
    esac
    exit 1
  fi
  say ''
  if [ "$DRY" = 1 ]; then say 'Dry run finished. Run it without --dry-run to connect.'
  else say "Done. Open $DONE_IN (restart it if it is open) and type: start"; fi
}

main "$@"
`;
}

// ---------- privacy ----------

export const privacy = (name, demo = false) => demo
  ? `${name} on agent-kanban: privacy

This is a public demo board with made-up data. Nobody signs in.
What it stores: whatever you add, in memory only, visible to other people trying the demo until the board resets (about 30 minutes). Don't put anything real or private in it.
What is shared: nothing is sold or shared. Your AI provider processes what you ask it under its own terms.
`
  : `${name} on agent-kanban: privacy

This is a private workspace for the ${name} team. It is not for the public.

What it stores: the tasks, notes, ideas, alerts and documents team members add, kept in a private GitHub repository the workspace owner controls.
Who can see it: only people listed in the workspace's people.yml, each limited to the clients they work on. Items marked private are visible only to the people named.
How you sign in: with your GitHub account. Signing in from ChatGPT, Claude or another agent gives that app access to the workspace as you, and only as you. GitHub tells the workspace your username and verified email addresses, nothing else.
What is shared: nothing is sold or shared outside the team. Your AI provider processes what you ask it under its own terms.
Removal: ask the workspace owner to delete anything, or to remove you from people.yml, which signs you out everywhere.
`;

// ---------- handlers ----------

export async function handleHome(req, res, ws, host, page) {
  if (page === 'privacy') return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(privacy(ws.name, ws.demo));
  const h = safeHost(host);
  if (!h) return res.writeHead(400).end();
  const brand = await loadBrand(ws);
  const person = ws.demo ? null : await personFromRequest(ws, req);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY' })
    .end(connectPage({ host: h, brand, gpt: gptUrl(), demo: !!ws.demo, settings: !!ws.hosting && (ws.demo || person?.role === 'owner'), signedIn: !!person }));
}

export function handleConnect(req, res, ws, host, app) {
  const h = safeHost(host);
  if (!h || (app && !APPS.includes(app))) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found. Try /connect, /connect/claude or /connect/codex.\n');
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    .end(connectScript({ host: h, app: app || null, name: ws.name }));
}
