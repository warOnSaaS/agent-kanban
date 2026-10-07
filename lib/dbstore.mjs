// The board's files kept in a SQL database, one team per team_id: the store for a team in the wOS suite that has
// not connected a GitHub repo (every demo team). Same interface as GitHubStore and FsStore (list, read, readRaw,
// write, delete), so the workspace code is unchanged. A team that connects a repo uses GitHubStore instead.
//
// db is the suite's ctx.db: query, get, run with ? placeholders, on Postgres or SQLite.
import fs from 'node:fs';
import path from 'node:path';

const TTL = 800; // another server copy's writes show up within this long
const now = () => new Date().toISOString();

export class DbStore {
  constructor(db, teamId, { seedDir } = {}) {
    this.db = db;
    this.team = teamId;
    this.seedDir = seedDir;
    this.webBase = '';
    this.cache = null;
    this.at = 0;
  }

  async seed() {
    if (this.seeded) return;
    const has = await this.db.get('SELECT path FROM board_files WHERE team_id = ? LIMIT 1', [this.team]);
    if (!has && this.seedDir) {
      const files = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else files.push([path.relative(this.seedDir, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')]);
        }
      };
      walk(this.seedDir);
      for (const [p, text] of files) {
        await this.db.run('INSERT INTO board_files (team_id, path, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (team_id, path) DO NOTHING', [this.team, p, text, now(), 'example']);
      }
    }
    this.seeded = true;
  }

  async all() {
    if (this.cache && Date.now() - this.at < TTL) return this.cache;
    await this.seed();
    const rows = await this.db.query('SELECT path, content FROM board_files WHERE team_id = ?', [this.team]);
    this.cache = new Map(rows.map((r) => [r.path, r.content]));
    this.at = Date.now();
    return this.cache;
  }

  /** Drop what this copy remembers, so the next read sees other copies' writes. */
  forget() { this.cache = null; }

  async list() { return [...(await this.all()).keys()].sort(); }

  async read(p) {
    const m = await this.all();
    return m.has(p) ? { text: m.get(p) } : null;
  }

  async readRaw(p) {
    const f = await this.read(p);
    return f ? Buffer.from(f.text) : null;
  }

  async api() { return null; }

  async write(p, text, { author } = {}) {
    if (String(p).split('/').includes('..')) throw new Error('Not a workspace path.');
    await this.seed();
    const t = String(text);
    const r = await this.db.run('UPDATE board_files SET content = ?, updated_at = ?, updated_by = ? WHERE team_id = ? AND path = ?', [t, now(), author?.name ?? null, this.team, p]);
    if (!r?.changes) await this.db.run('INSERT INTO board_files (team_id, path, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (team_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at', [this.team, p, t, now(), author?.name ?? null]);
    if (this.cache) this.cache.set(p, t);
  }

  async delete(p) {
    await this.db.run('DELETE FROM board_files WHERE team_id = ? AND path = ?', [this.team, p]);
    this.cache?.delete(p);
  }
}
