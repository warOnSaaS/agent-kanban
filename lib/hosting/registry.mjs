import fs from 'node:fs/promises';
import path from 'node:path';
import { call } from './github-app.mjs';

// The team registry: which team lives at which address, and where each product keeps that team's data.
// It holds no team data, only pointers, so losing it loses nothing a team owns (each team's repo also
// carries its own pointer in .agent-kanban/board.json, enough to rebuild an entry).
//
// A team (product-agnostic, the start of one warOnSaaS Cloud account):
// {
//   slug: "acme-ops", name: "Acme Ops", created_at, created_by: "<github login>",
//   members: ["<github login>", ...],          cloud-level admins; each product still decides access itself
//   products: {
//     board: { enabled_at, storage: { kind: "github", repo: "owner/name", branch: "main", installation_id: 123 } }
//   },
//   plan: null,      reserved: "self-storage" (their repo or database) or "managed" (we run it, with a margin)
//   billing: null,   reserved for the billing account, once there is one
// }
//
// Backends: GitHubRegistry (a private repo owned by warOnSaaS: free, versioned, exportable with git clone),
// FsRegistry (a folder, for tests and a single machine), MemoryRegistry (the demo).

export const RESERVED = new Set(['api', 'app', 'admin', 'create', 'new', 'login', 'logout', 'oauth', 'github', 'mcp', 'settings', 'static', 'assets', 'www', 'help', 'docs', 't', 'cloud', 'billing', 'demo']);
export const validSlug = (s) => typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s) && !s.includes('--') && !RESERVED.has(s);
export const slugFor = (name) => String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');

export function newTeam({ slug, name, createdBy, product, storage }) {
  return {
    slug, name, created_at: new Date().toISOString(), created_by: createdBy,
    members: [createdBy].filter(Boolean),
    products: { [product]: { enabled_at: new Date().toISOString(), storage } },
    plan: null,
    billing: null,
  };
}

class Cached {
  constructor() { this.cache = new Map(); }
  async get(slug) {
    if (!validSlug(slug)) return null;
    const hit = this.cache.get(slug);
    if (hit && hit.until > Date.now()) return hit.team;
    const team = await this.load(slug);
    this.cache.set(slug, { team, until: Date.now() + (team ? 60_000 : 5_000) });
    return team;
  }
  // A free slug based on `want`: acme-ops, acme-ops-2, ...
  async freeSlug(want) {
    const base = validSlug(want) ? want : `team-${want || 'new'}`.slice(0, 40).replace(/-$/, '');
    for (let n = 1; n < 50; n++) {
      const s = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
      if (validSlug(s) && !(await this.load(s))) return s;
    }
    throw new Error('Could not find a free address for that name. Try another.');
  }
  forget(slug) { this.cache.delete(slug); }
}

export class MemoryRegistry extends Cached {
  constructor(teams = []) {
    super();
    this.teams = new Map(teams.map((t) => [t.slug, t]));
  }
  async load(slug) { return this.teams.get(slug) ?? null; }
  async create(team) {
    if (this.teams.has(team.slug)) throw new SlugTaken(team.slug);
    this.teams.set(team.slug, structuredClone(team));
    return team;
  }
  async update(slug, fn) {
    const t = this.teams.get(slug);
    if (!t) throw new Error(`No team ${slug}`);
    const next = fn(structuredClone(t));
    this.teams.set(slug, next);
    this.forget(slug);
    return next;
  }
  async listFor(login) {
    const lc = String(login).toLowerCase();
    return [...this.teams.values()].filter((t) => t.members.some((m) => m.toLowerCase() === lc));
  }
}

export class FsRegistry extends Cached {
  constructor(dir) { super(); this.dir = dir; }
  file(slug) { return path.join(this.dir, 'teams', `${slug}.json`); }
  async load(slug) {
    try { return JSON.parse(await fs.readFile(this.file(slug), 'utf8')); } catch { return null; }
  }
  async create(team) {
    await fs.mkdir(path.dirname(this.file(team.slug)), { recursive: true });
    try {
      await fs.writeFile(this.file(team.slug), JSON.stringify(team, null, 2), { flag: 'wx' });
    } catch (e) {
      if (e.code === 'EEXIST') throw new SlugTaken(team.slug);
      throw e;
    }
    return team;
  }
  async update(slug, fn) {
    const t = await this.load(slug);
    if (!t) throw new Error(`No team ${slug}`);
    const next = fn(t);
    await fs.writeFile(this.file(slug), JSON.stringify(next, null, 2));
    this.forget(slug);
    return next;
  }
  async listFor(login) {
    const lc = String(login).toLowerCase();
    let names = [];
    try { names = await fs.readdir(path.join(this.dir, 'teams')); } catch { return []; }
    const all = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => this.load(n.slice(0, -5))));
    return all.filter((t) => t && t.members.some((m) => m.toLowerCase() === lc));
  }
}

// teams/<slug>.json, plus members/<login>.json listing that person's teams so "my boards" is one read.
// Creating a file that already exists fails at GitHub, which is what keeps two teams off one address.
export class GitHubRegistry extends Cached {
  constructor({ repo, token, branch = 'main' }) {
    super();
    this.repo = repo;
    this.token = token; // a function returning a token
    this.branch = branch;
  }
  async read(p) {
    const r = await call(`/repos/${this.repo}/contents/${p}?ref=${this.branch}`, await this.token());
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Team registry unavailable (GitHub ${r.status})`);
    return { json: JSON.parse(Buffer.from(r.body.content, 'base64').toString('utf8')), sha: r.body.sha };
  }
  async write(p, json, { sha, message }) {
    const r = await call(`/repos/${this.repo}/contents/${p}`, await this.token(), { method: 'PUT', body: { message, branch: this.branch, sha, content: Buffer.from(JSON.stringify(json, null, 2) + '\n').toString('base64') } });
    if (r.status === 422 && !sha) return false;
    if (!r.ok) throw new Error(`Team registry write failed (GitHub ${r.status})`);
    return true;
  }
  async load(slug) { return (await this.read(`teams/${slug}.json`))?.json ?? null; }
  async create(team) {
    if (!(await this.write(`teams/${team.slug}.json`, team, { message: `Add team ${team.slug}` }))) throw new SlugTaken(team.slug);
    for (const m of team.members) await this.addMember(m, team.slug);
    return team;
  }
  async addMember(login, slug) {
    const p = `members/${String(login).toLowerCase()}.json`;
    const cur = await this.read(p);
    const teams = [...new Set([...(cur?.json?.teams ?? []), slug])];
    await this.write(p, { teams }, { sha: cur?.sha, message: `${login}: ${slug}` });
  }
  async update(slug, fn) {
    const cur = await this.read(`teams/${slug}.json`);
    if (!cur) throw new Error(`No team ${slug}`);
    const next = fn(cur.json);
    await this.write(`teams/${slug}.json`, next, { sha: cur.sha, message: `Update team ${slug}` });
    this.forget(slug);
    return next;
  }
  async listFor(login) {
    const idx = await this.read(`members/${String(login).toLowerCase()}.json`);
    const all = await Promise.all((idx?.json?.teams ?? []).map((s) => this.get(s)));
    return all.filter(Boolean);
  }
}

export class SlugTaken extends Error {
  constructor(slug) { super(`The address ${slug} is taken`); this.taken = true; }
}
