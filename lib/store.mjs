import fs from 'node:fs/promises';
import path from 'node:path';

// Two interchangeable backends: the real GitHub repo, and a local folder for tests and dev.

export class GitHubStore {
  constructor({ repo, token, branch = 'main' }) {
    this.repo = repo;
    this.token = token;
    this.branch = branch;
    this.webBase = `https://github.com/${repo}/blob/${branch}/`;
  }

  async api(url, init = {}) {
    const res = await fetch(`https://api.github.com/repos/${this.repo}${url}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
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
    return [...new Set([...files, ...this.changes.keys()])].sort();
  }

  async read(p) {
    this.fresh();
    return this.changes.has(p) ? { text: this.changes.get(p) } : super.read(p);
  }

  async readRaw(p) {
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
}
