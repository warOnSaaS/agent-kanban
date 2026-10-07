// The board as a wOS suite app: register(ctx) with a stand-in for the suite's context (ctx.db on SQLite in
// memory, with ? placeholders as the suite gives them). Every tool has a handler, a team's board survives a new
// server copy (a second register() on the same database), teams stay apart, screens come back as HTML with
// every action naming a tool, and exportTeam returns the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sqlite = await import('node:sqlite').catch(() => null);
const tools = JSON.parse(fs.readFileSync(new URL('../tools.json', import.meta.url), 'utf8')).tools;
const migration = fs.readFileSync(new URL('../migrations/0001_board.sql', import.meta.url), 'utf8');

function suiteDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(migration);
  const self = {
    dialect: 'sqlite',
    query: async (sql, p = []) => db.prepare(sql).all(...p),
    get: async (sql, p = []) => db.prepare(sql).get(...p),
    run: async (sql, p = []) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
    tx: async (fn) => fn(self),
  };
  return self;
}

const call = (team, { scopes = ['read', 'write', 'delete', 'admin'], actor = { kind: 'person', id: 'usr_riley', name: 'Riley Chen' } } = {}) => {
  const events = [];
  return { actor, team, scopes, via: 'screen', events, emit: (name, data) => events.push({ name, data }), callTool: async () => { throw new Error('no_tool'); } };
};

test('register(ctx): a handler per tool, state kept in the database, teams apart, screens name their tools', { skip: !sqlite && 'needs node:sqlite (Node 22)' }, async () => {
  const { default: register } = await import('../server.mjs');
  const db = suiteDb();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-suite-'));
  const ctx = { db, dataDir, publicUrl: 'http://localhost:8080', env: () => undefined, log: console };
  const app = await register(ctx);
  assert.deepEqual(Object.keys(app.handlers).sort(), tools.map((t) => t.name).sort(), 'one handler per tool in tools.json');

  const acme = { id: 't_acme', slug: 'acme', name: 'Acme Dental' };
  const birch = { id: 't_birch', slug: 'birch', name: 'Birch Law' };
  const c1 = call(acme);
  const added = await app.handlers['board.add_task']({ client: 'acme-dental', title: 'Order new chairs for the lobby', assignee: 'nobody' }, c1);
  assert.match(added.result, /Order new chairs for the lobby/);
  assert.deepEqual(c1.events.map((e) => e.name), ['board.item.changed']);

  // A second server copy on the same database sees it.
  const again = await register(ctx);
  const found = await again.handlers['board.find_tasks']({ client: 'acme-dental' }, call(acme));
  assert.match(found.result, /Order new chairs for the lobby/);
  const id = /id `([^`]+)`/.exec(found.result.split('\n').find((l) => l.includes('Order new chairs for the lobby')))[1];
  await again.handlers['board.update_task']({ task: id, status: 'doing' }, call(acme));
  const opened = await app.handlers['board.open_task']({ task: id }, call(acme));
  assert.match(opened.result, /doing/);

  // Another team has its own board.
  const other = await app.handlers['board.find_tasks']({}, call(birch));
  assert.doesNotMatch(other.result, /Order new chairs for the lobby/);

  // The person was added to the team, as an owner (admin scope).
  const team = await app.handlers['board.team']({}, call(acme));
  assert.match(team.result, /Riley Chen/);
  // A member without admin scope cannot use owner tools.
  await assert.rejects(app.handlers['board.add_client']({ name: 'Birch Law' }, call(acme, { scopes: ['read', 'write'], actor: { kind: 'person', id: 'usr_jo', name: 'Jo Park' } })), /admin/);

  // Screens: HTML, every form names a tool in the catalogue.
  const names = new Set(tools.map((t) => t.name.slice('board.'.length)));
  for (const p of ['/', '/mine', `/t/${id}`, '/alerts', '/settings']) {
    const s = await app.handlers['board.render_screen']({ path: p }, call(acme));
    assert.ok(s.body.length > 50, `screen ${p} has a body`);
    for (const m of s.body.matchAll(/<form[^>]*data-tool="([^"]+)"/g)) assert.ok(names.has(m[1]), `${p}: form tool ${m[1]} is in tools.json`);
  }
  const board = await app.handlers['board.render_screen']({ path: '/' }, call(acme));
  assert.match(board.body, /data-task="/);

  const storage = await app.handlers['board.board_storage']({}, call(acme));
  assert.equal(storage.mode, 'db');

  const files = await app.exportTeam(acme);
  assert.ok(Object.keys(files).some((f) => f.startsWith('clients/acme-dental/tasks/')));
  assert.match(files['people.yml'], /Riley Chen/);
});
