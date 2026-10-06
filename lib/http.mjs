import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Workspace } from './workspace.mjs';
import { GitHubStore } from './store.mjs';
import { buildServer } from './mcp.mjs';
import { renderBoard } from './board.mjs';
import { personFromRequest, challenge, json, page, verify } from './auth.mjs';

export function workspaceFromEnv(env = process.env) {
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
  const server = buildServer(session);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body ?? (await readJson(req)));
}

export async function handleBoard(req, res, ws) {
  const person = await personFromRequest(ws, req);
  if (!person) {
    return page(res, 200, `<h1>${ws.name} on agent-kanban</h1><p>Every task, hand-off and idea, in one place.</p><a class="btn" href="/login?next=/board">SIGN IN WITH GITHUB</a>`);
  }
  const client = new URL(req.url, 'http://x').searchParams.get('client') ?? undefined;
  const html = await renderBoard(ws.as(person), { client });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }).end(html);
}

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
