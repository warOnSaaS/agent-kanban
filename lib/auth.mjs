import crypto from 'node:crypto';

// Sign in with GitHub, for everything: Claude, ChatGPT, Claude Code and Codex connect through standard MCP OAuth
// (discovery, dynamic client registration, PKCE), and the board uses the same GitHub login with a cookie.
// Who someone is comes from GitHub; what they can see comes from people.yml. No keys anywhere.

const SECRET = () => process.env.OAUTH_SECRET || 'dev-secret';
const GH_WEB = () => process.env.GITHUB_WEB_BASE || 'https://github.com';
const GH_API = () => process.env.GITHUB_API_BASE || 'https://api.github.com';
const now = () => Math.floor(Date.now() / 1000);
const DAY = 24 * 3600;
const COOKIE = 'ak_session';

// ---------- signed, stateless tokens ----------

export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', SECRET()).update(body).digest('base64url')}`;
}

export function verify(token, kind) {
  const [body, mac] = String(token ?? '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (p.k !== kind || (p.exp && p.exp < now())) return null;
  return p;
}

// Tokens carry the GitHub login, so taking someone out of people.yml signs them out everywhere.
async function personFor(ws, p) {
  return p ? (await ws.team()).find((x) => x.id === p.id && sameLogin(x.github, p.g)) ?? null : null;
}
const sameLogin = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

export async function personFromRequest(ws, req) {
  if (ws.demo) return (await ws.team()).find((p) => p.role === 'owner') ?? null;
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (bearer) return personFor(ws, verify(bearer, 'access'));
  const cookie = /(?:^|;\s*)ak_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return cookie ? personFor(ws, verify(decodeURIComponent(cookie), 'access')) : null;
}

export function issueTokens(person) {
  return {
    access_token: sign({ k: 'access', id: person.id, g: person.github, exp: now() + 30 * DAY }),
    refresh_token: sign({ k: 'refresh', id: person.id, g: person.github, exp: now() + 365 * DAY }),
    token_type: 'bearer',
    expires_in: 30 * DAY,
  };
}

// ---------- discovery ----------

export const resourceMetadata = (host) => ({
  resource: `${host}/mcp`,
  authorization_servers: [host],
  bearer_methods_supported: ['header'],
  resource_name: 'agent-kanban',
});

export const serverMetadata = (host) => ({
  issuer: host,
  authorization_endpoint: `${host}/oauth/authorize`,
  token_endpoint: `${host}/oauth/token`,
  registration_endpoint: `${host}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  scopes_supported: ['workspace'],
});

export const challenge = (host) => `Bearer resource_metadata="${host}/.well-known/oauth-protected-resource"`;

// ---------- clients ----------

// Registration is stateless: the client id is a signed copy of what the app registered.
export async function handleRegister(req, res) {
  const b = await bodyObject(req);
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter(okRedirect) : [];
  if (!uris.length) return json(res, 400, { error: 'invalid_redirect_uri' });
  const client_id = sign({ k: 'client', r: uris, n: String(b.client_name ?? '').slice(0, 80) });
  json(res, 201, { client_id, client_name: b.client_name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: now() });
}

// https anywhere, or a loopback address for desktop and terminal apps (Claude Code, Codex).
function okRedirect(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

// The ChatGPT GPT is a fixed client with a secret; everything else registers itself and uses PKCE.
function clientFor(client_id) {
  if (client_id && client_id === process.env.OAUTH_CLIENT_ID) {
    return { fixed: true, allows: (r) => { try { return ['chatgpt.com', 'chat.openai.com'].includes(new URL(r).hostname); } catch { return false; } } };
  }
  const c = verify(client_id, 'client');
  return c ? { fixed: false, allows: (r) => c.r.includes(r) } : null;
}

// ---------- sign in ----------

export async function handleAuthorize(req, res, host) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const client = clientFor(q.client_id);
  if (!client || !client.allows(q.redirect_uri)) return page(res, 400, '<h1>This sign-in link is not valid</h1><p>Start again from your app.</p>');
  if (!client.fixed && (!q.code_challenge || (q.code_challenge_method ?? 'S256') !== 'S256')) return page(res, 400, '<h1>This app must use PKCE</h1>');
  githubRedirect(res, host, { c: q.client_id, r: q.redirect_uri, s: q.state, cc: q.code_challenge });
}

// The board (or any page) asks for a browser login with /login?next=/board.
export function handleLogin(req, res, host) {
  const next = new URL(req.url, 'http://x').searchParams.get('next') ?? '/board';
  githubRedirect(res, host, { web: next.startsWith('/') && !next.startsWith('//') ? next : '/board' });
}

function githubRedirect(res, host, carry) {
  const state = sign({ k: 'gh', ...carry, exp: now() + 900 });
  const u = new URL(`${GH_WEB()}/login/oauth/authorize`);
  u.searchParams.set('client_id', process.env.GITHUB_OAUTH_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', `${host}/oauth/github/callback`);
  u.searchParams.set('scope', 'read:user user:email');
  u.searchParams.set('state', state);
  u.searchParams.set('allow_signup', 'true');
  res.writeHead(302, { location: u.toString(), 'cache-control': 'no-store' }).end();
}

export async function handleGithubCallback(req, res, ws, host) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const st = verify(q.state, 'gh');
  if (!st || !q.code) return page(res, 400, '<h1>Sign-in expired</h1><p>Go back to your app and try again.</p>');

  const tok = await fetch(`${GH_WEB()}/login/oauth/access_token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_OAUTH_CLIENT_ID, client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET, code: q.code, redirect_uri: `${host}/oauth/github/callback` }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return page(res, 400, '<h1>GitHub sign-in failed</h1><p>Try again from your app.</p>');
  const gh = (p) => fetch(`${GH_API()}${p}`, { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'agent-kanban' } }).then((r) => (r.ok ? r.json() : null));
  const [user, emails] = await Promise.all([gh('/user'), gh('/user/emails')]);
  if (!user?.login) return page(res, 400, '<h1>GitHub sign-in failed</h1><p>Try again from your app.</p>');
  const verified = (emails ?? []).filter((e) => e.verified).map((e) => e.email.toLowerCase());

  const person = await ws.personByGithub(user.login, verified);
  if (!person) {
    await ws.noteUnknownSignIn(user.login).catch(() => {});
    return page(res, 403, `<h1>Hi @${esc(user.login)}</h1><p>You're signed in to GitHub, but you're not on the ${esc(ws.name)} team yet.</p><p>Send ${esc(process.env.WORKSPACE_CONTACT || 'the person who invited you')} your username: <b>${esc(user.login)}</b>. Once you're added, come back and sign in again.</p>`);
  }
  // The owner gets the repo itself the first time she signs in. Teammates never do: a repo shows every file.
  if (person.role === 'owner') await ws.inviteToRepo(user.login).catch(() => {});

  if (st.web) {
    const t = issueTokens(person);
    res.writeHead(302, { location: st.web, 'set-cookie': `${COOKIE}=${encodeURIComponent(t.access_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * DAY}`, 'cache-control': 'no-store' }).end();
    return;
  }
  const code = sign({ k: 'code', id: person.id, g: person.github, c: st.c, r: st.r, cc: st.cc, exp: now() + 300 });
  const to = new URL(st.r);
  to.searchParams.set('code', code);
  if (st.s) to.searchParams.set('state', st.s);
  res.writeHead(302, { location: to.toString(), 'cache-control': 'no-store' }).end();
}

export async function handleToken(req, res, ws) {
  const q = await bodyObject(req);
  const basic = (req.headers.authorization ?? '').startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':') : [];
  const client_id = q.client_id ?? basic[0];
  const secret = q.client_secret ?? basic[1];
  const client = clientFor(client_id);
  if (!client || (client.fixed && secret !== process.env.OAUTH_CLIENT_SECRET)) return json(res, 401, { error: 'invalid_client' });

  let grant = null;
  if (q.grant_type === 'authorization_code') {
    grant = verify(q.code, 'code');
    if (grant && (grant.c !== client_id || (q.redirect_uri && grant.r !== q.redirect_uri))) grant = null;
    if (grant && grant.cc) {
      const s256 = crypto.createHash('sha256').update(String(q.code_verifier ?? '')).digest('base64url');
      if (s256 !== grant.cc) grant = null;
    } else if (grant && !client.fixed) grant = null;
  } else if (q.grant_type === 'refresh_token') {
    grant = verify(q.refresh_token, 'refresh');
  }
  const person = await personFor(ws, grant);
  if (!person) return json(res, 400, { error: 'invalid_grant' });
  json(res, 200, issueTokens(person));
}

// ---------- bits ----------

export async function bodyObject(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = typeof req.body === 'string' ? req.body : '';
  if (!s) for await (const c of req) s += c;
  if (!s) return {};
  try {
    return (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(s) : Object.fromEntries(new URLSearchParams(s));
  } catch {
    return {};
  }
}

export const json = (res, status, obj, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(obj));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function page(res, status, inner) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>agent-kanban</title><meta name="robots" content="noindex">
<style>:root{--bg:#f4f4f2;--card:#fff;--ink:#111;--muted:#666;--line:#d8d8d4}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#141414;--ink:#e8e8e8;--muted:#8a8a8a;--line:#2a2a2a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "JetBrains Mono","SFMono-Regular",ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:0;padding:28px 24px;max-width:440px;width:100%}h1{font-size:16px;margin:0 0 8px}p{color:var(--muted);margin:0 0 12px}b{color:var(--ink)}
a.btn{display:block;text-align:center;text-decoration:none;margin-top:12px;font-weight:600;padding:12px;border:1px solid var(--ink);background:var(--ink);color:var(--bg)}</style></head><body><main>${inner}</main></body></html>`);
}
