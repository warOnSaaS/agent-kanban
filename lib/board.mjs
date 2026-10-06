// The /board page: the kanban for everything this person can see, client tabs, and what needs them.
import css from './ui/wos-css.mjs';
import { renderKanban, esc } from './kanban.mjs';

export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">';

export async function renderBoard(s, { client } = {}) {
  const [day, clients, ideas, team] = await Promise.all([s.myDay(), s.clients(), s.ideas(), s.teamList()]);
  const slug = client && clients.some((c) => c.client === client) ? client : null;
  const tasks = await s.tasks(slug ? { client: slug } : {});
  const first = s.me.name.split(' ')[0];
  const forYou = [...day.unopened, ...day.review];
  const tab = (href, label, on) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.ws.name)} · agent-kanban</title><meta name="robots" content="noindex">${FONTS}<style>${css}</style></head><body>
<header class="header"><div class="wrap"><span class="mark">${esc(s.ws.name)}</span><span class="small dim">agent-kanban · ${esc(first)}</span></div></header>
<main class="wrap stack" style="padding-top:var(--s5)">
  <p class="small dim">Read-only. To change anything, tell your agent.</p>
  <nav class="tabs" aria-label="Clients">${tab('/board', 'ALL', !slug)}${clients.map((c) => tab(`/board?client=${encodeURIComponent(c.client)}`, c.name ?? c.client, slug === c.client)).join('')}</nav>
  ${renderKanban({ tasks, people: team, clients })}
  <div class="grid" style="margin-top:var(--s6)">
    <section class="card"><div class="card-head"><span class="label">FOR YOU</span><span class="count">${forYou.length + day.alerts.length}</span></div>
      <ul class="list small">${forYou.map((t) => `<li><span class="status">${t.data.status === 'review' ? 'REVIEW' : 'NEW'}</span> ${esc(t.data.title)}</li>`).join('')}${day.alerts.slice(0, 5).map((a) => `<li><span class="status">ALERT</span> ${esc(a.body)}</li>`).join('') || (forYou.length ? '' : '<li class="dim">Nothing waiting.</li>')}</ul></section>
    <section class="card"><div class="card-head"><span class="label">IDEAS</span><span class="count">${ideas.length}</span></div>
      <ul class="list small">${ideas.slice(0, 8).map((i) => `<li>${esc(i.data.title)} <span class="dim">· ${esc(i.data.created_by)}</span></li>`).join('') || '<li class="dim">No ideas yet.</li>'}</ul></section>
  </div>
</main></body></html>`;
}
