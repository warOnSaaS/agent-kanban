import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Workspace } from './workspace.mjs';
import { GitHubStore, DemoStore } from './store.mjs';
import { buildServer } from './mcp.mjs';
import { renderPage } from './board.mjs';
import { personFromRequest, challenge, json, page, verify } from './auth.mjs';
import { actorFor, busy, liveState } from './live.mjs';

// DEMO_BOARD=1 serves the example workspace shipped with this repo, with no sign-in. It never reads WORKSPACE_REPO.
let demoWs;
export const EXAMPLE_DIR = new URL('../example-workspace', import.meta.url).pathname;
export function workspaceFromEnv(env = process.env) {
  if (env.DEMO_BOARD === '1') return (demoWs ??= new Workspace(new DemoStore(EXAMPLE_DIR), { name: env.WORKSPACE_NAME || 'Example Co', demo: true }));
  const store = new GitHubStore({ repo: env.WORKSPACE_REPO, token: env.GITHUB_TOKEN, branch: env.WORKSPACE_BRANCH || 'main' });
  const mailer = env.RESEND_API_KEY
    ? ({ to, subject, text }) => fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.ALERT_FROM || 'agent-kanban <onboarding@resend.dev>', to, subject, text }),
      })
    : undefined;
  return new Workspace(store, { mailer, name: env.WORKSPACE_NAME });
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
  res.writeHead(302, { location: '/board', 'set-cookie': 'ak_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', 'cache-control': 'no-store' }).end();
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
