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

// tasks: [{ id, data }] as the workspace loads them. people: [{ id, name }]. clients: [{ client, name }].
export function renderKanban({ tasks, people = [], clients = [], doneDays = 14, today = new Date().toISOString().slice(0, 10) }) {
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? id;
  const clientName = (c) => clients.find((x) => x.client === c)?.name ?? c;
  const cutoff = new Date(Date.parse(today) - doneDays * 864e5).toISOString().slice(0, 10);
  const shown = tasks.filter((t) => t.data.status !== 'done' || String(t.data.completed ?? t.data.created ?? '') >= cutoff);

  const cols = COLUMNS.map(([key, label]) => {
    const cards = shown.filter((t) => (t.data.status ?? 'todo') === key).sort(order);
    return `<section class="kanban-col" aria-label="${label}">
  <div class="kanban-col-head"><span class="label">${label}</span><span class="count">${cards.length}</span></div>
  <div class="kanban-cards">${cards.map((t) => card(t, { nameOf, clientName, today })).join('') || '<div class="empty small">NOTHING</div>'}</div>
</section>`;
  });
  return `<div class="kanban">${cols.join('')}</div>`;
}

function card(t, { nameOf, clientName, today }) {
  const d = t.data;
  const owner = d.assignee ? nameOf(d.assignee) : null;
  const flags = [
    d.sent_back && d.status !== 'done' ? 'SENT BACK' : null,
    d.status === 'review' && d.handed_by ? `FROM ${firstName(nameOf(d.handed_by)).toUpperCase()}` : null,
    d.waiting_for ? String(d.waiting_for).toUpperCase() : null,
    ['high', 'urgent'].includes(d.priority) ? String(d.priority).toUpperCase() : null,
    d.due && String(d.due) < today && d.status !== 'done' ? 'OVERDUE' : null,
  ].filter(Boolean);
  return `<article class="kcard">
  <div class="kcard-title">${esc(d.title)}</div>
  ${flags.length ? `<div class="kcard-meta">${flags.map((f) => `<span class="kcard-flag">${esc(f)}</span>`).join('')}</div>` : ''}
  ${d.next_step && d.status !== 'done' ? `<div class="kcard-next">NEXT: ${esc(d.next_step)}</div>` : ''}
  <div class="kcard-meta">
    ${owner ? `<span class="avatar" title="${esc(owner)}">${esc(initials(owner))}</span>` : '<span class="avatar avatar-empty" title="Unassigned">?</span>'}
    <span>${owner ? esc(firstName(owner)) : 'UP FOR GRABS'}</span>
    ${d.client ? `<span class="tag">${esc(clientName(d.client))}</span>` : ''}
    ${d.due ? `<span>DUE ${esc(d.due)}</span>` : ''}
  </div>
</article>`;
}

const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
const order = (a, b) => (rank[a.data.priority] ?? 2) - (rank[b.data.priority] ?? 2) || String(a.data.due ?? '9999').localeCompare(String(b.data.due ?? '9999'));
const firstName = (n) => String(n).split(' ')[0];
const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
