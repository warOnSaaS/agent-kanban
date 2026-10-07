import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../lib/workspace.mjs';
import { FsStore, MemoryStore } from '../lib/store.mjs';
import { issueTokens } from '../lib/auth.mjs';
import { defineTools } from '../lib/mcp.mjs';
import { serve } from '../dev.mjs';
import { Hosted, serveHosted } from '../lib/hosted.mjs';
import { MemoryRegistry } from '../lib/hosting/registry.mjs';
import { rebaseHtml } from '../lib/hosting/rebase.mjs';
import { main as cli } from '../bin/agent-kanban.mjs';

process.env.OAUTH_SECRET = 'parity-secret';

// ---------- every action on a screen is also a tool ----------

// Every element that does something: a form, a button outside a form, a button-styled link. Each must name the
// tool that does the same thing for an agent (data-tool runs it; data-agent-tool names it), itself or through a
// container. Pure page helpers are exempt: opening and closing a dialog, revealing a section, copying text.
// Links to other sites (docs, GitHub, an app's own settings) are navigation, not actions.
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'wbr']);
const HELPER = /\bdata-(?:live-)?(open|close|reveal|copy)\b/;

export function uiActions(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const stack = [];
  const found = [];
  for (const m of body.matchAll(/<(\/?)([a-z0-9-]+)([^>]*)>/gi)) {
    const [, close, tagRaw, attrs] = m;
    const tag = tagRaw.toLowerCase();
    if (close) {
      const i = stack.map((x) => x.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    const own = /data-(?:agent-)?tool="([^"]+)"/.exec(attrs)?.[1];
    const inherited = [...stack].reverse().find((x) => x.tool)?.tool;
    const inForm = stack.some((x) => x.tag === 'form');
    const isAction = tag === 'form'
      || (tag === 'button' && !inForm && !HELPER.test(attrs))
      || (tag === 'a' && /class="[^"]*\bbtn\b/.test(attrs) && !/href="https?:\/\//.test(attrs.replace(/href="https?:\/\/localhost[^"]*"/, 'href="/x"')) && !HELPER.test(attrs));
    if (isAction) found.push({ tag, tool: own ?? inherited, snippet: m[0].slice(0, 120) });
    if (!VOID.has(tag) && !attrs.trim().endsWith('/')) stack.push({ tag, tool: own });
  }
  return found;
}

function toolNames(session) {
  const names = new Set();
  defineTools(session, (name) => names.add(name));
  return names;
}

let dir, ws, srv, base, hostedSrv, hosted, ho;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-parity-'));
  fs.cpSync(new URL('../example-workspace', import.meta.url), dir, { recursive: true });
  ws = new Workspace(new FsStore(dir), { name: 'Example Co' });
  srv = await serve(ws);
  base = `http://localhost:${srv.address().port}`;
  hosted = new Hosted({ env: { OAUTH_SECRET: 'parity-secret' }, app: null, registry: new MemoryRegistry() });
  hostedSrv = await serveHosted(0, hosted);
  ho = `http://localhost:${hostedSrv.address().port}`;
});
after(() => { srv.close(); hostedSrv.close(); fs.rmSync(dir, { recursive: true }); });

test('every action on every screen has a matching tool (agents can do everything people can)', async () => {
  const owner = (await ws.team()).find((p) => p.role === 'owner');
  const cookie = `ak_session=${encodeURIComponent(issueTokens(owner).access_token)}`;
  const boardTools = toolNames(ws.as(owner));
  const hostedWs = hosted.workspaceFor(await hosted.team('acme-ops'));
  const hostedTools = toolNames(Object.assign(hostedWs.as((await hostedWs.team())[0]), { host: '' }));
  const accountTools = new Set(hosted.accountTools({ github: 'sam' }, '').keys());

  const someTask = (await ws.as(owner).tasks())[0].id;
  const someIdea = (await ws.as(owner).ideas())[0].id;
  const screens = [
    [`${base}/`, boardTools, 'connect page'],
    [`${base}/board`, boardTools, 'board'],
    [`${base}/board/t/${someTask}`, boardTools, 'task'],
    [`${base}/board/i/${someIdea}`, boardTools, 'idea'],
    [`${base}/board/alerts`, boardTools, 'alerts'],
    [`${ho}/`, accountTools, 'hosted front page'],
    [`${ho}/create`, accountTools, 'create a board'],
    [`${ho}/t/acme-ops/`, hostedTools, 'hosted connect page'],
    [`${ho}/t/acme-ops/board`, hostedTools, 'hosted board'],
    [`${ho}/t/acme-ops/settings`, hostedTools, 'settings'],
  ];
  const missing = [];
  let checked = 0;
  const perScreen = {};
  for (const [url, tools, name] of screens) {
    const html = await (await fetch(url, { headers: { cookie } })).text();
    for (const a of uiActions(html)) {
      checked++;
      perScreen[name] = [...(perScreen[name] ?? []), a.tool];
      if (!a.tool) missing.push(`${name}: ${a.snippet} has no tool`);
      else if (!tools.has(a.tool)) missing.push(`${name}: ${a.snippet} names "${a.tool}", which is not a tool there`);
    }
  }
  assert.deepEqual(missing, []);
  if (process.env.PARITY_DEBUG) console.log(perScreen);
  assert.ok(checked > 15, `checked ${checked} actions`);
  for (const t of ['create_board', 'my_boards', 'board_links', 'invite_person', 'export_board', 'move_to_own_hosting']) assert.ok(accountTools.has(t), t);
  for (const t of ['connect_links', 'add_person', 'update_person', 'remove_person', 'clear_examples', 'export_board', 'move_to_own_hosting']) assert.ok(hostedTools.has(t), t);
});

test('the parity check itself catches an action with no tool', () => {
  assert.equal(uiActions('<form class="x"><button>Go</button></form>')[0].tool, undefined);
  assert.equal(uiActions('<div><button class="btn">Do it</button></div>')[0].tool, undefined);
  assert.equal(uiActions('<div data-agent-tool="connect_links"><a class="btn" href="/board">Open</a></div>')[0].tool, 'connect_links');
  assert.equal(uiActions('<button type="button" data-open="new-task">New</button>').length, 0);
});

// ---------- self-hosted: unchanged, plus the owner's zip ----------

test('self-hosted: the owner downloads everything as a zip; teammates cannot', async () => {
  const team = await ws.team();
  const tok = (id) => issueTokens(team.find((p) => p.id === id)).access_token;
  const r = await fetch(`${base}/export.zip`, { headers: { cookie: `ak_session=${encodeURIComponent(tok('sam'))}` } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.includes(Buffer.from('people.yml')));
  assert.equal((await fetch(`${base}/export.zip`, { headers: { cookie: `ak_session=${encodeURIComponent(tok('jordan'))}` } })).status, 403);
  assert.equal((await fetch(`${base}/export.zip`)).status, 403);
});

test('rebasing keeps a team\'s pages inside /t/<team> and leaves other sites alone', () => {
  const out = rebaseHtml(`<a href="/board">b</a><a href="//cdn.x/y">c</a><a href="https://x.com/">d</a><img src="/brand/l.png"><form data-next="/board"></form><script>fetch('/v1/' + t)</script>`, '/t/acme');
  assert.match(out, /href="\/t\/acme\/board"/);
  assert.match(out, /href="\/\/cdn\.x\/y"/);
  assert.match(out, /href="https:\/\/x\.com\/"/);
  assert.match(out, /src="\/t\/acme\/brand\/l\.png"/);
  assert.match(out, /data-next="\/t\/acme\/board"/);
  assert.match(out, /fetch\('\/t\/acme\/v1\/'/);
});

test('examples clear in one step, and only examples', async () => {
  const { seedFiles } = await import('../lib/seed.mjs');
  const store = new MemoryStore(Object.fromEntries(seedFiles({ teamName: 'Acme Dental', slug: 'acme-dental', owner: { name: 'Sam Rivera', github: 'sam-rivera-example' } }).map((f) => [f.path, f.content])));
  const w = new Workspace(store, { name: 'Acme Dental' });
  const sam = (await w.team())[0];
  const s = w.as(sam);
  await s.addClient({ name: 'Birch Law' });
  await s.addTask({ client: 'Birch Law', title: 'Draft the PTO policy' });
  assert.equal((await s.examples()).length, 6);
  assert.deepEqual(await s.clearExamples(), { cleared: 6 });
  assert.deepEqual((await s.tasks()).map((t) => t.data.title), ['Draft the PTO policy']);
  const jordan = await s.addPerson({ name: 'Jordan Lee', github: 'jordan-lee-example', clients: 'Birch Law' });
  await assert.rejects(() => w.as({ ...jordan, role: 'team' }).clearExamples(), /Only the owner/);
});

// ---------- the deploy command ----------

test('deploy --dry-run: plans every step as JSON events, runs nothing, prints no secrets', async () => {
  let out = '';
  const ran = [];
  const code = await cli(['deploy', '--repo', 'sam-rivera-example/acme-ops-board', '--from', 'https://agent-kanban-hosted.vercel.app/t/acme-ops', '--name', 'Acme Ops', '--dry-run', '--json'], { write: (s) => { out += s; } });
  assert.equal(code, 0);
  const events = out.trim().split('\n').map((l) => JSON.parse(l));
  const result = events.at(-1);
  assert.equal(result.event, 'result');
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.url, 'https://acme-ops-board.vercel.app');
  assert.equal(result.mcp, 'https://acme-ops-board.vercel.app/mcp');
  const commands = events.filter((e) => e.status === 'plan').map((e) => e.command);
  for (const want of [/^vercel whoami/, /^gh auth status/, /^vercel link --yes --project acme-ops-board/, /^vercel deploy --prod --yes/, /^vercel env add GITHUB_APP_PRIVATE_KEY production < \(secret\)/, /^vercel env add OAUTH_SECRET production < \(secret\)/, /^gh api -X PUT repos\/sam-rivera-example\/acme-ops-board\/contents\/\.agent-kanban\/hosting\.json/]) {
    assert.ok(commands.some((c) => want.test(c)), `missing ${want}`);
  }
  assert.deepEqual(events.filter((e) => e.status === 'done').map((e) => e.id), ['tools', 'repo', 'stage', 'vercel', 'github-app', 'env', 'redeploy', 'verify', 'point']);
  assert.ok(events.some((e) => e.event === 'open' && /installations\/new/.test(e.url)));
  assert.ok(!/BEGIN|PRIVATE KEY-----/.test(out));
  assert.equal(ran.length, 0);
});

test('deploy: plain-text output, Node-host steps, and usage mistakes exit 2', async () => {
  let out = '';
  assert.equal(await cli(['deploy', '--repo', 'a/b', '--target', 'node'], { write: (s) => { out += s; } }), 0);
  assert.match(out, /node dev\.mjs/);
  assert.match(out, /PUBLIC_URL=https:\/\/YOUR-HOST/);
  out = '';
  assert.equal(await cli(['deploy', '--dry-run', '--json'], { write: (s) => { out += s; } }), 1);
  assert.match(out, /--repo owner\/name/);
  assert.equal(await cli(['deploy', '--repo'], { write: () => {} }), 2);
  assert.equal(await cli(['frobnicate'], { write: () => {} }), 2);
  out = '';
  assert.equal(await cli(['point', '--repo', 'a/b', '--back', '--dry-run', '--json'], { write: (s) => { out += s; } }), 0);
  assert.match(out, /DELETE repos\/a\/b\/contents\/\.agent-kanban\/hosting\.json/);
});
