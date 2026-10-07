// Live updates: who did what (actors), the version pages poll, the feed and its access rules, the
// GitHub version check (cached, conditional, cheap), and the single-function demo router.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Workspace } from '../lib/workspace.mjs';
import { FsStore, GitHubStore } from '../lib/store.mjs';
import { sign } from '../lib/auth.mjs';
import { appOf, actorFor, liveVersion, recentActivity, track, entry, makeActor } from '../lib/live.mjs';
import { route } from '../api/demo.mjs';
import { serve } from '../dev.mjs';

process.env.OAUTH_SECRET = 'test-secret';
let srv, dir, base, ws;
const people = {};
const access = (p, extra = {}) => sign({ k: 'access', id: p.id, g: p.github, exp: Math.floor(Date.now() / 1000) + 3600, ...extra });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-live-'));
  fs.cpSync(new URL('../example-workspace', import.meta.url), dir, { recursive: true });
  ws = new Workspace(new FsStore(dir), { name: 'Example Co' });
  srv = await serve(ws);
  base = `http://localhost:${srv.address().port}`;
  for (const p of await ws.team()) people[p.id] = p;
});
after(() => { srv.close(); fs.rmSync(dir, { recursive: true }); });

async function agent(token, { ua, name = 'test' } = {}) {
  const c = new Client({ name, version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, ...(ua ? { 'user-agent': ua } : {}) } } }));
  return { c, call: async (n, a = {}) => (await c.callTool({ name: n, arguments: a })).content.map((x) => x.text).join('\n') };
}
const live = (who, v = '') => fetch(`${base}/board/live?v=${encodeURIComponent(v)}`, { headers: { cookie: `ak_session=${encodeURIComponent(access(people[who]))}` } }).then((r) => r.json());
const pto = async () => (await ws.as(people.sam).tasks()).find((t) => t.data.title === 'Draft the PTO policy').id;

test('apps are named from what they call themselves', () => {
  assert.equal(appOf('Claude Code (agent-kanban)').agent, 'Claude Code');
  assert.equal(appOf('claude-ai').agent, 'Claude');
  assert.equal(appOf('codex-mcp-client').agent, 'Codex');
  assert.equal(appOf('openai-mcp').agent, 'ChatGPT');
  assert.equal(appOf('GPT').agent, 'GPT');
  assert.equal(appOf(''), null);
  assert.equal(makeActor({ id: 'sam', name: 'Sam Rivera' }, { via: 'agent', agent: 'Claude', app: 'claude' }).label, "Claude (Sam's)");
  assert.equal(makeActor({ id: 'sam', name: 'Sam Rivera' }).label, 'Sam');
  const req = (h) => ({ headers: h });
  assert.equal(actorFor(req({ 'user-agent': 'node' }), people.sam, { channel: 'rest' }).via, 'web');
  assert.equal(actorFor(req({ authorization: `Bearer ${access(people.sam)}`, 'user-agent': 'Mozilla/5.0; ChatGPT-User/1.0' }), people.sam, { channel: 'rest' }).label, "GPT (Sam's)");
  // Stateless MCP: the name given on initialize is remembered for the calls that follow.
  const h = { 'user-agent': 'codex_cli_rs/0.50' };
  actorFor(req(h), people.sam, { body: { method: 'initialize', params: { clientInfo: { name: 'codex-mcp-client' } } } });
  assert.equal(actorFor(req(h), people.sam, { body: { method: 'tools/call', params: {} } }).label, "Codex (Sam's)");
  assert.equal(actorFor(req({}), people.sam, { body: { method: 'tools/call', params: { _meta: { 'openai/userAgent': 'x' } } } }).agent, 'ChatGPT');
  assert.equal(actorFor(req({ 'user-agent': 'node' }), people.sam, { body: {} }).label, "AI app (Sam's)");
});

test('the version endpoint: unchanged answers are tiny, a change from an agent arrives with who did it', async () => {
  const first = await live('sam');
  assert.equal(first.changed, true);
  assert.ok(Array.isArray(first.activity));
  const same = await live('sam', first.v);
  assert.deepEqual(Object.keys(same).sort(), ['changed', 'connected', 'v']);
  assert.equal(same.changed, false);

  const claude = await agent(access(people.sam, { a: 'Claude' }));
  const id = await pto();
  await claude.call('update_task', { task: id, status: 'review' });
  const after = await live('sam', first.v);
  assert.equal(after.changed, true);
  assert.notEqual(after.v, first.v);
  const top = after.activity[0];
  assert.equal(top.label, "Claude (Sam's)");
  assert.equal(top.via, 'agent');
  assert.equal(top.app, 'claude');
  assert.equal(top.verb, 'moved {item} to Review');
  assert.equal(top.item.id, id);
  assert.equal(top.item.href, `/board/t/${id}`);
  assert.ok(after.connected.some((c) => c.label === "Claude (Sam's)"), 'Claude shows as connected');
  await claude.c.close();
});

test('people on the web are recorded as themselves; the feed only shows what each person may see', async () => {
  const id = await pto();
  const r = await fetch(`${base}/v1/update_task`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'agent-kanban', cookie: `ak_session=${encodeURIComponent(access(people.sam))}` }, body: JSON.stringify({ task: id, assignee: 'riley' }) });
  assert.equal(r.status, 200);
  const s = await live('sam');
  assert.equal(s.activity[0].label, 'Sam');
  assert.equal(s.activity[0].via, 'web');
  assert.equal(s.activity[0].verb, 'gave {item} to Riley');

  // A Birch Law change by Claude Code: Sam (owner) sees it, Jordan (Acme only) never does.
  const cc = await agent(access(people.sam), { ua: 'claude-code/2.1.4' });
  await cc.call('add_task', { client: 'birch', title: 'Birch engagement letter' });
  const sam = await live('sam');
  assert.match(sam.activity[0].label, /^Claude Code \(Sam's\)$/);
  assert.equal(sam.activity[0].item.title, 'Birch engagement letter');
  const jordan = await live('jordan');
  assert.ok(!jordan.activity.some((a) => a.item?.title === 'Birch engagement letter'));
  assert.ok(jordan.activity.some((a) => a.verb === 'gave {item} to Riley'), 'Acme changes still show for Jordan');
  // Signed out: a 401, not the sign-in page.
  assert.equal((await fetch(`${base}/board/live`)).status, 401);
  await cc.c.close();
});

test('recent_activity: agents read what other agents did', async () => {
  const codex = await agent(access(people.sam, { a: 'Codex' }));
  const text = await codex.call('recent_activity', { limit: 5 });
  assert.match(text, /Claude Code \(Sam's\) added "Birch engagement letter"/);
  assert.match(text, /Connected now: .*Codex \(Sam's\) \(working\)/);
  await codex.c.close();
});

test('the board page carries the live layer and marks every card', async () => {
  const html = await fetch(`${base}/board`, { headers: { cookie: `ak_session=${encodeURIComponent(access(people.sam))}` } }).then((r) => r.text());
  assert.match(html, /data-live-open/);
  assert.match(html, /id="live-panel"/);
  assert.match(html, /\/board\/live\?v=/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /class="kcard"[^>]*data-item="/);
  assert.doesNotMatch(html, /\u2014/);
});

// A stand-in for the GitHub API that counts calls and honours If-None-Match.
test('GitHub: the version is cached for a moment, then asked with an ETag; the feed comes from commit trailers', async () => {
  let head = 'sha1', calls = { ref: 0, ref304: 0, commits: 0 };
  const a = entry(makeActor(people.sam, { via: 'agent', app: 'claude', agent: 'Claude' }), 'moved {item} to Review', { kind: 'task', id: 't1', title: 'One', href: '/board/t/t1' });
  const gh = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.endsWith('/git/ref/heads/main')) {
      calls.ref++;
      const etag = `"${head}"`;
      if (req.headers['if-none-match'] === etag) { calls.ref304++; return res.writeHead(304).end(); }
      return res.writeHead(200, { 'content-type': 'application/json', etag }).end(JSON.stringify({ object: { sha: head } }));
    }
    if (u.pathname.endsWith('/commits')) {
      calls.commits++;
      return res.writeHead(200, { 'content-type': 'application/json', etag: `"c-${head}"` }).end(JSON.stringify([
        { commit: { message: `Update task: One (Sam Rivera)\n\nActivity: ${JSON.stringify(a)}` } },
        { commit: { message: 'Alert to jordan (Sam Rivera)' } },
      ]));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => gh.listen(0, r));
  process.env.GITHUB_API_BASE = `http://localhost:${gh.address().port}`;
  try {
    const store = new GitHubStore({ repo: 'example/live-test', token: 't' });
    assert.equal(await liveVersion(store), 'sha1');
    assert.equal(await liveVersion(store), 'sha1');
    await Promise.all([liveVersion(store), liveVersion(store), liveVersion(store)]);
    assert.equal(calls.ref, 1, 'many tabs within 1.5 s cost one call');
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(await liveVersion(new GitHubStore({ repo: 'example/live-test', token: 't' })), 'sha1', 'shared across store objects for the same repo');
    assert.equal(calls.ref304, 1, 'an unchanged head is a 304, which GitHub does not count against the rate limit');
    const feed = await recentActivity(store);
    assert.equal(feed.length, 1);
    assert.equal(feed[0].label, "Claude (Sam's)");
    await recentActivity(store);
    assert.equal(calls.commits, 1, 'the commit list is read once per head');
    // A write from this server: the trailer goes in the commit message.
    const writes = [];
    const fake = { repo: 'example/other', write: async (p, t, o) => writes.push(o.message) };
    track(fake);
    await fake.write('x.md', 'x', { message: 'Task: X (Sam Rivera)', activity: a });
    assert.match(writes[0], /^Task: X \(Sam Rivera\)\n\nActivity: \{.*"label":"Claude \(Sam's\)"/);
  } finally {
    gh.close();
    delete process.env.GITHUB_API_BASE;
  }
});

test('the demo runs as one function: vercel.json rewrites map to the same handlers', () => {
  assert.deepEqual(route('/board/t/abc').query, { kind: 't', id: 'abc' });
  assert.deepEqual(route('/board/live').query, { kind: 'live' });
  assert.ok(route('/mcp'));
  assert.deepEqual(route('/v1/update_task').query, { tool: 'update_task' });
  assert.deepEqual(route('/').query, {});
  assert.equal(route('/nope/nope/nope/nope'), null);
});
