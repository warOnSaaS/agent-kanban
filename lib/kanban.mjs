// The board as columns and cards, from plain data. One renderer for the /board page,
// the in-chat board (view_kanban) and the example on the warOnSaaS site.
// Styles come from the ui-design kit (ui-board, ui-lane, ui-kcard; lib/ui/kit.css). The first kit's class names
// (kanban, kcard) are kept beside them so pages still styled by that kit keep working.

export const COLUMNS = [
  ['todo', 'To do'],
  ['doing', 'Doing'],
  ['waiting', 'Waiting'],
  ['review', 'Review'],
  ['done', 'Done'],
];
const DOT = { ideas: '', todo: '', doing: ' is-ink', waiting: '', review: ' is-accent', done: ' is-good' };

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
  return `<div class="ui-board kanban">${cols.join('')}</div>`;
}

function column(key, label, cards, droppable) {
  return `<section class="ui-lane kanban-col" aria-label="${label}"${droppable ? ` data-status="${key}"` : ''}>
  <div class="ui-lane-h kanban-col-head"><span class="ui-dot dot${DOT[key] ?? ''}"></span><b class="name">${label}</b><span class="ui-count count">${cards.length}</span></div>
  <div class="ui-lane-cards kanban-cards">${cards.join('') || `<div class="ui-lane-empty kanban-empty">${droppable ? 'Drop a card here' : 'Nothing yet'}</div>`}</div>
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
    yourTurn(d, me) ? ['Your turn', 'is-accent'] : null,
    d.sent_back && d.status !== 'done' ? ['Sent back', 'is-soft'] : null,
    d.status === 'review' && d.handed_by ? [`From ${firstName(nameOf(d.handed_by))}`, ''] : null,
    d.waiting_for ? [cap(d.waiting_for), ''] : null,
    ['high', 'urgent'].includes(d.priority) ? [cap(d.priority), 'is-soft'] : null,
    d.due && String(d.due) < today && d.status !== 'done' ? ['Overdue', 'is-bad'] : null,
  ].filter(Boolean);
  const tag = href ? 'a' : 'article';
  const attrs = [href ? `href="${esc(href(t, 'task'))}"` : '', interactive ? `draggable="true" data-task="${esc(t.id)}"` : '', `data-item="${esc(t.id)}"`].filter(Boolean).join(' ');
  return `<${tag} class="ui-kcard kcard${yourTurn(d, me) ? ' is-turn' : ''}"${attrs ? ' ' + attrs : ''}>
  ${chips.length ? `<div class="ui-kcard-chips kcard-chips">${chips.map(([l, c]) => `<span class="ui-chip chip${c ? ' ' + c + ' chip-' + c.slice(3) : ''}">${esc(l)}</span>`).join('')}</div>` : ''}
  <div class="ui-kcard-t kcard-title">${esc(d.title)}</div>
  ${d.next_step && d.status !== 'done' ? `<div class="ui-kcard-next kcard-next">${esc(d.next_step)}</div>` : ''}
  <div class="ui-kcard-f kcard-foot">
    <span class="client">${d.client ? esc(clientName(d.client)) : ''}${d.due ? ` · Due ${esc(d.due)}` : ''}</span>
    <span class="who">${owner ? `<span class="ui-avatar avatar" data-tone="${tone(owner)}" title="${esc(owner)}">${esc(initials(owner))}</span>` : '<span class="ui-avatar is-empty avatar avatar-empty" title="Up for grabs">?</span>'}</span>
  </div>
</${tag}>`;
}

function ideaCard(i, { nameOf, clientName, href }) {
  const d = i.data;
  const by = nameOf(d.created_by);
  const tag = href ? 'a' : 'article';
  return `<${tag} class="ui-kcard kcard"${href ? ` href="${esc(href(i, 'idea'))}"` : ''} data-item="${esc(i.id)}">
  ${d.status && d.status !== 'new' ? `<div class="ui-kcard-chips kcard-chips"><span class="ui-chip chip">${esc(cap(d.status))}</span></div>` : ''}
  <div class="ui-kcard-t kcard-title">${esc(d.title)}</div>
  <div class="ui-kcard-f kcard-foot">
    <span class="client">${d.client ? esc(clientName(d.client)) : 'General'}</span>
    <span class="who"><span class="ui-avatar avatar" data-tone="${tone(by)}" title="${esc(by)}">${esc(initials(by))}</span></span>
  </div>
</${tag}>`;
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
const order = (a, b) => (rank[a.data.priority] ?? 2) - (rank[b.data.priority] ?? 2) || String(a.data.due ?? '9999').localeCompare(String(b.data.due ?? '9999'));
export const firstName = (n) => String(n).split(' ')[0];
// A steady soft colour per person, from the kit's six tones.
export const tone = (n) => [...String(n)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7) % 6;
export const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
