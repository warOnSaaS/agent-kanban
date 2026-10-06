import YAML from 'yaml';
import { parse, stringify, slugify, today, stamp, shortId } from './md.mjs';

// The workspace repo layout:
//   people.yml                      who is on the team, what they can see (never served)
//   clients/<client>/client.md      the client overview
//   clients/<client>/tasks/*.md     one file per task
//   clients/<client>/notes/*.md     meeting notes, call notes, decisions
//   clients/<client>/docs/*         anything else for that client
//   ideas/*.md                      the brainstorm board, open to everyone
//   playbooks/*.md                  how we do things, open to everyone
//   alerts/*.md                     messages between people
//   people/<id>/                    one person's private scratch space
//   internal/                       owner only (pricing, finances, hiring)
// Any file can also carry `private_to: [ids]` to hide it from everyone else.

export const STATUSES = ['todo', 'doing', 'waiting', 'review', 'done'];
export const NOBODY = 'nobody';
export const MEETING = 'meet to discuss';
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export class Workspace {
  constructor(store, { mailer, name } = {}) {
    this.store = store;
    this.mailer = mailer;
    this.name = name || process.env.WORKSPACE_NAME || 'Team';
  }

  async team() {
    const f = await this.store.read('people.yml');
    if (!f) throw new Error('people.yml is missing from the workspace repo');
    return (YAML.parse(f.text)?.people ?? []).map((p) => ({ clients: [], role: 'team', ...p }));
  }

  // Who a GitHub sign-in belongs to: their username in people.yml, or, the first time,
  // a verified GitHub email matching their email there (their username is then saved).
  async personByGithub(login, verifiedEmails = []) {
    const team = await this.team();
    const lc = String(login).toLowerCase();
    const byLogin = team.find((p) => p.github && String(p.github).toLowerCase() === lc);
    if (byLogin) return byLogin;
    const byEmail = team.find((p) => !p.github && p.email && verifiedEmails.includes(String(p.email).toLowerCase()));
    if (!byEmail) return null;
    const f = await this.store.read('people.yml');
    const doc = YAML.parseDocument(f.text);
    const people = doc.get('people');
    const idx = people.items.findIndex((it) => it.get('id') === byEmail.id);
    people.items[idx].set('github', login);
    await this.store.write('people.yml', doc.toString(), { message: `Link ${byEmail.name} to GitHub @${login}`, author: { name: byEmail.name, email: byEmail.email } });
    return { ...byEmail, github: login };
  }

  async noteUnknownSignIn(login) {
    const owner = (await this.team()).find((p) => p.role === 'owner');
    if (owner) await this.as(owner).alert({ to: [owner.id], message: `GitHub user @${login} tried to sign in but isn't in people.yml. Add them there if they should have access.`, quiet: true });
  }

  async inviteToRepo(login) {
    if (this.store.api) await this.store.api(`/collaborators/${login}`, { method: 'PUT', body: JSON.stringify({ permission: 'maintain' }) });
  }

  as(person) {
    return new Session(this, person);
  }
}


export class Session {
  constructor(ws, me) {
    this.ws = ws;
    this.store = ws.store;
    this.me = me;
    this.isOwner = me.role === 'owner';
  }

  // ---------- access ----------

  seesClient(slug) {
    return this.isOwner || this.me.clients === 'all' || (Array.isArray(this.me.clients) && this.me.clients.includes(slug));
  }

  canPath(p) {
    if (p === 'people.yml' || p.startsWith('.')) return false;
    if (p.startsWith('internal/')) return this.isOwner;
    if (p.startsWith('people/')) return p.split('/')[1] === this.me.id;
    if (p.startsWith('clients/')) return this.seesClient(p.split('/')[1]);
    return true;
  }

  canItem(p, data) {
    if (!this.canPath(p)) return false;
    const priv = toList(data?.private_to);
    if (priv.length && !priv.includes(this.me.id) && data.created_by !== this.me.id) return false;
    // "sees: own" in people.yml: only tasks that are theirs, or up for grabs. Others' tasks don't exist for them.
    if (this.me.sees === 'own' && !this.isOwner && p.includes('/tasks/')) {
      const id = this.me.id;
      return !data?.assignee || [data.assignee, data.created_by, data.handed_by, data.meeting_owner].includes(id) || toList(data?.meet_with).includes(id);
    }
    if (p.startsWith('alerts/')) {
      const to = toList(data?.to);
      return to.includes('everyone') || to.includes(this.me.id) || data?.from === this.me.id;
    }
    return true;
  }

  canWriteTop(p) {
    // Top-level files (README and friends) are the owner's to edit.
    return !p.includes('/') ? this.isOwner : this.canPath(p);
  }

  // ---------- loading ----------

  async load(prefix, { md = true } = {}) {
    const paths = (await this.store.list()).filter((p) => p.startsWith(prefix) && this.canPath(p) && (!md || p.endsWith('.md')));
    const items = await pool(paths, 8, async (p) => {
      const f = await this.store.read(p);
      if (!f) return null;
      const { data, body } = parse(f.text);
      return { path: p, id: stem(p), data, body };
    });
    return items.filter((i) => i && this.canItem(i.path, i.data));
  }

  async get(p) {
    if (!this.canPath(p)) return null;
    const f = await this.store.read(p);
    if (!f) return null;
    const { data, body } = parse(f.text);
    return this.canItem(p, data) ? { path: p, id: stem(p), data, body, text: f.text } : null;
  }

  async save(p, data, body, message) {
    await this.store.write(p, stringify(data, body), {
      message: `${message} (${this.me.name})`,
      author: { name: this.me.name, email: this.me.email || `${this.me.id}@users.noreply.github.com` },
    });
  }

  url(p) {
    return this.store.webBase + p;
  }

  // ---------- people and clients ----------

  async teamList() {
    return (await this.ws.team()).map((p) => ({ id: p.id, name: p.name, role: p.role, title: p.title, github: p.github }));
  }

  async resolvePerson(who) {
    if (!who) return null;
    const w = String(who).toLowerCase().trim().replace(/^@/, '');
    if (w === 'me' || w === 'myself') return this.me.id;
    if (w === 'everyone' || w === 'all') return 'everyone';
    if (['nobody', 'no one', 'none', 'unassigned', 'unassign'].includes(w)) return NOBODY;
    const team = await this.ws.team();
    const hit = team.find((p) => p.id === w) ?? team.find((p) => p.github && String(p.github).toLowerCase() === w) ?? team.find((p) => p.name?.toLowerCase() === w) ?? team.find((p) => p.name?.toLowerCase().split(' ')[0] === w);
    if (!hit) throw new Error(`Nobody called "${who}" is on the team. Team: ${team.map((p) => `${p.name} (${p.id})`).join(', ')}`);
    return hit.id;
  }

  async clients() {
    const all = await this.load('clients/');
    return all.filter((i) => i.path.endsWith('/client.md')).map((i) => ({ client: i.path.split('/')[1], ...i.data }));
  }

  async resolveClient(name) {
    if (!name) return null;
    const list = await this.clients();
    const s = slugify(name);
    const hit = list.find((c) => c.client === s) ?? list.find((c) => c.client.includes(s) || slugify(c.name ?? '').includes(s));
    if (!hit) throw new Error(`No client matching "${name}" that you can see. Your clients: ${list.map((c) => c.client).join(', ') || 'none'}`);
    return hit.client;
  }

  async openClient(name) {
    const slug = await this.resolveClient(name);
    const items = await this.load(`clients/${slug}/`);
    const overview = items.find((i) => i.path.endsWith('/client.md'));
    const tasks = items.filter((i) => i.path.includes('/tasks/'));
    const notes = items.filter((i) => i.path.includes('/notes/')).sort(byNewest).slice(0, 10);
    const files = (await this.store.list()).filter((p) => p.startsWith(`clients/${slug}/docs/`));
    return { slug, overview, tasks, notes, files };
  }

  async addClient({ name, summary, contacts, team: members }) {
    if (!this.isOwner) throw new Error('Only the owner can add a client, because adding one decides who can see it.');
    const slug = slugify(name);
    if (await this.store.read(`clients/${slug}/client.md`)) throw new Error(`Client ${slug} already exists`);
    await this.save(`clients/${slug}/client.md`, { name, status: 'active', since: today(), contacts }, summary ?? '', `Add client ${name}`);
    return { slug, note: members ? 'Remember to add this client to each team member in people.yml.' : undefined };
  }

  // ---------- tasks ----------

  async tasks({ client, assignee, status, due_before } = {}) {
    const slug = client ? await this.resolveClient(client) : null;
    const who = assignee ? await this.resolvePerson(assignee) : null;
    let items = (await this.load(slug ? `clients/${slug}/tasks/` : 'clients/')).filter((i) => i.path.includes('/tasks/'));
    if (who === NOBODY) items = items.filter((i) => !i.data.assignee);
    else if (who) items = items.filter((i) => i.data.assignee === who);
    if (status === 'open') items = items.filter((i) => i.data.status !== 'done');
    else if (status) items = items.filter((i) => i.data.status === status);
    if (due_before) items = items.filter((i) => i.data.due && String(i.data.due) <= due_before);
    return items.sort(byDue);
  }

  async findTask(idOrPath) {
    const want = String(idOrPath).replace(/\.md$/, '');
    const all = (await this.load('clients/')).filter((i) => i.path.includes('/tasks/'));
    const hit = all.find((i) => i.id === want || i.path === `${want}.md`) ?? all.find((i) => i.id.includes(want));
    if (!hit) throw new Error(`No task "${idOrPath}" that you can see`);
    return hit;
  }

  // Passing work to someone else's agent: what was done and what's next go into the task itself,
  // so whoever picks it up (person or agent) reads one file and has the whole story.
  async handOff({ task, client, title, to, what_i_did, whats_next, links, due, priority, needs = 'action' }) {
    const who = await this.resolvePerson(to);
    if (who === 'everyone' || who === NOBODY) throw new Error('Hand a task to one person');
    let t;
    if (task) t = await this.findTask(task);
    else {
      if (!client || !title) throw new Error('Give either an existing task, or a client and a title for a new one');
      const made = await this.addTask({ client, title, assignee: this.me.id });
      t = await this.findTask(made.path.replace(/\.md$/, ''));
    }
    const d = { ...t.data, assignee: who, status: needs === 'review' ? 'review' : 'todo', handed_by: this.me.id, handed_on: today(), opened_by: undefined, sent_back: t.data.handed_by === who || undefined, next_step: String(whats_next).split('\n').find((l) => l.trim())?.replace(/^[-\d.\s]+/, '').slice(0, 160) };
    if (due) d.due = due;
    if (priority) d.priority = priority;
    const linkLines = toList(links).map((l) => `- ${l}`).join('\n');
    const handoff = [
      `## Handoff from ${this.me.name} to ${(await this.ws.team()).find((p) => p.id === who)?.name ?? who} (${today()})`,
      `**What I did**\n${what_i_did}`,
      `**What's next**\n${whats_next}`,
      linkLines && `**Links**\n${linkLines}`,
    ].filter(Boolean).join('\n\n');
    const [top, activity = ''] = t.body.split(/(?:^|\n)## Activity\n/);
    const line = `- ${today()} ${this.me.name}: handed off to ${who}`;
    const body = `${top.trim()}\n\n${handoff}\n\n## Activity\n${activity.trim()}\n${line}`.trim();
    await this.save(t.path, d, body, `Hand off: ${d.title} -> ${who}`);
    if (who !== this.me.id) {
      await this.alert({ to: [who], message: `${this.me.name} handed you "${d.title}"${needs === 'review' ? ' for your review' : ''}. Next: ${whats_next}`, client: d.client, link: t.path, urgent: priority === 'urgent' });
    }
    return { id: t.id, path: t.path, ...d };
  }

  async addTask({ client, title, details, assignee, due, priority, private_to }) {
    const slug = await this.resolveClient(client);
    let who = assignee ? await this.resolvePerson(assignee) : this.me.id;
    if (who === NOBODY) who = undefined;
    if (who === 'everyone') throw new Error('A task has one owner. Leave it unassigned ("nobody") so anyone can pick it up.');
    const id = `${slugify(title).slice(0, 40)}-${shortId()}`;
    const p = `clients/${slug}/tasks/${id}.md`;
    const data = {
      title, client: slug, status: 'todo', priority: priority ?? 'normal', assignee: who, due,
      created_by: this.me.id, created: today(), private_to: await this.people(private_to),
    };
    await this.save(p, data, `${details ?? ''}\n\n## Activity\n- ${today()} ${this.me.name}: created`, `Task: ${title}`);
    if (who && who !== this.me.id) await this.alert({ to: [who], message: `New task for you: ${title}`, client: slug, link: p, quiet: true });
    return { id, path: p, ...data };
  }

  async updateTask({ task, status, assignee, due, priority, title, comment }) {
    const t = await this.findTask(task);
    const d = { ...t.data };
    const changes = [];
    if (status && status !== d.status) {
      changes.push(`status ${d.status} -> ${status}`);
      if (d.status === 'waiting' && d.waiting_for === MEETING) for (const k of ['waiting_for', 'meet_with', 'meeting_owner', 'meeting_at', 'meeting_minutes']) delete d[k];
      d.status = status;
      if (status === 'done') d.completed = today();
    }
    if (priority && priority !== d.priority) { changes.push(`priority -> ${priority}`); d.priority = priority; }
    if (due && due !== d.due) { changes.push(`due -> ${due}`); d.due = due; }
    if (title && title !== d.title) { changes.push(`renamed`); d.title = title; }
    let newAssignee;
    const before = d.assignee;
    if (assignee) {
      const who = await this.resolvePerson(assignee);
      if (who === 'everyone') throw new Error('A task has one owner. Use "nobody" to leave it up for grabs.');
      if (who === NOBODY) { if (d.assignee) { changes.push('unassigned, up for grabs'); delete d.assignee; } }
      else if (who !== d.assignee) { changes.push(`assigned to ${who}`); d.assignee = who; newAssignee = who; delete d.opened_by; }
    }
    if (!changes.length && !comment) return { unchanged: true, task: t.data };
    if (d.assignee === this.me.id && !toList(d.opened_by).includes(this.me.id)) d.opened_by = [...toList(d.opened_by), this.me.id];
    const line = `- ${today()} ${this.me.name}: ${[changes.join(', '), comment].filter(Boolean).join('. ')}`;
    const body = /## Activity/.test(t.body) ? `${t.body}\n${line}` : `${t.body}\n\n## Activity\n${line}`;
    await this.save(t.path, d, body, `Update task: ${d.title}`);
    if (newAssignee && newAssignee !== this.me.id) {
      await this.alert({ to: [newAssignee], message: `${this.me.name} handed you: ${d.title}`, client: d.client, link: t.path, quiet: true });
    }
    // Whoever owns the task and whoever asked for it hear about progress, minus the person making it.
    const watchers = [...new Set([newAssignee ? null : d.assignee, before, d.created_by, d.handed_by])].filter((p) => p && p !== this.me.id && p !== newAssignee);
    if (watchers.length) {
      await this.alert({ to: watchers, message: `${this.me.name} on "${d.title}": ${[changes.join(', '), comment].filter(Boolean).join('. ')}`, client: d.client, link: t.path, quiet: true });
    }
    return { path: t.path, ...d };
  }

  // Reading a task you own marks it opened, which is how "new, not opened yet" works.
  async openTask(task) {
    const t = await this.findTask(task);
    if (t.data.assignee === this.me.id && !toList(t.data.opened_by).includes(this.me.id)) {
      t.data = { ...t.data, opened_by: [...toList(t.data.opened_by), this.me.id] };
      await this.save(t.path, t.data, t.body, `Opened: ${t.data.title}`);
    }
    return t;
  }

  // Park a task until the right people talk. "owner" is who sets the meeting up.
  async meetToDiscuss({ task, with: attendees, owner, when, minutes, agenda }) {
    const t = await this.findTask(task);
    const people = [];
    for (const p of toList(attendees)) { const id = await this.resolvePerson(p); if (id !== NOBODY && id !== 'everyone') people.push(id); }
    const ownerId = owner ? await this.resolvePerson(owner) : t.data.meeting_owner ?? this.me.id;
    const meetWith = [...new Set([...toList(t.data.meet_with), ...people, ownerId])];
    if (when && !/^\d{4}-\d{2}-\d{2}( \d{1,2}:\d{2})?$/.test(when)) throw new Error('Give the meeting time as YYYY-MM-DD HH:MM (24h, local time)');
    const d = { ...t.data, status: 'waiting', waiting_for: MEETING, meet_with: meetWith, meeting_owner: ownerId, meeting_at: when ?? t.data.meeting_at, meeting_minutes: minutes ?? t.data.meeting_minutes ?? (when ? 30 : undefined) };
    const what = when ? `meeting set for ${when}` : `waiting to meet and discuss, ${ownerId} sets it up`;
    const body = `${t.body}\n- ${today()} ${this.me.name}: ${what} (with ${meetWith.join(', ')})${agenda ? `. Agenda: ${agenda}` : ''}`;
    await this.save(t.path, d, body, `Meet to discuss: ${d.title}`);
    const others = meetWith.filter((p) => p !== this.me.id);
    if (others.length) {
      await this.alert({ to: others, message: when ? `Meeting on "${d.title}": ${when}${agenda ? `. Agenda: ${agenda}` : ''}` : `"${d.title}" needs a conversation with ${meetWith.join(', ')}. ${ownerId === this.me.id ? `${this.me.name} will set it up.` : `${ownerId} to set it up.`}${agenda ? ` Agenda: ${agenda}` : ''}`, client: d.client, link: t.path, quiet: true });
    }
    return { id: t.id, ...d };
  }

  // What goes on someone's calendar feed: their due dates and their meetings.
  async calendarItems() {
    const open = await this.tasks({ status: 'open' });
    const mine = open.filter((t) => t.data.assignee === this.me.id && t.data.due);
    const meetings = open.filter((t) => t.data.meeting_at && toList(t.data.meet_with).includes(this.me.id));
    return { due: mine, meetings };
  }

  // ---------- notes, ideas, documents ----------

  async addNote({ client, title, body, private_to }) {
    const slug = await this.resolveClient(client);
    const p = `clients/${slug}/notes/${today()}-${slugify(title).slice(0, 40)}-${shortId()}.md`;
    await this.save(p, { title, client: slug, created_by: this.me.id, created: today(), private_to: await this.people(private_to) }, body, `Note: ${title}`);
    return { path: p };
  }

  async ideas() {
    return (await this.load('ideas/')).sort(byNewest);
  }

  async addIdea({ title, body, client, tags }) {
    const p = `ideas/${today()}-${slugify(title).slice(0, 40)}-${shortId()}.md`;
    const slug = client ? await this.resolveClient(client) : undefined;
    await this.save(p, { title, created_by: this.me.id, created: today(), client: slug, tags, status: 'new' }, `${body ?? ''}\n\n## Thread\n`, `Idea: ${title}`);
    return { path: p };
  }

  async comment({ item, text }) {
    const p = item.endsWith('.md') ? item : `${item}.md`;
    const it = (await this.get(p)) ?? (await this.findTask(item).catch(() => null));
    if (!it) throw new Error(`Nothing at "${item}" that you can see. Use search to find the path.`);
    if (it.path.includes('/tasks/')) return this.updateTask({ task: it.path.replace(/\.md$/, ''), comment: text });
    const heading = it.path.startsWith('ideas/') ? '## Thread' : '## Comments';
    const line = `- ${today()} ${this.me.name}: ${text}`;
    const body = it.body.includes(heading) ? `${it.body}\n${line}` : `${it.body}\n\n${heading}\n${line}`;
    await this.save(it.path, it.data, body, `Comment on ${it.data.title ?? it.path}`);
    if (it.data.created_by && it.data.created_by !== this.me.id) {
      await this.alert({ to: [it.data.created_by], message: `${this.me.name} commented on "${it.data.title ?? it.path}": ${text}`, link: it.path, quiet: true });
    }
    return { path: it.path };
  }

  async saveDocument({ path: p, content }) {
    const clean = String(p).replace(/^\/+/, '');
    if (clean.includes('..') || !this.canWriteTop(clean) || clean === 'people.yml') throw new Error(`You can't write to ${p}`);
    const existing = await this.get(clean);
    if (existing === null && (await this.store.read(clean))) throw new Error(`You can't write to ${p}`);
    await this.store.write(clean, content, {
      message: `${existing ? 'Update' : 'Add'} ${clean} (${this.me.name})`,
      author: { name: this.me.name, email: this.me.email || `${this.me.id}@users.noreply.github.com` },
    });
    return { path: clean, url: this.url(clean) };
  }

  // ---------- alerts ----------

  async alert({ to, message, client, link, urgent, quiet }) {
    const ids = [];
    for (const t of toList(to)) ids.push(await this.resolvePerson(t));
    if (!ids.length) throw new Error('Say who the alert is for (a name, or "everyone")');
    const p = `alerts/${stamp()}-${shortId()}.md`;
    const data = { to: ids, from: this.me.id, client, link, urgent: urgent || undefined, created: new Date().toISOString(), read_by: [] };
    await this.save(p, data, message, `Alert to ${ids.join(', ')}`);
    if (!quiet || urgent) await this.email(ids, message, data);
    return { path: p, to: ids };
  }

  async inbox({ include_read = false } = {}) {
    const all = (await this.load('alerts/')).filter((a) => a.data.from !== this.me.id || toList(a.data.to).includes(this.me.id));
    const unread = all.filter((a) => !toList(a.data.read_by).includes(this.me.id));
    return (include_read ? all : unread).sort(byNewest);
  }

  async markRead({ alerts } = {}) {
    const unread = await this.inbox();
    const pick = alerts?.length ? unread.filter((a) => alerts.some((x) => a.path.includes(x))) : unread;
    for (const a of pick) await this.save(a.path, { ...a.data, read_by: [...toList(a.data.read_by), this.me.id] }, a.body, 'Alert read');
    return { marked: pick.length };
  }

  async email(ids, message, data) {
    if (!this.ws.mailer) return;
    const team = await this.ws.team();
    const targets = ids.includes('everyone') ? team.filter((p) => p.id !== this.me.id) : team.filter((p) => ids.includes(p.id));
    for (const p of targets.filter((p) => p.email)) {
      await this.ws.mailer({ to: p.email, subject: `${data.urgent ? '[Urgent] ' : ''}${this.me.name}: ${message.slice(0, 70)}`, text: message }).catch(() => {});
    }
  }

  // ---------- overview and search ----------

  // Where things stand across everything this person can see.
  async overview({ client } = {}) {
    const all = await this.tasks({ client });
    const open = all.filter((t) => t.data.status !== 'done');
    const now = today();
    const people = {};
    for (const t of open) {
      const who = t.data.assignee ?? 'unassigned';
      people[who] ??= { open: 0, overdue: 0, review: 0 };
      people[who].open++;
      if (t.data.due && String(t.data.due) < now) people[who].overdue++;
      if (t.data.status === 'review') people[who].review++;
    }
    return {
      by_status: Object.fromEntries(['todo', 'doing', 'waiting', 'review'].map((st) => [st, open.filter((t) => t.data.status === st)])),
      unassigned: open.filter((t) => !t.data.assignee),
      overdue: open.filter((t) => t.data.due && String(t.data.due) < now),
      done_recently: all.filter((t) => t.data.status === 'done' && t.data.completed && String(t.data.completed) >= addDays(now, -14)),
      people,
      clients: [...new Set(open.map((t) => t.data.client))].map((c) => ({ client: c, open: open.filter((t) => t.data.client === c).length })),
    };
  }

  async myDay() {
    const open = await this.tasks({ status: 'open' });
    const all = open.filter((t) => t.data.assignee === this.me.id);
    const fromSomeoneElse = (t) => (t.data.handed_by ?? t.data.created_by) !== this.me.id;
    const unopened = all.filter((t) => fromSomeoneElse(t) && !toList(t.data.opened_by).includes(this.me.id));
    const review = all.filter((t) => t.data.status === 'review' && !unopened.includes(t));
    const meetings = open.filter((t) => !unopened.includes(t) && t.data.waiting_for === MEETING && (toList(t.data.meet_with).includes(this.me.id) || t.data.meeting_owner === this.me.id));
    const mine = all.filter((t) => !unopened.includes(t) && !review.includes(t) && !meetings.includes(t));
    const now = today();
    return {
      unopened,
      review,
      meetings_to_set_up: meetings.filter((t) => !t.data.meeting_at),
      meetings_scheduled: meetings.filter((t) => t.data.meeting_at).sort((a, b) => String(a.data.meeting_at).localeCompare(String(b.data.meeting_at))),
      up_for_grabs: open.filter((t) => !t.data.assignee),
      overdue: mine.filter((t) => t.data.due && String(t.data.due) < now),
      due_this_week: mine.filter((t) => t.data.due && String(t.data.due) >= now && String(t.data.due) <= addDays(now, 7)),
      other_open: mine.filter((t) => !t.data.due || String(t.data.due) > addDays(now, 7)),
      alerts: await this.inbox(),
    };
  }

  async search(q) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    const items = (await this.load('')).filter((i) => !i.path.startsWith('alerts/'));
    return items
      .map((i) => {
        const hay = `${i.path} ${i.data.title ?? ''} ${i.data.name ?? ''} ${i.body}`.toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 + (String(i.data.title ?? '').toLowerCase().includes(w) ? 1 : 0) : 0), 0);
        return { i, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((x) => x.i);
  }

  async people(list) {
    const l = toList(list);
    if (!l.length) return undefined;
    const ids = [];
    for (const p of l) ids.push(await this.resolvePerson(p));
    if (!ids.includes(this.me.id)) ids.push(this.me.id);
    return ids;
  }

  async unreadCount() {
    return (await this.inbox()).length;
  }
}

// ---------- helpers ----------

export const toList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const stem = (p) => p.split('/').pop().replace(/\.md$/, '');
const byNewest = (a, b) => String(b.data.created ?? b.path).localeCompare(String(a.data.created ?? a.path));
const byDue = (a, b) => String(a.data.due ?? '9999').localeCompare(String(b.data.due ?? '9999')) || PRIORITIES.indexOf(b.data.priority) - PRIORITIES.indexOf(a.data.priority);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}
