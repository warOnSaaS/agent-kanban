// The board as a wOS suite app (warOnSaaS/suite, CONTRACTS.md): register(ctx) returns one handler per tool in
// tools.json, keyed board.<name>. Each handler runs the same tool code the standalone board serves at /mcp and
// /v1/<name> (lib/mcp.mjs), for the calling team, as the calling person or agent.
//
// Storage: a board lives in its team's GitHub repo, by design. A team that connected a repo (board.connect_repo,
// or WOS_BOARD_REPO and WOS_BOARD_GITHUB_TOKEN on a one-team server) reads and writes that repo. A team that has
// not (every demo team) keeps the same files in the suite's database (lib/dbstore.mjs), starting from the
// example board, until it connects one.
//
// Standalone (dev.mjs, Vercel, hosted) does not use this file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { Workspace } from './lib/workspace.mjs';
import { GitHubStore } from './lib/store.mjs';
import { DbStore } from './lib/dbstore.mjs';
import { defineTools } from './lib/mcp.mjs';
import { makeActor } from './lib/live.mjs';
import { renderScreen } from './lib/board.mjs';
import { seal, unseal } from './lib/hosting/seal.mjs';
import { slugify } from './lib/md.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const APP = 'board';

// Tools the suite adds beside the board's own: its screens, and where the team's board is kept.
export const SUITE_TOOLS = {
  render_screen: {
    title: 'Board screen',
    description: 'The board screen at an address inside the app (/, /mine, /client/<client>, /t/<task id>, /i/<idea id>, /alerts, /settings), drawn as HTML, for the wOS screens. Agents use the other board tools instead.',
    shape: { path: z.string().max(300).optional().describe('Address inside the board app, for example /t/website-refresh') },
    scope: 'read',
  },
  board_storage: {
    title: 'Where the board is kept',
    description: 'Where this team\'s board lives: its GitHub repo, or the wOS database until a repo is connected.',
    shape: {},
    scope: 'read',
  },
  connect_repo: {
    title: 'Connect a GitHub repo',
    description: 'Admin only. Keep this team\'s board in a GitHub repo (owner/name) with a token that can write to it. The board then reads and writes that repo. Send disconnect: true to go back to keeping it in wOS.',
    shape: {
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional().describe('owner/name of the repo, for example acme-dental/board'),
      token: z.string().min(10).max(400).optional().describe('A GitHub token with contents read and write on that repo'),
      branch: z.string().max(100).optional().describe('Branch, main by default'),
      disconnect: z.boolean().optional().describe('true to stop using the repo'),
    },
    scope: 'admin',
  },
};

// Owner-only tools in lib/mcp.mjs: admin scope in the suite.
export const ADMIN_TOOLS = new Set(['add_person', 'update_person', 'remove_person', 'clear_examples', 'export_board', 'invite_link', 'add_client', 'move_to_own_hosting']);

const now = () => new Date().toISOString();
const collect = (session) => {
  const tools = new Map();
  defineTools(session, (name, meta, run) => tools.set(name, { ...meta, run }));
  return tools;
};

export default async function register(ctx) {
  const env = (n) => (typeof ctx.env === 'function' ? ctx.env(n) : undefined);
  const seedDir = path.join(HERE, 'example-workspace');
  const host = `${String(ctx.publicUrl ?? '').replace(/\/$/, '')}/a/board`;
  const workspaces = new Map(); // team id -> { ws, key }

  // The key that seals repo tokens at rest: WOS_BOARD_SECRET, or one kept in this app's data folder.
  const secret = (() => {
    if (env('WOS_BOARD_SECRET')) return env('WOS_BOARD_SECRET');
    try {
      const f = path.join(ctx.dataDir ?? HERE, '.board-key');
      if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      return fs.readFileSync(f, 'utf8').trim();
    } catch { return 'board-unsealed'; }
  })();

  async function settingsOf(teamId) {
    return (await ctx.db.get('SELECT * FROM board_settings WHERE team_id = ?', [teamId])) ?? null;
  }

  async function storeFor(team) {
    const s = await settingsOf(team.id);
    const token = s?.token_sealed ? unseal(s.token_sealed, secret)?.t : null;
    if (s?.repo && token) return { store: new GitHubStore({ repo: s.repo, token, branch: s.branch || 'main' }), key: `repo:${s.repo}:${s.updated_at}`, mode: 'repo', repo: s.repo };
    if (env('WOS_BOARD_REPO') && env('WOS_BOARD_GITHUB_TOKEN')) return { store: new GitHubStore({ repo: env('WOS_BOARD_REPO'), token: env('WOS_BOARD_GITHUB_TOKEN'), branch: 'main' }), key: 'env', mode: 'repo', repo: env('WOS_BOARD_REPO') };
    return { store: new DbStore(ctx.db, team.id, { seedDir }), key: 'db', mode: 'db', repo: null };
  }

  async function workspaceFor(team) {
    const s = await settingsOf(team.id);
    const want = s?.repo ? `repo:${s.repo}:${s.updated_at}` : env('WOS_BOARD_REPO') ? 'env' : 'db';
    const hit = workspaces.get(team.id);
    if (hit && hit.key === want) return hit;
    const st = await storeFor(team);
    const ws = new Workspace(st.store, { name: s?.name || team.name || 'Team board' });
    const entry = { ws, key: st.key, mode: st.mode, repo: st.repo, raw: st.store };
    workspaces.set(team.id, entry);
    return entry;
  }

  // The person acting, as the board knows people: everyone the suite lets in is on the team (the suite checked
  // membership), admin scope makes them an owner. They are added to people.yml the first time, so tasks,
  // hand-offs and alerts can name them.
  async function personFor(ws, call) {
    const uid = call.actor.personId ?? call.actor.id;
    const team = await ws.team().catch(() => []);
    let me = team.find((p) => p.wos === uid);
    if (!me) {
      const f = await ws.store.read('people.yml');
      const doc = YAML.parse(f?.text ?? '') ?? {};
      const people = doc.people ?? [];
      const name = call.actor.kind === 'agent' && call.actor.personId ? (await nameOf(call)) : call.actor.name;
      const taken = (x) => people.some((p) => p.id === x);
      const first = slugify(String(name ?? 'person').split(' ')[0]) || 'person';
      let id = [first, slugify(String(name ?? ''))].find((x) => x && !taken(x));
      for (let n = 2; !id; n++) if (!taken(`${first}-${n}`)) id = `${first}-${n}`;
      me = { id, name: name || 'Someone', role: call.scopes.includes('admin') ? 'owner' : 'team', clients: 'all', wos: uid };
      doc.people = [...people, me];
      await ws.store.write('people.yml', YAML.stringify(doc), { message: `Add ${me.name} to the team`, author: { name: me.name } });
    }
    return { ...me, clients: me.clients ?? 'all', role: call.scopes.includes('admin') ? 'owner' : 'team' };
  }
  async function nameOf(call) {
    try {
      const m = (await ctx.people?.members?.(call.team.id)) ?? [];
      return m.find((x) => x.id === call.actor.personId)?.name ?? call.actor.name;
    } catch { return call.actor.name; }
  }

  async function sessionFor(call) {
    const entry = await workspaceFor(call.team);
    // Each call starts from what the database holds now: another server copy may have written since.
    entry.raw.forget?.();
    const me = await personFor(entry.ws, call);
    const session = entry.ws.as(me);
    session.host = host;
    session.actor = call.actor.kind === 'agent' ? makeActor(me, { via: 'agent', app: 'agent', agent: call.actor.name }) : makeActor(me, { via: 'web' });
    return { session, entry };
  }

  const tools = JSON.parse(fs.readFileSync(path.join(HERE, 'tools.json'), 'utf8')).tools;
  const handlers = {};
  for (const t of tools) {
    const name = t.name.slice(APP.length + 1);
    if (SUITE_TOOLS[name]) continue;
    handlers[t.name] = async (input, call) => {
      const { session, entry } = await sessionFor(call);
      if (name === 'export_board') {
        return { result: `Everything on this board is in Settings, Hosting, Export everything (the board's files are in it).${entry.repo ? ` It is also your GitHub repo: https://github.com/${entry.repo}` : ''}` };
      }
      const tool = collect(session).get(name);
      if (!tool) throw new Error(ADMIN_TOOLS.has(name) ? `Only a team admin can use ${t.name}.` : `No action called ${t.name}.`);
      const parsed = z.object(tool.shape).safeParse(input ?? {});
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
      const out = await tool.run(parsed.data);
      const text = out.content.map((c) => c.text).join('\n');
      if (out.isError) throw new Error(text);
      if (!tool.readOnly) call.emit?.('board.item.changed', { tool: t.name });
      return { result: text };
    };
  }

  handlers['board.render_screen'] = async ({ path: p = '/' } = {}, call) => {
    const { session, entry } = await sessionFor(call);
    const parts = String(p || '/').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    const [a, b] = parts;
    if (a === 'settings') return { title: 'Board settings', current: 'settings', body: settingsBody(entry, call), unread: await session.unreadCount().catch(() => 0), me: session.me.id };
    const opts = a === 't' ? { kind: 't', id: b } : a === 'i' ? { kind: 'i', id: b } : a === 'alerts' ? { kind: 'alerts' } : a === 'mine' ? { view: 'mine' } : a === 'client' ? { client: b } : {};
    const out = await renderScreen(session, opts);
    return { title: out.title, current: out.current, body: out.body, unread: out.unread ?? 0, me: session.me.id, admin: call.scopes.includes('admin') };
  };

  handlers['board.board_storage'] = async (_input, call) => {
    const entry = await workspaceFor(call.team);
    return { result: entry.mode === 'repo' ? `Kept in the GitHub repo ${entry.repo}.` : 'Kept in the wOS database. Connect a GitHub repo to keep it there instead.', mode: entry.mode, repo: entry.repo };
  };

  handlers['board.connect_repo'] = async (input, call) => {
    const by = call.actor.name ?? null;
    if (input.disconnect) {
      await ctx.db.run('DELETE FROM board_settings WHERE team_id = ?', [call.team.id]);
      workspaces.delete(call.team.id);
      call.emit?.('board.item.changed', { tool: 'board.connect_repo' });
      return { result: 'The board is kept in the wOS database again. The repo is left as it is.' };
    }
    if (!input.repo || !input.token) throw new Error('Give the repo (owner/name) and a token that can write to it.');
    const probe = new GitHubStore({ repo: input.repo, token: input.token, branch: input.branch || 'main' });
    let people;
    try { people = await probe.read('people.yml'); } catch (e) { throw new Error(`GitHub did not let us in: ${e.message.slice(0, 160)}`); }
    if (!people) {
      // An empty repo: start it from the board this team already has.
      const cur = await workspaceFor(call.team);
      for (const f of await cur.ws.store.list()) {
        const x = await cur.ws.store.read(f);
        if (x) await probe.write(f, x.text, { message: `Move the board here: ${f}`, author: { name: by ?? 'wOS', email: 'board@wos.example' } });
      }
    }
    const row = [call.team.id, input.repo, input.branch || 'main', seal({ t: input.token }, secret), now(), by];
    const r = await ctx.db.run('UPDATE board_settings SET repo = ?, branch = ?, token_sealed = ?, updated_at = ?, updated_by = ? WHERE team_id = ?', [row[1], row[2], row[3], row[4], row[5], row[0]]);
    if (!r?.changes) await ctx.db.run('INSERT INTO board_settings (team_id, repo, branch, token_sealed, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)', row);
    workspaces.delete(call.team.id);
    call.emit?.('board.item.changed', { tool: 'board.connect_repo' });
    return { result: `The board is now kept in ${input.repo}${people ? '' : ' (copied there from wOS)'}.` };
  };

  return {
    handlers,
    // Everything a team's board has: every file, as it sits in the repo.
    async exportTeam(team) {
      const { ws } = await workspaceFor(team);
      const files = {};
      for (const f of await ws.store.list()) {
        const x = await ws.store.read(f);
        if (x) files[f] = x.text;
      }
      return files;
    },
  };
}

function settingsBody(entry, call) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const admin = call.scopes.includes('admin');
  const where = entry.mode === 'repo'
    ? `<p>This board is kept in the GitHub repo <b>${esc(entry.repo)}</b>. Every task, note and idea is a file there.</p>`
    : '<p>This board is kept in the wOS database for now. Connect a GitHub repo and every task, note and idea becomes a file in it, which you own and can read anywhere.</p>';
  const form = !admin ? '<p class="ak-small">Only a team admin can change this.</p>' : entry.mode === 'repo' && entry.repo
    ? '<form data-tool="connect_repo"><input type="hidden" name="disconnect" value="true"><p class="ak-err form-error"></p><div><button class="ui-btn is-quiet is-sm">Stop using the repo</button></div></form>'
    : `<form data-tool="connect_repo" class="ak-side-form">
  <label class="ui-field"><span>Repo</span><input class="ui-input" name="repo" required placeholder="acme-dental/board"></label>
  <label class="ui-field"><span>Token <small>contents read and write on that repo</small></span><input class="ui-input" name="token" type="password" required autocomplete="off"></label>
  <p class="ak-err form-error"></p><div><button class="ui-btn is-accent is-sm">Connect the repo</button></div></form>`;
  return `<div class="ui-ph"><div><h1>Board settings</h1><p>Where the board is kept</p></div></div>
<section class="ui-card ak-stack">${where}${form}</section>`;
}
