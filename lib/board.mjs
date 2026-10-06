// A read-only page per person: the same workspace their AI sees, for a quick look without a chat.

export async function renderBoard(s) {
  const [day, tasks, clients, ideas, o] = await Promise.all([s.myDay(), s.tasks({ status: 'open' }), s.clients(), s.ideas(), s.overview()]);
  const byClient = new Map(clients.map((c) => [c.client, []]));
  for (const t of tasks) (byClient.get(t.data.client) ?? byClient.set(t.data.client, []).get(t.data.client)).push(t);
  const name = (c) => clients.find((x) => x.client === c)?.name ?? c;
  const first = s.me.name.split(' ')[0];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.ws.name)} · agent-kanban</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f4f4f2;--card:#fff;--ink:#111;--muted:#666;--line:#d8d8d4}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#141414;--ink:#e8e8e8;--muted:#8a8a8a;--line:#2a2a2a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.55 "JetBrains Mono","SFMono-Regular",ui-monospace,Menlo,monospace}
main{max-width:1080px;margin:0 auto;padding:28px 16px 64px}h1{font-size:18px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.08em}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:32px 0 10px}
.sub{color:var(--muted);margin:0 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:0;padding:14px 16px}.card h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
ul{list-style:none;margin:0;padding:0}li{padding:7px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
.meta{color:var(--muted);font-size:13px}.late{font-weight:700}.pill{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:0;padding:0 8px;margin-right:6px;color:var(--muted)}
.empty{color:var(--muted);font-style:normal}
.cols{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}@media (max-width:1000px){.cols{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}}
</style></head><body><main>
<h1>${esc(first)}'s workspace</h1>
<p class="sub">Read-only view. To add or change anything, just ask your Claude or ChatGPT.</p>

<div class="grid">
  ${card('New for you, not opened yet', day.unopened.map((t) => taskLi(t).replace('</li>', `<div class="meta">from ${esc(t.data.handed_by ?? t.data.created_by)}${t.data.status === 'review' ? ' · for your review' : ''}</div></li>`)))}
  ${card('Waiting on your review', day.review.map(taskLi))}
  ${card('Meetings', [...day.meetings_scheduled, ...day.meetings_to_set_up].map((t) => `<li>${esc(t.data.title)}<div class="meta">${t.data.meeting_at ? esc(t.data.meeting_at) : `to set up by ${esc(t.data.meeting_owner)}`} · with ${esc([].concat(t.data.meet_with ?? []).join(', '))}</div></li>`))}
  ${card('Overdue', day.overdue.map(taskLi), 'late')}
  ${card('Due this week', day.due_this_week.map(taskLi))}
  ${card(`Unread alerts (${day.alerts.length})`, day.alerts.map((a) => `<li>${esc(a.body)}<div class="meta">from ${esc(a.data.from)}${a.data.client ? ` · ${esc(name(a.data.client))}` : ''}${a.data.urgent ? ' · <span class="late">urgent</span>' : ''}</div></li>`))}
</div>

<h2>Where things stand</h2>
<p class="sub">${Object.values(o.by_status).flat().length} open · ${o.overdue.length} overdue · ${o.unassigned.length} unassigned · ${o.done_recently.length} done in the last 2 weeks</p>
<div class="cols">
  ${[['todo', 'To do'], ['doing', 'In progress'], ['waiting', 'Waiting'], ['review', 'In review']].map(([k, l]) => card(`${l} (${o.by_status[k].length})`, o.by_status[k].map((t) => taskLi(t).replace('</li>', `<div class="meta">${esc(name(t.data.client))}${t.data.next_step ? ` · next: ${esc(t.data.next_step)}` : ''}</div></li>`)))).join('')}
  ${card(`Done, last 2 weeks (${o.done_recently.length})`, o.done_recently.map((t) => taskLi(t).replace('</li>', `<div class="meta">${esc(name(t.data.client))} · ${esc(t.data.completed)}</div></li>`)))}
</div>
<div class="grid" style="margin-top:12px">
  ${card('Who has what', Object.entries(o.people).map(([p, n]) => `<li>${esc(p)}<div class="meta">${n.open} open${n.overdue ? ` · <span class="late">${n.overdue} overdue</span>` : ''}${n.review ? ` · ${n.review} to review` : ''}</div></li>`))}
</div>

<h2>Up for grabs</h2>
<div class="grid">
  ${card('Unassigned', day.up_for_grabs.map(taskLi))}
</div>

<h2>Open work by client</h2>
<div class="grid">
  ${[...byClient].map(([c, ts]) => card(name(c), ts.map(taskLi))).join('')}
</div>

<h2>Ideas board</h2>
<div class="grid">
  ${card('Latest ideas', ideas.slice(0, 12).map((i) => `<li>${esc(i.data.title)}<div class="meta">${esc(i.data.created_by)} · ${esc(i.data.created)}${i.data.client ? ` · ${esc(name(i.data.client))}` : ''}</div></li>`))}
</div>
</main></body></html>`;
}

const card = (title, items, cls = '') => `<section class="card"><h3 class="${cls}">${esc(title)}</h3>${items.length ? `<ul>${items.join('')}</ul>` : '<p class="empty">Nothing here.</p>'}</section>`;
const taskLi = (t) => `<li>${esc(t.data.title)}${t.data.sent_back && t.data.status !== 'done' ? ' <span class="late">[SENT BACK]</span>' : ''}<div class="meta"><span class="pill">${esc(t.data.waiting_for ?? t.data.status)}</span>${esc(t.data.assignee ?? 'unassigned')}${t.data.due ? ` · due ${esc(t.data.due)}` : ''}${['high', 'urgent'].includes(t.data.priority) ? ` · <span class="late">${esc(t.data.priority)}</span>` : ''}</div></li>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
