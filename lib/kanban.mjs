// The board as columns and cards, from plain data. One renderer for the /board page,
// the in-chat board (view_kanban) and the example on the warOnSaaS site.
// Styles come from the wOS UI kit (lib/ui/wos.css, synced from warOnSaaS/site).

export const COLUMNS = [
  ['todo', 'To do'],
  ['doing', 'Doing'],
  ['waiting', 'Waiting'],
  ['review', 'Review'],
  ['done', 'Done'],
];
const DOT = { ideas: '', todo: '', doing: ' dot-fg', waiting: '', review: ' dot-accent', done: '' };

// tasks/ideas: [{ id, data }] as the workspace loads them. people: [{ id, name }]. clients: [{ client, name }].
// me: the viewer's id, for YOUR TURN. href(item, kind): link for a card. interactive: cards can be dragged.
export function renderKanban({ tasks, ideas = null, people = [], clients = [], doneDays = 14, today = new Date().toISOString().slice(0, 10), me = null, href = null, interactive = false }) {
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? id;
  const clientName = (c) => clients.find((x) => x.client === c)?.name ?? c;
  const cutoff = new Date(Date.parse(today) - doneDays * 864e5).toISOString().slice(0, 10);
  const shown = tasks.filter((t) => t.data.status !== 'done' || String(t.data.completed ?? t.data.created ?? '') >= cutoff);
  const ctx = { nameOf, clientName, today, me, href, interactive };

  const cols = [];
  if (ideas) {
    const open = ideas.filter((i) => !['done', 'dropped', 'task'].includes(i.data.status));
    cols.push(column('ideas', 'Ideas', open.map((i) => ideaCard(i, ctx)), false));
  }
  for (const [key, label] of COLUMNS) {
    const cards = shown.filter((t) => (t.data.status ?? 'todo') === key).sort(order);
    cols.push(column(key, label, cards.map((t) => taskCard(t, ctx)), interactive));
  }
  return `<div class="kanban">${cols.join('')}</div>`;
}

function column(key, label, cards, droppable) {
  return `<section class="kanban-col" aria-label="${label}"${droppable ? ` data-status="${key}"` : ''}>
  <div class="kanban-col-head"><span class="dot${DOT[key] ?? ''}"></span><span class="name">${label}</span><span class="count">${cards.length}</span></div>
  <div class="kanban-cards">${cards.join('') || `<div class="kanban-empty">${droppable ? 'Drop a card here' : 'Nothing yet'}</div>`}</div>
</section>`;
}

// Whose move it is: assigned to them and not parked, or they set up a meeting that isn't booked yet.
export const yourTurn = (d, me) => !!me && d.status !== 'done' && (
  (d.assignee === me && !(d.status === 'waiting' && d.waiting_for !== 'meet to discuss')) ||
  (d.waiting_for === 'meet to discuss' && d.meeting_owner === me && !d.meeting_at)
);

function taskCard(t, { nameOf, clientName, today, me, href, interactive }) {
  const d = t.data;
  const owner = d.assignee ? nameOf(d.assignee) : null;
  const chips = [
    yourTurn(d, me) ? ['Your turn', 'chip-accent'] : null,
    d.sent_back && d.status !== 'done' ? ['Sent back', 'chip-soft'] : null,
    d.status === 'review' && d.handed_by ? [`From ${firstName(nameOf(d.handed_by))}`, ''] : null,
    d.waiting_for ? [cap(d.waiting_for), ''] : null,
    ['high', 'urgent'].includes(d.priority) ? [cap(d.priority), 'chip-soft'] : null,
    d.due && String(d.due) < today && d.status !== 'done' ? ['Overdue', 'chip-soft'] : null,
  ].filter(Boolean);
  const tag = href ? 'a' : 'article';
  const attrs = [href ? `href="${esc(href(t, 'task'))}"` : '', interactive ? `draggable="true" data-task="${esc(t.id)}"` : ''].filter(Boolean).join(' ');
  return `<${tag} class="kcard"${attrs ? ' ' + attrs : ''}>
  ${chips.length ? `<div class="kcard-chips">${chips.map(([l, c]) => `<span class="chip${c ? ' ' + c : ''}">${esc(l)}</span>`).join('')}</div>` : ''}
  <div class="kcard-title">${esc(d.title)}</div>
  ${d.next_step && d.status !== 'done' ? `<div class="kcard-next">${esc(d.next_step)}</div>` : ''}
  <div class="kcard-foot">
    <span class="client">${d.client ? esc(clientName(d.client)) : ''}${d.due ? ` · Due ${esc(d.due)}` : ''}</span>
    <span class="who">${owner ? `<span class="avatar" title="${esc(owner)}">${esc(initials(owner))}</span>` : '<span class="avatar avatar-empty" title="Up for grabs">?</span>'}</span>
  </div>
</${tag}>`;
}

function ideaCard(i, { nameOf, clientName, href }) {
  const d = i.data;
  const by = nameOf(d.created_by);
  const tag = href ? 'a' : 'article';
  return `<${tag} class="kcard"${href ? ` href="${esc(href(i, 'idea'))}"` : ''}>
  ${d.status && d.status !== 'new' ? `<div class="kcard-chips"><span class="chip">${esc(cap(d.status))}</span></div>` : ''}
  <div class="kcard-title">${esc(d.title)}</div>
  <div class="kcard-foot">
    <span class="client">${d.client ? esc(clientName(d.client)) : 'General'}</span>
    <span class="who"><span class="avatar" title="${esc(by)}">${esc(initials(by))}</span></span>
  </div>
</${tag}>`;
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
const order = (a, b) => (rank[a.data.priority] ?? 2) - (rank[b.data.priority] ?? 2) || String(a.data.due ?? '9999').localeCompare(String(b.data.due ?? '9999'));
export const firstName = (n) => String(n).split(' ')[0];
export const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
