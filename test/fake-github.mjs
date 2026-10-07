// A stand-in for github.com and api.github.com, enough for the hosted tests: sign-in, GitHub App tokens,
// installations, creating repos, writing a commit through the git data API, the contents API, zipballs.
// It enforces what matters for isolation: an installation token only reaches the repos in that installation.
import http from 'node:http';
import crypto from 'node:crypto';

export function fakeGithub({ publicKey, clientSecret = 'app-secret' }) {
  const users = {}; // login -> { emails, name, id }
  const installations = {}; // id -> { id, account, type, all, repos: Set, users: Set(logins who can use it) }
  const repos = {}; // full -> { id, owner, name, private, branch, files: Map, sha: string, installation }
  const trees = {};
  const commits = {};
  let n = 1000;
  const seq = () => String(++n);

  const addUser = (login, { emails = [], name } = {}) => (users[login] = { login, emails, name: name ?? login, id: Number(seq()) });
  const addInstallation = ({ id, account, type = 'User', all = false, users: who = [account] }) => (installations[id] = { id, account, type, all, repos: new Set(), users: new Set(who) });
  const addRepo = (full, { files = {}, installation } = {}) => {
    const [owner, name] = full.split('/');
    const r = { id: Number(seq()), owner, name, full, private: true, branch: 'main', files: new Map(Object.entries(files)), sha: `c${seq()}`, installation };
    repos[full] = r;
    commits[r.sha] = { tree: `t${r.sha}` };
    trees[`t${r.sha}`] = new Map(r.files);
    if (installation) installations[installation].repos.add(full);
    return r;
  };

  const verifyJwt = (tok) => {
    const [h, p, s] = String(tok).split('.');
    if (!s) return false;
    return crypto.verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'));
  };
  const blobSha = (text) => crypto.createHash('sha1').update(String(text)).digest('hex');

  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const send = (status, obj, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(obj === undefined ? '' : JSON.stringify(obj));
    const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const userOf = () => (auth.startsWith('utok-') ? users[auth.slice(5)] : null);
    const instOf = () => (auth.startsWith('itok-') ? installations[auth.slice(5)] : null);
    const p = u.pathname;
    let m;

    if (p === '/login/oauth/access_token') {
      if (body.client_secret !== clientSecret || !String(body.code).startsWith('as-')) return send(200, { error: 'bad_verification_code' });
      const login = body.code.slice(3);
      if (!users[login]) addUser(login);
      return send(200, { access_token: `utok-${login}`, expires_in: 28800, token_type: 'bearer' });
    }
    if (p === '/user') return userOf() ? send(200, { login: userOf().login, name: userOf().name, id: userOf().id }) : send(401, { message: 'Bad credentials' });
    if (p === '/user/emails') return userOf() ? send(200, userOf().emails.map((email) => ({ email, verified: true }))) : send(401, {});
    if (p === '/user/installations') {
      const me = userOf();
      if (!me) return send(401, {});
      const list = Object.values(installations).filter((i) => i.users.has(me.login));
      return send(200, { total_count: list.length, installations: list.map((i) => ({ id: i.id, account: { login: i.account, id: 1, type: i.type }, repository_selection: i.all ? 'all' : 'selected' })) });
    }
    if ((m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(p))) {
      if (!verifyJwt(auth)) return send(401, { message: 'A JSON web token could not be decoded' });
      if (!installations[m[1]]) return send(404, {});
      return send(201, { token: `itok-${m[1]}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if ((m = /^\/app-manifests\/([^/]+)\/conversions$/.exec(p))) {
      if (m[1] !== 'good-code') return send(404, { message: 'Not Found' });
      return send(201, { id: 77, slug: 'acme-ops-board', client_id: 'Iv1.x', client_secret: 'sec', pem: 'PEM', webhook_secret: null, html_url: 'https://github.com/apps/acme-ops-board', owner: { login: 'sam-rivera-example' } });
    }
    if ((m = /^\/(?:user|orgs\/([^/]+))\/repos$/.exec(p)) && req.method === 'POST') {
      const me = userOf();
      if (!me) return send(403, { message: 'Resource not accessible by integration' });
      const owner = m[1] ?? me.login;
      // GitHub only lets the app's user token create repos where the app is installed.
      if (!Object.values(installations).some((i) => i.account === owner && i.users.has(me.login))) return send(403, { message: 'Resource not accessible by integration' });
      const full = `${owner}/${body.name}`;
      if (repos[full]) return send(422, { message: 'name already exists on this account' });
      const r = addRepo(full, { files: body.auto_init ? { 'README.md': `# ${body.name}\n` } : {} });
      r.private = !!body.private;
      const inst = Object.values(installations).find((i) => i.account === owner);
      if (inst?.all) inst.repos.add(full);
      return send(201, { id: r.id, full_name: full, default_branch: 'main', html_url: `https://github.com/${full}`, private: r.private });
    }
    if ((m = /^\/user\/installations\/(\d+)\/repositories\/(\d+)$/.exec(p)) && req.method === 'PUT') {
      const inst = installations[m[1]];
      const r = Object.values(repos).find((x) => String(x.id) === m[2]);
      if (!inst || !r || !userOf() || !inst.users.has(userOf().login)) return send(404, {});
      inst.repos.add(r.full);
      return send(204);
    }

    m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(p);
    if (!m) return send(404, { message: 'Not Found' });
    const repo = repos[m[1]];
    const rest = m[2] ?? '';
    if (rest === '/installation') {
      if (!verifyJwt(auth)) return send(401, {});
      const inst = repo && Object.values(installations).find((i) => i.repos.has(repo.full));
      return inst ? send(200, { id: inst.id }) : send(404, { message: 'Not Found' });
    }
    // Who may touch this repo: an installation that holds it, or a user who owns it.
    const inst = instOf();
    const allowed = repo && ((inst && inst.repos.has(repo.full)) || (userOf() && userOf().login === repo.owner));
    if (!allowed) return send(404, { message: 'Not Found' });

    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) return send(200, { object: { sha: repo.sha } });
    if ((m = /^\/git\/commits\/(.+)$/.exec(rest)) && req.method === 'GET') return commits[m[1]] ? send(200, { sha: m[1], tree: { sha: commits[m[1]].tree } }) : send(404, {});
    if (rest === '/git/trees' && req.method === 'POST') {
      const t = new Map(trees[body.base_tree] ?? []);
      for (const e of body.tree) t.set(e.path, e.content);
      const sha = `t${seq()}`;
      trees[sha] = t;
      return send(201, { sha });
    }
    if (rest === '/git/commits' && req.method === 'POST') {
      const sha = `c${seq()}`;
      commits[sha] = { tree: body.tree, message: body.message };
      return send(201, { sha });
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && req.method === 'PATCH') {
      repo.sha = body.sha;
      repo.files = new Map(trees[commits[body.sha].tree]);
      return send(200, { object: { sha: body.sha } });
    }
    if ((m = /^\/git\/trees\/([^/]+)$/.exec(rest))) return send(200, { tree: [...repo.files.keys()].map((path) => ({ path, type: 'blob' })) });
    if ((m = /^\/zipball\/(.+)$/.exec(rest))) return res.writeHead(302, { location: `https://codeload.example/${repo.full}/zip?token=temp` }).end();
    if ((m = /^\/contents\/(.+)$/.exec(rest))) {
      const fp = decodeURIComponent(m[1]);
      const cur = repo.files.get(fp);
      if (req.method === 'GET') return cur === undefined ? send(404, { message: 'Not Found' }) : send(200, { content: Buffer.from(cur).toString('base64'), sha: blobSha(cur) });
      if (req.method === 'PUT') {
        if (cur !== undefined && body.sha !== blobSha(cur)) return send(cur !== undefined && !body.sha ? 422 : 409, { message: 'sha mismatch' });
        repo.files.set(fp, Buffer.from(body.content, 'base64').toString('utf8'));
        return send(cur === undefined ? 201 : 200, { content: { sha: blobSha(repo.files.get(fp)) } });
      }
      if (req.method === 'DELETE') {
        if (cur === undefined) return send(404, {});
        repo.files.delete(fp);
        return send(200, {});
      }
    }
    send(404, { message: 'Not Found' });
  });

  return { srv, users, installations, repos, addUser, addInstallation, addRepo, listen: () => new Promise((r) => srv.listen(0, () => r(`http://localhost:${srv.address().port}`))) };
}
