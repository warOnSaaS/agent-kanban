// The connect page (/), the connect script (/connect) and the demo board.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Workspace } from '../lib/workspace.mjs';
import { FsStore, DemoStore } from '../lib/store.mjs';
import { connectScript, claudeInstallLink, safeHost } from '../lib/connect.mjs';
import { serve } from '../dev.mjs';

const EXAMPLE = new URL('../example-workspace', import.meta.url).pathname;
let team, demo, teamBase, demoBase, tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-connect-'));
  team = await serve(new Workspace(new FsStore(EXAMPLE), { name: 'Acme Ops' }));
  demo = await serve(new Workspace(new DemoStore(EXAMPLE), { name: 'Example Co', demo: true }));
  teamBase = `http://localhost:${team.address().port}`;
  demoBase = `http://localhost:${demo.address().port}`;
});
after(() => { team.close(); demo.close(); fs.rmSync(tmp, { recursive: true }); delete process.env.CHATGPT_GPT_URL; });

const get = (url) => fetch(url).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: await r.text() }));

test('the connect page shows one tile per app, with the Claude link prefilled and no em dashes', async () => {
  const r = await get(`${teamBase}/`);
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  for (const app of ['Claude', 'Claude Code', 'Codex', 'Browser']) assert.match(r.text, new RegExp(`<h2 id="app-[\\w-]+-t">${app}</h2>`));
  assert.ok(r.text.includes(claudeInstallLink('Acme Ops', `${teamBase}/mcp`).replace(/&/g, '&amp;')));
  assert.match(r.text, /connectorUrl=http%3A%2F%2Flocalhost%3A\d+%2Fmcp/);
  assert.ok(r.text.includes(`curl -fsSL ${teamBase}/connect/claude | sh`));
  assert.ok(r.text.includes(`curl -fsSL ${teamBase}/connect/codex | sh`));
  assert.ok(!r.text.includes('\u2014'));
  assert.doesNotMatch(r.text, /Demo board/);
});

test('the ChatGPT tile shows only when the instance sets CHATGPT_GPT_URL to a ChatGPT link', async () => {
  delete process.env.CHATGPT_GPT_URL;
  assert.doesNotMatch((await get(`${teamBase}/`)).text, /id="app-chatgpt"/);
  process.env.CHATGPT_GPT_URL = 'https://evil.example/g/x';
  assert.doesNotMatch((await get(`${teamBase}/`)).text, /id="app-chatgpt"/);
  process.env.CHATGPT_GPT_URL = 'https://chatgpt.com/g/g-abc123-acme-ops';
  const r = await get(`${teamBase}/`);
  assert.match(r.text, /id="app-chatgpt"/);
  assert.ok(r.text.includes('href="https://chatgpt.com/g/g-abc123-acme-ops"'));
  delete process.env.CHATGPT_GPT_URL;
});

test('the connect script carries this board address and is plain text', async () => {
  const all = await get(`${teamBase}/connect`);
  assert.equal(all.status, 200);
  assert.match(all.type, /text\/plain/);
  assert.ok(all.text.startsWith('#!/bin/sh'));
  assert.ok(all.text.includes(`URL='${teamBase}/mcp'`));
  assert.ok(all.text.includes("APPS='claude codex'"));
  assert.ok(all.text.trimEnd().endsWith('main "$@"'), 'runs only once fully downloaded');
  assert.ok((await get(`${teamBase}/connect/codex`)).text.includes("APPS='codex'"));
  assert.equal((await get(`${teamBase}/connect/other`)).status, 404);
  assert.ok(!all.text.includes('\u2014'));
});

test('odd Host headers never reach the page or the script', () => {
  assert.equal(safeHost("https://x.example';rm -rf ~;'"), null);
  assert.equal(safeHost('https://x.example/path'), null);
  assert.equal(safeHost('https://board.acme.example'), 'https://board.acme.example');
});

// Fake claude and codex on PATH that keep their servers in a file, like the real ones keep a config.
function fakeApps(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, 'servers');
  fs.writeFileSync(cfg, '');
  const common = `cfg='${cfg}'; echo "$(basename "$0") $*" >> '${dir}/calls'\n`;
  fs.writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\n${common}case "$2" in
  get) line=$(grep "^claude $3 " "$cfg") || exit 1; echo "$3:"; echo "  URL: \${line##* }"; case "$line" in *authed*) echo '  Status: ✔ Connected';; *) echo '  Status: ! Needs authentication';; esac ;;
  add) echo "claude $7 $8" >> "$cfg" ;;
  login) sed -i.bak "s|^claude $3 \\(.*\\)$|claude $3 authed \\1|" "$cfg" ;;
esac\n`);
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\n${common}case "$2" in
  get) line=$(grep "^codex $3 " "$cfg") || exit 1; echo "  url: \${line##* }" ;;
  add) echo "codex $3 $5" >> "$cfg" ;;
  list) grep '^codex ' "$cfg" | while read -r _ n u; do echo "$n  $u  enabled  OAuth"; done ;;
esac\n`);
  for (const f of ['claude', 'codex']) fs.chmodSync(path.join(dir, f), 0o755);
  return { calls: () => (fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8') : ''), cfg };
}

const sh = (script, dir, args = []) => execFileSync('sh', ['-s', '--', ...args], { input: script, env: { PATH: `${dir}:/usr/bin:/bin` }, encoding: 'utf8' });

test('the script: dry run changes nothing, a real run adds and signs in, a second run is a no-op', () => {
  const dir = path.join(tmp, 'apps');
  const apps = fakeApps(dir);
  const script = connectScript({ host: 'https://board.acme.example', name: 'Acme Ops' });

  const dry = sh(script, dir, ['--dry-run']);
  assert.match(dry, /Dry run: this shows what would run and changes nothing/);
  assert.match(dry, /\$ claude mcp add --transport http --scope user agent-kanban https:\/\/board\.acme\.example\/mcp/);
  assert.match(dry, /\$ codex mcp add agent-kanban --url https:\/\/board\.acme\.example\/mcp/);
  assert.doesNotMatch(apps.calls(), / add | login /);

  const real = sh(script, dir);
  assert.match(real, /Done\. Open Claude Code and Codex .* type: start/);
  assert.match(apps.calls(), /claude mcp add --transport http --scope user agent-kanban https:\/\/board\.acme\.example\/mcp/);
  assert.match(apps.calls(), /claude mcp login agent-kanban/);
  assert.match(apps.calls(), /codex mcp add agent-kanban --url https:\/\/board\.acme\.example\/mcp/);

  const before = apps.calls();
  const again = sh(script, dir);
  assert.match(again, /Already added as agent-kanban\./);
  assert.doesNotMatch(apps.calls().slice(before.length), / add | login /);
});

test('the script never overwrites another board with the same name', () => {
  const dir = path.join(tmp, 'apps2');
  const apps = fakeApps(dir);
  fs.appendFileSync(apps.cfg, 'claude agent-kanban authed https://other.example/mcp\n');
  const out = sh(connectScript({ host: 'https://board.acme.example', app: 'claude' }), dir);
  assert.match(out, /claude mcp add --transport http --scope user agent-kanban-board-acme-example https:\/\/board\.acme\.example\/mcp/);
  assert.doesNotMatch(apps.calls(), /codex/);
});

test('the script says how to get the app when it is not installed', () => {
  const dir = path.join(tmp, 'none');
  fs.mkdirSync(dir);
  assert.throws(() => sh(connectScript({ host: 'https://board.acme.example', app: 'codex' }), dir), (e) => /Codex is not installed here/.test(e.stdout));
});

test('the demo board: no sign-in, changes stay in memory, the example files stay as they are', async () => {
  const page = await get(`${demoBase}/`);
  assert.match(page.text, /Demo board/);
  assert.equal((await get(`${demoBase}/.well-known/oauth-protected-resource`)).status, 404);
  assert.match((await get(`${demoBase}/board`)).text, /Demo: changes reset/);

  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${demoBase}/mcp`)));
  const call = async (name, args = {}) => (await c.callTool({ name, arguments: args })).content.map((x) => x.text).join('\n');
  assert.match(await call('start'), /Sam/);
  const before = fs.readdirSync(path.join(EXAMPLE, 'clients/acme-dental/tasks')).length;
  await call('add_task', { title: 'Try the demo board', client: 'acme-dental' });
  assert.match(await call('status'), /Try the demo board/);
  assert.equal(fs.readdirSync(path.join(EXAMPLE, 'clients/acme-dental/tasks')).length, before);
  await c.close();
  assert.match((await get(`${demoBase}/privacy`)).text, /public demo board/);
});

test('the demo store resets after a while', async () => {
  const s = new DemoStore(EXAMPLE, { resetAfterMs: 0 });
  await s.write('ideas/x.md', 'hi');
  s.since -= 1;
  assert.equal(await s.read('ideas/x.md'), null);
});
