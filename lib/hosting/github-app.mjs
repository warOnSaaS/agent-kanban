import crypto from 'node:crypto';

// One GitHub App, registered once, does two jobs:
//   1. Sign-in. Its client id and secret run the same "Sign in with GitHub" screen an OAuth app does.
//   2. Repo access. Installed on a person's account (or one repo), it gets short-lived tokens for the repos
//      it was given, so nobody pastes a token anywhere.
// Product-agnostic: the board and the CRM use it the same way. Nothing here knows what is stored in the repo.

const WEB = () => process.env.GITHUB_WEB_BASE || 'https://github.com';
const API = () => process.env.GITHUB_API_BASE || 'https://api.github.com';
const now = () => Math.floor(Date.now() / 1000);

export class GitHubApp {
  constructor({ appId, privateKey, clientId, clientSecret, slug }) {
    this.appId = String(appId ?? '');
    this.privateKey = String(privateKey ?? '').replace(/\\n/g, '\n');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.slug = slug;
    this.tokens = new Map();
  }

  static fromEnv(env = process.env) {
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
    return new GitHubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY, clientId: env.GITHUB_APP_CLIENT_ID || env.GITHUB_OAUTH_CLIENT_ID, clientSecret: env.GITHUB_APP_CLIENT_SECRET || env.GITHUB_OAUTH_CLIENT_SECRET, slug: env.GITHUB_APP_SLUG });
  }

  // The app proves who it is with a 9-minute JWT signed by its private key.
  jwt() {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now() - 60, exp: now() + 540, iss: this.appId })}`;
    return `${body}.${crypto.sign('sha256', Buffer.from(body), this.privateKey).toString('base64url')}`;
  }

  // An hour-long token for one installation, cached until five minutes before it runs out.
  async installationToken(installationId) {
    const hit = this.tokens.get(String(installationId));
    if (hit && hit.until > Date.now()) return hit.token;
    const r = await call(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, this.jwt(), { method: 'POST' });
    if (!r.ok) throw new GitHubError(r, 'Could not get access to the repo');
    this.tokens.set(String(installationId), { token: r.body.token, until: Date.parse(r.body.expires_at) - 5 * 60_000 });
    return r.body.token;
  }

  // A token getter for one repo, for stores that need a fresh token per call.
  tokenFor(installationId) {
    return () => this.installationToken(installationId);
  }

  async installationForRepo(repo) {
    const r = await call(`/repos/${repo}/installation`, this.jwt());
    return r.ok ? r.body.id : null;
  }

  // ---------- people ----------

  authorizeUrl({ redirectUri, state }) {
    const u = new URL(`${WEB()}/login/oauth/authorize`);
    u.searchParams.set('client_id', this.clientId ?? '');
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('allow_signup', 'true');
    return u.toString();
  }

  // Where someone adds the app to their account or an organization. GitHub shows the account picker.
  installUrl({ state, targetId } = {}) {
    const u = new URL(`${WEB()}/apps/${this.slug}/installations/${targetId ? 'new/permissions' : 'new'}`);
    if (targetId) u.searchParams.set('target_id', String(targetId));
    if (state) u.searchParams.set('state', state);
    return u.toString();
  }

  async userToken(code, redirectUri) {
    const r = await fetch(`${WEB()}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code, redirect_uri: redirectUri }),
    }).then((x) => x.json()).catch(() => ({}));
    return r.access_token ? { token: r.access_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : null } : null;
  }

  // Accounts where this person can use the app: their own, and organizations that installed it.
  async installationsFor(userToken) {
    const r = await call('/user/installations?per_page=100', userToken);
    if (!r.ok) return [];
    return (r.body.installations ?? []).map((i) => ({ id: i.id, account: i.account?.login, accountId: i.account?.id, type: i.account?.type, all: i.repository_selection === 'all' }));
  }

  // ---------- repos ----------

  // A new private repo in the person's account or organization, made with their own GitHub sign-in so it is
  // theirs from the first second. Name clashes get -2, -3...
  async createRepo(userToken, { owner, isOrg, name, description }) {
    for (let n = 1; n <= 9; n++) {
      const tryName = n === 1 ? name : `${name}-${n}`;
      const r = await call(isOrg ? `/orgs/${owner}/repos` : '/user/repos', userToken, {
        method: 'POST',
        body: { name: tryName, private: true, auto_init: true, description, has_issues: false, has_wiki: false, has_projects: false },
      });
      if (r.ok) return { id: r.body.id, repo: r.body.full_name, branch: r.body.default_branch || 'main', url: r.body.html_url };
      if (r.status !== 422) throw new GitHubError(r, 'GitHub would not create the repo');
    }
    throw new Error(`Every name from ${name} to ${name}-9 is taken in ${owner}. Pick another team name.`);
  }

  // Installs that cover "only selected repositories" need the new repo added. Installs on "all" already have it.
  async addRepoToInstallation(userToken, installationId, repoId) {
    const r = await call(`/user/installations/${installationId}/repositories/${repoId}`, userToken, { method: 'PUT' });
    return r.ok || r.status === 304;
  }

  // Writes many files as one commit (one tree, one commit, one ref move), on top of what is there.
  async seedRepo(token, repo, { branch = 'main', files, message }) {
    let ref;
    for (let i = 0; i < 8; i++) {
      ref = await call(`/repos/${repo}/git/ref/heads/${branch}`, token);
      if (ref.ok) break;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    if (!ref.ok) throw new GitHubError(ref, 'The new repo did not become ready');
    const head = await call(`/repos/${repo}/git/commits/${ref.body.object.sha}`, token);
    if (!head.ok) throw new GitHubError(head, 'Could not read the new repo');
    const tree = await call(`/repos/${repo}/git/trees`, token, { method: 'POST', body: { base_tree: head.body.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) } });
    if (!tree.ok) throw new GitHubError(tree, 'Could not write the starter files');
    const commit = await call(`/repos/${repo}/git/commits`, token, { method: 'POST', body: { message, tree: tree.body.sha, parents: [ref.body.object.sha] } });
    if (!commit.ok) throw new GitHubError(commit, 'Could not write the starter files');
    const moved = await call(`/repos/${repo}/git/refs/heads/${branch}`, token, { method: 'PATCH', body: { sha: commit.body.sha } });
    if (!moved.ok) throw new GitHubError(moved, 'Could not write the starter files');
    return commit.body.sha;
  }
}

// GitHub's own download of a repo: a short-lived link to a zip of the whole thing.
export async function zipballUrl(token, repo, branch = 'main') {
  const r = await fetch(`${API()}/repos/${repo}/zipball/${branch}`, { headers: headers(token), redirect: 'manual' });
  return r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
}

// ---------- registering the app itself (the manifest flow) ----------

// What the app asks for. Hosted: a public app anyone can install, allowed to create repos for them.
// Own hosting: a private app for one team, allowed to read and write its one repo.
export function appManifest({ name, url, callbackUrls, setupUrl, redirectUrl, hosted = false, description }) {
  return {
    name: String(name).slice(0, 34),
    url,
    description,
    public: hosted,
    redirect_url: redirectUrl,
    callback_urls: callbackUrls,
    ...(setupUrl ? { setup_url: setupUrl, setup_on_update: false } : {}),
    request_oauth_on_install: false,
    hook_attributes: { url: `${url.replace(/\/$/, '')}/github/events`, active: false },
    default_permissions: { contents: 'write', metadata: 'read', email_addresses: 'read', ...(hosted ? { administration: 'write' } : {}) },
    default_events: [],
  };
}

// The page GitHub shows to create the app, with everything filled in. org: create it under an organization.
export const manifestFormAction = ({ org, state }) => `${WEB()}/${org ? `organizations/${encodeURIComponent(org)}/` : ''}settings/apps/new?state=${encodeURIComponent(state)}`;

// After the click, GitHub hands back a one-time code; this trades it for the app's id, keys and secrets.
export async function convertManifest(code) {
  const r = await call(`/app-manifests/${encodeURIComponent(code)}/conversions`, null, { method: 'POST' });
  if (!r.ok) throw new GitHubError(r, 'GitHub did not finish creating the app');
  const b = r.body;
  return { appId: String(b.id), slug: b.slug, clientId: b.client_id, clientSecret: b.client_secret, privateKey: b.pem, webhookSecret: b.webhook_secret, url: b.html_url, owner: b.owner?.login };
}

// ---------- bits ----------

const headers = (token) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'warOnSaaS' });

export async function call(path, token, { method = 'GET', body } = {}) {
  const r = await fetch(`${API()}${path}`, { method, headers: { ...headers(token), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { ok: r.ok, status: r.status, body: parsed };
}

export class GitHubError extends Error {
  constructor(r, what) {
    super(`${what} (GitHub ${r.status}${r.body?.message ? `: ${r.body.message}` : ''})`);
    this.status = r.status;
  }
}
