// The web board: everything an agent can do, by clicking. Every action posts to /v1/<tool>, the same tools
// the agents call, with the same access rules. Pages: the board, a task, an idea, alerts.
import { head, topBar } from './ui/page.mjs';
import { renderKanban, esc, firstName, yourTurn, initials, tone } from './kanban.mjs';
import { loadBrand } from './brand.mjs';
import { markdown } from './markdown.mjs';
import { STATUSES, PRIORITIES } from './workspace.mjs';
import { liveCss, liveButton, livePanel, liveScript } from './live-ui.mjs';

const STATUS_LABEL = { todo: 'To do', doing: 'Doing', waiting: 'Waiting', review: 'Review', done: 'Done' };

export async function renderPage(s, { kind, id, view, client }) {
  const brand = await loadBrand(s.ws);
  const [team, unread] = await Promise.all([s.teamList(), s.unreadCount()]);
  const ctx = { s, brand, team, unread };
  if (kind === 't') return renderTask(ctx, id);
  if (kind === 'i') return renderIdea(ctx, id);
  if (kind === 'alerts') return renderAlerts(ctx);
  return renderBoard(ctx, { view, client });
}

// ---------- shell ----------

const PAGE_CSS = `
.ak-toolbar{display:flex;justify-content:space-between;align-items:flex-end;gap:var(--ui-s3);flex-wrap:wrap}
.ak-toolbar .ui-tabs{flex:1;min-width:0}
.ak-board-note{margin:0}
.ui-lane.drop-target .ui-lane-cards{outline:1.5px dashed var(--ui-accent);outline-offset:4px;border-radius:var(--ui-radius)}
.ak-task-head{display:grid;gap:var(--ui-s2)}
.ak-task-head .ak-meta{margin:0;color:var(--ui-ink-3);font-size:14px}
.ui-decide-a form{display:inline}
.ui-decide-more[hidden]{display:none}
.ak-block{display:grid;gap:var(--ui-s3)}
.ak-prose{line-height:1.65;color:var(--ui-ink);max-width:70ch}
.ak-prose h1,.ak-prose h2,.ak-prose h3{font-family:var(--ui-display);font-weight:var(--ui-weight-strong);margin:var(--ui-s5) 0 var(--ui-s2);font-size:17px}
.ak-prose p{margin:0 0 var(--ui-s3)}.ak-prose ul,.ak-prose ol{margin:0 0 var(--ui-s3);padding-left:var(--ui-s5)}
.ak-prose a{color:var(--ui-ask-ink);text-decoration:underline;text-decoration-color:var(--ui-accent-line);text-underline-offset:3px}
.ak-prose hr{border:0;border-top:1px solid var(--ui-line);margin:var(--ui-s5) 0}
.ui-checks a,.ui-steps a{color:var(--ui-ask-ink)}
.ak-comment{display:grid;gap:var(--ui-s2);margin-top:var(--ui-s2)}
.ak-side-form{display:grid;gap:var(--ui-s3);margin-top:var(--ui-s4);padding-top:var(--ui-s4);border-top:1px solid var(--ui-line)}
.ak-side-form .ui-field{margin:0}
details.ui-card>summary{cursor:pointer;font-weight:var(--ui-weight-strong);list-style:none;display:flex;justify-content:space-between;align-items:center}
details.ui-card>summary::-webkit-details-marker{display:none}
details.ui-card>summary::after{content:"";width:7px;height:7px;border-right:1.5px solid var(--ui-ink-3);border-bottom:1.5px solid var(--ui-ink-3);transform:rotate(45deg);transition:transform var(--ui-dur) var(--ui-ease)}
details.ui-card[open]>summary::after{transform:translateY(3px) rotate(-135deg)}
details.ak-older>summary{cursor:pointer;color:var(--ui-ink-2);font-size:14px}
.ui-timeline .pending,.ui-feed .pending,.pending{opacity:.55}
.ak-thread{list-style:none;margin:0;padding:0;display:grid}
.ak-thread li{padding:var(--ui-s3) 0;border-top:1px solid var(--ui-line);font-size:14px;color:var(--ui-ink-2)}
.ak-thread li:first-child{border-top:0}
.ak-alerts .ui-inbox-i{cursor:default}
.ak-alerts .ui-inbox-s{white-space:normal}
.ak-alerts a{color:var(--ui-ask-ink)}
`;

function shell({ s, brand, unread }, { title, current, body, wide = false }) {
  const link = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const nav = `${link('/board', 'Board', 'board')}${link('/board/alerts', `Alerts${unread ? `<span class="ui-badge">${unread}</span>` : ''}`, 'alerts')}${liveButton}<a href="/" class="ak-hide-sm">Connect your AI</a>${s.ws.hosting && s.isOwner ? link('/settings', 'Settings', 'settings') : ''}${s.ws.demo ? '<span class="ui-chip is-soft ak-hide-sm">Demo: changes reset</span>' : `<a href="/logout" class="ak-hide-sm">Sign out ${esc(firstName(s.me.name))}</a>`}`;
  return `${head({ title: `${title} · ${brand.name}`, brand, css: PAGE_CSS + liveCss })}<body>
${topBar({ brand, home: '/board', nav, wide })}
<main class="ak-wrap ak-stack${wide ? ' is-wide' : ''}">${body}</main>
<div id="toast" class="ui-toast" role="status" aria-live="polite"></div>
${livePanel}
<script>window.AK_ME=${JSON.stringify(s.me.name)};window.AK_ME_ID=${JSON.stringify(s.me.id)};${CLIENT}${liveScript()}</script>
</body></html>`;
}

// ---------- board ----------

async function renderBoard(ctx, { view, client }) {
  const { s, team } = ctx;
  const [clients, ideasAll] = await Promise.all([s.clients(), s.ideas()]);
  const slug = client && clients.some((c) => c.client === client) ? client : null;
  const mine = view === 'mine' && !slug;
  let tasks = await s.tasks(slug ? { client: slug } : {});
  let ideas = slug ? ideasAll.filter((i) => i.data.client === slug) : ideasAll;
  if (mine) {
    tasks = tasks.filter((t) => t.data.assignee === s.me.id || yourTurn(t.data, s.me.id));
    ideas = ideas.filter((i) => i.data.created_by === s.me.id);
  }
  const tab = (href, label, on) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  const turns = tasks.filter((t) => yourTurn(t.data, s.me.id)).length;

  return shell(ctx, {
    title: 'Board',
    current: 'board',
    wide: true,
    body: `
<div class="ak-toolbar">
  <nav class="ui-tabs" aria-label="Filter">${tab('/board', 'All', !slug && !mine)}${tab('/board?view=mine', `Mine${turns ? ` · ${turns} your turn` : ''}`, mine)}${clients.map((c) => tab(`/board?client=${encodeURIComponent(c.client)}`, c.name ?? c.client, slug === c.client)).join('')}</nav>
  <div class="ak-row">${s.isOwner && clients.some((c) => c.example === true) ? '<form data-tool="clear_examples"><button class="ui-btn is-ghost is-sm" title="Removes the example cards a new board starts with">Clear examples</button></form>' : ''}<button class="ui-btn is-quiet is-sm" data-open="new-idea">New idea</button><button class="ui-btn is-accent is-sm" data-open="new-task">New task</button></div>
</div>
${renderKanban({ tasks, ideas, clients, people: team, me: s.me.id, interactive: true, href: (x, kind) => `/board/${kind === 'idea' ? 'i' : 't'}/${encodeURIComponent(x.id)}` })}
<p class="ak-small ak-board-note">Drag a card to change its stage. Open a card to review, assign, comment or hand it off. Your agent can do all of this too.</p>

<dialog class="ui-dialog" id="new-task"><form data-tool="add_task">
  <div class="ui-dialog-h"><h2>New task</h2><button type="button" class="ui-x" data-close aria-label="Close">×</button></div>
  <div class="ui-dialog-b"><div class="ui-fields">
  ${field('What', `<input class="ui-input" name="title" required placeholder="Start with a verb: Draft the PTO policy">`, true)}
  ${field('Client', select('client', clients.map((c) => [c.client, c.name ?? c.client]), slug))}
  ${field('Owner', select('assignee', [['me', 'Me'], ['nobody', 'Nobody (up for grabs)'], ...team.filter((p) => p.id !== s.me.id).map((p) => [p.id, p.name])], 'me'))}
  ${field('Due', '<input class="ui-input" type="date" name="due">')}${field('Priority', select('priority', PRIORITIES.map((p) => [p, cap(p)]), 'normal'))}
  ${field('Details', '<textarea class="ui-textarea" name="details" placeholder="Context, links, what done looks like"></textarea>', true)}
  </div><p class="ak-err form-error"></p></div>
  <div class="ui-dialog-a"><button type="button" class="ui-btn is-ghost" data-close>Cancel</button><button class="ui-btn is-accent">Create task</button></div>
</form></dialog>

<dialog class="ui-dialog" id="new-idea"><form data-tool="add_idea">
  <div class="ui-dialog-h"><h2>New idea</h2><button type="button" class="ui-x" data-close aria-label="Close">×</button></div>
  <div class="ui-dialog-b"><div class="ui-fields">
  ${field('Idea', '<input class="ui-input" name="title" required>', true)}
  ${field('Client <small>optional</small>', select('client', [['', 'Not about one client'], ...clients.map((c) => [c.client, c.name ?? c.client])], slug ?? ''), true)}
  ${field('Details', '<textarea class="ui-textarea" name="body"></textarea>', true)}
  </div><p class="ak-err form-error"></p></div>
  <div class="ui-dialog-a"><button type="button" class="ui-btn is-ghost" data-close>Cancel</button><button class="ui-btn is-accent">Post idea</button></div>
</form></dialog>`,
  });
}

// ---------- task ----------

async function renderTask(ctx, id) {
  const { s, team } = ctx;
  let t;
  try {
    t = await s.openTask(id);
  } catch {
    return shell(ctx, { title: 'Not found', current: 'board', body: '<div class="ui-card ui-blank"><b>That task does not exist</b><p>Or you do not have access to it.</p><a class="ui-btn is-quiet is-sm" href="/board">Back to the board</a></div>' });
  }
  const d = t.data;
  const clients = await s.clients();
  const clientName = clients.find((c) => c.client === d.client)?.name ?? d.client;
  const nameOf = (pid) => team.find((p) => p.id === pid)?.name ?? pid;
  const [top, activity = ''] = t.body.split(/(?:^|\n)## Activity\n/);
  const { intro, handoffs } = splitHandoffs(top);
  const latest = handoffs[handoffs.length - 1];
  const links = linksOf(top);
  const reviewer = d.status === 'review' && d.assignee === s.me.id;
  const from = d.handed_by ?? d.created_by;
  const fromFirst = esc(firstName(nameOf(from)));
  const people = team.map((p) => [p.id, p.name]);
  const events = activity.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)).reverse();

  const decision = reviewer ? `
<section class="ui-decide">
  <div><span class="ui-label">${fromFirst} asked you to review this</span><p>${esc(d.next_step ?? 'Review the work and decide.')}</p></div>
  <div class="ui-decide-a">
    <form data-tool="update_task"><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="status" value="done"><input type="hidden" name="comment" value="Approved"><button class="ui-btn is-accent">Approve</button></form>
    <button class="ui-btn is-quiet" data-reveal="send-back">Send back</button>
    <button class="ui-btn is-quiet" data-reveal="meet">Meet to discuss</button>
  </div>
  <form data-tool="hand_off" id="send-back" class="ui-decide-more" hidden><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="to" value="${esc(from)}"><input type="hidden" name="what_i_did" value="Reviewed it">
    <textarea class="ui-textarea" name="whats_next" required placeholder="What should ${fromFirst} change?"></textarea><p class="ak-err form-error"></p><div class="ak-row"><button class="ui-btn is-accent is-sm">Send back to ${fromFirst}</button><button type="button" class="ui-btn is-ghost is-sm" data-reveal="send-back">Cancel</button></div></form>
  <form data-tool="meet_to_discuss" id="meet" class="ui-decide-more" hidden><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="with" value="${esc(from)}"><input type="hidden" name="owner" value="${esc(s.me.id)}">
    <textarea class="ui-textarea" name="agenda" placeholder="What do you want to decide together?"></textarea><p class="ak-err form-error"></p><div class="ak-row"><button class="ui-btn is-accent is-sm">Ask ${fromFirst} to meet</button><button type="button" class="ui-btn is-ghost is-sm" data-reveal="meet">Cancel</button></div></form>
</section>` : '';

  const linkCards = links.length ? `<section class="ak-block"><h3 class="ak-h3">Links</h3><div class="ui-linkcards">${links.map((l) => `<a class="ui-linkcard" href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(cap(l.label))}</b><span>${esc(l.url.replace(/^https:\/\//, ''))}</span></a>`).join('')}</div></section>` : '';
  const done = latest?.did?.length ? `<section class="ak-block"><h3 class="ak-h3">What was done</h3><ul class="ui-checks">${latest.did.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ul></section>` : '';
  const next = latest?.next?.length ? `<section class="ak-block"><h3 class="ak-h3">What's next</h3><ol class="ui-steps">${latest.next.map((x) => `<li><div>${inlineMd(x)}</div></li>`).join('')}</ol></section>` : '';
  const older = handoffs.length > 1 ? `<details class="ak-block ak-older"><summary>Earlier hand-offs (${handoffs.length - 1})</summary><div class="ak-prose">${handoffs.slice(0, -1).reverse().map((h) => markdown(h.raw)).join('<hr>')}</div></details>` : '';

  return shell(ctx, {
    title: d.title,
    current: 'board',
    body: `
<header class="ak-task-head task-head" data-item="${esc(t.id)}">
  <div class="ui-crumbs"><a href="/board">Board</a> / <a href="/board?client=${encodeURIComponent(d.client)}">${esc(clientName)}</a></div>
  <div class="ui-kcard-chips">
    <span class="ui-chip is-outline">${esc(STATUS_LABEL[d.status] ?? d.status)}</span>
    ${yourTurn(d, s.me.id) ? '<span class="ui-chip is-accent">Your turn</span>' : ''}
    ${d.sent_back && d.status !== 'done' ? '<span class="ui-chip is-soft">Sent back</span>' : ''}
    ${d.waiting_for ? `<span class="ui-chip">${esc(cap(d.waiting_for))}</span>` : ''}
    ${['high', 'urgent'].includes(d.priority) ? `<span class="ui-chip is-soft">${esc(cap(d.priority))} priority</span>` : ''}
  </div>
  <h1 class="ak-h1">${esc(d.title)}</h1>
  <p class="ak-meta">${esc(clientName)} · ${d.handed_by ? `From ${esc(nameOf(d.handed_by))}` : `Created by ${esc(nameOf(d.created_by))}`}${d.handed_on ?? d.created ? `, ${esc(d.handed_on ?? d.created)}` : ''}${d.due ? ` · Due ${esc(d.due)}` : ''}</p>
</header>
${decision}
<div class="ui-split">
  <div class="ak-stack">
    ${intro.trim() ? `<section class="ak-block ak-prose">${markdown(intro)}</section>` : ''}
    ${linkCards}${done}${next}${older}
    ${!intro.trim() && !latest ? '<p class="ak-small">No details yet.</p>' : ''}
    <section class="ak-block"><h3 class="ak-h3">Activity</h3>
      <ol class="ui-timeline" id="feed" data-order="newest-first">${events.map((e) => `<li>${activityLine(e)}</li>`).join('') || '<li class="dim">Nothing yet.</li>'}</ol>
      <form data-tool="comment" class="ak-comment" data-optimistic="comment"><input type="hidden" name="item" value="${esc(t.path)}">
        <textarea class="ui-textarea" name="text" required rows="2" placeholder="Add a comment"></textarea><p class="ak-err form-error"></p><div><button class="ui-btn is-quiet is-sm">Comment</button></div></form>
    </section>
  </div>
  <aside class="ui-split-side">
    <section class="ui-card">
      <dl class="ui-kv">
        <dt>Owner</dt><dd>${d.assignee ? esc(nameOf(d.assignee)) : 'Up for grabs'}</dd>
        <dt>Client</dt><dd>${esc(clientName)}</dd>
        ${d.due ? `<dt>Due</dt><dd>${esc(d.due)}</dd>` : ''}
        ${d.meet_with ? `<dt>Meet with</dt><dd>${esc([].concat(d.meet_with).map(nameOf).join(', '))}${d.meeting_at ? `, ${esc(d.meeting_at)}` : ''}</dd>` : ''}
      </dl>
      <form data-tool="update_task" class="ak-side-form"><input type="hidden" name="task" value="${esc(t.id)}">
        ${field('Stage', select('status', STATUSES.map((x) => [x, STATUS_LABEL[x]]), d.status))}
        ${field('Owner', select('assignee', [['nobody', 'Up for grabs'], ...people], d.assignee ?? 'nobody'))}
        <div class="ui-fields">${field('Due', `<input class="ui-input" type="date" name="due" value="${esc(d.due ?? '')}">`)}${field('Priority', select('priority', PRIORITIES.map((x) => [x, cap(x)]), d.priority ?? 'normal'))}</div>
        <p class="ak-err form-error"></p><div><button class="ui-btn is-quiet is-sm">Save changes</button></div>
      </form>
    </section>
    <details class="ui-card"><summary>Hand off to someone</summary>
      <form data-tool="hand_off" class="ak-side-form"><input type="hidden" name="task" value="${esc(t.id)}">
        ${field('To', select('to', people.filter(([pid]) => pid !== s.me.id), from !== s.me.id ? from : undefined))}
        ${field('What I did', '<textarea class="ui-textarea" name="what_i_did" required rows="3"></textarea>')}
        ${field("What's next", '<textarea class="ui-textarea" name="whats_next" required rows="3"></textarea>')}
        ${field('Links <small>one per line</small>', '<textarea class="ui-textarea" name="links" data-list rows="2"></textarea>')}
        <label class="ui-check"><input type="checkbox" name="needs" value="review"><span>For their review</span></label>
        <p class="ak-err form-error"></p><div><button class="ui-btn is-accent is-sm">Hand off</button></div>
      </form>
    </details>
  </aside>
</div>`,
  });
}

// A task body: an optional intro, then "## Handoff from A to B (date)" blocks with **What I did**, **What's next**, **Links**.
function splitHandoffs(text) {
  const parts = String(text).split(/(?=^## Handoff from )/m);
  const intro = parts[0].startsWith('## Handoff from ') ? '' : parts.shift();
  const handoffs = parts.map((raw) => {
    const sect = (name) => {
      const m = new RegExp(`\\*\\*${name}\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Z][^*]+\\*\\*\\n|$)`).exec(raw);
      return m ? m[1].split('\n').map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim()).filter(Boolean) : [];
    };
    return { raw, did: sect('What I did'), next: sect("What's next") };
  });
  return { intro, handoffs };
}

// An activity line, "2026-01-12 Jordan Lee: handed off to sam", as who, what and when.
const activityLine = (e) => {
  const m = /^(\d{4}-\d{2}-\d{2}(?:[ T][\d:]+)?)\s+([^:]{1,60}):\s*(.*)$/.exec(e);
  return m ? `<b>${esc(m[2])}</b> ${esc(m[3])}<time>${esc(m[1])}</time>` : esc(e);
};
const inlineMd = (x) => markdown(x).replace(/^<p>|<\/p>$/g, '');
const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);

// ---------- idea ----------

async function renderIdea(ctx, id) {
  const { s, team } = ctx;
  const idea = await s.get(`ideas/${String(id).replace(/[^\w.-]/g, '')}.md`);
  if (!idea) return shell(ctx, { title: 'Not found', current: 'board', body: '<div class="ui-card ui-blank"><b>That idea does not exist</b><a class="ui-btn is-quiet is-sm" href="/board">Back to the board</a></div>' });
  const d = idea.data;
  const clients = await s.clients();
  const nameOf = (pid) => team.find((p) => p.id === pid)?.name ?? pid;
  const [body, thread = ''] = idea.body.split(/(?:^|\n)## Thread\n?/);
  return shell(ctx, {
    title: d.title,
    current: 'board',
    body: `
<header class="ak-task-head">
<div class="ui-crumbs"><a href="/board">Board</a> / Ideas</div>
<h1 class="ak-h1 idea-head" data-item="${esc(idea.id)}">${esc(d.title)}</h1>
<p class="ak-meta">${esc(nameOf(d.created_by))}, ${esc(d.created ?? '')}${d.client ? ` · ${esc(clients.find((c) => c.client === d.client)?.name ?? d.client)}` : ''}</p></header>
<div class="ui-split">
  <div class="ak-stack">
    <article class="ak-prose">${markdown(body) || '<p class="ak-small">No details.</p>'}</article>
    <section class="ak-block"><h3 class="ak-h3">Thread</h3><ul class="ak-thread" id="feed" data-order="oldest-first">${thread.split('\n').filter((l) => l.startsWith('- ')).map((l) => `<li>${esc(l.slice(2))}</li>`).join('') || '<li class="dim">No replies yet.</li>'}</ul></section>
    <form data-tool="comment" class="ak-comment" data-optimistic="comment"><input type="hidden" name="item" value="${esc(idea.path)}">
      ${field('Reply', '<textarea class="ui-textarea" name="text" required></textarea>')}<p class="ak-err form-error"></p><div><button class="ui-btn is-quiet is-sm">Reply</button></div></form>
  </div>
  <aside class="ui-split-side"><form data-tool="add_task" class="ui-card ak-stack" data-next="/board">
    <div class="ui-card-h"><h3>Turn into a task</h3></div>
    <input type="hidden" name="title" value="${esc(d.title)}"><input type="hidden" name="details" value="${esc(`From the idea: ${d.title}\n\n${body.trim()}`)}">
    ${field('Client', select('client', clients.map((c) => [c.client, c.name ?? c.client]), d.client))}
    ${field('Owner', select('assignee', [['me', 'Me'], ['nobody', 'Nobody (up for grabs)'], ...team.filter((p) => p.id !== s.me.id).map((p) => [p.id, p.name])], 'me'))}
    <p class="ak-err form-error"></p><div><button class="ui-btn is-accent is-sm">Create task</button></div>
  </form></aside>
</div>`,
  });
}

// ---------- alerts ----------

async function renderAlerts(ctx) {
  const { s, team } = ctx;
  const all = await s.inbox({ include_read: true });
  const nameOf = (pid) => team.find((p) => p.id === pid)?.name ?? pid;
  const unread = all.filter((a) => ![].concat(a.data.read_by ?? []).includes(s.me.id));
  const taskLink = (a) => (a.data.link?.includes('/tasks/') ? ` <a href="/board/t/${encodeURIComponent(a.data.link.split('/').pop().replace(/\.md$/, ''))}">Open</a>` : '');
  const item = (a, isNew) => {
    const who = nameOf(a.data.from);
    return `<li class="ui-inbox-i${isNew ? ' is-unread' : ''}"><span class="ui-avatar is-sm" data-tone="${tone(who)}">${esc(initials(who))}</span><div><div class="ui-inbox-h"><b>${esc(firstName(who))}</b>${isNew ? '<span class="ui-chip is-accent">New</span>' : ''}</div><div class="ui-inbox-s">${esc(a.body)}${taskLink(a)}</div></div><div class="ui-inbox-m"><time>${esc(String(a.data.created ?? '').slice(0, 16).replace('T', ' '))}</time></div></li>`;
  };
  return shell(ctx, {
    title: 'Alerts',
    current: 'alerts',
    body: `
<div class="ui-ph"><div><h1>Alerts</h1><p>${unread.length ? `${unread.length} new` : 'Nothing new'}</p></div>${unread.length ? '<form data-tool="my_alerts"><button class="ui-btn is-quiet is-sm">Mark all read</button></form>' : ''}</div>
<div class="ui-card ak-alerts" style="padding:0;overflow:hidden">${all.length ? `<ul class="ui-inbox">${all.slice(0, 50).map((a) => item(a, unread.includes(a))).join('')}</ul>` : '<div class="ui-blank"><b>No alerts</b><p>When someone hands you work or mentions you, it shows here.</p></div>'}</div>`,
  });
}

// ---------- helpers ----------

const field = (label, control, wide = false) => `<label class="ui-field${wide ? ' is-wide' : ''}"><span>${label}</span>${control}</label>`;
const select = (name, opts, selected) => `<select class="ui-select" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

// Links from a hand-off's **Links** section ("https://... (label)"), else any URL in the text.
function linksOf(text) {
  const out = [];
  for (const m of String(text).matchAll(/https:\/\/[^\s)<>"]+(?:\s*\(([^)]+)\))?/g)) {
    const url = m[0].replace(/\s*\(.*$/, '').replace(/[.,;]+$/, '');
    if (!out.some((l) => l.url === url)) out.push({ url, label: m[1] ?? new URL(url).hostname });
  }
  return out.slice(0, 6);
}

// Browser side: every form[data-tool] posts to /v1/<tool>; cards drag between stages.
const CLIENT = `
(function () {
  function ak(tool, args) {
    return fetch('/v1/' + tool, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'agent-kanban' }, body: JSON.stringify(args) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'That did not work.'); return j; }); });
  }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1800);
  }
  // Fetch this page again and swap in what changed: no flash, same scroll, open sections stay open.
  function refresh() {
    var y = window.scrollY, open = Array.prototype.map.call(document.querySelectorAll('details[open]'), function (d) { return d.querySelector('summary').textContent; });
    return fetch(location.href, { headers: { 'x-requested-with': 'agent-kanban' } }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      document.querySelector('main').innerHTML = doc.querySelector('main').innerHTML;
      var nav = doc.querySelector('.ak-nav'); if (nav) document.querySelector('.ak-nav').innerHTML = nav.innerHTML;
      document.querySelectorAll('details').forEach(function (d) { if (open.indexOf(d.querySelector('summary').textContent) >= 0) d.open = true; });
      bind(); window.scrollTo(0, y);
    });
  }
  window.AK_REFRESH = refresh;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function bind() {
    document.querySelectorAll('form[data-tool]').forEach(function (f) {
      if (f.dataset.bound) return; f.dataset.bound = '1';
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var args = {};
        Array.prototype.forEach.call(f.elements, function (el) {
          if (!el.name || el.disabled) return;
          if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
          var v = el.value.trim();
          if (el.hasAttribute('data-list')) v = v.split(/\\n|,/).map(function (x) { return x.trim(); }).filter(Boolean);
          if (v === '' || (Array.isArray(v) && !v.length)) return;
          args[el.name] = v;
        });
        var btn = f.querySelector('button:not([type=button])'), err = f.querySelector('.form-error'), shown = null;
        if (btn) btn.disabled = true;
        if (err) err.textContent = '';
        // Show it straight away; the quiet refresh after the save confirms it.
        if (f.dataset.optimistic === 'comment' && args.text) {
          var feed = document.getElementById('feed');
          if (feed) {
            shown = document.createElement('li'); shown.className = 'pending';
            shown.textContent = new Date().toISOString().slice(0, 10) + ' ' + window.AK_ME + ': ' + args.text;
            var empty = feed.querySelector('.dim'); if (empty) empty.remove();
            if (feed.dataset.order === 'newest-first') feed.prepend(shown); else feed.appendChild(shown);
            f.reset();
          }
        }
        ak(f.getAttribute('data-tool'), args).then(function () {
          if (f.getAttribute('data-next')) { location.href = f.getAttribute('data-next'); return; }
          var dlg = f.closest('dialog'); if (dlg) { dlg.close(); f.reset(); }
          toast('Saved');
          return refresh();
        }).catch(function (x) {
          if (shown) shown.remove();
          if (err) err.textContent = x.message; if (btn) btn.disabled = false;
        });
      });
    });
    document.querySelectorAll('[data-open]').forEach(function (b) { if (b.dataset.bound) return; b.dataset.bound = '1'; b.addEventListener('click', function () { document.getElementById(b.getAttribute('data-open')).showModal(); }); });
    document.querySelectorAll('[data-close]').forEach(function (b) { if (b.dataset.bound) return; b.dataset.bound = '1'; b.addEventListener('click', function () { b.closest('dialog').close(); }); });
    document.querySelectorAll('[data-task]').forEach(function (c) {
      if (c.dataset.bound) return; c.dataset.bound = '1';
      c.addEventListener('dragstart', function (e) { dragged = c; c.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
      c.addEventListener('dragend', function () { c.classList.remove('is-dragging'); });
    });
    document.querySelectorAll('.ui-lane[data-status]').forEach(function (col) {
      if (col.dataset.bound) return; col.dataset.bound = '1';
      col.addEventListener('dragover', function (e) { if (dragged) { e.preventDefault(); col.classList.add('drop-target'); } });
      col.addEventListener('dragleave', function () { col.classList.remove('drop-target'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault(); col.classList.remove('drop-target');
        var card = dragged; dragged = null;
        if (!card) return;
        var from = card.parentNode, next = card.nextSibling, cards = col.querySelector('.ui-lane-cards');
        var empty = cards.querySelector('.ui-lane-empty'); if (empty) empty.remove();
        cards.prepend(card); card.classList.add('pending');
        ak('update_task', { task: card.getAttribute('data-task'), status: col.getAttribute('data-status') })
          .then(function () { toast('Moved'); return refresh(); })
          .catch(function (x) { from.insertBefore(card, next); card.classList.remove('pending'); toast(x.message); });
      });
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-reveal]'); if (!b) return;
    var f = document.getElementById(b.getAttribute('data-reveal')); if (!f) return;
    document.querySelectorAll('.ui-decide-more').forEach(function (x) { if (x !== f) x.hidden = true; });
    f.hidden = !f.hidden; if (!f.hidden) { var ta = f.querySelector('textarea'); if (ta) ta.focus(); }
  });
  var dragged = null;
  bind();
})();
`;
