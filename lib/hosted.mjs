// Hosted mode: one deployment, many teams. HOSTED=1 turns it on; without it nothing here runs and the board is
// the single-team self-hosted app it always was.
//
//   /                         the front page: Create a board
//   /create                   sign in with GitHub, name the team, pick where the repo goes
//   /mcp                      the account-level MCP server: create_board, my_boards, board_links, invite_person...
//   /v1/<tool>                the same account-level tools over HTTPS (the create page posts here)
//   /github/callback          the one GitHub sign-in return address, for every team (GitHub Apps need one)
//   /github/setup             where GitHub sends people after they install the app on an account
//   /auth/waronsaas           sign in with the warOnSaaS account (AUTH_PROVIDER=waronsaas); /callback is the one
//                             return address for the deployment and every team; the team rides in `carry`
//   /github/connect           with the account: connect GitHub once, so the board's repo can be made in their account
//   /t/<team>/...             one team's board: every self-hosted route, plus /settings
//
// Looking is free: the front page, Create a board, every board and settings page render for a signed-out
// visitor. Doing anything (a tool call) asks for a sign-in: the pages show the account's prompt, the API and
// MCP answer 401 { error: { code: "sign_in" } }.
//
// Each team's data is its own private GitHub repo in its owner's account, reached with the warOnSaaS GitHub
// App's token for that one installation. Each team signs its own tokens and cookies (lib/hosting/context.mjs),
// so nothing issued for one team is accepted by another.
import http from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Workspace } from './workspace.mjs';
import { GitHubStore, FsStore, MemoryStore } from './store.mjs';
import { routeBoard } from './routes.mjs';
import { personFromRequest, issueTokens, sign, verify, json, page, challenge, bodyObject, handleGithubCallback, handleLogin, handleAuthorize, handleToken, handleRegister, resourceMetadata, serverMetadata, sessionCookie, usesAccount, signInError, account, handleAccountLogin, accountDeclined, signInWithProfile, teamOfPath, githubRedirect, safeNext, signOut, ACCOUNT_PATH, ACCOUNT_CALLBACK } from './auth.mjs';
import { runInContext, deriveSecret } from './hosting/context.mjs';
import { rebaseResponse } from './hosting/rebase.mjs';
import { seal, unseal } from './hosting/seal.mjs';
import { meter } from './hosting/meter.mjs';
import { GitHubApp } from './hosting/github-app.mjs';
import { MemoryRegistry, FsRegistry, GitHubRegistry, newTeam, slugFor, validSlug, SlugTaken } from './hosting/registry.mjs';
import { seedFiles } from './seed.mjs';
import { boardLinks, linksText, exportLink, moveCommand, MOVE_LINES } from './links.mjs';
import { homePage, createPage, settingsPage, settingsSignedOutPage, notFoundPage } from './hosted-pages.mjs';

const PRODUCT = 'board';
const DEMO_OWNER = { id: 'sam', name: 'Sam Rivera', github: 'sam-rivera-example' };
const titleCase = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export class Hosted {
  constructor({ env = process.env, app, registry, demo } = {}) {
    this.env = env;
    this.app = app === undefined ? GitHubApp.fromEnv(env) : app;
    this.demo = demo ?? (env.HOSTED_DEMO === '1' || !this.app);
    this.rootSecret = env.OAUTH_SECRET || (this.demo ? 'demo-secret' : null);
    if (!this.rootSecret) throw new Error('OAUTH_SECRET is required in hosted mode');
    this.registry = registry ?? this.registryFromEnv();
    this.demoStores = new Map();
    this.moves = new Map();
  }

  registryFromEnv() {
    const env = this.env;
    if (this.demo) return new MemoryRegistry();
    if (env.HOSTED_REGISTRY_DIR) return new FsRegistry(env.HOSTED_REGISTRY_DIR);
    const repo = env.HOSTED_REGISTRY_REPO;
    if (!repo) throw new Error('HOSTED_REGISTRY_REPO (owner/repo of the team registry) is required in hosted mode');
    let iid = env.HOSTED_REGISTRY_INSTALLATION_ID;
    return new GitHubRegistry({ repo, token: async () => this.app.installationToken((iid ??= await this.app.installationForRepo(repo))) });
  }

  // ---------- contexts ----------

  github(origin) {
    return this.app ? { clientId: this.app.clientId, clientSecret: this.app.clientSecret, callback: `${origin}/github/callback` } : { clientId: '', clientSecret: '', callback: `${origin}/github/callback` };
  }

  rootContext(origin) {
    return { team: null, base: '', origin, secret: deriveSecret(this.rootSecret, 'account'), cookie: { name: 'ak_account', path: '/' }, github: this.github(origin) };
  }

  teamContext(slug, origin) {
    return { team: slug, base: `/t/${slug}`, origin, secret: deriveSecret(this.rootSecret, `team:${slug}`), cookie: { name: 'ak_session', path: `/t/${slug}` }, github: this.github(origin) };
  }

  // The account directory: who someone is at the root, before any team. With GitHub sign-in it is GitHub itself:
  // whoever signs in. With the warOnSaaS account it is the account: { sub, sid, name, email, github_login }.
  // Their GitHub sign-in rides along, sealed, so creating a board right after needs no second trip to GitHub.
  accounts() {
    const secret = deriveSecret(this.rootSecret, 'account-seal');
    return {
      name: 'agent-kanban',
      demo: this.demo,
      team: async () => (this.demo ? [{ ...DEMO_OWNER, role: 'owner' }] : []),
      identify: (p) => {
        const s = p.x ? unseal(p.x, secret) : null;
        return { id: p.id, sub: p.sub, sid: p.sid, github: p.g ?? null, name: s?.name || p.n || p.g || 'you', email: s?.email ?? p.e, n: p.n, e: p.e, x: p.x, gh: s && s.until > Date.now() ? s.t : null };
      },
      // The account signed someone in: that is who they are here. Every account may make boards.
      personByAccount: async (profile) => ({ id: String(profile.sub), sub: profile.sub, github: profile.github_login ?? null, name: profile.name || profile.github_login || profile.email || 'you', email: profile.email_verified !== false ? profile.email : undefined, n: profile.name, e: profile.email_verified !== false ? profile.email : undefined }),
      personByGithub: async (login, emails = [], { token, user } = {}) => ({
        id: String(login).toLowerCase(), github: login, name: user?.name || login, email: emails[0],
        x: token?.access_token ? seal({ t: token.access_token, until: Date.now() + (token.expires_in ? token.expires_in * 1000 : 8 * 3600_000) - 60_000, name: user?.name || login, email: emails[0] }, secret) : undefined,
      }),
      noteUnknownSignIn: async () => {},
      inviteToRepo: async () => {},
    };
  }

  // ---------- teams ----------

  async team(slug) {
    if (!validSlug(slug)) return null;
    const t = await this.registry.get(slug);
    if (t || !this.demo) return t;
    // The preview keeps teams in memory, and a serverless function has many short-lived copies. Any address
    // therefore opens a fresh made-up board, so a link made on one copy still works on the next.
    return newTeam({ slug, name: titleCase(slug), createdBy: DEMO_OWNER.github, product: PRODUCT, storage: { kind: 'memory' } });
  }

  workspaceFor(team) {
    const st = team.products?.[PRODUCT]?.storage;
    if (!st) return null;
    let store;
    if (st.kind === 'github') store = new GitHubStore({ repo: st.repo, branch: st.branch || 'main', token: this.app.tokenFor(st.installation_id) });
    else if (st.kind === 'dir') store = new FsStore(st.dir);
    else {
      if (!this.demoStores.has(team.slug)) {
        const files = seedFiles({ teamName: team.name, slug: team.slug, owner: DEMO_OWNER, hostedUrl: null });
        this.demoStores.set(team.slug, new MemoryStore(Object.fromEntries(files.map((f) => [f.path, f.content]))));
      }
      store = this.demoStores.get(team.slug);
    }
    const ws = new Workspace(store, { name: team.name, demo: st.kind === 'memory' });
    ws.hosting = { slug: team.slug, team };
    return ws;
  }

  // A team that moved to its own hosting says so in its own repo: .agent-kanban/hosting.json { "moved_to": "https://..." }.
  // Their repo, their switch: deleting the file brings them back here.
  async movedTo(ws, slug) {
    const hit = this.moves.get(slug);
    if (hit && hit.until > Date.now()) return hit.to;
    let to = null;
    try {
      const f = await ws.store.read('.agent-kanban/hosting.json');
      const u = f ? new URL(JSON.parse(f.text).moved_to) : null;
      to = u && u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/$/, '') : null;
    } catch {
      to = null;
    }
    this.moves.set(slug, { to, until: Date.now() + 60_000 });
    return to;
  }

  // Someone's place on a team, for the account-level tools: by their account id, GitHub login or email.
  async member(slug, who, origin) {
    const team = await this.team(slug);
    if (!team) throw new Error(`No board called ${slug}. Your boards: call my_boards.`);
    const ws = this.workspaceFor(team);
    const person = this.demo ? (await ws.team()).find((p) => p.role === 'owner') : findPerson(await ws.team(), who);
    if (!person) throw new Error(`You are not on the ${team.name} board.`);
    const session = ws.as(person);
    session.host = `${origin}/t/${slug}`;
    return { team, ws, person, session };
  }

  // ---------- creating a board ----------

  // Returns { slug, url, next } when made, or { next, why } when the person must first do something in GitHub.
  async createBoard(person, { name, account, installationId }, origin) {
    const teamName = String(name ?? '').trim().slice(0, 60);
    if (!teamName) throw new Error('Give the team a name, e.g. "Acme Ops".');
    const slug = await this.registry.freeSlug(slugFor(teamName));

    if (this.demo) {
      await this.registry.create(newTeam({ slug, name: teamName, createdBy: person.github ?? person.id, members: memberKeys(person), product: PRODUCT, storage: { kind: 'memory' } }));
      return { slug, name: teamName, url: `${origin}/t/${slug}`, next: `${origin}/t/${slug}/`, repo: null };
    }

    // The repo is made with the person's own GitHub sign-in, so it is theirs from the first second. With the
    // account, that is a separate one-click step: connect GitHub, then come back here.
    const back = `/create?name=${encodeURIComponent(teamName)}`;
    if (!person.gh) return usesAccount() ? { next: `${origin}/github/connect?next=${encodeURIComponent(back)}`, why: 'github' } : { next: `${origin}${back}`, why: 'sign-in' };
    const installs = await this.app.installationsFor(person.gh);
    const target = account && account !== '*other' ? String(account) : null;
    const inst = installationId
      ? installs.find((i) => String(i.id) === String(installationId))
      : installs.find((i) => i.account?.toLowerCase() === (target ?? person.github).toLowerCase());
    if (!inst) {
      if (installationId) throw new Error('That GitHub installation is not one you can use.');
      const state = runInContext(this.rootContext(origin), () => sign({ k: 'install', n: teamName, exp: Math.floor(Date.now() / 1000) + 3600 }));
      return { open: this.app.installUrl({ state }), why: 'install' };
    }
    const repo = await this.app.createRepo(person.gh, { owner: inst.account, isOrg: inst.type === 'Organization', name: `${slug}-board`, description: `The ${teamName} board on agent-kanban: tasks, notes and ideas, as files you own.` });
    if (!inst.all) await this.app.addRepoToInstallation(person.gh, inst.id, repo.id);
    const token = await this.app.installationToken(inst.id);
    const url = `${origin}/t/${slug}`;
    await this.app.seedRepo(token, repo.repo, { branch: repo.branch, files: seedFiles({ teamName, slug, owner: { name: person.name, github: person.github, email: person.email, account: person.sub }, hostedUrl: url }), message: `Start the ${teamName} board` });
    try {
      await this.registry.create(newTeam({ slug, name: teamName, createdBy: person.github ?? person.id, members: memberKeys(person), product: PRODUCT, storage: { kind: 'github', repo: repo.repo, branch: repo.branch, installation_id: inst.id } }));
    } catch (e) {
      if (e instanceof SlugTaken) throw new Error('Someone took that address a moment ago. Try again: the repo is made, you can delete it on GitHub.');
      throw e;
    }
    return { slug, name: teamName, url, next: `${url}/login?next=${encodeURIComponent('/')}`, repo: repo.repo };
  }

  // ---------- the account-level tools (MCP at /mcp, HTTPS at /v1) ----------

  defineAccountTools(person, origin, register) {
    const reply = (text, data) => ({ content: [{ type: 'text', text }], ...(data ? { structuredContent: data } : {}) });
    const tool = (name, title, description, shape, fn, readOnly = false) => register(name, { title, description, shape, readOnly }, async (args) => {
      try {
        return await fn(args ?? {});
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: e.message }] };
      }
    });
    const board = z.string().describe('The board address name, e.g. "acme-ops" (from my_boards)');

    tool('create_board', 'Create a board', 'Make a new board for a team: a private GitHub repo in their account (or an organization) with them as owner, and a board everyone reaches from their AI app. Use when someone says "make me a board for my team". If GitHub needs a click first (installing the app), it returns the one link to open; after that, call it again.', {
      name: z.string().describe('The team name, e.g. "Acme Ops"'),
      account: z.string().optional().describe('GitHub account or organization to keep the repo in. Defaults to their own.'),
    }, async (a) => {
      const r = await this.createBoard(person, a, origin);
      if (!r.slug) return reply(r.why === 'install'
        ? `One click first: open ${r.open} and install agent-kanban on the account where the board's repo should go (yours, or an organization). Then ask again and the board is made.`
        : r.why === 'github'
          ? `One click first: open ${r.next} and connect your GitHub account, so the board's repo can be made in it. Then ask again and the board is made.`
          : `Sign in with GitHub once more to create it: ${r.next}`, r.why === 'install' ? { open: r.open } : { next: r.next });
      return reply(`Made **${r.name}**. Connect page: ${r.url}/${r.repo ? `\nIts data is in your private repo https://github.com/${r.repo}` : ''}\n\nNext: open the Connect page, pick your app and type start. To add people, use invite_person.`, { slug: r.slug, url: r.url, next: r.next, repo: r.repo });
    });

    tool('my_boards', 'My boards', 'The boards this person made or was added to at the account level, with their addresses.', {}, async () => {
      const list = this.demo ? [] : await this.registry.listFor(memberKeys(person));
      return reply(list.length ? list.map((t) => `- **${t.name}** (\`${t.slug}\`): ${origin}/t/${t.slug}/`).join('\n') : 'No boards yet. Say "make me a board for my team".', { boards: list.map((t) => ({ slug: t.slug, name: t.name, url: `${origin}/t/${t.slug}` })) });
    }, true);

    tool('board_links', 'Board links', 'How to reach one board from each app: the Connect page, the one-click Claude link, the Claude Code and Codex commands, the MCP address.', { board }, async ({ board: slug }) => {
      const team = await this.team(slug);
      if (!team) throw new Error(`No board called ${slug}.`);
      const l = boardLinks(`${origin}/t/${team.slug}`, team.name);
      return reply(`${team.name}:\n${linksText(l)}`, l);
    }, true);

    tool('invite_person', 'Invite someone to a board', 'Owner only. Adds someone to a board and returns their personal setup link. Give their name and GitHub username (or the email on their GitHub account).', {
      board,
      name: z.string(),
      github: z.string().optional(),
      email: z.string().optional(),
      role: z.enum(['team', 'owner']).optional(),
      clients: z.union([z.array(z.string()), z.string()]).optional().describe('Client names, or "all"'),
    }, async ({ board: slug, ...a }) => {
      const m = await this.member(slug, person, origin);
      return runInContext(this.teamContext(m.team.slug, origin), async () => {
        const p = await m.session.addPerson(a);
        const url = `${m.session.host}/INSTRUCTIONS.md?for=${encodeURIComponent(sign({ k: 'invite', id: p.id }))}`;
        return reply(`Added ${p.name} to ${m.team.name}. Send them this setup link; they hand it to their AI app:\n${url}`, { person: p.id, setup_link: url });
      });
    });

    tool('export_board', 'Download a board', 'Owner only. A ten-minute link to a zip of everything on a board. It is also their GitHub repo.', { board }, async ({ board: slug }) => {
      const m = await this.member(slug, person, origin);
      if (m.person.role !== 'owner') throw new Error('Only the owner can download everything.');
      return runInContext(this.teamContext(m.team.slug, origin), async () => {
        const url = exportLink(m.session.host, m.person);
        return reply(`Download (works for ten minutes): ${url}${m.ws.store.repo ? `\nOr the repo itself: https://github.com/${m.ws.store.repo}` : ''}`, { url });
      });
    }, true);

    tool('move_to_own_hosting', 'Move a board to my own hosting', 'Owner only. How to run a board on your own Vercel account instead of ours: the data stays in your GitHub repo, people are sent to the new address. Returns the one command to run.', { board }, async ({ board: slug }) => {
      const m = await this.member(slug, person, origin);
      if (m.person.role !== 'owner') throw new Error('Only the owner can move the board.');
      const cmd = moveCommand({ repo: m.ws.store.repo ?? 'OWNER/REPO', from: m.session.host });
      return reply(`${MOVE_LINES.join('\n')}\n\nRun this on a computer with Node 20 or later (--dry-run shows each step first):\n\`\`\`\n${cmd}\n\`\`\``, { command: cmd });
    }, true);
  }

  accountTools(person, origin) {
    const tools = new Map();
    this.defineAccountTools(person, origin, (name, meta, run) => tools.set(name, { ...meta, run }));
    return tools;
  }

  // ---------- requests ----------

  async handle(req, res) {
    const origin = this.env.HOSTED_ORIGIN?.replace(/\/$/, '') || `${req.headers['x-forwarded-proto'] ?? (this.env.VERCEL ? 'https' : 'http')}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
    // Vercel sends everything to one function with the original path in ?__path=.
    const u = new URL(req.url, 'http://x');
    const p = u.searchParams.get('__path') ?? u.pathname;
    u.searchParams.delete('__path');
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('__')) u.searchParams.delete(k);
    const search = u.searchParams.toString() ? `?${u.searchParams}` : '';
    if (req.query) for (const k of Object.keys(req.query)) if (k.startsWith('__')) delete req.query[k];

    const m = /^\/t\/([^/]+)(\/.*)?$/.exec(p);
    if (m) return this.handleTeam(req, res, decodeURIComponent(m[1]), m[2] ?? '/', search, origin);
    // OAuth discovery with the path after the well-known name (RFC 8414 and 9728): /.well-known/x/t/<team>/mcp
    const wk = /^\/\.well-known\/(oauth-authorization-server|oauth-protected-resource|openid-configuration)\/t\/([^/]+)(\/.*)?$/.exec(p);
    if (wk) return this.handleTeam(req, res, decodeURIComponent(wk[2]), `/.well-known/${wk[1]}`, search, origin);
    req.url = p + search;
    return runInContext(this.rootContext(origin), () => this.handleRoot(req, res, p, origin));
  }

  async handleRoot(req, res, p, origin) {
    const accounts = this.accounts();
    const person = await personFromRequest(accounts, req);
    if (p === '/') {
      const boards = person && !this.demo ? await this.registry.listFor(memberKeys(person)).catch(() => []) : [];
      return html(res, homePage({ origin, signedIn: !!person && !this.demo, boards, demo: this.demo }));
    }
    if (p === '/create') {
      const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
      // With GitHub sign-in the page needs the person first. With the account it shows to everyone and the form
      // asks for a sign-in when sent.
      if (!person && !usesAccount()) return res.writeHead(302, { location: `/login?next=${encodeURIComponent(`/create${name ? `?name=${encodeURIComponent(name)}` : ''}`)}`, 'cache-control': 'no-store' }).end();
      return html(res, createPage({ person, accounts: person ? await this.accountChoices(person) : [], demo: this.demo, name, github: !!person?.gh || !usesAccount() }));
    }
    if (p === '/github/callback') {
      const st = peek(new URL(req.url, 'http://x').searchParams.get('state'));
      if (st?.connect) return this.handleGithubConnect(req, res, person, origin);
      if (st?.t) return this.handleTeam(req, res, String(st.t), '/oauth/github/callback', new URL(req.url, 'http://x').search, origin);
      return handleGithubCallback(req, res, accounts, origin);
    }
    if (p === '/github/connect') {
      // Connect GitHub to a signed-in account, for making the board's repo in their own account.
      const next = safeNext(new URL(req.url, 'http://x').searchParams.get('next'), '/create');
      if (!person) return res.writeHead(302, { location: `${ACCOUNT_PATH}?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' }).end();
      return githubRedirect(res, origin, { web: next, connect: 1 });
    }
    if (p === '/github/setup') return this.handleSetup(req, res, person, origin);
    if (p === ACCOUNT_PATH && usesAccount()) return handleAccountLogin(req, res, origin);
    if (p === ACCOUNT_CALLBACK && usesAccount()) return this.handleAccountCallback(req, res, accounts, origin);
    if (p === '/login') return handleLogin(req, res, origin);
    if (p === '/logout') return signOut(res, { returnTo: `${origin}/`, fallback: '/' });
    if (p === '/mcp') return this.handleAccountMcp(req, res, person, origin);
    if (p.startsWith('/v1/')) return this.handleAccountRest(req, res, person, p.slice(4), origin);
    if (p.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, resourceMetadata(origin), { 'access-control-allow-origin': '*' });
    if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration')) return json(res, 200, serverMetadata(origin), { 'access-control-allow-origin': '*' });
    if (p === '/oauth/authorize') return handleAuthorize(req, res, origin);
    if (p === '/oauth/token') return handleToken(req, res, accounts);
    if (p === '/oauth/register') return handleRegister(req, res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
  }

  async accountChoices(person) {
    if (this.demo) return [{ login: person.github, label: `${person.github} (your account)` }];
    const installs = person.gh ? await this.app.installationsFor(person.gh) : [];
    const own = { login: person.github, label: `${person.github} (your account)` };
    return [own, ...installs.filter((i) => i.account?.toLowerCase() !== person.github.toLowerCase()).map((i) => ({ login: i.account, label: `${i.account} (organization)` }))];
  }

  // After installing the app, GitHub returns here with the installation and our signed state (the team name).
  async handleSetup(req, res, person, origin) {
    const q = new URL(req.url, 'http://x').searchParams;
    const st = verify(q.get('state'), 'install');
    if (!person || !st) return res.writeHead(302, { location: `/create${st?.n ? `?name=${encodeURIComponent(st.n)}` : ''}`, 'cache-control': 'no-store' }).end();
    try {
      const r = await this.createBoard(person, { name: st.n, installationId: q.get('installation_id') }, origin);
      res.writeHead(302, { location: r.next, 'cache-control': 'no-store' }).end();
    } catch (e) {
      page(res, 400, `<h1>The board was not made</h1><p>${escText(e.message)}</p><a class="btn" href="/create">Try again</a>`);
    }
  }

  async handleAccountMcp(req, res, person, origin) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST (this is an MCP endpoint)' }, { allow: 'POST' });
    if (!person) return json(res, 401, usesAccount() ? signInError() : { error: 'Sign in with GitHub to make and manage boards.' }, { 'www-authenticate': challenge(origin) });
    const server = new McpServer({ name: 'agent-kanban', version: '1.0.0' }, { instructions: 'agent-kanban: shared boards for teams and their AI agents. Use create_board when someone wants a board for their team, then share the Connect page it returns. Each board also has its own MCP address (board_links) for day-to-day work. Plain words, one line per item.' });
    this.defineAccountTools(person, origin, (name, { title, description, shape, readOnly }, run) => server.registerTool(name, { title, description, inputSchema: shape, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true } }, run));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body ?? (await bodyObject(req)));
  }

  async handleAccountRest(req, res, person, name, origin) {
    if (!person) return json(res, 401, usesAccount() ? signInError() : { error: 'Sign in with GitHub first.' });
    if (!req.headers.authorization && req.headers['x-requested-with'] !== 'agent-kanban') return json(res, 403, { error: 'Missing request header' });
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
    const t = this.accountTools(person, origin).get(name);
    if (!t) return json(res, 404, { error: `No action called ${name}` });
    const parsed = z.object(t.shape).safeParse(await bodyObject(req));
    if (!parsed.success) return json(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    const out = await t.run(parsed.data);
    const text = out.content.map((c) => c.text).join('\n');
    json(res, out.isError ? 400 : 200, out.isError ? { error: text } : { result: text, data: out.structuredContent });
  }

  async handleTeam(req, res, slug, rest, search, origin) {
    const team = await this.team(slug);
    if (!team) return runInContext(this.rootContext(origin), () => html(res, notFoundPage({ slug }), 404));
    const ws = this.workspaceFor(team);
    if (!ws) return html(res, notFoundPage({ slug }), 404);
    const base = `/t/${team.slug}`;
    const host = `${origin}${base}`;
    meter(team.slug, PRODUCT);
    return runInContext(this.teamContext(team.slug, origin), async () => {
      const moved = ws.demo ? null : await this.movedTo(ws, team.slug);
      if (moved) {
        if (req.method === 'GET' && !rest.startsWith('/v1/') && rest !== '/mcp' && !rest.startsWith('/.well-known/')) return res.writeHead(308, { location: `${moved}${rest}${search}`, 'cache-control': 'no-store' }).end();
        return json(res, 410, { error: `This board moved to ${moved}. Connect your app to ${moved}/mcp instead.` });
      }
      rebaseResponse(res, base);
      req.url = rest + search;
      if (rest === '/settings') return this.handleSettings(req, res, ws, team, host);
      if (await routeBoard(req, res, ws, host, rest)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
    });
  }

  // ---------- the warOnSaaS account ----------

  // The one return address from the account, for the deployment and every team. Where the person started
  // rides in carry (the team) and next (the page); so does a pending MCP authorization (carry.mcp).
  async handleAccountCallback(req, res, accounts, origin) {
    const r = await account().finish(req);
    if (r.error) return accountDeclined(res, r);
    const slug = r.carry?.t ?? teamOfPath(r.next);
    if (!slug) return signInWithProfile(res, accounts, r.profile, { next: r.next, carry: r.carry, clear: r.clear });
    const team = await this.team(slug);
    const ws = team && this.workspaceFor(team);
    if (!ws) return html(res, notFoundPage({ slug }), 404);
    return runInContext(this.teamContext(team.slug, origin), () => signInWithProfile(res, ws, r.profile, { next: r.next, carry: r.carry, clear: r.clear }));
  }

  // Back from GitHub after "connect GitHub": the person's GitHub sign-in is sealed into their account cookie, so
  // the board's repo can be made in their own account. Their account stays who they are.
  async handleGithubConnect(req, res, person, origin) {
    const q = new URL(req.url, 'http://x').searchParams;
    const st = verify(q.get('state'), 'gh');
    const next = safeNext(st?.web, '/create');
    if (!st || !q.get('code')) return page(res, 400, '<h1>That link expired</h1><p>Go back and try again.</p>');
    if (!person) return res.writeHead(302, { location: `${ACCOUNT_PATH}?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' }).end();
    if (!this.app) return res.writeHead(302, { location: next, 'cache-control': 'no-store' }).end();
    const tok = await this.app.userToken(q.get('code'), `${origin}/github/callback`);
    const user = tok && await fetch(`${process.env.GITHUB_API_BASE || 'https://api.github.com'}/user`, { headers: { authorization: `Bearer ${tok.token}`, accept: 'application/vnd.github+json', 'user-agent': 'agent-kanban' } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!user?.login) return page(res, 400, '<h1>GitHub did not connect</h1><p>Try again from the Create page.</p><a class="btn" href="/create">Create a board</a>');
    const secret = deriveSecret(this.rootSecret, 'account-seal');
    const x = seal({ t: tok.token, until: (tok.expiresAt ?? Date.now() + 8 * 3600_000) - 60_000, name: person.name, email: person.email }, secret);
    const t = issueTokens({ ...person, github: user.login, x }, { sid: person.sid, n: person.n, e: person.e });
    res.writeHead(302, { location: next, 'set-cookie': sessionCookie(encodeURIComponent(t.access_token), 30 * 24 * 3600), 'cache-control': 'no-store' }).end();
  }

  async handleSettings(req, res, ws, team, host) {
    const person = await personFromRequest(ws, req);
    if (!person && usesAccount()) return html(res, settingsSignedOutPage({ ws }));
    if (!person) return res.writeHead(302, { location: `/login?next=${encodeURIComponent('/settings')}`, 'cache-control': 'no-store' }).end();
    if (person.role !== 'owner') return page(res, 403, '<h1>Settings are for the owner</h1><p>Ask the board\'s owner to change who is on the team.</p><a class="btn" href="/board">Back to the board</a>');
    const s = ws.as(person);
    const [people, clients] = await Promise.all([ws.team(), s.clients()]);
    html(res, settingsPage({ team, ws, me: person, people, clients, links: boardLinks(host, team.name), repo: ws.store.repo, moveCommand: moveCommand({ repo: ws.store.repo ?? 'OWNER/REPO', from: host }), demo: ws.demo }));
  }
}

// Read a signed state's payload without checking it, only to learn which team's key checks it.
function peek(token) {
  try {
    return JSON.parse(Buffer.from(String(token ?? '').split('.')[0], 'base64url').toString());
  } catch {
    return null;
  }
}

const escText = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The keys a person is known by in the team registry: their account id and their GitHub login.
const memberKeys = (who) => [who?.sub, who?.github].filter(Boolean).map((k) => String(k).toLowerCase());

// Someone on a team's people.yml: by account id, else GitHub login, else verified email.
function findPerson(team, who) {
  const lc = (v) => (v ? String(v).toLowerCase() : null);
  return team.find((p) => who?.sub && p.account === who.sub)
    ?? team.find((p) => who?.github && lc(p.github) === lc(who.github))
    ?? team.find((p) => who?.email && lc(p.email) === lc(who.email))
    ?? null;
}
const html = (res, body, status = 200) => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY' }).end(body);

// ---------- servers ----------

let shared;
export const hostedFromEnv = () => (shared ??= new Hosted());

export async function handleHosted(req, res, hub = hostedFromEnv()) {
  try {
    await hub.handle(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Something went wrong. Try again in a minute.\n');
  }
}

export function serveHosted(port = 0, hub = hostedFromEnv()) {
  const srv = http.createServer((req, res) => handleHosted(req, res, hub));
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

export { issueTokens };
