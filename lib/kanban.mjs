// The board as columns and cards, from plain data. One renderer for the /board page,
// the in-chat board (view_kanban) and the example on the warOnSaaS site.
// Styles come from the wOS UI kit (lib/ui/wos.css, synced from warOnSaaS/site).

export const COLUMNS = [
  ['todo', 'TO DO'],
  ['doing', 'DOING'],
  ['waiting', 'WAITING'],
  ['review', 'REVIEW'],
  ['done', 'DONE'],
];

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
    cols.push(column('ideas', 'IDEAS', open.map((i) => ideaCard(i, ctx)), false));
  }
  for (const [key, label] of COLUMNS) {
    const cards = shown.filter((t) => (t.data.status ?? 'todo') === key).sort(order);
    cols.push(column(key, label, cards.map((t) => taskCard(t, ctx)), interactive));
  }
  return `<div class="kanban">${cols.join('')}</div>`;
}

function column(key, label, cards, droppable) {
  return `<section class="kanban-col" aria-label="${label}"${droppable ? ` data-status="${key}"` : ''}>
  <div class="kanban-col-head"><span class="label">${label}</span><span class="count">${cards.length}</span></div>
  <div class="kanban-cards">${cards.join('') || '<div class="empty small">NOTHING</div>'}</div>
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
  const flags = [
    d.sent_back && d.status !== 'done' ? 'SENT BACK' : null,
    d.status === 'review' && d.handed_by ? `FROM ${firstName(nameOf(d.handed_by)).toUpperCase()}` : null,
    d.waiting_for ? String(d.waiting_for).toUpperCase() : null,
    ['high', 'urgent'].includes(d.priority) ? String(d.priority).toUpperCase() : null,
    d.due && String(d.due) < today && d.status !== 'done' ? 'OVERDUE' : null,
  ].filter(Boolean);
  const turn = yourTurn(d, me);
  const tag = href ? 'a' : 'article';
  const attrs = [href ? `href="${esc(href(t, 'task'))}"` : '', interactive ? `draggable="true" data-task="${esc(t.id)}"` : ''].filter(Boolean).join(' ');
  return `<${tag} class="kcard"${attrs ? ' ' + attrs : ''}>
  <div class="kcard-title">${esc(d.title)}</div>
  ${turn || flags.length ? `<div class="kcard-meta">${turn ? '<span class="kcard-turn">YOUR TURN</span>' : ''}${flags.map((f) => `<span class="kcard-flag">${esc(f)}</span>`).join('')}</div>` : ''}
  ${d.next_step && d.status !== 'done' ? `<div class="kcard-next">NEXT: ${esc(d.next_step)}</div>` : ''}
  <div class="kcard-meta">
    ${owner ? `<span class="avatar" title="${esc(owner)}">${esc(initials(owner))}</span>` : '<span class="avatar avatar-empty" title="Unassigned">?</span>'}
    <span>${owner ? esc(firstName(owner)) : 'UP FOR GRABS'}</span>
    ${d.client ? `<span class="tag">${esc(clientName(d.client))}</span>` : ''}
    ${d.due ? `<span>DUE ${esc(d.due)}</span>` : ''}
  </div>
</${tag}>`;
}

function ideaCard(i, { nameOf, clientName, href }) {
  const d = i.data;
  const replies = (String(i.body).split('## Thread')[1] ?? '').split('\n').filter((l) => l.startsWith('- ')).length;
  const tag = href ? 'a' : 'article';
  return `<${tag} class="kcard"${href ? ` href="${esc(href(i, 'idea'))}"` : ''}>
  <div class="kcard-title">${esc(d.title)}</div>
  <div class="kcard-meta">
    <span class="avatar" title="${esc(nameOf(d.created_by))}">${esc(initials(nameOf(d.created_by)))}</span>
    <span>${esc(firstName(nameOf(d.created_by)))}</span>
    ${d.client ? `<span class="tag">${esc(clientName(d.client))}</span>` : ''}
    ${replies ? `<span>${replies} ${replies === 1 ? 'REPLY' : 'REPLIES'}</span>` : ''}
  </div>
</${tag}>`;
}

const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
const order = (a, b) => (rank[a.data.priority] ?? 2) - (rank[b.data.priority] ?? 2) || String(a.data.due ?? '9999').localeCompare(String(b.data.due ?? '9999'));
export const firstName = (n) => String(n).split(' ')[0];
export const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
