#!/usr/bin/env node
// agent-kanban command line. Plain text by default; --json prints one JSON event per line (for the wOS Desktop
// app and other programs, see docs/DESKTOP.md). Exit code 0 on success, 1 on failure, 2 on a usage mistake.
//
//   agent-kanban deploy --repo owner/name [--from https://host/t/team] [--name "Acme Ops"] [--project name]
//                       [--scope vercel-team] [--target vercel|node] [--dry-run] [--json] [--no-open]
//   agent-kanban point --repo owner/name --to https://your-board     (send people from the hosted board to yours)
//   agent-kanban point --repo owner/name --back                      (send them back to the hosted board)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy, makeOutput, makeRunner, pointHosted } from '../lib/hosting/deploy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// What is specific to agent-kanban; lib/hosting/deploy.mjs does the rest and is shared with other apps.
export const SPEC = {
  name: 'agent-kanban',
  packageDir: ROOT,
  files: ['api', 'lib', 'example-workspace', 'package.json', 'vercel.json', 'dev.mjs', 'LICENSE'],
  callbackPath: '/oauth/github/callback',
  env: ({ repo, name, url, app, secret, branch }) => ({
    WORKSPACE_REPO: repo,
    WORKSPACE_BRANCH: branch || 'main',
    WORKSPACE_NAME: name,
    OAUTH_SECRET: secret,
    GITHUB_APP_ID: app.appId,
    GITHUB_APP_PRIVATE_KEY: app.privateKey,
    GITHUB_OAUTH_CLIENT_ID: app.clientId,
    GITHUB_OAUTH_CLIENT_SECRET: app.clientSecret,
    PUBLIC_URL: url,
  }),
};

const HELP = `agent-kanban: move a board to your own hosting

  agent-kanban deploy --repo OWNER/REPO [--from HOSTED_BOARD_URL]
      Puts the board app on your own Vercel account, using your existing workspace repo.
      Sets up GitHub sign-in with a GitHub App of your own (you click Create, then Install).
      With --from, people using the hosted board are sent to the new address.
      Options: --name "Team name"  --project vercel-project-name  --scope vercel-team
               --target node (prints the steps for any Node host instead)
               --dry-run (changes nothing, shows every step)  --json (one JSON event per line)
               --no-open (print links instead of opening the browser)

  agent-kanban point --repo OWNER/REPO --to URL     send people from the hosted board to URL
  agent-kanban point --repo OWNER/REPO --back       send them back to the hosted board

Needs Node 20+, the Vercel CLI (npm i -g vercel, then vercel login) and the GitHub CLI (gh auth login).
`;

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Usage(`Unexpected "${a}"`);
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (['dryRun', 'json', 'noOpen', 'back', 'yes'].includes(k)) o[k] = true;
    else if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Usage(`--${a.slice(2)} needs a value`);
    else o[k] = rest[++i];
  }
  return o;
}

class Usage extends Error {}

function nodeSteps(o) {
  const repo = o.repo ?? 'OWNER/REPO';
  return [
    'git clone https://github.com/warOnSaaS/agent-kanban && cd agent-kanban && npm install --omit=dev',
    'Create a GitHub App for sign-in: github.com/settings/apps/new. Callback URL: https://YOUR-HOST/oauth/github/callback. Permissions: Contents read and write, Email addresses read. Install it on ' + repo + ' only.',
    `Set: WORKSPACE_REPO=${repo} WORKSPACE_NAME="Your team" OAUTH_SECRET=(a long random string) PUBLIC_URL=https://YOUR-HOST GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET (from the app)`,
    'Run: PORT=3977 node dev.mjs, behind HTTPS (Caddy, nginx or your platform\'s proxy) at YOUR-HOST',
    `Then: agent-kanban point --repo ${repo} --to https://YOUR-HOST`,
  ];
}

export async function main(argv, { write, runner } = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    (write ?? ((s) => process.stderr.write(s)))(`${e.message}\n\n${HELP}`);
    return 2;
  }
  const out = makeOutput({ json: !!o.json, write });
  if (!o.cmd || o.cmd === 'help' || o.help) {
    (write ?? ((s) => process.stdout.write(s)))(HELP);
    return o.cmd && o.cmd !== 'help' ? 2 : 0;
  }
  const run = runner ?? makeRunner({ dry: !!o.dryRun, out });
  try {
    if (o.cmd === 'deploy') {
      if (o.target === 'node') {
        const steps = nodeSteps(o);
        steps.forEach((s, i) => out.info(`${i + 1}. ${s}`));
        out.result({ ok: true, target: 'node', steps, message: 'Those are the steps for any Node host. Your data stays in your repo.' });
        return 0;
      }
      if (o.target && o.target !== 'vercel') throw new Usage('--target is vercel or node');
      out.result(await deploy(SPEC, o, { out, run }));
      return 0;
    }
    if (o.cmd === 'point') {
      if (!o.repo || (!o.to && !o.back)) throw new Usage('point needs --repo and --to URL (or --back)');
      if (o.to && !/^https:\/\//.test(o.to)) throw new Usage('--to must be an https address');
      await pointHosted(run, o.repo, o.back ? null : o.to.replace(/\/$/, ''), !!o.dryRun);
      out.result({ ok: true, repo: o.repo, to: o.back ? null : o.to, message: o.back ? 'People go to the hosted board again.' : `People are sent to ${o.to}.` });
      return 0;
    }
    throw new Usage(`Unknown command "${o.cmd}"`);
  } catch (e) {
    out.result({ ok: false, error: e.message });
    return e instanceof Usage ? 2 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
