import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Workspace } from './workspace.mjs';
import { GitHubStore, DemoStore } from './store.mjs';
import { buildServer } from './mcp.mjs';
import { renderPage } from './board.mjs';
import { personFromRequest, challenge, json, page, verify, sessionCookie } from './auth.mjs';
import { GitHubApp, zipballUrl } from './hosting/github-app.mjs';
import { zip } from './hosting/zip.mjs';
import { actorFor, busy, liveState } from './live.mjs';

// DEMO_BOARD=1 serves the example workspace shipped with this repo, with no sign-in. It never reads WORKSPACE_REPO.
let demoWs;
export const EXAMPLE_DIR = new URL('../example-workspace', import.meta.url).pathname;
export function workspaceFromEnv(env = process.env) {
  if (env.HOSTED === '1') throw new Error('This deployment serves many teams: use /t/<team>/...');
  if (env.DEMO_BOARD === '1') return (demoWs ??= new Workspace(new DemoStore(EXAMPLE_DIR), { name: env.WORKSPACE_NAME || 'Example Co', demo: true }));
  const store = new GitHubStore({ repo: env.WORKSPACE_REPO, token: env.GITHUB_TOKEN || appToken(env), branch: env.WORKSPACE_BRANCH || 'main' });
  const mailer = env.RESEND_API_KEY
    ? ({ to, subject, text }) => fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.ALERT_FROM || 'agent-kanban <onboarding@resend.dev>', to, subject, text }),
      })
    : undefined;
  return new Workspace(store, { mailer, name: env.WORKSPACE_NAME });
}

// Own hosting without a personal token: a GitHub App installed on the one workspace repo (what
// "agent-kanban deploy" sets up). GITHUB_TOKEN, when set, wins, so existing instances are unchanged.
let app;
function appToken(env) {
  app ??= GitHubApp.fromEnv(env);
  if (!app) return undefined;
  let iid = env.GITHUB_APP_INSTALLATION_ID;
  return async () => {
    iid ??= await app.installationForRepo(env.WORKSPACE_REPO);
    if (!iid) throw new Error(`The GitHub App is not installed on ${env.WORKSPACE_REPO}`);
    return app.installationToken(iid);
  };
}

export const hostOf = (req) => `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

// One address for everyone: /mcp. Apps that aren't signed in get a 401 pointing at the sign-in, which is GitHub.
export async function handleMcp(req, res, ws, host) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST (this is an MCP endpoint)' }, { allow: 'POST' });
  const person = await personFromRequest(ws, req);
  if (!person) return json(res, 401, { error: 'Sign in with GitHub to use agent-kanban.' }, { 'www-authenticate': challenge(host) });
  const session = ws.as(person);
  session.host = host;
  const body = req.body ?? (await readJson(req));
  // Who is calling (Claude, ChatGPT, Claude Code, Codex...), for the live feed and "connected now".
  session.actor = actorFor(req, person, { channel: 'mcp', body });
  const done = busy(ws.store, session.actor);
  const server = buildServer(session);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); done(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export async function handleBoard(req, res, ws, { kind, id } = {}) {
  const person = await personFromRequest(ws, req);
  if (!person && kind === 'live') return json(res, 401, { error: 'Signed out' });
  if (!person) {
    const { loadBrand } = await import('./brand.mjs');
    const brand = await loadBrand(ws);
    const back = encodeURIComponent(new URL(req.url, 'http://x').pathname + new URL(req.url, 'http://x').search);
    return page(res, 200, `<h1>${escHtml(brand.name)}</h1><p>Every task, hand-off and idea, in one place.</p><a class="btn" href="/login?next=${back}">SIGN IN WITH GITHUB</a>`);
  }
  const q = new URL(req.url, 'http://x').searchParams;
  if (kind === 'live') return handleLive(res, ws.as(person), q.get('v') ?? '');
  const html = await renderPage(ws.as(person), { kind, id, view: q.get('view') ?? undefined, client: q.get('client') ?? undefined });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY' }).end(html);
}

// /board/live?v=<version>: what open pages poll every two seconds. Only what this person may see.
async function handleLive(res, session, v) {
  const out = await liveState(session.store, { v, visible: (a) => !a.item?.path || session.canItem(a.item.path, a.item.access ?? {}) });
  json(res, 200, out);
}

export function handleLogout(req, res) {
  res.writeHead(302, { location: '/board', 'set-cookie': sessionCookie('', 0), 'cache-control': 'no-store' }).end();
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function handleInstructions(req, res, ws, host) {
  const { instructions } = await import('./instructions.mjs');
  // ?for=<signed invite> personalises the file. Signed, so nobody can read another person's name or email by guessing.
  const invite = verify(new URL(req.url, 'http://x').searchParams.get('for'), 'invite');
  const person = invite ? (await ws.team()).find((p) => p.id === invite.id) : undefined;
  res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `inline; filename="INSTRUCTIONS${person ? `-${person.id}` : ''}.md"` })
    .end(instructions({ host, name: ws.name, repo: ws.store.repo, person }));
}

async function readJson(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : undefined;
}

// Everything on the board as one zip, for the owner. From the browser (signed in) or from a ten-minute link an
// agent hands over (export_board). A GitHub repo is zipped by GitHub itself; anything else is zipped here.
export async function handleExport(req, res, ws) {
  const key = verify(new URL(req.url, 'http://x').searchParams.get('key'), 'export');
  const person = key ? (await ws.team()).find((p) => p.id === key.id && (!p.github || String(p.github).toLowerCase() === String(key.g ?? '').toLowerCase())) : await personFromRequest(ws, req);
  if (!person || person.role !== 'owner') return page(res, 403, '<h1>Only the owner can download everything</h1><p>Sign in on the board as the owner, or ask your AI app for a download link.</p>');
  const name = `${String(ws.name).replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.zip`;
  if (ws.store instanceof GitHubStore) {
    const token = typeof ws.store.token === 'function' ? await ws.store.token() : ws.store.token;
    const url = await zipballUrl(token, ws.store.repo, ws.store.branch);
    if (url) return res.writeHead(302, { location: url, 'cache-control': 'no-store' }).end();
    return page(res, 502, '<h1>GitHub did not answer</h1><p>Try again in a minute, or download it from the repo on GitHub.</p>');
  }
  const files = [];
  for (const p of await ws.store.list()) files.push({ path: p, data: (await ws.store.readRaw(p)) ?? '' });
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }).end(zip(files));
}
