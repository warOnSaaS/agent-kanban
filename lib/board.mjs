// The web board: everything an agent can do, by clicking. Every action posts to /v1/<tool>, the same tools
// the agents call, with the same access rules. Pages: the board, a task, an idea, alerts.
import css from './ui/wos-css.mjs';
import { renderKanban, esc, firstName, yourTurn } from './kanban.mjs';
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

function shell({ s, brand, unread }, { title, current, body, wide = false }) {
  const link = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html><html lang="en"${brand.scheme ? ` data-theme="${brand.scheme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(brand.name)}</title><meta name="robots" content="noindex">${brand.fonts}
<style>${css}${brand.css}
.page{padding-top:var(--s5);padding-bottom:var(--s8)}
.toolbar{display:flex;justify-content:space-between;align-items:end;gap:var(--s3);flex-wrap:wrap}
.toolbar .tabs{flex:1;min-width:0}
.split{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:var(--s6);align-items:start}
@media (max-width:900px){.split{grid-template-columns:1fr}}
.form-error{color:var(--fg);font-weight:700;font-size:var(--t-sm)}
.kanban-col.drop-target .kanban-cards{outline:2px dashed var(--accent);outline-offset:4px}
details.card summary{cursor:pointer;font-weight:700;color:var(--fg);list-style:none}
details.card summary::-webkit-details-marker{display:none}
.linkbtns{display:flex;flex-wrap:wrap;gap:var(--s2)}
.wide{max-width:none}
.task-head{display:grid;gap:var(--s2)}
.task-head h1{font-size:clamp(24px,3vw,32px);margin:0}
.task-head .meta{color:var(--dim);font-size:var(--t-sm);margin:0}
.decide{display:grid;grid-template-columns:1fr auto;gap:var(--s3) var(--s5);align-items:center;background:var(--accent-soft);border-radius:calc(var(--radius) + 4px);padding:var(--s4) var(--s5)}
.decide-ask p{margin:var(--s1) 0 0;color:var(--fg);font-weight:600}
.decide-actions{display:flex;gap:var(--s2);flex-wrap:wrap}
.decide-actions form{display:inline}
.decide-more{grid-column:1/-1;display:grid;gap:var(--s2)}
.decide-more[hidden]{display:none}
@media (max-width:760px){.decide{grid-template-columns:1fr}}
.block{display:grid;gap:var(--s3)}
.block h3{font-size:var(--t-lg);margin:0}
.linkcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--s2)}
.linkcard{display:grid;gap:2px;padding:var(--s3) var(--s4);border:1px solid var(--rule);border-radius:var(--radius);text-decoration:none;background:var(--bg);box-shadow:var(--shadow-sm)}
.linkcard:hover{border-color:var(--accent);box-shadow:var(--shadow-md)}
.linkcard b{color:var(--fg)}
.linkcard span{font-size:var(--t-xs);color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.checks{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.checks li{display:grid;grid-template-columns:20px 1fr;gap:var(--s2);align-items:start}
.checks li::before{content:"✓";display:grid;place-items:center;width:20px;height:20px;border-radius:var(--pill);background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:700;margin-top:2px}
.timeline{list-style:none;margin:0;padding:0 0 0 var(--s4);border-left:2px solid var(--rule);display:grid;gap:var(--s3);font-size:var(--t-sm);color:var(--body)}
.timeline li{position:relative}
.timeline li::before{content:"";position:absolute;left:calc(-1 * var(--s4) - 6px);top:6px;width:10px;height:10px;border-radius:var(--pill);background:var(--bg);border:2px solid var(--accent)}
.comment-box{display:grid;gap:var(--s2);margin-top:var(--s3)}
.side{display:grid;gap:var(--s4)}
.side-form .label{font-size:var(--t-xs)}
.grid.two{grid-template-columns:1fr 1fr}
details.side summary{font-weight:600}
#toast{position:fixed;left:50%;bottom:var(--s5);transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:var(--s2) var(--s4);font-size:var(--t-sm);font-weight:700;letter-spacing:.06em;border-radius:var(--radius);opacity:0;transition:opacity .2s;pointer-events:none;z-index:10}
#toast.on{opacity:1}
.pending{opacity:.55}
${liveCss}</style></head><body>
<header class="header"><div class="wrap${wide ? ' wide' : ''}">
  <a class="brand" href="/board">${brand.logo ? `<img src="/brand/${esc(brand.logo)}" alt="">` : ''}<span>${esc(brand.name)}</span></a>
  <nav class="nav" aria-label="Main">${link('/board', 'Board', 'board')}${link('/board/alerts', `Alerts${unread ? ` (${unread})` : ''}`, 'alerts')}${liveButton}<a href="/">Connect your AI</a>${s.ws.hosting && s.isOwner ? link('/settings', 'Settings', 'settings') : ''}${s.ws.demo ? '<span class="dim small">Demo: changes reset</span>' : `<a href="/logout">Sign out ${esc(firstName(s.me.name))}</a>`}</nav>
</div></header>
<main class="wrap page stack${wide ? ' wide' : ''}">${body}</main>
<div id="toast" role="status" aria-live="polite"></div>
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
<div class="toolbar">
  <nav class="tabs" aria-label="Filter">${tab('/board', 'All', !slug && !mine)}${tab('/board?view=mine', `Mine${turns ? ` · ${turns} your turn` : ''}`, mine)}${clients.map((c) => tab(`/board?client=${encodeURIComponent(c.client)}`, c.name ?? c.client, slug === c.client)).join('')}</nav>
  <div class="row">${s.isOwner && clients.some((c) => c.example === true) ? '<form data-tool="clear_examples"><button class="btn btn-ghost btn-sm" title="Removes the example cards a new board starts with">Clear examples</button></form>' : ''}<button class="btn btn-secondary btn-sm" data-open="new-idea">New idea</button><button class="btn btn-sm" data-open="new-task">New task</button></div>
</div>
${renderKanban({ tasks, ideas, clients, people: team, me: s.me.id, interactive: true, href: (x, kind) => `/board/${kind === 'idea' ? 'i' : 't'}/${encodeURIComponent(x.id)}` })}
<p class="small dim">Drag a card to change its stage. Open a card to review, assign, comment or hand it off. Your agent can do all of this too.</p>

<dialog class="dialog" id="new-task"><form data-tool="add_task" class="stack">
  <h3>New task</h3>
  ${field('What', `<input class="input" name="title" required placeholder="Start with a verb: Draft the PTO policy">`)}
  ${field('Client', select('client', clients.map((c) => [c.client, c.name ?? c.client]), slug))}
  ${field('Owner', select('assignee', [['me', 'Me'], ['nobody', 'Nobody (up for grabs)'], ...team.filter((p) => p.id !== s.me.id).map((p) => [p.id, p.name])], 'me'))}
  <div class="grid">${field('Due', '<input class="input" type="date" name="due">')}${field('Priority', select('priority', PRIORITIES.map((p) => [p, p]), 'normal'))}</div>
  ${field('Details', '<textarea class="textarea" name="details" placeholder="Context, links, what done looks like"></textarea>')}
  <p class="form-error"></p>
  <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn">Create</button></div>
</form></dialog>

<dialog class="dialog" id="new-idea"><form data-tool="add_idea" class="stack">
  <h3>New idea</h3>
  ${field('Idea', '<input class="input" name="title" required>')}
  ${field('Client (optional)', select('client', [['', 'Not about one client'], ...clients.map((c) => [c.client, c.name ?? c.client])], slug ?? ''))}
  ${field('Details', '<textarea class="textarea" name="body"></textarea>')}
  <p class="form-error"></p>
  <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn">Post</button></div>
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
    return shell(ctx, { title: 'Not found', current: 'board', body: '<div class="empty">That task does not exist, or you do not have access to it.</div><p><a href="/board">Back to the board</a></p>' });
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
<section class="decide">
  <div class="decide-ask"><span class="label">${fromFirst} asked you to review this</span><p>${esc(d.next_step ?? 'Review the work and decide.')}</p></div>
  <div class="decide-actions">
    <form data-tool="update_task"><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="status" value="done"><input type="hidden" name="comment" value="Approved"><button class="btn">Approve</button></form>
    <button class="btn btn-secondary" data-reveal="send-back">Send back</button>
    <button class="btn btn-secondary" data-reveal="meet">Meet to discuss</button>
  </div>
  <form data-tool="hand_off" id="send-back" class="decide-more" hidden><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="to" value="${esc(from)}"><input type="hidden" name="what_i_did" value="Reviewed it">
    <textarea class="textarea" name="whats_next" required placeholder="What should ${fromFirst} change?"></textarea><p class="form-error"></p><div class="row"><button class="btn">Send back to ${fromFirst}</button><button type="button" class="btn btn-ghost" data-reveal="send-back">Cancel</button></div></form>
  <form data-tool="meet_to_discuss" id="meet" class="decide-more" hidden><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="with" value="${esc(from)}"><input type="hidden" name="owner" value="${esc(s.me.id)}">
    <textarea class="textarea" name="agenda" placeholder="What do you want to decide together?"></textarea><p class="form-error"></p><div class="row"><button class="btn">Ask ${fromFirst} to meet</button><button type="button" class="btn btn-ghost" data-reveal="meet">Cancel</button></div></form>
</section>` : '';

  const linkCards = links.length ? `<section class="block"><h3>Links</h3><div class="linkcards">${links.map((l) => `<a class="linkcard" href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(cap(l.label))}</b><span>${esc(l.url.replace(/^https:\/\//, ''))}</span></a>`).join('')}</div></section>` : '';
  const done = latest?.did?.length ? `<section class="block"><h3>What was done</h3><ul class="checks">${latest.did.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ul></section>` : '';
  const next = latest?.next?.length ? `<section class="block"><h3>What's next</h3><ol class="steps">${latest.next.map((x) => `<li><div>${inlineMd(x)}</div></li>`).join('')}</ol></section>` : '';
  const older = handoffs.length > 1 ? `<details class="block"><summary>Earlier hand-offs (${handoffs.length - 1})</summary><div class="prose">${handoffs.slice(0, -1).reverse().map((h) => markdown(h.raw)).join('<hr class="rule">')}</div></details>` : '';

  return shell(ctx, {
    title: d.title,
    current: 'board',
    body: `
<div class="crumbs"><a href="/board">Board</a> / <a href="/board?client=${encodeURIComponent(d.client)}">${esc(clientName)}</a></div>
<header class="task-head" data-item="${esc(t.id)}">
  <div class="kcard-chips">
    <span class="chip chip-outline">${esc(STATUS_LABEL[d.status] ?? d.status)}</span>
    ${yourTurn(d, s.me.id) ? '<span class="chip chip-accent">Your turn</span>' : ''}
    ${d.sent_back && d.status !== 'done' ? '<span class="chip chip-soft">Sent back</span>' : ''}
    ${d.waiting_for ? `<span class="chip">${esc(cap(d.waiting_for))}</span>` : ''}
    ${['high', 'urgent'].includes(d.priority) ? `<span class="chip chip-soft">${esc(cap(d.priority))} priority</span>` : ''}
  </div>
  <h1>${esc(d.title)}</h1>
  <p class="meta">${esc(clientName)} · ${d.handed_by ? `From ${esc(nameOf(d.handed_by))}` : `Created by ${esc(nameOf(d.created_by))}`}${d.handed_on ?? d.created ? `, ${esc(d.handed_on ?? d.created)}` : ''}${d.due ? ` · Due ${esc(d.due)}` : ''}</p>
</header>
${decision}
<div class="split">
  <div class="stack">
    ${intro.trim() ? `<section class="block prose">${markdown(intro)}</section>` : ''}
    ${linkCards}${done}${next}${older}
    ${!intro.trim() && !latest ? '<p class="dim">No details yet.</p>' : ''}
    <section class="block"><h3>Activity</h3>
      <ol class="timeline" id="feed" data-order="newest-first">${events.map((e) => `<li>${esc(e)}</li>`).join('') || '<li class="dim">Nothing yet.</li>'}</ol>
      <form data-tool="comment" class="comment-box" data-optimistic="comment"><input type="hidden" name="item" value="${esc(t.path)}">
        <textarea class="textarea" name="text" required rows="2" placeholder="Add a comment"></textarea><p class="form-error"></p><div><button class="btn btn-sm">Comment</button></div></form>
    </section>
  </div>
  <aside class="stack">
    <section class="card side">
      <dl class="kv">
        <dt>Owner</dt><dd>${d.assignee ? esc(nameOf(d.assignee)) : 'Up for grabs'}</dd>
        <dt>Client</dt><dd>${esc(clientName)}</dd>
        ${d.due ? `<dt>Due</dt><dd>${esc(d.due)}</dd>` : ''}
        ${d.meet_with ? `<dt>Meet with</dt><dd>${esc([].concat(d.meet_with).map(nameOf).join(', '))}${d.meeting_at ? `, ${esc(d.meeting_at)}` : ''}</dd>` : ''}
      </dl>
      <form data-tool="update_task" class="stack side-form"><input type="hidden" name="task" value="${esc(t.id)}">
        ${field('Stage', select('status', STATUSES.map((x) => [x, STATUS_LABEL[x]]), d.status))}
        ${field('Owner', select('assignee', [['nobody', 'Up for grabs'], ...people], d.assignee ?? 'nobody'))}
        <div class="grid two">${field('Due', `<input class="input" type="date" name="due" value="${esc(d.due ?? '')}">`)}${field('Priority', select('priority', PRIORITIES.map((x) => [x, cap(x)]), d.priority ?? 'normal'))}</div>
        <p class="form-error"></p><button class="btn btn-sm btn-secondary">Save changes</button>
      </form>
    </section>
    <details class="card side"><summary>Hand off to someone</summary>
      <form data-tool="hand_off" class="stack side-form"><input type="hidden" name="task" value="${esc(t.id)}">
        ${field('To', select('to', people.filter(([pid]) => pid !== s.me.id), from !== s.me.id ? from : undefined))}
        ${field('What I did', '<textarea class="textarea" name="what_i_did" required rows="3"></textarea>')}
        ${field("What's next", '<textarea class="textarea" name="whats_next" required rows="3"></textarea>')}
        ${field('Links, one per line', '<textarea class="textarea" name="links" data-list rows="2"></textarea>')}
        <label class="check"><input type="checkbox" name="needs" value="review"> For their review</label>
        <p class="form-error"></p><button class="btn btn-sm">Hand off</button>
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

const inlineMd = (x) => markdown(x).replace(/^<p>|<\/p>$/g, '');
const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);

// ---------- idea ----------

async function renderIdea(ctx, id) {
  const { s, team } = ctx;
  const idea = await s.get(`ideas/${String(id).replace(/[^\w.-]/g, '')}.md`);
  if (!idea) return shell(ctx, { title: 'Not found', current: 'board', body: '<div class="empty">That idea does not exist.</div><p><a href="/board">Back to the board</a></p>' });
  const d = idea.data;
  const clients = await s.clients();
  const nameOf = (pid) => team.find((p) => p.id === pid)?.name ?? pid;
  const [body, thread = ''] = idea.body.split(/(?:^|\n)## Thread\n?/);
  return shell(ctx, {
    title: d.title,
    current: 'board',
    body: `
<div class="crumbs"><a href="/board">Board</a> / Ideas</div>
<h1 class="idea-head" data-item="${esc(idea.id)}">${esc(d.title)}</h1>
<p class="small dim">${esc(nameOf(d.created_by))}, ${esc(d.created ?? '')}${d.client ? ` · ${esc(clients.find((c) => c.client === d.client)?.name ?? d.client)}` : ''}</p>
<div class="split">
  <div class="stack">
    <article class="prose">${markdown(body) || '<p class="dim">No details.</p>'}</article>
    <section class="stack"><h3>Thread</h3><ul class="list small" id="feed" data-order="oldest-first">${thread.split('\n').filter((l) => l.startsWith('- ')).map((l) => `<li>${esc(l.slice(2))}</li>`).join('') || '<li class="dim">No replies yet.</li>'}</ul></section>
    <form data-tool="comment" class="stack" data-optimistic="comment"><input type="hidden" name="item" value="${esc(idea.path)}">
      ${field('Reply', '<textarea class="textarea" name="text" required></textarea>')}<p class="form-error"></p><div><button class="btn btn-secondary">Reply</button></div></form>
  </div>
  <aside><form data-tool="add_task" class="card stack" data-next="/board">
    <span class="label">Turn into a task</span>
    <input type="hidden" name="title" value="${esc(d.title)}"><input type="hidden" name="details" value="${esc(`From the idea: ${d.title}\n\n${body.trim()}`)}">
    ${field('Client', select('client', clients.map((c) => [c.client, c.name ?? c.client]), d.client))}
    ${field('Owner', select('assignee', [['me', 'Me'], ['nobody', 'Nobody (up for grabs)'], ...team.filter((p) => p.id !== s.me.id).map((p) => [p.id, p.name])], 'me'))}
    <p class="form-error"></p><button class="btn btn-sm">Create task</button>
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
  const item = (a, isNew) => `<li>${isNew ? '<span class="chip chip-accent">New</span> ' : ''}<b>${esc(firstName(nameOf(a.data.from)))}</b>: ${esc(a.body)}${a.data.link?.includes('/tasks/') ? ` <a href="/board/t/${encodeURIComponent(a.data.link.split('/').pop().replace(/\.md$/, ''))}">Open</a>` : ''}<div class="small dim">${esc(String(a.data.created ?? '').slice(0, 16).replace('T', ' '))}</div></li>`;
  return shell(ctx, {
    title: 'Alerts',
    current: 'alerts',
    body: `
<div class="toolbar"><h1 style="margin:0">Alerts</h1>${unread.length ? '<form data-tool="my_alerts"><button class="btn btn-sm">Mark all read</button></form>' : ''}</div>
<ul class="list">${all.slice(0, 50).map((a) => item(a, unread.includes(a))).join('') || '<li class="dim">No alerts.</li>'}</ul>`,
  });
}

// ---------- helpers ----------

const field = (label, control) => `<label class="field"><span class="label">${label}</span>${control}</label>`;
const select = (name, opts, selected) => `<select class="select" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

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
      var nav = doc.querySelector('.header .nav'); if (nav) document.querySelector('.header .nav').innerHTML = nav.innerHTML;
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
      c.addEventListener('dragstart', function (e) { dragged = c; e.dataTransfer.effectAllowed = 'move'; });
    });
    document.querySelectorAll('[data-status]').forEach(function (col) {
      if (col.dataset.bound) return; col.dataset.bound = '1';
      col.addEventListener('dragover', function (e) { if (dragged) { e.preventDefault(); col.classList.add('drop-target'); } });
      col.addEventListener('dragleave', function () { col.classList.remove('drop-target'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault(); col.classList.remove('drop-target');
        var card = dragged; dragged = null;
        if (!card) return;
        var from = card.parentNode, next = card.nextSibling, cards = col.querySelector('.kanban-cards');
        var empty = cards.querySelector('.empty'); if (empty) empty.remove();
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
    document.querySelectorAll('.decide-more').forEach(function (x) { if (x !== f) x.hidden = true; });
    f.hidden = !f.hidden; if (!f.hidden) { var ta = f.querySelector('textarea'); if (ta) ta.focus(); }
  });
  var dragged = null;
  bind();
})();
`;
