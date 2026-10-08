import fs from 'node:fs';
import YAML from 'yaml';
import path from 'node:path';
import { slugify, today, stringify } from './md.mjs';

// What goes into a new team's repo: the example workspace's structure, playbooks and templates, the person who
// made it as the owner, and five example cards (marked example: true) that teach the board by doing. The example
// workspace's made-up clients and people stay out: a real team's board starts with only real people on it.

export const EXAMPLE_DIR = new URL('../example-workspace/', import.meta.url).pathname;
const KEEP = [/^playbooks\//, /^templates\//, /^alerts\/README\.md$/, /^internal\/README\.md$/];

function walk(dir, root = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, root) : [path.relative(root, full).split(path.sep).join('/')];
  });
}

// owner: { name, github, email?, account? } (account: their warOnSaaS account id). Returns [{ path, content }].
export function seedFiles({ teamName, slug, owner, hostedUrl }) {
  const id = slugify(String(owner.name || owner.github).split(' ')[0]) || 'owner';
  const files = walk(EXAMPLE_DIR).filter((p) => KEEP.some((r) => r.test(p))).map((p) => ({ path: p, content: fs.readFileSync(path.join(EXAMPLE_DIR, p), 'utf8') }));
  const header = fs.readFileSync(path.join(EXAMPLE_DIR, 'people.yml'), 'utf8').split('\npeople:')[0];
  const d = today();
  const name = owner.name || owner.github;
  const first = String(name).split(' ')[0];
  // A few example cards that teach the board by doing. All marked example: true; clear_examples removes them.
  const card = (file, title, status, body, extra = {}) => ({
    path: `clients/examples/tasks/${file}.md`,
    content: stringify({ title, client: 'examples', status, priority: 'normal', assignee: id, created_by: id, created: d, example: true, ...extra }, `${body}\n\n## Activity\n- ${d} ${name}: created`),
  });
  files.push(
    { path: 'people.yml', content: `${header}\n${YAML.stringify({ people: [{ id, name, title: 'Owner', role: 'owner', ...(owner.github ? { github: owner.github } : {}), ...(owner.email ? { email: owner.email } : {}), ...(owner.account ? { account: owner.account } : {}), clients: 'all' }] })}` },
    { path: `people/${id}/README.md`, content: `# ${name}\n\nPrivate scratch space.\n` },
    { path: 'clients/examples/client.md', content: stringify({ name: 'Examples', status: 'active', since: d, engagement: 'Example cards that show how the board works. Clear them any time.', example: true }, 'These cards are examples. Try each one, then clear them: say "clear the examples" to your AI app, or use the button on the board.') },
    card('welcome-drag-me-to-doing-ex01', 'Welcome: drag me to Doing', 'todo', 'This is an example card. Drag it to **Doing** on the board, or tell your AI app: "move the welcome card to doing".', { priority: 'high' }),
    card('try-ask-your-ai-to-hand-this-off-ex02', 'Try: ask your AI to hand this off', 'doing', 'Type **hand off task** in your AI app. It writes what was done and what is next into this card, and tells the next person.'),
    card('review-approve-or-send-back-ex03', 'Review: approve or send this back', 'review', `Type **review** in your AI app. It opens the work, says Ready or Not ready, and asks: approve, send back, or meet?\n\n## Handoff from ${name} to ${name} (${d})\n\n**What I did**\nWrote a one-page welcome note for new clients.\n\n**What's next**\nCheck it reads well, then approve it.`, { handed_by: id, handed_on: d, next_step: 'Check it reads well, then approve it.' }),
    card('up-for-grabs-take-me-ex04', 'Up for grabs: take me', 'todo', `Nobody owns this card yet, so everyone on the client sees it. Tell your AI app: "assign the up for grabs card to me", ${first}.`, { assignee: undefined }),
    card('done-you-made-a-board-ex05', 'Done: you made a board', 'done', 'Finished cards stay here for two weeks, then drop off the board. They stay in your repo for good.', { completed: d }),
  );
  files.push(
    { path: 'README.md', content: `# ${teamName}\n\nThe ${teamName} board on agent-kanban. Every task, note, idea and alert is a file in this repo, and this repo is yours: download it, change it, or run the board yourself at any time.\n\n- people.yml: who is on the team and what each person can see\n- clients/: one folder per client, with tasks, notes and documents\n- ideas/, playbooks/, alerts/: shared by the team\n- internal/: owner only\n\nThe board's code is open source: https://github.com/warOnSaaS/agent-kanban\n` },
    { path: '.agent-kanban/board.json', content: `${JSON.stringify({ name: teamName, slug, hosted_url: hostedUrl, created: new Date().toISOString() }, null, 2)}\n` },
  );
  return files;
}
