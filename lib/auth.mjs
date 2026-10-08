import crypto from 'node:crypto';
import { currentContext } from './hosting/context.mjs';
import { WosAccount, authProvider } from './account-client.mjs';

// Who someone is, for everything: Claude, ChatGPT, Claude Code and Codex connect through standard MCP OAuth
// (discovery, dynamic client registration, PKCE), and the board uses the same sign-in with a cookie. What they
// can see comes from people.yml. No keys anywhere.
//
// Two sign-ins, picked by AUTH_PROVIDER (lib/account-client.mjs, authProvider):
//   github     the install's own GitHub app: who someone is comes from GitHub. Self-hosted boards, as always.
//   waronsaas  the warOnSaaS account (account.waronsaas.com): one callback at /auth/waronsaas/callback, the
//              person is matched to people.yml by their verified email or GitHub login, and their account id
//              (sub) is remembered. Hosted copies, and self-hosters who want it.
// Looking is free in both: a signed-out visitor sees the pages; actions ask for a sign-in.

// Hosted, each request runs in its team's context (lib/hosting/context.mjs): its own signing key, cookie and
// GitHub app. Self-hosted there is no context and every value comes from the instance's env, as always.
const T = () => currentContext() ?? {};
const SECRET = () => T().secret || process.env.OAUTH_SECRET || 'dev-secret';
const GH_ID = () => T().github?.clientId ?? process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
const GH_SECRET = () => T().github?.clientSecret ?? process.env.GITHUB_OAUTH_CLIENT_SECRET;
const ghCallback = (host) => T().github?.callback ?? `${host}/oauth/github/callback`;
const GH_WEB = () => process.env.GITHUB_WEB_BASE || 'https://github.com';
const GH_API = () => process.env.GITHUB_API_BASE || 'https://api.github.com';
const now = () => Math.floor(Date.now() / 1000);
const DAY = 24 * 3600;
const COOKIE = () => T().cookie?.name ?? 'ak_session';
export const sessionCookie = (value, maxAge) => `${COOKIE()}=${value}; Path=${T().cookie?.path ?? '/'}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- which sign-in ----------

export const provider = () => authProvider(process.env);
export const usesAccount = () => provider() === 'waronsaas';
export const APP_NAME = 'agent-kanban';
export const ACCOUNT_PATH = '/auth/waronsaas';
export const ACCOUNT_CALLBACK = `${ACCOUNT_PATH}/callback`;

// One account client per process. The callback address is given per request (one deployment may answer on
// several hosts), so the one from the env is only a fallback.
let accountClient = null;
export function setAccount(client) { accountClient = client; }
export function account() {
  if (accountClient) return accountClient;
  const env = process.env;
  if (!env.WOS_ACCOUNT_CLIENT_ID || !env.WOS_ACCOUNT_CLIENT_SECRET) throw new Error('AUTH_PROVIDER=waronsaas needs WOS_ACCOUNT_CLIENT_ID and WOS_ACCOUNT_CLIENT_SECRET');
  const base = (env.PUBLIC_URL || env.HOSTED_ORIGIN || '').replace(/\/$/, '');
  accountClient = new WosAccount({ issuer: env.WOS_ACCOUNT_URL || undefined, clientId: env.WOS_ACCOUNT_CLIENT_ID, clientSecret: env.WOS_ACCOUNT_CLIENT_SECRET, redirectUri: base ? `${base}${ACCOUNT_CALLBACK}` : null, secret: env.OAUTH_SECRET, cookiePath: ACCOUNT_CALLBACK });
  return accountClient;
}

// The deployment's own address (scheme and host), with no team path: where the one callback lives.
const originOf = (host) => T().origin ?? String(host ?? '').replace(/\/t\/[^/]+$/, '');
// A path on this site, or the fallback. Never another site. Spaces and other characters a Location header
// cannot carry are percent-encoded; anything already encoded is left as it is.
export const safeNext = (next, fallback = '/') => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
  ? Array.from(next).map((ch) => (/[\x21-\x7e]/.test(ch) ? ch : encodeURIComponent(ch))).join('')
  : fallback);

// The one line every page carries: looking is free, actions ask for a sign-in (prompt.js, served by the account).
export function promptScript({ signedIn }) {
  if (!usesAccount()) return '';
  const issuer = process.env.WOS_ACCOUNT_URL?.replace(/\/$/, '') || 'https://account.waronsaas.com';
  return `<script src="${esc(issuer)}/prompt.js" defer data-signed-in="${signedIn ? 'true' : 'false'}" data-app="${APP_NAME}" data-signin="${ACCOUNT_PATH}"></script>`;
}

// The prompt draws itself from ui-design v2 tokens (--ui-*). This board is on the older kit (--bg, --fg...), so the
// pages map one to the other, and the kit's own heading colour is kept off the prompt's heading.
export const promptCss = `:root{--ui-surface:var(--bg);--ui-surface-2:var(--cell);--ui-ink:var(--fg);--ui-ink-2:var(--body);--ui-ink-3:var(--dim);--ui-line:var(--rule);--ui-line-2:var(--rule-strong);--ui-accent:var(--accent);--ui-on-accent:var(--accent-ink);--ui-font:var(--font-body);--ui-display:var(--font-head);--ui-display-weight:700;--ui-radius-lg:calc(var(--radius) + 6px);--ui-radius-sm:var(--radius);--ui-shadow-lg:var(--shadow-md,none);--ui-scrim:rgba(0,0,0,.55)}
.wos-ap h2{color:var(--ui-ink)}.wos-ap-card{box-shadow:none}`;

// The 401 for a call with no session: apps that can sign in get the pointer to the account.
export const signInError = () => (usesAccount() ? { error: { code: 'sign_in', message: 'Sign in to your warOnSaaS account' } } : { error: 'Sign in with GitHub to use agent-kanban.' });

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

// Tokens carry who the person is (their GitHub login, or their account id), so taking someone out of people.yml
// signs them out everywhere. With the account, they also carry the account session (sid): "Sign out everywhere"
// on the account ends them too.
async function personFor(ws, p) {
  if (!p) return null;
  if (usesAccount()) {
    if (!p.sid) return null;
    if (!(await account().isLive(p.sid))) return null;
  }
  if (ws.identify) return ws.identify(p);
  const person = (await ws.team()).find((x) => x.id === p.id && ((p.sub && x.account === p.sub) || sameLogin(x.github, p.g))) ?? null;
  return person ? { ...person, sid: p.sid } : null;
}
const sameLogin = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

export async function personFromRequest(ws, req) {
  if (ws.demo) return (await ws.team()).find((p) => p.role === 'owner') ?? null;
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (bearer) return personFor(ws, verify(bearer, 'access'));
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE()}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1];
  return cookie ? personFor(ws, verify(decodeURIComponent(cookie), 'access')) : null;
}

// Account-level people (hosted, before any team) have no people.yml: their name (n) and email (e) ride in the
// token. extra: more claims for both tokens (the account session sid, for one).
export function issueTokens(person, extra = {}) {
  const who = { id: person.id, g: person.github, ...(person.x ? { x: person.x } : {}), ...(person.account ?? person.sub ? { sub: person.account ?? person.sub } : {}), ...(person.sid ? { sid: person.sid } : {}), ...(person.n ? { n: person.n } : {}), ...(person.e ? { e: person.e } : {}), ...extra };
  return {
    access_token: sign({ k: 'access', ...who, exp: now() + 30 * DAY }),
    refresh_token: sign({ k: 'refresh', ...who, exp: now() + 365 * DAY }),
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
    return { fixed: true, name: 'ChatGPT', allows: (r) => { try { return ['chatgpt.com', 'chat.openai.com'].includes(new URL(r).hostname); } catch { return false; } } };
  }
  const c = verify(client_id, 'client');
  return c ? { fixed: false, name: c.n, allows: (r) => c.r.includes(r) } : null;
}

// ---------- sign in ----------

export async function handleAuthorize(req, res, host) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const client = clientFor(q.client_id);
  if (!client || !client.allows(q.redirect_uri)) return page(res, 400, '<h1>This sign-in link is not valid</h1><p>Start again from your app.</p>');
  if (!client.fixed && (!q.code_challenge || (q.code_challenge_method ?? 'S256') !== 'S256')) return page(res, 400, '<h1>This app must use PKCE</h1>');
  const mcp = { c: q.client_id, r: q.redirect_uri, s: q.state, cc: q.code_challenge };
  // With the account, the AI app becomes a connection the person can see and end on their account page.
  if (usesAccount()) return accountRedirect(res, host, { carry: { mcp }, connection: `${client.name || 'An AI app'} via ${APP_NAME}` });
  githubRedirect(res, host, mcp);
}

// The board (or any page) asks for a browser login with /login?next=/board.
export function handleLogin(req, res, host) {
  const next = safeNext(new URL(req.url, 'http://x').searchParams.get('next'), '/board');
  if (usesAccount()) return res.writeHead(302, { location: `${ACCOUNT_PATH}?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' }).end();
  githubRedirect(res, host, { web: next });
}

export function githubRedirect(res, host, carry) {
  const state = sign({ k: 'gh', ...carry, ...(T().team ? { t: T().team } : {}), exp: now() + 900 });
  const u = new URL(`${GH_WEB()}/login/oauth/authorize`);
  u.searchParams.set('client_id', GH_ID());
  u.searchParams.set('redirect_uri', ghCallback(host));
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
    body: JSON.stringify({ client_id: GH_ID(), client_secret: GH_SECRET(), code: q.code, redirect_uri: ghCallback(host) }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return page(res, 400, '<h1>GitHub sign-in failed</h1><p>Try again from your app.</p>');
  const gh = (p) => fetch(`${GH_API()}${p}`, { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'agent-kanban' } }).then((r) => (r.ok ? r.json() : null));
  const [user, emails] = await Promise.all([gh('/user'), gh('/user/emails')]);
  if (!user?.login) return page(res, 400, '<h1>GitHub sign-in failed</h1><p>Try again from your app.</p>');
  const verified = (emails ?? []).filter((e) => e.verified).map((e) => e.email.toLowerCase());

  const person = await ws.personByGithub(user.login, verified, { token: tok, user });
  if (!person) {
    await ws.noteUnknownSignIn(user.login).catch(() => {});
    return page(res, 403, `<h1>Hi @${esc(user.login)}</h1><p>You're signed in to GitHub, but you're not on the ${esc(ws.name)} team yet.</p><p>Send ${esc(process.env.WORKSPACE_CONTACT || 'the person who invited you')} your username: <b>${esc(user.login)}</b>. Once you're added, come back and sign in again.</p>`);
  }
  // The owner gets the repo itself the first time she signs in. Teammates never do: a repo shows every file.
  if (person.role === 'owner') await ws.inviteToRepo(user.login).catch(() => {});

  if (st.web) {
    const t = issueTokens(person);
    res.writeHead(302, { location: st.web, 'set-cookie': sessionCookie(encodeURIComponent(t.access_token), 30 * DAY), 'cache-control': 'no-store' }).end();
    return;
  }
  const code = sign({ k: 'code', id: person.id, g: person.github, c: st.c, r: st.r, cc: st.cc, exp: now() + 300 });
  const to = new URL(st.r);
  to.searchParams.set('code', code);
  if (st.s) to.searchParams.set('state', st.s);
  res.writeHead(302, { location: to.toString(), 'cache-control': 'no-store' }).end();
}

// ---------- sign in with the warOnSaaS account ----------

// Sends the browser to the account. next is a path on this site; in a team's context it is put under the team,
// because the one callback lives at the deployment's root. carry rides back to the callback untouched.
export function accountRedirect(res, host, { next = '/', carry = null, prompt = null, provider: pick = null, connection = null } = {}) {
  const origin = originOf(host);
  const base = T().base ?? '';
  const path = safeNext(next, '/');
  const full = base && !(path === base || path.startsWith(`${base}/`)) ? `${base}${path}` : path;
  const { location, cookie } = account().start({
    next: full,
    carry: { ...(T().team ? { t: T().team } : {}), ...(carry ?? {}) },
    prompt: prompt === 'none' ? 'none' : null,
    provider: ['github', 'google'].includes(pick) ? pick : null,
    connection,
    redirectUri: `${origin}${ACCOUNT_CALLBACK}`,
    secure: origin.startsWith('https:'),
  });
  res.writeHead(302, { location, 'set-cookie': cookie, 'cache-control': 'no-store' }).end();
}

// GET /auth/waronsaas?next=/board[&prompt=none][&provider=github|google]
export function handleAccountLogin(req, res, host) {
  const q = new URL(req.url, 'http://x').searchParams;
  accountRedirect(res, host, { next: q.get('next') ?? '/', prompt: q.get('prompt'), provider: q.get('provider') });
}

// The team that a return path belongs to, when the sign-in started on a team's page: /t/<team>/...
export const teamOfPath = (p) => /^\/t\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(String(p ?? ''))?.[1] ?? null;

// GET /auth/waronsaas/callback for a self-hosted board: finish, then sign the person in to this one workspace.
export async function handleAccountCallback(req, res, ws, host) {
  const r = await account().finish(req);
  if (r.error) return accountDeclined(res, r);
  return signInWithProfile(res, ws, r.profile, { next: r.next, carry: r.carry, clear: r.clear });
}

// The account said no (login_required after a silent try, or the person cancelled): back to the page, still
// signed out, still open.
export const accountDeclined = (res, r) => res.writeHead(302, { location: safeNext(r.next, '/'), 'set-cookie': r.clear, 'cache-control': 'no-store' }).end();

// A verified account profile becomes a session on this workspace: the person is found in people.yml (by their
// account id, else once by GitHub login or verified email), and gets the cookie, or the code their AI app is
// waiting for (carry.mcp). Runs in the workspace's context, so cookies and codes carry its key.
export async function signInWithProfile(res, ws, profile, { next = '/', carry = null, clear = null } = {}) {
  const headers = clear ? { 'set-cookie': [clear] } : { 'set-cookie': [] };
  const person = await ws.personByAccount(profile);
  if (!person) {
    await ws.noteUnknownSignIn(profile.github_login ? `@${profile.github_login}` : profile.email ?? 'someone').catch(() => {});
    const who = [profile.github_login && `GitHub <b>@${esc(profile.github_login)}</b>`, profile.email && `email <b>${esc(profile.email)}</b>`].filter(Boolean).join(' or ');
    return page(res, 403, `<h1>Hi ${esc(profile.name || 'there')}</h1><p>You're signed in, but you're not on the ${esc(ws.name)} team yet.</p><p>Ask ${esc(process.env.WORKSPACE_CONTACT || 'the board\'s owner')} to add you${who ? ` by ${who}` : ''}. Once you're added, come back and sign in again.</p>`, headers);
  }
  if (person.role === 'owner' && profile.github_login) await ws.inviteToRepo(profile.github_login).catch(() => {});
  const me = { ...person, sid: profile.sid };
  if (carry?.mcp) {
    const m = carry.mcp;
    const code = sign({ k: 'code', id: me.id, g: me.github, sub: me.account ?? me.sub, sid: me.sid, c: m.c, r: m.r, cc: m.cc, exp: now() + 300 });
    const to = new URL(m.r);
    to.searchParams.set('code', code);
    if (m.s) to.searchParams.set('state', m.s);
    return res.writeHead(302, { location: to.toString(), ...headers, 'cache-control': 'no-store' }).end();
  }
  const t = issueTokens(me);
  headers['set-cookie'].push(sessionCookie(encodeURIComponent(t.access_token), 30 * DAY));
  res.writeHead(302, { location: safeNext(next, '/'), ...headers, 'cache-control': 'no-store' }).end();
}

// Sign out of the board, and of the account too when that is the sign-in. returnTo: where the account sends
// the browser afterwards (an address on this site).
export function signOut(res, { returnTo, fallback = '/board' }) {
  const location = usesAccount() && returnTo ? account().endSessionUrl(returnTo) : fallback;
  res.writeHead(302, { location, 'set-cookie': sessionCookie('', 0), 'cache-control': 'no-store' }).end();
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
  json(res, 200, withApp(issueTokens(person, grant.sid ? { sid: grant.sid } : {}), client.fixed ? 'GPT' : grant.a ?? verify(client_id, 'client')?.n));
}

// The app a token was issued to (the name it registered with, or GPT), so the live feed can say
// "Claude (Sam's)" instead of just "Sam". Carried into refreshed tokens.
function withApp(t, app) {
  if (!app) return t;
  const again = (tok, kind) => { const p = verify(tok, kind); return p ? sign({ ...p, a: String(app).slice(0, 60) }) : tok; };
  return { ...t, access_token: again(t.access_token, 'access'), refresh_token: again(t.refresh_token, 'refresh') };
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

export function page(res, status, inner, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...headers }).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>agent-kanban</title><meta name="robots" content="noindex">
<style>:root{--bg:#f4f4f2;--card:#fff;--ink:#111;--muted:#666;--line:#d8d8d4}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#141414;--ink:#e8e8e8;--muted:#8a8a8a;--line:#2a2a2a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "JetBrains Mono","SFMono-Regular",ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:0;padding:28px 24px;max-width:440px;width:100%}h1{font-size:16px;margin:0 0 8px}p{color:var(--muted);margin:0 0 12px}b{color:var(--ink)}
a.btn{display:block;text-align:center;text-decoration:none;margin-top:12px;font-weight:600;padding:12px;border:1px solid var(--ink);background:var(--ink);color:var(--bg)}</style></head><body><main>${inner}</main></body></html>`);
}
