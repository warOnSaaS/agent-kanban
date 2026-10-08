// Sign in with the warOnSaaS account (AUTH_PROVIDER=waronsaas), against a fake account server and a fake GitHub.
// Looking is free: every page renders for a signed-out visitor. Doing anything asks for a sign-in: the API and
// MCP answer 401 sign_in. The callback signs a person in by their GitHub login or verified email and remembers
// their account id; "sign out everywhere" on the account (a dead sid) signs them out here too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fakeAccount, signInThrough, cookieFrom } from './fake-account.mjs';
import { fakeGithub } from './fake-github.mjs';

process.env.AUTH_PROVIDER = 'waronsaas';
process.env.OAUTH_SECRET = 'account-test-secret';
process.env.WOS_ACCOUNT_CLIENT_ID = 'board';
process.env.WOS_ACCOUNT_CLIENT_SECRET = 'board-secret';
process.env.WORKSPACE_CONTACT = 'Sam';
delete process.env.PUBLIC_URL;
delete process.env.HOSTED_ORIGIN;

const acct = fakeAccount();
process.env.WOS_ACCOUNT_URL = await acct.listen();

const { Workspace } = await import('../lib/workspace.mjs');
const { FsStore } = await import('../lib/store.mjs');
const { verify, account } = await import('../lib/auth.mjs');
const { serve } = await import('../dev.mjs');
const { Hosted, serveHosted } = await import('../lib/hosted.mjs');
const { GitHubApp } = await import('../lib/hosting/github-app.mjs');
const { GitHubRegistry } = await import('../lib/hosting/registry.mjs');

const SAM = { sub: 'acc_sam', name: 'Sam Rivera', email: 'sam@example.com', email_verified: true, github_login: 'sam-rivera-example' };
const JORDAN = { sub: 'acc_jordan', name: 'Jordan Lee', email: 'jordan@example.com', email_verified: true, github_login: 'jordan-lee-example', sid: 'ses_jordan' };
const RILEY = { sub: 'acc_riley', name: 'Riley Chen', email: 'riley@example.com', email_verified: true };
const STRANGER = { sub: 'acc_stranger', name: 'Pat Stranger', email: 'pat@example.com', email_verified: true };

let dir, ws, srv, base;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-account-'));
  fs.cpSync(new URL('../example-workspace', import.meta.url), dir, { recursive: true });
  ws = new Workspace(new FsStore(dir), { name: 'Example Co' });
  srv = await serve(ws);
  base = `http://localhost:${srv.address().port}`;
});
after(() => { srv.close(); acct.close(); fs.rmSync(dir, { recursive: true }); });

const get = (url, cookie) => fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const rest = (url, cookie, args = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'agent-kanban', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(args) });
const mcpPost = (url, token) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const people = () => YAML.parse(fs.readFileSync(path.join(dir, 'people.yml'), 'utf8')).people;
const PROMPT_OUT = new RegExp(`<script src="${acct.issuer}/prompt.js" defer data-signed-in="false" data-app="agent-kanban" data-signin="/auth/waronsaas">`);
const PROMPT_IN = /prompt\.js" defer data-signed-in="true"/;

// ---------- self-hosted board on the account ----------

test('signed out: every page renders (no redirect) with the prompt; nothing private shows; calls answer 401 sign_in', async () => {
  for (const p of ['/', '/board', '/board/alerts', '/board?view=mine']) {
    const r = await get(base + p);
    assert.equal(r.status, 200, p);
    const html = await r.text();
    assert.match(html, PROMPT_OUT, `${p} carries the prompt`);
    assert.doesNotMatch(html, /Draft the PTO policy|Remote work policy/, `${p} shows no cards`);
    assert.ok(!html.includes('—'));
  }
  const board = await (await get(`${base}/board`)).text();
  assert.match(board, /data-needs-account/);
  assert.match(board, /sign in to see them/i);
  const r = await rest(`${base}/v1/add_task`, null, { client: 'Acme', title: 'x' });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: { code: 'sign_in', message: 'Sign in to your warOnSaaS account' } });
  const m = await mcpPost(`${base}/mcp`);
  assert.equal(m.status, 401);
  assert.match(m.headers.get('www-authenticate'), /oauth-protected-resource/);
  assert.deepEqual((await m.json()).error.code, 'sign_in');
  assert.equal((await get(`${base}/board/live?v=`)).status, 401);
});

test('/login and /auth/waronsaas send the browser to the account with PKCE, the right callback and the options', async () => {
  const login = await get(`${base}/login?next=/board`);
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/auth/waronsaas?next=%2Fboard');
  const start = await get(`${base}/auth/waronsaas?next=/board&prompt=none&provider=google`);
  assert.equal(start.status, 302);
  const u = new URL(start.headers.get('location'));
  assert.equal(u.origin, acct.issuer);
  assert.equal(u.pathname, '/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'board');
  assert.equal(u.searchParams.get('redirect_uri'), `${base}/auth/waronsaas/callback`);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('prompt'), 'none');
  assert.equal(u.searchParams.get('provider'), 'google');
  assert.match(u.searchParams.get('scope'), /\bopenid\b/);
  assert.doesNotMatch(u.searchParams.get('scope'), /offline_access/, 'a browser sign-in is not a connection');
  const flow = start.headers.getSetCookie().find((c) => c.startsWith('wos_acct_flow='));
  assert.match(flow, /Path=\/auth\/waronsaas\/callback/);
  assert.match(flow, /HttpOnly/);
  // Another site as next is never followed.
  const odd = await get(`${base}/auth/waronsaas?next=https://evil.example/x`);
  assert.equal(odd.status, 302);
});

let samCookie;
test('the callback signs Sam in by his GitHub login and remembers his account id; the board and the API work', async () => {
  acct.who = SAM;
  const { res } = await signInThrough(base, '/auth/waronsaas?next=/board');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/board');
  const c = cookieFrom(res, 'ak_session');
  assert.ok(c, 'session cookie set');
  assert.match(c.raw, /HttpOnly/);
  assert.ok(res.headers.getSetCookie().some((x) => x.startsWith('wos_acct_flow=;')), 'the flow cookie is cleared');
  samCookie = c.header;
  const tok = verify(c.value, 'access');
  assert.equal(tok.sub, 'acc_sam');
  assert.ok(tok.sid, 'the account session rides in the cookie');
  assert.equal(people().find((p) => p.id === 'sam').account, 'acc_sam');

  const html = await (await get(`${base}/board`, samCookie)).text();
  assert.match(html, /Sign out Sam/);
  assert.match(html, /Draft the PTO policy/);
  assert.match(html, PROMPT_IN);
  const r = await rest(`${base}/v1/add_idea`, samCookie, { title: 'Signed in through the account' });
  assert.equal(r.status, 200);
  assert.match(await (await get(`${base}/board`, samCookie)).text(), /Signed in through the account/);
});

test('a verified email links a person with no GitHub yet; an unknown account is turned away and the owner hears', async () => {
  acct.who = RILEY;
  const { res } = await signInThrough(base, '/auth/waronsaas?next=/board');
  assert.equal(res.status, 302);
  const riley = people().find((p) => p.id === 'riley');
  assert.equal(riley.account, 'acc_riley');
  assert.equal(riley.github, undefined, 'no GitHub login to fill in');
  assert.match(fs.readFileSync(path.join(dir, 'people.yml'), 'utf8'), /# Who is on the team/, 'the file keeps its comments');
  const board = await (await get(`${base}/board`, cookieFrom(res, 'ak_session').header)).text();
  assert.match(board, /Sign out Riley/);

  acct.who = STRANGER;
  const no = await signInThrough(base, '/auth/waronsaas?next=/board');
  assert.equal(no.res.status, 403);
  const text = await no.res.text();
  assert.match(text, /not on the Example Co team/);
  assert.match(text, /pat@example\.com/);
  assert.ok(!cookieFrom(no.res, 'ak_session'));
  const alerts = await (await rest(`${base}/v1/my_alerts`, samCookie)).json();
  assert.match(alerts.result, /pat@example\.com tried to sign in/);

  // An unverified email never matches.
  acct.who = { sub: 'acc_fake', email: 'casey@example.com', email_verified: false, name: 'Not Casey' };
  assert.equal((await signInThrough(base, '/auth/waronsaas?next=/board')).res.status, 403);
});

test('a dead account session (sign out everywhere) signs the person out here: pages open, calls 401', async () => {
  acct.who = JORDAN;
  const { res } = await signInThrough(base, '/auth/waronsaas?next=/board');
  const c = cookieFrom(res, 'ak_session');
  assert.equal(verify(c.value, 'access').sid, 'ses_jordan');
  acct.dead.add('ses_jordan');
  const r = await rest(`${base}/v1/my_day`, c.header);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, 'sign_in');
  const html = await (await get(`${base}/board`, c.header)).text();
  assert.match(html, PROMPT_OUT);
  assert.doesNotMatch(html, /Sign out Jordan/);
  acct.dead.delete('ses_jordan');
});

test('a silent try while the browser is not signed in to the account comes back signed out, page still open', async () => {
  acct.browserSignedIn = false;
  const { res } = await signInThrough(base, '/auth/waronsaas?next=/board&prompt=none');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/board');
  assert.ok(!cookieFrom(res, 'ak_session'), 'no session');
  assert.ok(res.headers.getSetCookie().some((x) => x.startsWith('wos_acct_flow=;')), 'flow cookie cleared');
  acct.browserSignedIn = true;
  // A callback with no flow (an old link) goes home, signed out.
  const stale = await get(`${base}/auth/waronsaas/callback?code=x&state=y`);
  assert.equal(stale.status, 302);
  assert.ok(!cookieFrom(stale, 'ak_session'));
});

test('MCP: an AI app signs in through the account as a connection; its tokens carry the account session', async () => {
  const cb = 'http://localhost:7777/callback';
  const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [cb] }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: cb, state: 'st1', code_challenge: challenge, code_challenge_method: 'S256' });
  acct.who = SAM;
  const { res, authorizeUrl } = await signInThrough(base, `/oauth/authorize?${q}`);
  assert.equal(authorizeUrl.searchParams.get('connection'), 'Claude Code via agent-kanban');
  assert.match(authorizeUrl.searchParams.get('scope'), /offline_access/);
  assert.equal(res.status, 302);
  const app = new URL(res.headers.get('location'));
  assert.equal(app.origin + app.pathname, cb);
  assert.equal(app.searchParams.get('state'), 'st1');
  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const code = app.searchParams.get('code');
  assert.equal((await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: cb, code_verifier: 'wrong' }))).status, 400);
  const tok = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: cb, code_verifier: verifier }))).json();
  assert.ok(tok.access_token);
  const p = verify(tok.access_token, 'access');
  assert.equal(p.sub, 'acc_sam');
  assert.ok(p.sid);
  assert.equal(p.a, 'Claude Code');
  const again = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).json();
  assert.equal(verify(again.access_token, 'access').sid, p.sid, 'a refresh keeps the account session');

  const c = new Client({ name: 't', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${again.access_token}` } } }));
  assert.match((await c.callTool({ name: 'my_day', arguments: {} })).content[0].text, /# Sam Rivera/);
  // The account ends the connection: the token stops working (the liveness answer is cached a minute).
  acct.dead.add(p.sid);
  account().live.delete(p.sid);
  assert.equal((await mcpPost(`${base}/mcp`, again.access_token)).status, 401);
  acct.dead.delete(p.sid);
});

test('sign out clears the board cookie and signs out of the account too, which then comes back to the board', async () => {
  const out = await get(`${base}/logout`, samCookie);
  assert.equal(out.status, 302);
  assert.match(out.headers.get('set-cookie'), /ak_session=;.*Max-Age=0/);
  const u = new URL(out.headers.get('location'));
  assert.equal(u.origin + u.pathname, `${acct.issuer}/oauth/end-session`);
  assert.equal(u.searchParams.get('client_id'), 'board');
  assert.equal(u.searchParams.get('post_logout_redirect_uri'), `${base}/board`);
});

// ---------- hosted: many teams, one callback ----------

let gh, hub, hsrv, ho;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
before(async () => {
  gh = fakeGithub({ publicKey });
  const ghBase = await gh.listen();
  process.env.GITHUB_WEB_BASE = process.env.GITHUB_API_BASE = ghBase;
  gh.addUser('sam-rivera-example', { emails: ['sam@example.com'], name: 'Sam Rivera' });
  gh.addInstallation({ id: 99, account: 'warOnSaaS', type: 'Organization' });
  gh.addRepo('warOnSaaS/agent-kanban-registry', { installation: 99 });
  const app = new GitHubApp({ appId: '123', privateKey, clientId: 'Iv1.hosted', clientSecret: 'app-secret', slug: 'agent-kanban' });
  hub = new Hosted({ env: { OAUTH_SECRET: 'account-test-secret' }, app, registry: new GitHubRegistry({ repo: 'warOnSaaS/agent-kanban-registry', token: () => app.installationToken(99) }) });
  hsrv = await serveHosted(0, hub);
  ho = `http://localhost:${hsrv.address().port}`;
});
after(() => { hsrv.close(); gh.srv.close(); });

test('hosted, signed out: the front page and Create a board render with the prompt; calls answer 401 sign_in', async () => {
  const home = await get(`${ho}/`);
  assert.equal(home.status, 200);
  const h = await home.text();
  assert.match(h, PROMPT_OUT);
  assert.match(h, /href="\/auth\/waronsaas\?next=%2F"[^>]*>Sign in</);
  const create = await get(`${ho}/create?name=Acme%20Ops`);
  assert.equal(create.status, 200, 'no redirect to sign in');
  const c = await create.text();
  assert.match(c, /data-tool="create_board"/);
  assert.match(c, /value="Acme Ops"/);
  assert.match(c, /Sending this form asks you to sign in/);
  assert.match(c, PROMPT_OUT);
  const r = await rest(`${ho}/v1/create_board`, null, { name: 'Acme Ops' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, 'sign_in');
  assert.equal((await mcpPost(`${ho}/mcp`)).status, 401);
});

let acctCookie;
test('hosted: sign in to the account, connect GitHub once, create a board; the owner is seeded with their account id', async () => {
  acct.who = SAM;
  const { res } = await signInThrough(ho, '/auth/waronsaas?next=/create?name=Acme%20Ops');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/create?name=Acme%20Ops');
  let c = cookieFrom(res, 'ak_account');
  assert.ok(c);
  assert.equal(c.path, '/');
  acctCookie = c.header;
  let page = await (await get(`${ho}/create?name=Acme%20Ops`, c.header)).text();
  assert.match(page, /Signed in as <b>Sam Rivera<\/b> \(@sam-rivera-example\)/);
  assert.match(page, /GitHub asks once/);
  assert.match(page, PROMPT_IN);

  // Creating needs GitHub for the repo: the tool points at the one-click connect step.
  let r = await (await rest(`${ho}/v1/create_board`, c.header, { name: 'Acme Ops' })).json();
  assert.equal(r.data.next, `${ho}/github/connect?next=${encodeURIComponent('/create?name=Acme%20Ops')}`);
  const toGh = await get(r.data.next, c.header);
  assert.equal(toGh.status, 302);
  const ghUrl = new URL(toGh.headers.get('location'));
  assert.equal(ghUrl.pathname, '/login/oauth/authorize');
  assert.equal(ghUrl.searchParams.get('redirect_uri'), `${ho}/github/callback`);
  const back = await get(`${ho}/github/callback?code=as-sam-rivera-example&state=${encodeURIComponent(ghUrl.searchParams.get('state'))}`, c.header);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/create?name=Acme%20Ops');
  c = cookieFrom(back, 'ak_account');
  assert.ok(c, 'the account cookie now carries the GitHub sign-in');
  assert.notEqual(c.header, acctCookie);
  acctCookie = c.header;
  page = await (await get(`${ho}/create?name=Acme%20Ops`, acctCookie)).text();
  assert.match(page, /sam-rivera-example \(your account\)/);

  // Without a GitHub connect the connect step itself asks for the account first.
  assert.match((await get(`${ho}/github/connect?next=/create`)).headers.get('location'), /^\/auth\/waronsaas\?next=/);

  r = await (await rest(`${ho}/v1/create_board`, acctCookie, { name: 'Acme Ops' })).json();
  assert.match(r.data.open, /installations\/new/);
  gh.addInstallation({ id: 11, account: 'sam-rivera-example' });
  r = await (await rest(`${ho}/v1/create_board`, acctCookie, { name: 'Acme Ops' })).json();
  assert.equal(r.data.slug, 'acme-ops');
  const yml = gh.repos['sam-rivera-example/acme-ops-board'].files.get('people.yml');
  assert.match(yml, /github: sam-rivera-example/);
  assert.match(yml, /account: acc_sam/);
  const entry = JSON.parse(gh.repos['warOnSaaS/agent-kanban-registry'].files.get('teams/acme-ops.json'));
  assert.deepEqual(entry.members.sort(), ['acc_sam', 'sam-rivera-example']);
  assert.match((await (await rest(`${ho}/v1/my_boards`, acctCookie)).json()).result, /Acme Ops/);
  assert.match(await (await get(`${ho}/`, acctCookie)).text(), /Your boards[\s\S]*Acme Ops/);
});

test('hosted team, signed out: the board, settings and Connect page render without the team\'s data; calls 401', async () => {
  const board = await get(`${ho}/t/acme-ops/board`);
  assert.equal(board.status, 200);
  const b = await board.text();
  assert.match(b, PROMPT_OUT);
  assert.match(b, /The Acme Ops board/);
  assert.match(b, /data-needs-account/);
  assert.doesNotMatch(b, /Welcome: drag me to Doing/);
  assert.match(b, /href="\/t\/acme-ops\/auth\/waronsaas\?next=%2Fboard"/, 'links stay inside the team');
  const settings = await get(`${ho}/t/acme-ops/settings`);
  assert.equal(settings.status, 200);
  assert.match(await settings.text(), /data-needs-account/);
  assert.equal((await get(`${ho}/t/acme-ops/`)).status, 200);
  const r = await rest(`${ho}/t/acme-ops/v1/my_day`, null);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, 'sign_in');
  assert.equal((await mcpPost(`${ho}/t/acme-ops/mcp`)).status, 401);
});

test('hosted team: /login goes to the account through the one root callback; the team rides along and the cookie stays on the team', async () => {
  const login = await get(`${ho}/t/acme-ops/login?next=/`);
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/t/acme-ops/auth/waronsaas?next=%2F');
  acct.who = SAM;
  const { res, authorizeUrl } = await signInThrough(ho, '/t/acme-ops/auth/waronsaas?next=%2F');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), `${ho}/auth/waronsaas/callback`, 'one callback for every team');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/t/acme-ops/');
  const c = cookieFrom(res, 'ak_session');
  assert.equal(c.path, '/t/acme-ops');
  const board = await (await get(`${ho}/t/acme-ops/board`, c.header)).text();
  assert.match(board, /Welcome: drag me to Doing/);
  assert.match(board, /Sign out Sam/);
  assert.match(board, PROMPT_IN);
  assert.match(await (await get(`${ho}/t/acme-ops/`, c.header)).text(), /href="\/t\/acme-ops\/settings"/);

  // From a page's prompt (the root sign-in path with the team in next): same result.
  const viaRoot = await signInThrough(ho, `/auth/waronsaas?next=${encodeURIComponent('/t/acme-ops/board')}`);
  assert.equal(viaRoot.res.headers.get('location'), '/t/acme-ops/board');
  assert.equal(cookieFrom(viaRoot.res, 'ak_session').path, '/t/acme-ops');

  // Sign out on the team returns to the team's board.
  const out = await get(`${ho}/t/acme-ops/logout`, c.header);
  assert.equal(new URL(out.headers.get('location')).searchParams.get('post_logout_redirect_uri'), `${ho}/t/acme-ops/board`);

  // Someone invited by email only signs in with their account and is linked.
  const inv = await (await rest(`${ho}/v1/invite_person`, acctCookie, { board: 'acme-ops', name: 'Casey Park', email: 'casey@example.com', clients: 'all' })).json();
  assert.match(inv.result, /Added Casey Park/);
  acct.who = { sub: 'acc_casey', name: 'Casey Park', email: 'casey@example.com', email_verified: true };
  const casey = await signInThrough(ho, '/t/acme-ops/auth/waronsaas?next=%2Fboard');
  assert.equal(casey.res.headers.get('location'), '/t/acme-ops/board');
  assert.match(gh.repos['sam-rivera-example/acme-ops-board'].files.get('people.yml'), /account: acc_casey/);
  assert.match(await (await get(`${ho}/t/acme-ops/board`, cookieFrom(casey.res, 'ak_session').header)).text(), /Sign out Casey/);
});

test('hosted team MCP: an AI app connects through the account and gets a token for that team only', async () => {
  const cb = 'http://127.0.0.1:9/cb';
  const reg = await (await fetch(`${ho}/t/acme-ops/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [cb] }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  acct.who = SAM;
  const { res, authorizeUrl } = await signInThrough(ho, `/t/acme-ops/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: cb, state: 's', code_challenge: challenge, code_challenge_method: 'S256' })}`);
  assert.equal(authorizeUrl.searchParams.get('connection'), 'Claude via agent-kanban');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), `${ho}/auth/waronsaas/callback`);
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const tok = await (await fetch(`${ho}/t/acme-ops/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: cb, code_verifier: verifier }).toString() })).json();
  assert.ok(tok.access_token);
  assert.equal((await mcpPost(`${ho}/t/acme-ops/mcp`, tok.access_token)).status, 200);
  assert.equal((await mcpPost(`${ho}/mcp`, tok.access_token)).status, 401, 'a team token is not an account token');
});
