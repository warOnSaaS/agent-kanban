import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { GitHubApp, appManifest, manifestFormAction, convertManifest } from './github-app.mjs';

// "Move to my own hosting", for any warOnSaaS app whose data lives in a GitHub repo the customer owns.
// It puts a copy of the app on their own Vercel account, pointed at that same repo, sets up GitHub sign-in with
// a GitHub App of their own (two clicks in the browser: Create, Install), and then tells the hosted copy to send
// people to the new address. Their data never moves.
//
// Built as a plain CLI so the wOS Desktop app can run it behind one button: with --json every line on stdout is
// one JSON event (see docs/DESKTOP.md). --dry-run runs nothing at all and prints every command it would run.
//
// The app passes in what is specific to it (`spec`):
//   { name, packageDir, files: [paths to ship], callbackPath, env({ repo, name, url, app, secret }) -> {KEY: value} }

export function makeOutput({ json = false, write = (s) => process.stdout.write(s) } = {}) {
  const emit = (ev) => write(json ? `${JSON.stringify(ev)}\n` : human(ev));
  return {
    emit,
    step: (id, title, status = 'start', extra = {}) => emit({ event: 'step', id, title, status, ...extra }),
    open: (url, why) => emit({ event: 'open', url, why }),
    info: (text) => emit({ event: 'info', text }),
    result: (r) => emit({ event: 'result', ...r }),
  };
}

function human(ev) {
  if (ev.event === 'step') return ev.status === 'start' ? `\n> ${ev.title}\n` : ev.status === 'plan' ? `  $ ${ev.command}\n` : ev.status === 'fail' ? `  Failed: ${ev.error}\n` : ev.status === 'skip' ? `  Skipped: ${ev.reason}\n` : '  Done\n';
  if (ev.event === 'open') return `  Open this in your browser${ev.why ? ` (${ev.why})` : ''}:\n  ${ev.url}\n`;
  if (ev.event === 'info') return `  ${ev.text}\n`;
  if (ev.event === 'result') return ev.ok ? `\nDone. ${ev.message ?? ''}\n${ev.url ? `  New address: ${ev.url}\n` : ''}${ev.mcp ? `  MCP: ${ev.mcp}\n` : ''}` : `\nStopped: ${ev.error}\n`;
  return '';
}

// Runs a command, or in a dry run only shows it. Values marked secret are never printed.
export function makeRunner({ dry, out, cwd: cwd0 }) {
  return async function run(cmd, args, { input, cwd = cwd0, secret = false, quiet = false, allowFail = false } = {}) {
    const shown = [cmd, ...args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' ') + (input != null ? (secret ? ' < (secret)' : ' < (value)') : '');
    if (dry) {
      out.step('command', shown, 'plan', { command: shown });
      return { code: 0, stdout: '', stderr: '' };
    }
    if (!quiet) out.step('command', shown, 'plan', { command: shown });
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('error', (e) => (allowFail ? resolve({ code: 127, stdout, stderr: e.message }) : reject(new Error(`${cmd} is not installed or did not start: ${e.message}`))));
      p.on('close', (code) => (code === 0 || allowFail ? resolve({ code, stdout, stderr }) : reject(new Error(`${cmd} ${args[0] ?? ''} failed: ${(stderr || stdout).trim().split('\n').slice(-3).join(' ')}`))));
      if (input != null) p.stdin.end(input);
      else p.stdin.end();
    });
  };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52);

export async function deploy(spec, opts, { out, run, openUrl = defaultOpen, waitForCode = waitForManifestCode, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const dry = !!opts.dryRun;
  const repo = opts.repo;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Give your workspace repo: --repo owner/name');
  const project = opts.project || slug(`${repo.split('/')[1]}`);
  const scope = opts.scope ? ['--scope', opts.scope] : [];
  const steps = [];
  const step = async (id, title, fn) => {
    out.step(id, title, 'start');
    try {
      const r = await fn();
      out.step(id, title, 'done');
      steps.push({ id, ok: true });
      return r;
    } catch (e) {
      out.step(id, title, 'fail', { error: e.message });
      steps.push({ id, ok: false, error: e.message });
      throw e;
    }
  };

  // 1. Tools
  await step('tools', 'Check Node, the Vercel CLI and the GitHub CLI', async () => {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node 20 or later is needed.');
    await run('vercel', ['whoami', ...scope]);
    await run('gh', ['auth', 'status']);
  });

  // 2. The repo: it must exist and they must be able to change it.
  const info = await step('repo', `Check your workspace repo ${repo}`, async () => {
    const r = await run('gh', ['api', `repos/${repo}`, '--jq', '{admin: .permissions.admin, type: .owner.type, branch: .default_branch, private: .private}']);
    if (dry) return { admin: true, type: 'User', branch: 'main' };
    const j = JSON.parse(r.stdout);
    if (!j.admin) throw new Error(`You need admin rights on ${repo} (it is the board's data).`);
    return j;
  });
  const name = opts.name || (await readBoardName(run, repo, dry)) || repo.split('/')[1];

  // 3. A clean copy of the app to upload.
  const dir = await step('stage', 'Copy the app to upload', async () => {
    const d = dry ? path.join(os.tmpdir(), `${spec.name}-deploy`) : fs.mkdtempSync(path.join(os.tmpdir(), `${spec.name}-deploy-`));
    if (!dry) for (const f of spec.files) fs.cpSync(path.join(spec.packageDir, f), path.join(d, f), { recursive: true });
    return d;
  });

  // 4. Their Vercel project, and a first deploy so the address exists before GitHub is told about it.
  const url = await step('vercel', `Create the Vercel project ${project} and deploy`, async () => {
    await run('vercel', ['link', '--yes', '--project', project, ...scope], { cwd: dir });
    const r = await run('vercel', ['deploy', '--prod', '--yes', ...scope], { cwd: dir });
    if (dry) return opts.url || `https://${project}.vercel.app`;
    return opts.url || (await productionUrl(project, r.stdout));
  });

  // 5. GitHub sign-in and repo access: a GitHub App of their own. Two clicks: Create, then Install on the repo.
  const app = await step('github-app', 'Set up GitHub sign-in (a GitHub App of your own)', async () => {
    if (opts.appId && opts.privateKey && opts.clientId && opts.clientSecret) return { appId: opts.appId, privateKey: opts.privateKey, clientId: opts.clientId, clientSecret: opts.clientSecret, slug: opts.appSlug };
    const org = info.type === 'Organization' ? repo.split('/')[0] : null;
    const manifest = appManifest({ name: `${name} board`.slice(0, 34), url, callbackUrls: [`${url}${spec.callbackPath}`], redirectUrl: 'http://127.0.0.1:{port}/done', hosted: false, description: `Sign-in and repo access for the ${name} board (${spec.name}).` });
    if (dry) {
      out.open(`http://127.0.0.1:<port>/ (submits to ${manifestFormAction({ org, state: '<state>' })})`, 'click Create GitHub App');
      out.open('https://github.com/apps/<your-new-app>/installations/new', `click Install, and pick only ${repo}`);
      return { appId: '<app id>', privateKey: '<private key>', clientId: '<client id>', clientSecret: '<client secret>', slug: '<your-new-app>' };
    }
    const made = await waitForCode({ manifest, org, open: (u) => { out.open(u, 'click Create GitHub App'); if (!opts.noOpen) openUrl(u); } });
    const created = await convertManifest(made.code);
    const install = `https://github.com/apps/${created.slug}/installations/new`;
    out.open(install, `click Install, and pick only ${repo}`);
    if (!opts.noOpen) openUrl(install);
    const gh = new GitHubApp(created);
    for (let i = 0; i < 200; i++) {
      if (await gh.installationForRepo(repo)) return created;
      await sleep(3000);
    }
    throw new Error(`The app was made but not installed on ${repo}. Install it from ${install}, then run this again with --app-id ${created.appId}.`);
  });

  // 6. Settings, then the real deploy.
  await step('env', 'Save the settings in your Vercel project', async () => {
    const env = spec.env({ repo, name, url, app, secret: crypto.randomBytes(32).toString('base64url'), branch: info.branch });
    for (const [k, v] of Object.entries(env)) {
      await run('vercel', ['env', 'rm', k, 'production', '--yes', ...scope], { cwd: dir, allowFail: true, quiet: true });
      await run('vercel', ['env', 'add', k, 'production', ...scope], { cwd: dir, input: v, secret: /SECRET|KEY|TOKEN/.test(k) });
    }
  });
  await step('redeploy', 'Deploy with the settings', async () => {
    await run('vercel', ['deploy', '--prod', '--yes', ...scope], { cwd: dir });
  });
  await step('verify', `Check ${url} answers`, async () => {
    if (dry) return;
    const r = await fetch(`${url}/.well-known/oauth-authorization-server`).catch(() => null);
    if (!r?.ok) throw new Error(`${url} did not answer yet. Open it in a minute; if it still fails, run this again.`);
  });

  // 7. Point the hosted copy at the new address. It reads this file from their repo; deleting it moves them back.
  if (opts.from) {
    await step('point', `Send people from ${opts.from} to ${url}`, async () => pointHosted(run, repo, url, dry));
  }
  if (!dry && dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, dryRun: dry, url, mcp: `${url}/mcp`, connect: `${url}/`, project, repo, steps, message: dry ? 'Dry run: nothing was changed.' : `Your board runs on your own Vercel account now. Your data stayed in ${repo}.` };
}

// Writes (or with to=null removes) .agent-kanban/hosting.json in their repo.
export async function pointHosted(run, repo, to, dry) {
  const p = `repos/${repo}/contents/.agent-kanban/hosting.json`;
  const cur = await run('gh', ['api', p, '--jq', '.sha'], { allowFail: true, quiet: true });
  const sha = cur.code === 0 ? cur.stdout.trim() : '';
  if (!to) {
    if (!sha && !dry) return;
    await run('gh', ['api', '-X', 'DELETE', p, '-f', 'message=Back to hosted', '-f', `sha=${sha || '<sha>'}`]);
    return;
  }
  const content = Buffer.from(`${JSON.stringify({ moved_to: to, moved_at: new Date().toISOString() }, null, 2)}\n`).toString('base64');
  await run('gh', ['api', '-X', 'PUT', p, '-f', `message=Moved to ${to}`, '-f', `content=${content}`, ...(sha ? ['-f', `sha=${sha}`] : [])]);
}

async function readBoardName(run, repo, dry) {
  if (dry) return null;
  const r = await run('gh', ['api', `repos/${repo}/contents/.agent-kanban/board.json`, '--jq', '.content'], { allowFail: true, quiet: true });
  try {
    return r.code === 0 ? JSON.parse(Buffer.from(r.stdout.trim(), 'base64').toString()).name : null;
  } catch {
    return null;
  }
}

// The project's own address (https://<project>.vercel.app) when it answers, else the deployment's.
async function productionUrl(project, stdout) {
  const own = `https://${project}.vercel.app`;
  const r = await fetch(own, { method: 'HEAD' }).catch(() => null);
  if (r && r.headers.get('x-vercel-id')) return own;
  const m = /https:\/\/[^\s]+\.vercel\.app/.exec(stdout);
  return m ? m[0] : own;
}

// The manifest flow needs a form posted from a browser. A tiny local page does that, and catches GitHub's reply.
export function waitForManifestCode({ manifest, org, open, timeoutMs = 15 * 60_000 }) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex');
    let body;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname === '/done') {
        if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) return res.writeHead(400).end('This was not the reply we were waiting for. Close this tab and run the command again.');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><title>Done</title><body style="font:16px system-ui;padding:40px"><h1>GitHub App created</h1><p>Back to the terminal (or the app) for the last click.</p></body>');
        srv.close();
        clearTimeout(timer);
        resolve({ code: u.searchParams.get('code') });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
    const timer = setTimeout(() => { srv.close(); reject(new Error('Nobody clicked Create GitHub App within 15 minutes.')); }, timeoutMs);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const m = { ...manifest, redirect_url: `http://127.0.0.1:${port}/done` };
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      body = `<!doctype html><meta charset="utf-8"><title>Create the GitHub App</title><body style="font:16px system-ui;padding:40px"><form method="post" action="${esc(manifestFormAction({ org, state }))}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(m))}"><p>Taking you to GitHub...</p><button>Continue to GitHub</button></form><script>document.forms[0].submit()</script></body>`;
      open(`http://127.0.0.1:${port}/`);
    });
  });
}

function defaultOpen(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* the URL is printed too */ }
}
