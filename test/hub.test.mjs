import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Workspace } from '../lib/workspace.mjs';
import { FsStore } from '../lib/store.mjs';
import { issueTokens } from '../lib/auth.mjs';
import { serve } from '../dev.mjs';

process.env.OAUTH_CLIENT_ID = 'gpt';
process.env.OAUTH_CLIENT_SECRET = 'shh';
process.env.OAUTH_SECRET = 'test-secret';
process.env.GITHUB_OAUTH_CLIENT_ID = 'gh-client';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh-secret';

let srv, dir, base, ws, fakeGithub;
const tokens = {};
// A stand-in for github.com and api.github.com: code "as-<login>" signs in as that GitHub user.
const ghUsers = { 'sam-rivera-example': ['sam@example.com'], 'jordan-lee-example': [], 'riley-gh': ['riley@example.com'], stranger: ['x@example.com'] };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-'));
  fs.cpSync(new URL('../example-workspace', import.meta.url), dir, { recursive: true });
  ws = new Workspace(new FsStore(dir), { name: 'Example Co' });
  srv = await serve(ws);
  base = `http://localhost:${srv.address().port}`;
  for (const p of await ws.team()) if (p.github) tokens[p.id] = issueTokens(p).access_token;

  fakeGithub = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    const j = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (u.pathname === '/login/oauth/access_token') {
      const b = JSON.parse(body || '{}');
      if (b.client_secret !== 'gh-secret' || !String(b.code).startsWith('as-')) return j({ error: 'bad_verification_code' });
      return j({ access_token: `tok-${b.code.slice(3)}` });
    }
    const login = (req.headers.authorization ?? '').replace('Bearer tok-', '');
    if (!(login in ghUsers)) return res.writeHead(401).end();
    if (u.pathname === '/user') return j({ login });
    if (u.pathname === '/user/emails') return j(ghUsers[login].map((email) => ({ email, verified: true })));
    res.writeHead(404).end();
  });
  await new Promise((r) => fakeGithub.listen(0, r));
  process.env.GITHUB_WEB_BASE = process.env.GITHUB_API_BASE = `http://localhost:${fakeGithub.address().port}`;
});
after(() => { srv.close(); fakeGithub.close(); fs.rmSync(dir, { recursive: true }); });

async function as(who) {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens[who]}` } } }));
  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    return { text: r.content.map((x) => x.text).join('\n'), error: !!r.isError };
  };
  return { c, call };
}

const boardAs = (who) => fetch(`${base}/board`, { headers: { cookie: `ak_session=${encodeURIComponent(tokens[who])}` } }).then((r) => r.text());

test('no sign-in, a forged token or an old token gets a 401 that points apps to GitHub sign-in', async () => {
  const post = (auth) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) }, body: '{}' });
  const r = await post();
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata="http:\/\/localhost:\d+\/\.well-known\/oauth-protected-resource"/);
  assert.equal((await post('Bearer forged.token')).status, 401);
  const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.deepEqual(meta.authorization_servers, [base]);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.registration_endpoint, `${base}/oauth/register`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
});
test('owner sees every client, tools listed', async () => {
  const { c, call } = await as('sam');
  const tools = (await c.listTools()).tools.map((t) => t.name);
  for (const t of ['my_day', 'add_task', 'send_alert', 'add_idea', 'search', 'fetch', 'add_client']) assert.ok(tools.includes(t), t);
  const r = await call('list_clients');
  assert.match(r.text, /Acme/);
  assert.match(r.text, /Birch/);
});

test('team members only see their clients and never people.yml or internal', async () => {
  const { c, call } = await as('jordan');
  assert.ok(!(await c.listTools()).tools.some((t) => t.name === 'add_client'));
  const r = await call('list_clients');
  assert.match(r.text, /Acme/);
  assert.doesNotMatch(r.text, /Birch/);
  assert.ok((await call('open_client', { client: 'birch' })).error);
  assert.ok((await call('fetch', { id: 'people.yml' })).error);
  assert.ok((await call('fetch', { id: 'internal/README.md' })).error);
  assert.ok((await call('fetch', { id: 'people/sam/README.md' })).error);
  assert.ok((await call('save_document', { path: 'README.md', content: 'x' })).error);
  assert.ok((await call('save_document', { path: 'clients/birch-law/docs/x.md', content: 'x' })).error);
});

test('assigning a task alerts the new owner, who sees it in my_day', async () => {
  const jordan = await as('jordan');
  const add = await jordan.call('add_task', { client: 'acme', title: 'Draft the onboarding checklist', assignee: 'Sam', due: '2026-10-09', priority: 'high' });
  assert.match(add.text, /owner sam/);
  const sam = await as('sam');
  const day = await sam.call('my_day');
  assert.match(day.text, /Draft the onboarding checklist/);
  assert.match(day.text, /Jordan Lee|jordan/);
  assert.match(day.text, /unread alert/);
  const id = /id: `([^`]+)`/.exec(add.text)[1];
  const upd = await sam.call('update_task', { task: id, status: 'doing', comment: 'Started, using the Birch one as a base' });
  assert.match(upd.text, /doing/);
  const back = await jordan.call('my_alerts');
  assert.match(back.text, /Started, using the Birch one/);
  const again = await jordan.call('my_alerts');
  assert.match(again.text, /No alerts/);
});

test('private notes stay private', async () => {
  const sam = await as('sam');
  await sam.call('add_note', { client: 'Acme Dental', title: 'Fee conversation', body: 'Rate is confidential', private_to: ['sam'] });
  await sam.call('add_note', { client: 'Acme Dental', title: 'Kickoff recap', body: 'Shared with the team' });
  const jordan = await as('jordan');
  const view = await jordan.call('open_client', { client: 'acme' });
  assert.match(view.text, /Kickoff recap/);
  assert.doesNotMatch(view.text, /Fee conversation/);
  const s = await jordan.call('search', { query: 'confidential rate' });
  assert.equal(JSON.parse(s.text).results.length, 0);
  assert.match((await sam.call('open_client', { client: 'acme' })).text, /Fee conversation/);
});

test('ideas board and comments, alerts to everyone, search and fetch', async () => {
  const a1 = await as('casey');
  const idea = await a1.call('add_idea', { title: 'Quarterly HR compliance calendar', body: 'One shared calendar of filing dates per client' });
  const p = /`([^`]+)`/.exec(idea.text)[1];
  const sam = await as('sam');
  assert.match((await sam.call('list_ideas')).text, /Quarterly HR compliance calendar/);
  await sam.call('comment', { item: p, text: 'Love it, start with Acme' });
  assert.match((await a1.call('my_alerts')).text, /Love it/);
  await sam.call('send_alert', { to: 'everyone', message: 'Thursday check-in moved to 2pm' });
  assert.match((await a1.call('my_alerts')).text, /2pm/);
  const s = JSON.parse((await sam.call('search', { query: 'overtime' })).text);
  assert.ok(s.results.length >= 1);
  const f = JSON.parse((await sam.call('fetch', { id: s.results[0].id })).text);
  assert.match(f.text, /overtime/);
});

test('board: sign-in page without a session, the board with one', async () => {
  assert.match(await (await fetch(`${base}/board`)).text(), /SIGN IN WITH GITHUB/);
  const html = await boardAs('sam');
  assert.match(html, /agent-kanban · Sam/);
  assert.match(html, /aria-label="TO DO"/);
  assert.match(html, /Draft the PTO policy/);
  assert.match(html, /Remote work policy/);
  assert.doesNotMatch(html, /text-transform:\s*uppercase/);
  // Client tab: only that client's cards.
  const acme = await fetch(`${base}/board?client=acme-dental`, { headers: { cookie: `ak_session=${encodeURIComponent(tokens.sam)}` } }).then((r) => r.text());
  assert.match(acme, /aria-current="page">Acme Dental/);
  assert.match(acme, /Draft the PTO policy/);
  assert.doesNotMatch(acme, /Remote work policy/);
  // Jordan only has Acme: Birch's cards and tab never show.
  const j = await boardAs('jordan');
  assert.doesNotMatch(j, /Birch Law|Remote work policy/);
});
test('hand off: Jordan logs his finished work and passes the next step to Sam, whose agent picks it up', async () => {
  const jordan = await as('jordan');
  const h = await jordan.call('hand_off', {
    client: 'Acme', title: 'Website rebuild and AI case intake', to: 'Sam',
    what_i_did: 'Rebuilt every page of acmefirm.com and replaced the old intake form with an AI intake. Staging is live.',
    whats_next: 'Walk the managing partner through staging and get sign-off on the intake notice wording.',
    links: ['https://acme-law.vercel.app'], due: '2026-10-12', priority: 'high',
  });
  assert.ok(!h.error, h.text);
  const id = /id `([^`]+)`/.exec(h.text)[1];

  const sam = await as('sam');
  const day = await sam.call('my_day');
  assert.match(day.text, /New for you, not opened yet\n(- .*\n)*- \[todo\] \*\*Website rebuild and AI case intake\*\*/);
  assert.match(day.text, /unread alert/);
  const alerts = await sam.call('my_alerts');
  assert.match(alerts.text, /Next: Walk the managing partner/);

  const task = await sam.call('open_task', { task: id });
  assert.match(task.text, /## Handoff from Jordan Lee to sam/);
  assert.match(task.text, /Rebuilt every page/);
  assert.match(task.text, /acme-law\.vercel\.app/);
  assert.match(task.text, /handed off to sam/);
  assert.match((await sam.call('fetch', { id })).text, /What's next/);

  await sam.call('update_task', { task: id, status: 'doing', comment: 'Booked the walkthrough for Thursday' });
  assert.doesNotMatch((await sam.call('my_day')).text, /Website rebuild and AI case intake\*\*.*Use open_task/);
  assert.match((await jordan.call('my_alerts')).text, /Booked the walkthrough/);
  assert.match(await boardAs('sam'), /<span class="status">(NEW|REVIEW)<\/span>/);
});

test('unassigned, review, unopened, meet to discuss', async () => {
  const sam = await as('sam');
  const jordan = await as('jordan');
  const add = await sam.call('add_task', { client: 'Acme', title: 'Set up payroll export', assignee: 'nobody' });
  assert.match(add.text, /unassigned, up for grabs/);
  const id = /id: `([^`]+)`/.exec(add.text)[1];
  assert.match((await jordan.call('my_day')).text, /Up for grabs \(unassigned\)\n(- .*\n)*- \[todo\] \*\*Set up payroll export\*\*/);
  assert.match((await sam.call('find_tasks', { assignee: 'nobody' })).text, /Set up payroll export/);

  await sam.call('update_task', { task: id, assignee: 'Jordan' });
  let day = (await jordan.call('my_day')).text;
  assert.match(day, /New for you, not opened yet\n(- .*\n)*- \[todo\] \*\*Set up payroll export\*\*/);
  await jordan.call('open_task', { task: id });
  day = (await jordan.call('my_day')).text;
  assert.doesNotMatch(day, /not opened yet\n- \[todo\] \*\*Set up payroll export/);
  assert.match(day, /Set up payroll export/);

  const un = await jordan.call('update_task', { task: id, assignee: 'unassigned' });
  assert.match(un.text, /unassigned/);
  assert.match((await sam.call('my_alerts')).text, /unassigned, up for grabs/);

  const h = await jordan.call('hand_off', { task: id, to: 'sam', what_i_did: 'Scoped it', whats_next: 'Approve the scope', needs: 'review' });
  assert.match(h.text, /for review/);
  await sam.call('open_task', { task: id });
  assert.match((await sam.call('my_day')).text, /Waiting on your review\n(- .*\n)*- \[review\] \*\*Set up payroll export\*\*/);

  const m = await sam.call('meet_to_discuss', { task: id, with: ['Jordan'], owner: 'Jordan', agenda: 'Phase 1 scope' });
  assert.match(m.text, /waiting to meet and discuss/);
  assert.match((await jordan.call('my_day')).text, /Meetings to set up\n(- .*\n)*- \[waiting: meet to discuss\] \*\*Set up payroll export\*\*.*jordan sets it up/);
  assert.match((await jordan.call('my_alerts')).text, /needs a conversation/);
  await jordan.call('meet_to_discuss', { task: id, with: 'sam', when: '2026-10-09 14:00', minutes: 45 });
  assert.match((await sam.call('my_day')).text, /Meetings scheduled\n(- .*\n)*- 2026-10-09 14:00: \*\*Set up payroll export\*\*/);

  await sam.call('update_task', { task: id, status: 'doing' });
  const t = (await sam.call('open_task', { task: id })).text;
  assert.doesNotMatch(t, /meeting_at/);
  assert.match((await sam.call('how_to_use')).text, /.+/);
});

test('sign in with GitHub, the MCP way: register, authorize, GitHub, code + PKCE, token, tools', async () => {
  const cb = 'http://localhost:7777/callback';
  const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [cb] }) })).json();
  assert.ok(reg.client_id);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: cb, state: 'st1', code_challenge: challenge, code_challenge_method: 'S256' });

  // Unregistered redirect and missing PKCE are refused.
  assert.equal((await fetch(`${base}/oauth/authorize?${q.toString().replace(encodeURIComponent(cb), encodeURIComponent('https://evil.example/cb'))}`, { redirect: 'manual' })).status, 400);
  const noPkce = new URLSearchParams(q); noPkce.delete('code_challenge');
  assert.equal((await fetch(`${base}/oauth/authorize?${noPkce}`, { redirect: 'manual' })).status, 400);

  const toGithub = await fetch(`${base}/oauth/authorize?${q}`, { redirect: 'manual' });
  assert.equal(toGithub.status, 302);
  const gh = new URL(toGithub.headers.get('location'));
  assert.equal(gh.pathname, '/login/oauth/authorize');
  assert.equal(gh.searchParams.get('client_id'), 'gh-client');
  assert.equal(gh.searchParams.get('redirect_uri'), `${base}/oauth/github/callback`);

  // GitHub sends Jordan back with a code.
  const back = await fetch(`${base}/oauth/github/callback?code=as-jordan-lee-example&state=${encodeURIComponent(gh.searchParams.get('state'))}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  const app = new URL(back.headers.get('location'));
  assert.equal(app.origin + app.pathname, cb);
  assert.equal(app.searchParams.get('state'), 'st1');

  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const code = app.searchParams.get('code');
  assert.equal((await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: cb, code_verifier: 'wrong' }))).status, 400);
  const tok = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: cb, code_verifier: verifier }))).json();
  assert.ok(tok.access_token && tok.refresh_token);
  const again = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).json();
  assert.ok(again.access_token);

  const c = new Client({ name: 't', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${again.access_token}` } } }));
  const day = await c.callTool({ name: 'my_day', arguments: {} });
  assert.match(day.content[0].text, /# Jordan Lee/);
});

test('the ChatGPT GPT is a fixed client with a secret; REST actions use the same GitHub sign-in', async () => {
  const cb = 'https://chatgpt.com/aip/g-abc/oauth/callback';
  const toGithub = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ client_id: 'gpt', redirect_uri: cb, state: 'g1', response_type: 'code' })}`, { redirect: 'manual' });
  const gh = new URL(toGithub.headers.get('location'));
  const back = await fetch(`${base}/oauth/github/callback?code=as-jordan-lee-example&state=${encodeURIComponent(gh.searchParams.get('state'))}`, { redirect: 'manual' });
  const code = new URL(back.headers.get('location')).searchParams.get('code');
  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  assert.equal((await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: 'gpt', client_secret: 'nope', redirect_uri: cb }))).status, 401);
  const tok = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: 'gpt', client_secret: 'shh', redirect_uri: cb }))).json();
  const act = (name, body, t = tok.access_token) => fetch(`${base}/v1/${name}`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await act('my_day', {}, 'forged.token')).status, 401);
  assert.equal((await act('my_day', {}, tok.refresh_token)).status, 401);
  assert.match((await (await act('my_day', {})).json()).result, /# Jordan Lee/);
  assert.equal((await act('open_client', { client: 'birch' })).status, 400);
  assert.equal((await act('add_client', { name: 'X' })).status, 404);
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(Object.keys(spec.paths).length <= 30);
});

test('GitHub accounts not on the team are turned away and the owner hears about it; email links a new person once', async () => {
  const start = await fetch(`${base}/login?next=/board`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const no = await fetch(`${base}/oauth/github/callback?code=as-stranger&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  assert.equal(no.status, 403);
  assert.match(await no.text(), /not on the Example Co team/);
  const sam = await as('sam');
  assert.match((await sam.call('my_alerts')).text, /@stranger tried to sign in/);

  // Riley has no GitHub username in people.yml yet, only an email. Signing in links them.
  const yes = await fetch(`${base}/oauth/github/callback?code=as-riley-gh&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  assert.equal(yes.status, 302);
  assert.equal(yes.headers.get('location'), '/board');
  assert.match(yes.headers.get('set-cookie'), /ak_session=.*HttpOnly/);
  const people = YAML.parse(fs.readFileSync(path.join(dir, 'people.yml'), 'utf8')).people;
  assert.equal(people.find((p) => p.id === 'riley').github, 'riley-gh');
  assert.match(fs.readFileSync(path.join(dir, 'people.yml'), 'utf8'), /# Who is on the team/);

  // Removing someone from people.yml signs them out everywhere.
  const before = tokens.jordan;
  const yml = fs.readFileSync(path.join(dir, 'people.yml'), 'utf8');
  fs.writeFileSync(path.join(dir, 'people.yml'), yml.replace('github: jordan-lee-example', 'github: jordan-new-account'));
  assert.equal((await fetch(`${base}/v1/my_day`, { method: 'POST', headers: { authorization: `Bearer ${before}`, 'content-type': 'application/json' }, body: '{}' })).status, 401);
  fs.writeFileSync(path.join(dir, 'people.yml'), yml);
});

test('assign by GitHub username', async () => {
  const sam = await as('sam');
  const r = await sam.call('add_task', { client: 'Acme', title: 'Assigned by handle', assignee: '@jordan-lee-example' });
  assert.match(r.text, /owner jordan/);
});
test('whoever handed work over hears the review result, even on a task someone else created', async () => {
  const sam = await as('sam');
  const jordan = await as('jordan');
  const add = await sam.call('add_task', { client: 'Acme', title: 'Draft the PTO policy', assignee: 'Jordan' });
  const id = /id: `([^`]+)`/.exec(add.text)[1];
  await jordan.call('hand_off', { task: id, to: 'Sam', needs: 'review', what_i_did: 'Drafted it', whats_next: 'Approve or mark up' });
  await jordan.call('my_alerts');
  await sam.call('update_task', { task: id, status: 'done', comment: 'Approved, sending to the client' });
  assert.match((await jordan.call('my_alerts')).text, /Approved, sending to the client/);
});

test('short commands: start shows what is assigned and the four commands', async () => {
  const sam = await as('sam');
  const tools = (await sam.c.listTools()).tools;
  assert.ok(tools.some((t) => t.name === 'start' && /types "start"/.test(t.description)));
  assert.ok(tools.some((t) => t.name === 'my_day' && /check tasks/.test(t.description) && /what's assigned to me/.test(t.description)));
  assert.ok(tools.some((t) => t.name === 'hand_off' && /hand off task/.test(t.description)));
  const s = await sam.call('start');
  assert.match(s.text, /Welcome Sam/);
  assert.doesNotMatch(s.text, /_none_/);
  assert.match(s.text, /\*\*check tasks\*\*/);
  assert.match(s.text, /\*\*hand off task\*\*/);
  assert.match(s.text, /\*\*review\*\*/);
});

test('the four commands are MCP prompts', async () => {
  const { c } = await as('sam');
  const names = (await c.listPrompts()).prompts.map((p) => p.name);
  assert.deepEqual(names, ['start', 'check-tasks', 'review', 'new-task', 'assign-task', 'hand-off-task', 'status', 'view-kanban']);
  const p = await c.getPrompt({ name: 'hand-off-task' });
  assert.equal(p.messages[0].content.text, 'hand off task');
});

test('sent back shows up for the original sender, and status shows where everything stands', async () => {
  const sam = await as('sam');
  const jordan = await as('jordan');
  const add = await jordan.call('add_task', { client: 'Acme', title: 'Redesign the contact page', assignee: 'me' });
  const id = /id: `([^`]+)`/.exec(add.text)[1];
  await jordan.call('hand_off', { task: id, to: 'Sam', needs: 'review', what_i_did: 'New layout', whats_next: 'Approve the layout' });
  await sam.call('hand_off', { task: id, to: 'Jordan', what_i_did: 'Reviewed it', whats_next: 'Make the phone number bigger\nThen send it back' });
  const day = (await jordan.call('my_day')).text;
  assert.match(day, /New for you, not opened yet\n(- .*\n)*- \[todo\] \*\*Redesign the contact page\*\*.*SENT BACK by sam\. Next: Make the phone number bigger/);

  const st = (await sam.call('status')).text;
  assert.match(st, /# Where things stand/);
  assert.match(st, /## To do \(\d+\)/);
  assert.match(st, /## Who has what\n(- .*\n)*- \*\*jordan\*\*: \d+ open/);
  assert.match(st, /## Done in the last 2 weeks\n(- .*\n)*- \[done\]/);
  assert.match((await sam.call('status', { client: 'acme' })).text, /Where things stand: acme/);
  const board = await boardAs('sam');
  assert.match(board, /class="kanban"/);
  assert.match(board, /aria-label="DOING"/);
  assert.match(board, /SENT BACK/);
});

test('review pulls in the actual work and asks for a short verdict', async () => {
  const sam = await as('sam');
  const jordan = await as('jordan');
  await jordan.call('save_document', { path: 'clients/acme-dental/docs/pto-policy.md', content: '# PTO policy\n\nEmployees accrue 10 days a year. Carryover: none.' });
  await jordan.call('hand_off', { client: 'Acme', title: 'Draft the PTO policy v2', to: 'Sam', needs: 'review',
    what_i_did: 'Drafted the policy', whats_next: 'Check it allows carryover of 5 days',
    links: ['clients/acme-dental/docs/pto-policy.md', 'http://localhost:9/secret'] });
  const r = (await sam.call('review', { task: 'draft-the-pto-policy-v2' })).text;
  assert.match(r, /# Review: Draft the PTO policy v2/);
  assert.match(r, /## The work itself/);
  assert.match(r, /Carryover: none/);
  assert.doesNotMatch(r, /secret.*HTTP/);
  assert.match(r, /\*\*Ready\*\* or \*\*Not ready\*\*/);
  assert.match(r, /approve, send back, or meet/);
  // With no task named, review takes the next thing waiting on you.
  assert.match((await sam.call('review')).text, /# Review: /);
  // Leaner output: no empty sections anywhere.
  assert.doesNotMatch((await sam.call('my_day')).text, /_none_/);
  assert.doesNotMatch((await sam.call('status')).text, /_none_/);
});

test('create-and-hand-off in one step keeps the hand-off above the history', async () => {
  const jordan = await as('jordan');
  const h = await jordan.call('hand_off', { client: 'Acme', title: 'One step handoff check', to: 'Sam', what_i_did: 'Did the thing', whats_next: 'Check the thing' });
  const id = /id `([^`]+)`/.exec(h.text)[1];
  const body = JSON.parse((await jordan.call('fetch', { id })).text).text;
  assert.ok(body.indexOf('## Handoff') < body.indexOf('## Activity'), body);
  assert.equal(body.match(/## Activity/g).length, 1);
});

test('INSTRUCTIONS.md is one generic file: no secrets, agent identifies itself, then the right path', async () => {
  const v = await (await fetch(`${base}/INSTRUCTIONS.md`)).text();
  assert.match(v, /# Set up Example Co on agent-kanban/);
  assert.match(v, /## Step 0: work out what you are/);
  assert.match(v, /\*\*Agent: start now\.\*\*/);
  // Step 0 lists the four paths; each path's steps appear once, under Step 2.
  assert.match(v, /- \*\*A\. Claude Code or Codex\*\* \(you can run terminal commands\)\n- \*\*B\. The Claude app\*\* \(claude\.ai[^)]*\)\n- \*\*C\. ChatGPT\*\*\n- \*\*D\. Something else\*\*/);
  assert.equal(v.split('Add custom connector').length - 1, 1);
  assert.doesNotMatch(v, /Send, as three lines/);
  assert.match(v, /Claude Code or Codex/);
  assert.ok(v.includes(`claude mcp add --transport http --scope user agent-kanban ${base}/mcp`));
  assert.ok(v.includes(`codex mcp add agent-kanban --url ${base}/mcp`));
  assert.match(v, /codex mcp login agent-kanban/);
  assert.match(v, /\[Claude connector settings\]\(https:\/\/claude\.ai\/settings\/connectors\)/);
  assert.ok(v.includes('```\n   ' + base + '/mcp\n   ```'));
  assert.match(v, /do you have a GitHub account\?/);
  for (const t of Object.values(tokens)) assert.ok(!v.includes(t));
  assert.doesNotMatch(v, /—|calendar/i);
  assert.equal(v, await (await fetch(`${base}/instructions`)).text());
});

test('start offers the review walkthrough when something is waiting', async () => {
  const jordan = await as('jordan');
  await jordan.call('hand_off', { client: 'Acme', title: 'Walkthrough demo', to: 'Sam', needs: 'review', what_i_did: 'Built it', whats_next: 'Approve it', links: ['https://example.com'] });
  const s = (await (await as('sam')).call('start')).text;
  assert.match(s, /sent you something to review: .*Want to see it\?/);
});

test('sees: own hides tasks assigned to anyone else, everywhere', async () => {
  const sam = await as('sam');
  await sam.call('add_task', { client: 'Birch', title: 'Partner compensation review', assignee: 'me' });
  await sam.call('add_task', { client: 'Birch', title: 'Birch intake form refresh', assignee: 'nobody' });
  const casey = await as('casey');
  const st = (await casey.call('status')).text;
  assert.match(st, /Remote work policy/);
  assert.match(st, /Birch intake form refresh/);
  assert.doesNotMatch(st, /Partner compensation review/);
  assert.doesNotMatch((await casey.call('find_tasks', { client: 'Birch' })).text, /Partner compensation/);
  assert.ok(!JSON.parse((await casey.call('search', { query: 'partner compensation' })).text).results.some((r) => r.id.includes('partner-compensation')));
  assert.ok((await casey.call('open_task', { task: 'partner-compensation' })).error);
  assert.doesNotMatch(await boardAs('casey'), /Partner compensation/);
  // Sam (owner) sees it all.
  assert.match((await sam.call('status', { client: 'Birch' })).text, /Partner compensation review/);
});

test('view kanban: the board drawn in the chat, via MCP Apps and ChatGPT widgets, respecting access', async () => {
  const sam = await as('sam');
  const tools = (await sam.c.listTools()).tools;
  const vk = tools.find((t) => t.name === 'view_kanban');
  assert.equal(vk._meta.ui.resourceUri, 'ui://agent-kanban/kanban.html');
  assert.equal(vk._meta['openai/outputTemplate'], 'ui://agent-kanban/kanban-openai.html');
  const res = (await sam.c.listResources()).resources;
  assert.ok(res.some((r) => r.uri === 'ui://agent-kanban/kanban.html' && r.mimeType === 'text/html;profile=mcp-app'));
  assert.ok(res.some((r) => r.uri === 'ui://agent-kanban/kanban-openai.html' && r.mimeType === 'text/html+skybridge'));
  const page = (await sam.c.readResource({ uri: 'ui://agent-kanban/kanban.html' })).contents[0];
  assert.match(page.text, /ui\/initialize/);
  assert.match(page.text, /window\.openai/);
  assert.match(page.text, /\.kanban \{/);

  const r = await sam.c.callTool({ name: 'view_kanban', arguments: {} });
  assert.match(r.structuredContent.html, /class="kanban"/);
  assert.match(r.structuredContent.html, /Draft the PTO policy/);
  assert.match(r.structuredContent.summary, /OPEN/);
  assert.match(r.content[0].text, /\/board/);
  const birch = await sam.c.callTool({ name: 'view_kanban', arguments: { client: 'birch' } });
  assert.match(birch.structuredContent.title, /BIRCH LAW/);
  assert.doesNotMatch(birch.structuredContent.html, /Draft the PTO policy/);

  // Casey (birch only, sees own): no Acme cards, no tasks assigned to others.
  const casey = await as('casey');
  const c = await casey.c.callTool({ name: 'view_kanban', arguments: {} });
  assert.doesNotMatch(c.structuredContent.html, /Acme Dental|Partner compensation/);
  assert.match(c.structuredContent.html, /Remote work policy/);
});

test('personal setup link: owner gets one, it names the person and their GitHub email, and cannot be forged', async () => {
  const sam = await as('sam');
  const r = (await sam.call('invite_link', { person: 'Riley' })).text;
  const url = /(http\S+INSTRUCTIONS\.md\?for=\S+)/.exec(r)[1];
  const v = await (await fetch(url)).text();
  assert.match(v, /You are helping \*\*Riley Chen\*\* join/);
  assert.match(v, /Sign up with \*\*riley@example\.com\*\*/);
  assert.match(v, /Make sure \*\*riley@example\.com\*\* is one of its emails/);
  assert.match(v, /\[github\.com\/signup\]\(https:\/\/github\.com\/signup\)/);
  const forged = await (await fetch(`${base}/INSTRUCTIONS.md?for=${encodeURIComponent('eyJrIjoiaW52aXRlIiwiaWQiOiJyaWxleSJ9.forged')}`)).text();
  assert.doesNotMatch(forged, /riley@example\.com|Riley Chen/);
  assert.match(forged, /You are helping someone join/);
  const jordan = await as('jordan');
  assert.ok(!(await jordan.c.listTools()).tools.some((t) => t.name === 'invite_link'));
});
