// The web board: everything an agent can do, by clicking. Every action posts to /v1/<tool>, the same tools
// the agents call, with the same access rules. Pages: the board, a task, an idea, alerts.
import css from './ui/wos-css.mjs';
import { renderKanban, esc, firstName, yourTurn } from './kanban.mjs';
import { loadBrand } from './brand.mjs';
import { markdown } from './markdown.mjs';
import { STATUSES, PRIORITIES } from './workspace.mjs';

const STATUS_LABEL = { todo: 'TO DO', doing: 'DOING', waiting: 'WAITING', review: 'REVIEW', done: 'DONE' };

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
</style></head><body>
<header class="header"><div class="wrap${wide ? ' wide' : ''}">
  <a class="brand" href="/board">${brand.logo ? `<img src="/brand/${esc(brand.logo)}" alt="">` : ''}<span>${esc(brand.name)}</span></a>
  <nav class="nav" aria-label="Main">${link('/board', 'BOARD', 'board')}${link('/board/alerts', `ALERTS${unread ? ` (${unread})` : ''}`, 'alerts')}<a href="/logout">SIGN OUT ${esc(firstName(s.me.name).toUpperCase())}</a></nav>
</div></header>
<main class="wrap page stack${wide ? ' wide' : ''}">${body}</main>
<script>${CLIENT}</script>
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
  <nav class="tabs" aria-label="Filter">${tab('/board', 'ALL', !slug && !mine)}${tab('/board?view=mine', `MINE${turns ? ` · ${turns} YOUR TURN` : ''}`, mine)}${clients.map((c) => tab(`/board?client=${encodeURIComponent(c.client)}`, c.name ?? c.client, slug === c.client)).join('')}</nav>
  <div class="row"><button class="btn btn-secondary btn-sm" data-open="new-idea">NEW IDEA</button><button class="btn btn-sm" data-open="new-task">NEW TASK</button></div>
</div>
${renderKanban({ tasks, ideas, clients, people: team, me: s.me.id, interactive: true, href: (x, kind) => `/board/${kind === 'idea' ? 'i' : 't'}/${encodeURIComponent(x.id)}` })}
<p class="small dim">Drag a card to change its stage. Open a card to review, assign, comment or hand it off. Your agent can do all of this too.</p>

<dialog class="dialog" id="new-task"><form data-tool="add_task" class="stack">
  <h3>New task</h3>
  ${field('WHAT', `<input class="input" name="title" required placeholder="Start with a verb: Draft the PTO policy">`)}
  ${field('CLIENT', select('client', clients.map((c) => [c.client, c.name ?? c.client]), slug))}
  ${field('OWNER', select('assignee', [['me', 'Me'], ['nobody', 'Nobody (up for grabs)'], ...team.filter((p) => p.id !== s.me.id).map((p) => [p.id, p.name])], 'me'))}
  <div class="grid">${field('DUE', '<input class="input" type="date" name="due">')}${field('PRIORITY', select('priority', PRIORITIES.map((p) => [p, p]), 'normal'))}</div>
  ${field('DETAILS', '<textarea class="textarea" name="details" placeholder="Context, links, what done looks like"></textarea>')}
  <p class="form-error"></p>
  <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>CANCEL</button><button class="btn">CREATE</button></div>
</form></dialog>

<dialog class="dialog" id="new-idea"><form data-tool="add_idea" class="stack">
  <h3>New idea</h3>
  ${field('IDEA', '<input class="input" name="title" required>')}
  ${field('CLIENT (OPTIONAL)', select('client', [['', 'Not about one client'], ...clients.map((c) => [c.client, c.name ?? c.client])], slug ?? ''))}
  ${field('DETAILS', '<textarea class="textarea" name="body"></textarea>')}
  <p class="form-error"></p>
  <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>CANCEL</button><button class="btn">POST</button></div>
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
  const links = linksOf(top);
  const reviewer = d.status === 'review' && d.assignee === s.me.id;
  const from = d.handed_by ?? d.created_by;
  const people = team.map((p) => [p.id, p.name]);

  const reviewPanel = reviewer ? `
<section class="notice stack">
  <p class="label" style="margin:0">YOUR REVIEW</p>
  <p style="margin:0">${esc(firstName(nameOf(from)))} handed this to you for review.${d.next_step ? ` <b>Asked:</b> ${esc(d.next_step)}` : ''}</p>
  ${links.length ? `<div class="linkbtns">${links.map((l) => `<a class="btn btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">OPEN ${esc(l.label.toUpperCase())}</a>`).join('')}</div>` : ''}
  <div class="grid">
    <form data-tool="update_task" class="card stack"><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="status" value="done">
      <span class="label">APPROVE</span>${field('NOTE (OPTIONAL)', '<textarea class="textarea" name="comment" placeholder="Approved."></textarea>')}<p class="form-error"></p><button class="btn">APPROVE</button></form>
    <form data-tool="hand_off" class="card stack"><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="to" value="${esc(from)}"><input type="hidden" name="what_i_did" value="Reviewed it">
      <span class="label">SEND BACK</span>${field(`WHAT ${esc(firstName(nameOf(from)).toUpperCase())} SHOULD CHANGE`, '<textarea class="textarea" name="whats_next" required></textarea>')}<p class="form-error"></p><button class="btn btn-secondary">SEND BACK</button></form>
    <form data-tool="meet_to_discuss" class="card stack"><input type="hidden" name="task" value="${esc(t.id)}"><input type="hidden" name="with" value="${esc(from)}"><input type="hidden" name="owner" value="${esc(s.me.id)}">
      <span class="label">MEET TO DISCUSS</span>${field('WHAT TO DECIDE', '<textarea class="textarea" name="agenda"></textarea>')}<p class="form-error"></p><button class="btn btn-secondary">MEET</button></form>
  </div>
</section>` : '';

  return shell(ctx, {
    title: d.title,
    current: 'board',
    body: `
<div class="crumbs"><a href="/board">Board</a> / <a href="/board?client=${encodeURIComponent(d.client)}">${esc(clientName)}</a></div>
<h1>${esc(d.title)}</h1>
<div class="row">
  <span class="status">${esc(STATUS_LABEL[d.status] ?? d.status)}</span>
  ${yourTurn(d, s.me.id) ? '<span class="kcard-turn">YOUR TURN</span>' : ''}
  ${d.sent_back && d.status !== 'done' ? '<span class="kcard-flag">SENT BACK</span>' : ''}
  ${d.waiting_for ? `<span class="kcard-flag">${esc(String(d.waiting_for).toUpperCase())}</span>` : ''}
  ${['high', 'urgent'].includes(d.priority) ? `<span class="kcard-flag">${esc(d.priority.toUpperCase())}</span>` : ''}
</div>
${reviewPanel}
<div class="split">
  <div class="stack">
    ${!reviewer && links.length ? `<div class="linkbtns">${links.map((l) => `<a class="btn btn-secondary btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">OPEN ${esc(l.label.toUpperCase())}</a>`).join('')}</div>` : ''}
    <article class="prose">${markdown(top) || '<p class="dim">No details yet.</p>'}</article>
    <section class="stack"><h3>ACTIVITY</h3><ul class="list small">${activity.split('\n').filter((l) => l.startsWith('- ')).reverse().map((l) => `<li>${esc(l.slice(2))}</li>`).join('') || '<li class="dim">Nothing yet.</li>'}</ul></section>
    <form data-tool="comment" class="stack"><input type="hidden" name="item" value="${esc(t.path)}">
      ${field('COMMENT', '<textarea class="textarea" name="text" required placeholder="Progress, a question, a decision"></textarea>')}<p class="form-error"></p><div><button class="btn btn-secondary">COMMENT</button></div></form>
  </div>
  <aside class="stack">
    <dl class="kv card">
      <dt>CLIENT</dt><dd>${esc(clientName)}</dd>
      <dt>OWNER</dt><dd>${d.assignee ? esc(nameOf(d.assignee)) : 'Up for grabs'}</dd>
      ${d.due ? `<dt>DUE</dt><dd>${esc(d.due)}</dd>` : ''}
      <dt>PRIORITY</dt><dd>${esc(d.priority ?? 'normal')}</dd>
      ${d.handed_by ? `<dt>FROM</dt><dd>${esc(nameOf(d.handed_by))}, ${esc(d.handed_on ?? '')}</dd>` : ''}
      ${d.meet_with ? `<dt>MEET WITH</dt><dd>${esc([].concat(d.meet_with).map(nameOf).join(', '))}${d.meeting_at ? `, ${esc(d.meeting_at)}` : ''}</dd>` : ''}
      <dt>CREATED</dt><dd>${esc(nameOf(d.created_by))}, ${esc(d.created ?? '')}</dd>
    </dl>
    <form data-tool="update_task" class="card stack"><input type="hidden" name="task" value="${esc(t.id)}">
      <span class="label">CHANGE</span>
      ${field('STAGE', select('status', STATUSES.map((x) => [x, STATUS_LABEL[x]]), d.status))}
      ${field('OWNER', select('assignee', [['nobody', 'Nobody (up for grabs)'], ...people], d.assignee ?? 'nobody'))}
      ${field('DUE', `<input class="input" type="date" name="due" value="${esc(d.due ?? '')}">`)}
      ${field('PRIORITY', select('priority', PRIORITIES.map((x) => [x, x]), d.priority ?? 'normal'))}
      <p class="form-error"></p><button class="btn btn-sm">SAVE</button>
    </form>
    <details class="card stack"><summary>HAND OFF</summary>
      <form data-tool="hand_off" class="stack" style="margin-top:var(--s3)"><input type="hidden" name="task" value="${esc(t.id)}">
        ${field('TO', select('to', people.filter(([pid]) => pid !== s.me.id), from !== s.me.id ? from : undefined))}
        ${field('WHAT I DID', '<textarea class="textarea" name="what_i_did" required></textarea>')}
        ${field("WHAT'S NEXT", '<textarea class="textarea" name="whats_next" required></textarea>')}
        ${field('LINKS (ONE PER LINE)', '<textarea class="textarea" name="links" data-list></textarea>')}
        <label class="check"><input type="checkbox" name="needs" value="review"> For their review</label>
        <p class="form-error"></p><button class="btn btn-sm">HAND OFF</button>
      </form>
    </details>
  </aside>
</div>`,
  });
}

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
<h1>${esc(d.title)}</h1>
<p class="small dim">${esc(nameOf(d.created_by))}, ${esc(d.created ?? '')}${d.client ? ` · ${esc(clients.find((c) => c.client === d.client)?.name ?? d.client)}` : ''}</p>
<div class="split">
  <div class="stack">
    <article class="prose">${markdown(body) || '<p class="dim">No details.</p>'}</article>
    <section class="stack"><h3>THREAD</h3><ul class="list small">${thread.split('\n').filter((l) => l.startsWith('- ')).map((l) => `<li>${esc(l.slice(2))}</li>`).join('') || '<li class="dim">No replies yet.</li>'}</ul></section>
    <form data-tool="comment" class="stack"><input type="hidden" name="item" value="${esc(idea.path)}">
      ${field('REPLY', '<textarea class="textarea" name="text" required></textarea>')}<p class="form-error"></p><div><button class="btn btn-secondary">REPLY</button></div></form>
  </div>
  <aside><form data-tool="add_task" class="card stack" data-next="/board">
    <span class="label">TURN INTO A TASK</span>
    <input type="hidden" name="title" value="${esc(d.title)}"><input type="hidden" name="details" value="${esc(`From the idea: ${d.title}\n\n${body.trim()}`)}">
    ${field('CLIENT', select('client', clients.map((c) => [c.client, c.name ?? c.client]), d.client))}
    ${field('OWNER', select('assignee', [['me', 'Me'], ['nobody', 'Nobody (up for grabs)'], ...team.filter((p) => p.id !== s.me.id).map((p) => [p.id, p.name])], 'me'))}
    <p class="form-error"></p><button class="btn btn-sm">CREATE TASK</button>
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
  const item = (a, isNew) => `<li>${isNew ? '<span class="status">NEW</span> ' : ''}<b>${esc(firstName(nameOf(a.data.from)))}</b>: ${esc(a.body)}${a.data.link?.includes('/tasks/') ? ` <a href="/board/t/${encodeURIComponent(a.data.link.split('/').pop().replace(/\.md$/, ''))}">Open</a>` : ''}<div class="small dim">${esc(String(a.data.created ?? '').slice(0, 16).replace('T', ' '))}</div></li>`;
  return shell(ctx, {
    title: 'Alerts',
    current: 'alerts',
    body: `
<div class="toolbar"><h1 style="margin:0">Alerts</h1>${unread.length ? '<form data-tool="my_alerts"><button class="btn btn-sm">MARK ALL READ</button></form>' : ''}</div>
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
  document.querySelectorAll('form[data-tool]').forEach(function (f) {
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
      var btn = f.querySelector('button:not([type=button])'), err = f.querySelector('.form-error');
      if (btn) btn.disabled = true;
      if (err) err.textContent = '';
      ak(f.getAttribute('data-tool'), args).then(function () {
        location.href = f.getAttribute('data-next') || location.href;
      }).catch(function (x) { if (err) err.textContent = x.message; if (btn) btn.disabled = false; });
    });
  });
  document.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { document.getElementById(b.getAttribute('data-open')).showModal(); }); });
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  var dragged = null;
  document.querySelectorAll('[data-task]').forEach(function (c) {
    c.addEventListener('dragstart', function (e) { dragged = c.getAttribute('data-task'); e.dataTransfer.effectAllowed = 'move'; });
  });
  document.querySelectorAll('[data-status]').forEach(function (col) {
    col.addEventListener('dragover', function (e) { if (dragged) { e.preventDefault(); col.classList.add('drop-target'); } });
    col.addEventListener('dragleave', function () { col.classList.remove('drop-target'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('drop-target');
      if (!dragged) return;
      ak('update_task', { task: dragged, status: col.getAttribute('data-status') }).then(function () { location.reload(); }).catch(function (x) { alert(x.message); });
    });
  });
})();
`;
