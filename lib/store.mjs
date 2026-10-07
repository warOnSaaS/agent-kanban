import fs from 'node:fs/promises';
import path from 'node:path';

// Two interchangeable backends: the real GitHub repo, and a local folder for tests and dev.

export class GitHubStore {
  // token: a string, or a function returning one (GitHub App tokens expire after an hour).
  constructor({ repo, token, branch = 'main', apiBase = process.env.GITHUB_API_BASE || 'https://api.github.com' }) {
    this.repo = repo;
    this.token = token;
    this.apiBase = apiBase;
    this.branch = branch;
    this.webBase = `https://github.com/${repo}/blob/${branch}/`;
  }

  async api(url, init = {}) {
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    const res = await fetch(`${this.apiBase}/repos/${this.repo}${url}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...init.headers,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  async list() {
    if (!this.tree) {
      const t = await this.api(`/git/trees/${this.branch}?recursive=1`);
      this.tree = (t?.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path);
    }
    return this.tree;
  }

  async read(p) {
    const r = await this.api(`/contents/${encodePath(p)}?ref=${this.branch}`);
    if (!r || Array.isArray(r)) return null;
    return { text: Buffer.from(r.content, 'base64').toString('utf8'), sha: r.sha };
  }

  // Bytes, for images such as a brand logo.
  async readRaw(p) {
    const r = await this.api(`/contents/${encodePath(p)}?ref=${this.branch}`);
    return r && !Array.isArray(r) && r.content ? Buffer.from(r.content, 'base64') : null;
  }

  async write(p, text, { message, author }) {
    const existing = await this.read(p);
    await this.api(`/contents/${encodePath(p)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(text, 'utf8').toString('base64'),
        branch: this.branch,
        sha: existing?.sha,
        author,
      }),
    });
    if (this.tree && !this.tree.includes(p)) this.tree.push(p);
  }

  async delete(p, { message, author }) {
    const existing = await this.read(p);
    if (!existing) return;
    await this.api(`/contents/${encodePath(p)}`, { method: 'DELETE', body: JSON.stringify({ message, sha: existing.sha, branch: this.branch, author }) });
    if (this.tree) this.tree = this.tree.filter((x) => x !== p);
  }
}

export class FsStore {
  constructor(root) {
    this.root = root;
    this.webBase = 'file://' + root + '/';
    this.log = [];
  }

  async list() {
    const out = [];
    const walk = async (dir) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(path.relative(this.root, full).split(path.sep).join('/'));
      }
    };
    await walk(this.root);
    return out.sort();
  }

  async readRaw(p) {
    try {
      return await fs.readFile(path.join(this.root, p));
    } catch {
      return null;
    }
  }

  async read(p) {
    try {
      return { text: await fs.readFile(path.join(this.root, p), 'utf8') };
    } catch {
      return null;
    }
  }

  // Stand-in for the one GitHub API call the join page makes: unknown users are 404 (null), like GitHub.
  async api(url) {
    const user = /\/collaborators\/(.+)$/.exec(url)?.[1];
    this.invited ??= [];
    if (!user || user === 'nosuchuser') return null;
    this.invited.push(user);
    return {};
  }

  async delete(p, { message, author } = {}) {
    if (String(p).split('/').includes('..')) throw new Error('Not a workspace path.');
    await fs.rm(path.join(this.root, p), { force: true });
    this.log.push({ path: p, message, author: author?.name, deleted: true });
  }

  async write(p, text, { message, author }) {
    const full = path.join(this.root, p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, text);
    this.log.push({ path: p, message, author: author?.name });
  }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// The public demo board: the example workspace, read from the files shipped with this repo. Anyone can try it
// without signing in, so nothing is saved for real: changes live in memory for a while, then the board resets.
export class DemoStore extends FsStore {
  constructor(root, { resetAfterMs = 30 * 60_000, maxChanges = 300 } = {}) {
    super(root);
    this.webBase = 'https://github.com/warOnSaaS/agent-kanban/blob/main/example-workspace/';
    this.resetAfterMs = resetAfterMs;
    this.maxChanges = maxChanges;
    this.reset();
  }

  reset() {
    this.changes = new Map();
    this.since = Date.now();
  }

  fresh() {
    if (Date.now() - this.since > this.resetAfterMs || this.changes.size >= this.maxChanges) this.reset();
  }

  async list() {
    this.fresh();
    const files = await super.list();
    return [...new Set([...files, ...this.changes.keys()])].filter((p) => this.changes.get(p) !== null).sort();
  }

  async read(p) {
    this.fresh();
    if (this.changes.get(p) === null) return null;
    return this.changes.has(p) ? { text: this.changes.get(p) } : super.read(p);
  }

  async readRaw(p) {
    if (this.changes.get(p) === null) return null;
    return this.changes.has(p) ? Buffer.from(this.changes.get(p)) : super.readRaw(p);
  }

  async api() {
    return null;
  }

  async write(p, text) {
    this.fresh();
    if (p.split('/').includes('..')) throw new Error('Not a workspace path.');
    this.changes.set(p, String(text).slice(0, 20_000));
  }

  // Deleting in the demo hides the file until the board resets.
  async delete(p) {
    this.fresh();
    this.changes.set(p, null);
  }
}

// Files held in memory, from a starting set: hosted demo teams, and boards built in tests.
export class MemoryStore {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
    this.webBase = '';
    this.log = [];
  }
  async list() { return [...this.files.keys()].sort(); }
  async read(p) { return this.files.has(p) ? { text: String(this.files.get(p)) } : null; }
  async readRaw(p) { return this.files.has(p) ? Buffer.from(String(this.files.get(p))) : null; }
  async api() { return null; }
  async write(p, text, { message, author } = {}) {
    if (String(p).split('/').includes('..')) throw new Error('Not a workspace path.');
    this.files.set(p, String(text));
    this.log.push({ path: p, message, author: author?.name });
  }
  async delete(p, { message, author } = {}) {
    this.files.delete(p);
    this.log.push({ path: p, message, author: author?.name, deleted: true });
  }
}
