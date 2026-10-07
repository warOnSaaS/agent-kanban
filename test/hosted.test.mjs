import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fakeGithub } from './fake-github.mjs';

// Hosted mode against a fake GitHub: creating a board makes a real (fake) repo through the same GitHub App code
// production uses, and every team's data is read through an installation token that only reaches its own repo.

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
process.env.OAUTH_SECRET = 'hosted-test-secret';
delete process.env.WORKSPACE_CONTACT;

let gh, srv, origin, hub;
const { Hosted, serveHosted } = await import('../lib/hosted.mjs');
const { GitHubApp } = await import('../lib/hosting/github-app.mjs');
const { GitHubRegistry, MemoryRegistry } = await import('../lib/hosting/registry.mjs');

before(async () => {
  gh = fakeGithub({ publicKey });
  const base = await gh.listen();
  process.env.GITHUB_WEB_BASE = process.env.GITHUB_API_BASE = base;
  gh.addUser('sam-rivera-example', { emails: ['sam@example.com'], name: 'Sam Rivera' });
  gh.addUser('jordan-lee-example', { emails: ['jordan@example.com'], name: 'Jordan Lee' });
  gh.addUser('casey-park-example', { name: 'Casey Park' });
  gh.addInstallation({ id: 99, account: 'warOnSaaS', type: 'Organization' });
  gh.addRepo('warOnSaaS/agent-kanban-registry', { installation: 99 });
  const app = new GitHubApp({ appId: '123', privateKey, clientId: 'Iv1.hosted', clientSecret: 'app-secret', slug: 'agent-kanban' });
  hub = new Hosted({ env: { OAUTH_SECRET: 'hosted-test-secret' }, app, registry: new GitHubRegistry({ repo: 'warOnSaaS/agent-kanban-registry', token: () => app.installationToken(99) }) });
  srv = await serveHosted(0, hub);
  origin = `http://localhost:${srv.address().port}`;
});
after(() => { srv.close(); gh.srv.close(); });

// ---------- helpers ----------

const get = (p, headers = {}) => fetch(origin + p, { redirect: 'manual', headers });
const cookieFrom = (r, name) => {
  const c = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]).find((x) => x?.startsWith(`${name}=`));
  return c ? { header: c.split(';')[0], value: decodeURIComponent(c.split(';')[0].slice(name.length + 1)), path: /Path=([^;]+)/.exec(c)?.[1] } : null;
};

// Signs in through the hosted GitHub flow. GitHub itself is skipped: the fake turns code "as-<login>" into that user.
async function signIn(login, prefix = '') {
  const start = await get(`${prefix}/login?next=${encodeURIComponent('/')}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(to.searchParams.get('redirect_uri'), `${origin}/github/callback`, 'one callback address for every team');
  const back = await get(`/github/callback?code=as-${login}&state=${encodeURIComponent(to.searchParams.get('state'))}`);
  return { res: back, cookie: cookieFrom(back, prefix ? 'ak_session' : 'ak_account') };
}

const rest = (p, cookie, args = {}) => fetch(origin + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'agent-kanban', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(args) });
const bearerRest = (p, token, args = {}) => fetch(origin + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(args) });

async function mcp(url, token) {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return {
    c,
    call: async (name, args = {}) => {
      const r = await c.callTool({ name, arguments: args });
      return { text: r.content.map((x) => x.text).join('\n'), error: !!r.isError, data: r.structuredContent };
    },
  };
}

const accounts = {};
const teams = {};

// ---------- creating a board ----------

test('create a board: sign in, install the app once, and a private repo is made in your own account with you as owner', async () => {
  const { cookie } = await signIn('sam-rivera-example');
  assert.ok(cookie, 'account cookie set');
  assert.equal(cookie.path, '/');
  accounts.sam = cookie;

  const page = await (await get('/create', { cookie: cookie.header })).text();
  assert.match(page, /data-tool="create_board"/);
  assert.match(page, /sam-rivera-example \(your account\)/);

  // Not installed yet: the tool hands back the one GitHub link to open.
  let r = await (await rest('/v1/create_board', cookie.header, { name: 'Acme Ops' })).json();
  assert.match(r.data.open, /\/apps\/agent-kanban\/installations\/new/);
  assert.equal(Object.keys(gh.repos).filter((k) => k.startsWith('sam-rivera-example/')).length, 0);

  gh.addInstallation({ id: 11, account: 'sam-rivera-example' });
  r = await (await rest('/v1/create_board', cookie.header, { name: 'Acme Ops' })).json();
  assert.equal(r.data.slug, 'acme-ops');
  assert.equal(r.data.repo, 'sam-rivera-example/acme-ops-board');
  assert.equal(r.data.next, `${origin}/t/acme-ops/login?next=%2F`);
  teams.acme = r.data;

  const repo = gh.repos['sam-rivera-example/acme-ops-board'];
  assert.ok(repo.private, 'the repo is private');
  assert.ok(gh.installations[11].repos.has(repo.full), 'the new repo was added to the installation');
  assert.match(repo.files.get('people.yml'), /github: sam-rivera-example/);
  assert.match(repo.files.get('people.yml'), /role: owner/);
  assert.ok(!/jordan|casey|riley/i.test(repo.files.get('people.yml')), 'no example people');
  const examples = [...repo.files.keys()].filter((p) => p.startsWith('clients/examples/tasks/'));
  assert.ok(examples.length >= 3 && examples.length <= 5, 'three to five example cards');
  assert.ok(examples.every((p) => /example: true/.test(repo.files.get(p))), 'each card is marked as an example');
  assert.match(repo.files.get('.agent-kanban/board.json'), /"slug": "acme-ops"/);
  assert.ok(repo.files.has('playbooks/start-here.md'));

  const entry = JSON.parse(gh.repos['warOnSaaS/agent-kanban-registry'].files.get('teams/acme-ops.json'));
  assert.deepEqual(entry.products.board.storage, { kind: 'github', repo: repo.full, branch: 'main', installation_id: 11 });
  assert.deepEqual(entry.members, ['sam-rivera-example']);
  assert.equal(entry.plan, null);
  assert.ok(gh.repos['warOnSaaS/agent-kanban-registry'].files.has('members/sam-rivera-example.json'));
});

test('the new owner signs in to the team and lands on its Connect page, pointed at the team\'s own MCP address', async () => {
  const { res, cookie } = await signIn('sam-rivera-example', '/t/acme-ops');
  assert.equal(res.headers.get('location'), '/t/acme-ops/');
  assert.equal(cookie.path, '/t/acme-ops', 'the team cookie only goes to this team');
  teams.acme.cookie = cookie;
  const page = await (await get('/t/acme-ops/', { cookie: cookie.header })).text();
  assert.match(page, new RegExp(`${origin}/t/acme-ops/mcp`));
  assert.match(page, /curl -fsSL http:\/\/localhost:\d+\/t\/acme-ops\/connect\/claude \| sh/);
  assert.match(page, /href="\/t\/acme-ops\/settings"/, 'owners see Settings');
  const board = await (await get('/t/acme-ops/board', { cookie: cookie.header })).text();
  assert.match(board, /Welcome: drag me to Doing/);
  assert.ok(!/href="\/board/.test(board) && !/fetch\('\/v1/.test(board), 'every link stays inside the team');
  const script = await (await get('/t/acme-ops/connect/claude')).text();
  assert.match(script, /URL='http:\/\/localhost:\d+\/t\/acme-ops\/mcp'/);
});

test('the MCP layer: create, invite, links, clear examples, export and move all work from an agent', async () => {
  // Account level: Jordan makes his own board over MCP, after installing the app on his account.
  const { cookie } = await signIn('jordan-lee-example');
  accounts.jordan = cookie;
  gh.addInstallation({ id: 12, account: 'jordan-lee-example', all: true });
  const acct = await mcp(`${origin}/mcp`, cookie.value);
  const made = await acct.call('create_board', { name: 'Birch Law' });
  assert.equal(made.error, false, made.text);
  assert.equal(made.data.slug, 'birch-law');
  assert.match((await acct.call('my_boards')).text, /Birch Law/);
  assert.match((await acct.call('board_links', { board: 'birch-law' })).text, /t\/birch-law\/mcp/);
  const inv = await acct.call('invite_person', { board: 'birch-law', name: 'Sam Rivera', github: 'sam-rivera-example', clients: 'all' });
  assert.match(inv.text, /INSTRUCTIONS\.md\?for=/);
  assert.match(gh.repos['jordan-lee-example/birch-law-board'].files.get('people.yml'), /sam-rivera-example/);
  assert.match((await acct.call('move_to_own_hosting', { board: 'birch-law' })).text, /deploy --repo jordan-lee-example\/birch-law-board --from http:\/\/localhost:\d+\/t\/birch-law/);
  assert.match((await acct.call('export_board', { board: 'birch-law' })).text, /\/t\/birch-law\/export\.zip\?key=/);
  // Sam is on Birch Law now, but only as team: owner-only tools refuse him.
  const samAcct = await mcp(`${origin}/mcp`, accounts.sam.value);
  assert.match((await samAcct.call('export_board', { board: 'birch-law' })).text, /Only the owner/);
  assert.match((await samAcct.call('invite_person', { board: 'birch-law', name: 'Casey', github: 'casey-park-example' })).text, /Only the owner/);

  // Team level: the same actions on the board's own MCP address.
  const { cookie: tc } = await signIn('jordan-lee-example', '/t/birch-law');
  teams.birch = { cookie: tc };
  const team = await mcp(`${origin}/t/birch-law/mcp`, tc.value);
  assert.match((await team.call('connect_links')).text, /t\/birch-law\/mcp/);
  assert.match((await team.call('update_person', { person: 'sam', role: 'team', clients: 'all' })).text, /Sam Rivera: team/);
  assert.match((await team.call('add_person', { name: 'Casey Park', github: 'casey-park-example' })).text, /Added Casey Park/);
  assert.match((await team.call('remove_person', { person: 'casey' })).text, /Removed Casey Park/);
  assert.match((await team.call('move_to_own_hosting')).text, /npx -y .* deploy --repo jordan-lee-example\/birch-law-board/);
  assert.match((await team.call('clear_examples')).text, /Cleared 6 example items/);
  assert.ok(![...gh.repos['jordan-lee-example/birch-law-board'].files.keys()].some((p) => p.startsWith('clients/examples/')));
  assert.equal((await team.call('add_task', { client: 'examples', title: 'x' })).error, true, 'the examples client is gone');

  const zip = await get(`/t/birch-law/export.zip`, { cookie: tc.header });
  assert.equal(zip.status, 302);
  assert.match(zip.headers.get('location'), /codeload\.example\/jordan-lee-example\/birch-law-board/);
});

// ---------- isolation ----------

test('isolation: a token, cookie or sign-in code from one team never works on another, even for the same person', async () => {
  const acme = teams.acme.cookie;
  // Sam is on both boards. His Acme token still does nothing on Birch Law.
  const post = (url, token) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal((await post(`${origin}/t/acme-ops/mcp`, acme.value)).status, 200);
  const r = await post(`${origin}/t/birch-law/mcp`, acme.value);
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /\/t\/birch-law\/\.well-known\/oauth-protected-resource/);
  // Account tokens are not team tokens either way.
  assert.equal((await post(`${origin}/t/acme-ops/mcp`, accounts.sam.value)).status, 401);
  assert.equal((await post(`${origin}/mcp`, acme.value)).status, 401);
  // REST
  assert.equal((await bearerRest('/t/birch-law/v1/my_day', acme.value)).status, 401);
  assert.equal((await rest('/t/birch-law/v1/my_day', acme.header.replace('ak_session', 'ak_session'))).status, 401);
  // The board, with the Acme cookie: a sign-in page, nothing from Birch Law.
  const board = await (await get('/t/birch-law/board', { cookie: acme.header })).text();
  assert.match(board, /SIGN IN WITH GITHUB/i);
  assert.ok(!/Birch Law board|kanban-col/.test(board));
  // Settings and export: owner of one board is nobody on another.
  assert.equal((await get('/t/birch-law/settings', { cookie: acme.header })).status, 302);
  assert.equal((await get('/t/birch-law/export.zip', { cookie: acme.header })).status, 403);
  const key = /export\.zip\?key=([^\s]+)/.exec((await (await mcp(`${origin}/t/acme-ops/mcp`, acme.value)).call('export_board')).text)[1];
  assert.equal((await get(`/t/birch-law/export.zip?key=${key}`)).status, 403, 'an Acme download link does not open Birch Law');
  assert.equal((await get(`/t/acme-ops/export.zip?key=${key}`)).status, 302);
});

test('isolation: what one team writes never shows up for another, over MCP, REST or the board', async () => {
  const birch = await mcp(`${origin}/t/birch-law/mcp`, teams.birch.cookie.value);
  assert.equal((await birch.call('add_client', { name: 'Riverside Clinic' })).error, false);
  assert.equal((await birch.call('add_task', { client: 'Riverside Clinic', title: 'Quietly renegotiate the lease' })).error, false);
  const acme = await mcp(`${origin}/t/acme-ops/mcp`, teams.acme.cookie.value);
  const direct = await acme.call('fetch', { id: 'clients/riverside-clinic/client.md' });
  assert.equal(direct.error, true, 'asking for the exact path finds nothing');
  assert.ok(!/renegotiate|status: active/i.test(direct.text));
  for (const [tool, args] of [['search', { query: 'renegotiate lease' }], ['status', {}], ['list_clients', {}], ['find_tasks', {}]]) {
    const out = await acme.call(tool, args);
    assert.ok(!/renegotiate|Riverside/i.test(out.text), `${tool} leaked another team's data: ${out.text.slice(0, 120)}`);
  }
  const restOut = await (await bearerRest('/t/acme-ops/v1/search', teams.acme.cookie.value, { query: 'lease' })).text();
  assert.ok(!/Riverside|renegotiate/i.test(restOut));
  const board = await (await get('/t/acme-ops/board', { cookie: teams.acme.cookie.header })).text();
  assert.ok(!/Riverside|renegotiate/i.test(board));
  // And the repos: nothing crossed.
  assert.ok(![...gh.repos['sam-rivera-example/acme-ops-board'].files.keys()].some((p) => p.includes('riverside')));
});

test('isolation: odd addresses and another team\'s OAuth client or code are refused', async () => {
  for (const p of ['/t/..%2Fbirch-law/board', '/t/ACME-OPS/board', '/t/acme-ops%2F..%2Fbirch-law/board', '/t/nope/board', '/t/api/board']) {
    assert.equal((await get(p)).status, 404, p);
  }
  // A client registered on Acme cannot sign in on Birch Law.
  const reg = await (await fetch(`${origin}/t/acme-ops/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9/cb'] }) })).json();
  const auth = await get(`/t/birch-law/oauth/authorize?client_id=${encodeURIComponent(reg.client_id)}&redirect_uri=${encodeURIComponent('http://127.0.0.1:9/cb')}&code_challenge=x&code_challenge_method=S256`);
  assert.equal(auth.status, 400);
  // Discovery at the path GitHub-style clients use, per team.
  const meta = await (await get('/.well-known/oauth-authorization-server/t/birch-law')).json();
  assert.equal(meta.issuer, `${origin}/t/birch-law`);
  assert.equal(meta.token_endpoint, `${origin}/t/birch-law/oauth/token`);
  const res = await (await get('/.well-known/oauth-protected-resource/t/birch-law/mcp')).json();
  assert.equal(res.resource, `${origin}/t/birch-law/mcp`);
});

test('a team that moved to its own hosting sends people to the new address; its data never left its repo', async () => {
  const repo = gh.repos['sam-rivera-example/acme-ops-board'];
  repo.files.set('.agent-kanban/hosting.json', JSON.stringify({ moved_to: 'https://acme-ops-board.vercel.app' }));
  hub.moves.clear();
  const r = await get('/t/acme-ops/board?client=x');
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), 'https://acme-ops-board.vercel.app/board?client=x');
  const m = await fetch(`${origin}/t/acme-ops/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(m.status, 410);
  assert.match((await m.json()).error, /acme-ops-board\.vercel\.app\/mcp/);
  repo.files.delete('.agent-kanban/hosting.json');
  hub.moves.clear();
  assert.equal((await get('/t/acme-ops/board')).status, 200, 'deleting the file brings them back');
});

test('two teams cannot take one address: the registry refuses a second create of the same slug', async () => {
  const { SlugTaken, newTeam } = await import('../lib/hosting/registry.mjs');
  const t = newTeam({ slug: 'acme-ops', name: 'Acme', createdBy: 'x', product: 'board', storage: { kind: 'github', repo: 'x/y', installation_id: 1 } });
  await assert.rejects(() => hub.registry.create(t), SlugTaken);
  assert.equal(await hub.registry.freeSlug('acme-ops'), 'acme-ops-2');
});

// ---------- demo mode (no GitHub App yet) ----------

test('demo mode: create a board with no GitHub, land on its Connect page; any address opens a fresh made-up board', async () => {
  const demo = new Hosted({ env: {}, app: null, registry: new MemoryRegistry() });
  const s = await serveHosted(0, demo);
  const o = `http://localhost:${s.address().port}`;
  try {
    assert.match(await (await fetch(`${o}/`)).text(), /Create your board[\s\S]*Host it yourself, free/);
    const r = await (await fetch(`${o}/v1/create_board`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'agent-kanban' }, body: JSON.stringify({ name: 'Acme Dental' }) })).json();
    assert.equal(r.data.next, `${o}/t/acme-dental/`);
    assert.match(await (await fetch(r.data.next)).text(), /Use Acme Dental from your AI app/);
    assert.match(await (await fetch(`${o}/t/acme-dental/board`)).text(), /Review: approve or send this back/);
    assert.match(await (await fetch(`${o}/t/somebody-else/board`)).text(), /Welcome: drag me to Doing/);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${o}/mcp`)));
    const out = await c.callTool({ name: 'create_board', arguments: { name: 'Birch Law' } });
    assert.match(out.content[0].text, /t\/birch-law/);
  } finally {
    s.close();
  }
});
