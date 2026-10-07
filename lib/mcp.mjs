import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STATUSES, PRIORITIES } from './workspace.mjs';
import { linksIn, fetchPage } from './review.mjs';
import { renderKanban } from './kanban.mjs';
import { loadBrand } from './brand.mjs';
import { sign } from './auth.mjs';
import { recentActivity, connectedNow, activityLines } from './live.mjs';
import { boardLinks, linksText, exportLink, moveCommand, MOVE_LINES } from './links.mjs';

const signInvite = (id) => sign({ k: 'invite', id });
import { widgetHtml, WIDGET_URI, WIDGET_URI_OPENAI, MCP_APP_MIME, OPENAI_MIME } from './widget.mjs';

export const instructionsText = (name) => `This is the ${name} workspace on agent-kanban: clients, tasks, notes, ideas and alerts shared by a team and their agents.

YOUR ROLE: a chief of staff for busy people. Surface what matters, high level, in as few words as possible.
- One line per item. No preamble, no recap of what they asked, no sign-off, no praise.
- Only what is relevant right now. Leave out empty sections, ids and anything they did not ask about.
- Say more only when they ask ("more", "details", "why", "show me").
- When asked to review, actually review the work itself, not the description of it (use the review tool).

Everyone connects their own Claude or ChatGPT to it, so whatever you add here, the rest of the team sees (unless it is marked private).
Start with my_day when someone asks what is on their plate. Use people's first names. Dates are YYYY-MM-DD.
When someone tells you about a call, a decision or a to-do for a client, offer to save it here as a note or task.
When someone needs another person to know something, use send_alert.
When someone passes work to a teammate, use hand_off so the next person's agent gets what was done and what is next.
When my_day shows work handed to this person, open_task it, read the handoff, and offer to start on the next step.
Tasks can be unassigned ("nobody"): they show as up for grabs to everyone on that client.
When something needs a conversation, use meet_to_discuss with who should be there and who sets it up.
If someone asks how this works or what they can say, call how_to_use.

Short commands people type, and what to do:
- "start" or "agent-kanban start": call start.
- "check tasks", "what's assigned to me", "my tasks": call my_day.
- "new task": follow the add_task steps.
- "assign task": follow the update_task steps for assigning.
- "review": call review.
- "hand off task": follow the hand_off steps (ask only what you can't work out).
- "status", "where do things stand", "all tasks": call status.
- "view kanban", "show the board", "kanban": call view_kanban. The board is drawn in the chat; add at most one line.
- "review": open the first item waiting on their review and walk them through it.`;

export const COMMANDS = [
  ['start', 'Start', 'Welcome, what is assigned to you, and the commands', 'start'],
  ['check-tasks', 'Check tasks', "What's assigned to you, new things first", 'check tasks'],
  ['review', 'Review', "Go through what's waiting on your review", 'review'],
  ['new-task', 'New task', 'Create a task', 'new task'],
  ['assign-task', 'Assign task', 'Give a task to someone, or unassign it', 'assign task'],
  ['hand-off-task', 'Hand off task', 'Pass something to someone', 'hand off task'],
  ['status', 'Status', 'Every task and where things stand', 'status'],
  ['view-kanban', 'View kanban', 'The board, drawn in the chat', 'view kanban'],
];

export function buildServer(session) {
  const server = new McpServer({ name: 'agent-kanban', version: '1.0.0' }, { instructions: instructionsText(session.ws.name) });
  defineTools(session, (name, { title, description, shape, readOnly, meta }, run) =>
    server.registerTool(name, { title, description, inputSchema: shape, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false }, ...(meta ? { _meta: meta } : {}) }, run));
  // The board widget view_kanban points at: one page, served under the MCP Apps type and ChatGPT's.
  for (const [uri, mimeType] of [[WIDGET_URI, MCP_APP_MIME], [WIDGET_URI_OPENAI, OPENAI_MIME]]) {
    server.registerResource(uri === WIDGET_URI ? 'kanban-board' : 'kanban-board-openai', uri, { mimeType, description: 'The agent-kanban board' },
      async () => ({ contents: [{ uri, mimeType, text: widgetHtml(), _meta: { ui: { prefersBorder: false }, 'openai/widgetPrefersBorder': false } }] }));
  }
  // The four commands as MCP prompts: slash commands in Claude Code, one-click entries in the Claude app's + menu.
  for (const [name, title, description, text] of COMMANDS) {
    server.registerPrompt(name, { title, description }, () => ({ messages: [{ role: 'user', content: { type: 'text', text } }] }));
  }
  return server;
}

// The tool list is shared: the MCP server registers it, and the REST API (for ChatGPT GPTs) serves the same tools.
export function defineTools(session, register) {
  const me = session.me;

  // Every answer carries the unread alert count, the closest thing to a push the chat apps allow today.
  const reply = async (text, extra = {}) => {
    const n = await session.unreadCount().catch(() => 0);
    const footer = n ? `\n\n---\n${me.name.split(' ')[0]} has ${n} unread alert${n > 1 ? 's' : ''}. Mention it, and use my_alerts to read them.` : '';
    return { content: [{ type: 'text', text: text + footer }], ...extra };
  };
  // gpt: false keeps a tool out of the ChatGPT GPT's action list (GPTs take at most 30); it still works over MCP and /v1.
  const tool = (name, title, description, shape, fn, { readOnly = false, meta, gpt = true } = {}) =>
    register(name, { title, description, shape, readOnly, meta, gpt }, async (args) => {
      try {
        return await fn(args ?? {});
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: e.message }] };
      }
    });

  const optStr = (d) => z.string().optional().describe(d);
  const date = (d) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(d);
  const privateTo = z.union([z.array(z.string()), z.string()]).optional().describe('Only these people (names) can see it. Leave out to share with everyone on the client.');

  tool('my_day', 'My day', `What is on ${me.name}'s plate: new tasks not opened yet, things waiting on their review, meetings to set up, overdue and upcoming tasks, unassigned work up for grabs, and unread alerts. Use when someone types "check tasks", "what's assigned to me", "my tasks", "what's open", or starts their day. Read it back as a short briefing, new things first.`, {}, async () => {
    const d = await session.myDay();
    return reply([
      `# ${me.name}`,
      section('New for you, not opened yet', d.unopened.map((t) => `${taskLine(t)}. From ${t.data.handed_by ?? t.data.created_by}${t.data.status === 'review' ? ', for your review' : ''}${t.data.waiting_for === 'meet to discuss' ? `, needs a meeting with ${list(t.data.meet_with)} (${t.data.meeting_owner} sets it up)` : ''}. Use open_task to read it.`)),
      section('Waiting on your review', d.review.map(taskLine)),
      section('Meetings to set up', d.meetings_to_set_up.map((t) => `${taskLine(t)}. Meet with ${list(t.data.meet_with)}; ${t.data.meeting_owner} sets it up.`)),
      section('Meetings scheduled', d.meetings_scheduled.map((t) => `- ${t.data.meeting_at}: **${t.data.title}** with ${list(t.data.meet_with)}. id \`${t.id}\``)),
      section('Overdue', d.overdue.map(taskLine)),
      section('Due in the next 7 days', d.due_this_week.map(taskLine)),
      section('Other open tasks', d.other_open.map(taskLine)),
      section('Up for grabs (unassigned)', d.up_for_grabs.map(taskLine)),
      section('Unread alerts', d.alerts.map(alertLine)),
    ].filter(Boolean).join('\n\n') || 'Nothing open.');
  }, { readOnly: true });

  tool('list_clients', 'List clients', 'Every client this person can see, with status.', {}, async () => {
    const cs = await session.clients();
    return reply(cs.length ? cs.map((c) => `- **${c.name ?? c.client}** (\`${c.client}\`) ${c.status ?? ''}${c.engagement ? `: ${c.engagement}` : ''}`).join('\n') : 'No clients visible to you yet.');
  }, { readOnly: true });

  tool('open_client', 'Open a client', 'Everything about one client: overview, all tasks, the latest notes and files.', { client: z.string().describe('Client name or slug, e.g. "Acme"') }, async ({ client }) => {
    const c = await session.openClient(client);
    const open = c.tasks.filter((t) => t.data.status !== 'done');
    return reply([
      `# ${c.overview?.data.name ?? c.slug}`,
      c.overview ? `${fm(c.overview.data, ['status', 'since', 'engagement', 'contacts'])}\n\n${c.overview.body}` : '',
      section(`Open tasks (${open.length})`, open.map(taskLine)),
      section('Recently done', c.tasks.filter((t) => t.data.status === 'done').slice(0, 5).map(taskLine)),
      section('Latest notes', c.notes.map((n) => `- ${n.data.created} **${n.data.title}** by ${n.data.created_by} (\`${n.path}\`)\n  ${firstLine(n.body)}`)),
      section('Files', c.files.map((f) => `- ${f}`)),
    ].filter(Boolean).join('\n\n'));
  }, { readOnly: true });

  tool('find_tasks', 'Find tasks', 'List tasks, filtered by client, person and status. status "open" means anything not done.', {
    client: optStr('Client name'),
    assignee: optStr('Person name, "me", or "nobody" for unassigned'),
    status: z.enum(['open', ...STATUSES]).optional(),
    due_before: date('Only tasks due on or before this date'),
  }, async (a) => {
    const ts = await session.tasks(a);
    return reply(ts.length ? ts.map(taskLine).join('\n') : 'No tasks match.');
  }, { readOnly: true });

  tool('add_task', 'Add a task', 'Create a task for a client. Assigning it to someone else sends them an alert. When someone just types "new task": ask in one message for what it is, and (only if not obvious) which client, who owns it (or "nobody" to leave it up for grabs) and when it is due. Then create it and confirm in one line.', {
    client: z.string().describe('Client name'),
    title: z.string().describe('Short, starts with a verb: "Draft the PTO policy"'),
    details: optStr('Context, links, what done looks like'),
    assignee: optStr('Who owns it (name), or "nobody" to leave it unassigned. Defaults to the person asking.'),
    due: date('Due date'),
    priority: z.enum(PRIORITIES).optional(),
    private_to: privateTo,
  }, async (a) => {
    const t = await session.addTask(a);
    return reply(`Added **${t.title}** for ${t.client}, ${t.assignee ? `owner ${t.assignee}` : 'unassigned, up for grabs'}${t.due ? `, due ${t.due}` : ''}. id: \`${t.id}\``);
  });

  tool('update_task', 'Update a task', 'Change status, owner, due date or priority, and/or leave a comment. The owner is alerted when someone else changes their task. When someone just types "assign task": call status (or my_day), show the open tasks as a short numbered list with their current owner, ask which one and who should have it ("nobody" unassigns it), then set assignee and confirm in one line.', {
    task: z.string().describe('Task id (from find_tasks) or part of it'),
    status: z.enum(STATUSES).optional(),
    assignee: optStr('Give it to someone (name), or "nobody" to unassign it'),
    due: date('New due date'),
    priority: z.enum(PRIORITIES).optional(),
    title: optStr('New title'),
    comment: optStr('A progress note to add to the task'),
  }, async (a) => {
    const t = await session.updateTask(a);
    return reply(t.unchanged ? 'Nothing changed.' : `Updated **${t.title}**: ${t.status}, ${t.assignee ? `owner ${t.assignee}` : 'unassigned'}${t.due ? `, due ${t.due}` : ''}.`);
  });

  tool('review', 'Review work', 'Use when someone types "review" or asks to review something. Opens the work handed to them (fetches the linked pages and reads the linked files) so you can judge the deliverable itself against what was asked. Leave task out to take the next item waiting on their review.', {
    task: optStr('Task id. Leave out for the next thing waiting on their review.'),
  }, async ({ task }) => {
    let t;
    if (task) t = await session.openTask(task);
    else {
      const d = await session.myDay();
      const next = [...d.unopened, ...d.review].find((x) => x.data.status === 'review');
      if (!next) return reply('Nothing waiting on your review.');
      t = await session.openTask(next.id);
    }
    const handoff = t.body.split(/(?:^|\n)## Activity\n/)[0].trim();
    const { urls, paths } = linksIn(handoff);
    const pages = await Promise.all(urls.map(fetchPage));
    const files = (await Promise.all(paths.map((p) => session.get(p)))).filter(Boolean);
    const others = d2(await session.tasks({ status: 'open' }).catch(() => []), me.id).length;
    return reply([
      `# Review: ${t.data.title}`,
      `From ${t.data.handed_by ?? t.data.created_by} · ${t.data.client}${t.data.due ? ` · due ${t.data.due}` : ''} · id \`${t.id}\``,
      `## What was asked and what they say they did\n${handoff}`,
      pages.length || files.length ? '## The work itself' : '## The work itself\nNo links or files in the hand-off. If you can, ask for one; otherwise judge from the description and say so.',
      ...pages.map((p) => p.error ? `### ${p.url}\nCould not check: ${p.error}. Say so in your verdict.` : p.interactive ? `### ${p.title ?? p.url}\n${p.url} (HTTP ${p.status}, loads)\nInteractive page: its content only appears in a browser, so it could not be read here. In your verdict, say in one line that they should try it themselves.` : `### ${p.title ?? p.url}\n${p.url} (HTTP ${p.status})\n\n${p.text}${p.truncated ? '\n[...cut]' : ''}`),
      ...files.map((f) => `### ${f.path}\n${f.text.slice(0, 4000)}`),
      `## How to answer (follow exactly)
Check the work above against what was asked. If you can open links yourself, look at them too. Then reply in at most 5 short lines:
1. **Ready** or **Not ready**, with the one-line reason.
2. Up to 3 issues, most important first, one line each. Skip if none.
3. Ask: approve, send back, or meet?
No summary of the task, no praise, no preamble. Details only if asked.
When they answer: approve = update_task status done with their words as the comment; send back = hand_off to ${t.data.handed_by ?? t.data.created_by} with the issues as what's next; meet = meet_to_discuss.${others > 1 ? ` After that, mention in one line that ${others - 1} more ${others - 1 === 1 ? 'is' : 'are'} waiting on their review.` : ''}`,
    ].filter(Boolean).join('\n\n'));
  }, { readOnly: false });

  tool('open_task', 'Open a task', 'Read one task in full: details, any handoff (what was done, what is next, links) and its activity.', {
    task: z.string().describe('Task id from my_day or find_tasks, or part of its title'),
  }, async ({ task }) => {
    const t = await session.openTask(task);
    return reply(`# ${t.data.title}\n${fm(t.data, ['client', 'status', 'assignee', 'due', 'priority', 'waiting_for', 'meet_with', 'meeting_owner', 'meeting_at', 'handed_by', 'handed_on', 'created_by'])}\nid \`${t.id}\`\n\n${t.body}`);
  }, { readOnly: true });

  tool('hand_off', 'Hand off work', 'Pass work to a teammate so they (or their agent) can pick it up: records what you did, what is next and the links in the task, reassigns it, and alerts them. Use an existing task, or give a client and title to log finished work and hand it on in one step. When someone just types "hand off task": 1) if it is not obvious which task, call my_day and ask them to pick one by number; 2) ask who it goes to and whether it is for review or for them to take over; 3) draft "what I did" and "what\'s next" from this conversation and the task, show the draft in two short lines, and send it when they say yes.', {
    to: z.string().describe('Who picks it up (name)'),
    what_i_did: z.string().describe('What is finished, concretely'),
    whats_next: z.string().describe('The next steps for them, concretely enough for their agent to act on'),
    task: optStr('Existing task id. Leave out to create a new task.'),
    client: optStr('Client, when creating a new task'),
    title: optStr('Title, when creating a new task'),
    links: z.array(z.string()).optional().describe('URLs or workspace paths they will need'),
    due: date('When the next step is due'),
    priority: z.enum(PRIORITIES).optional(),
    needs: z.enum(['action', 'review']).optional().describe('"review" if they need to review and approve it; "action" (default) if they take it from here'),
  }, async (a) => {
    const t = await session.handOff(a);
    return reply(`Handed **${t.title}** to ${t.assignee}${t.status === 'review' ? ' for review' : ''}. They've been alerted, and it is first on their my_day. id \`${t.id}\``);
  });

  tool('meet_to_discuss', 'Meet to discuss', 'Park a task as waiting for a conversation: who should be in it, who sets it up, and (once booked) when. Everyone involved is alerted.', {
    task: z.string().describe('Task id'),
    with: z.union([z.array(z.string()), z.string()]).describe('Who should be in the meeting (names)'),
    owner: optStr('Who sets the meeting up (name). Defaults to the person asking.'),
    when: z.string().optional().describe('Once booked: "YYYY-MM-DD HH:MM", 24h local time'),
    minutes: z.number().int().optional().describe('Length, default 30'),
    agenda: optStr('What to decide'),
  }, async (a) => {
    const t = await session.meetToDiscuss(a);
    return reply(t.meeting_at
      ? `Booked: **${t.title}** on ${t.meeting_at} with ${list(t.meet_with)}. Everyone involved was alerted.`
      : `**${t.title}** is now waiting to meet and discuss, with ${list(t.meet_with)}. ${t.meeting_owner} sets it up.`);
  });

  tool('start', 'Start', 'Use when someone types "agent-kanban start", "start" or "hi", or is new here (including right after setting up agent-kanban and restarting): a welcome, what is assigned to them right now, and the four short commands they can type.', {}, async () => {
    const d = await session.myDay();
    const first = me.name.split(' ')[0];
    const count = d.unopened.length + d.review.length + d.meetings_to_set_up.length + d.overdue.length + d.due_this_week.length + d.other_open.length;
    const waiting = [...d.unopened, ...d.review].find((t) => t.data.status === 'review');
    const repo = session.isOwner && session.store.repo ? `https://github.com/${session.store.repo}` : null;
    return reply([
      waiting
        ? `Welcome ${first} in one short line. Then say: "${waiting.data.handed_by ?? waiting.data.created_by} sent you something to review: ${waiting.data.title}. Want to see it?" If they say yes, call open_task ${waiting.id} and reply with only: the title, up to 3 one-line highlights of what was done, and the links. Then ask: approve, send back, or meet? Show the commands below only after that, or if they say no.`
        : `Welcome ${first} in one short line, say how many things are waiting and the single most important one, then show the commands exactly as written. Nothing else.`,
      repo ? `They own the workspace repo: ${repo} (GitHub emailed them an invite when they first signed in; it needs Accept). Mention it in one line only if they haven't opened it yet.` : '',
      `## Right now: ${count} open for ${first}`,
      section('New, not opened yet', d.unopened.map(taskLine)),
      section('Waiting on your review', d.review.map(taskLine)),
      section('Meetings to set up', d.meetings_to_set_up.map(taskLine)),
      section('Up for grabs', d.up_for_grabs.map(taskLine)),
      `## Commands (show these exactly)\n- **check tasks**: what's assigned to you\n- **review**: go through what's waiting on you\n- **new task**: create one\n- **assign task**: give a task to someone, or unassign it\n- **hand off task**: pass something to someone\n- **status**: every task and where things stand\n- **view kanban**: the board, drawn here\n- **start**: this screen again`,
    ].filter(Boolean).join('\n\n') || 'Nothing open.');
  }, { readOnly: true });

  tool('status', 'Where things stand', 'Every task this person can see, by stage (to do, in progress, waiting, in review), plus who has how much, what is overdue, what is unassigned and what got done in the last two weeks. Use when someone types "status", "where do things stand", "all tasks" or asks for an overview. Present it as a compact board, not a wall of text.', {
    client: optStr('Only this client'),
  }, async ({ client }) => {
    const o = await session.overview({ client });
    const labels = { todo: 'To do', doing: 'In progress', waiting: 'Waiting', review: 'In review' };
    return reply([
      `# Where things stand${client ? `: ${client}` : ''}`,
      `**${Object.values(o.by_status).flat().length} open** · ${o.overdue.length} overdue · ${o.unassigned.length} unassigned · ${o.done_recently.length} done in the last 2 weeks`,
      ...Object.entries(o.by_status).map(([st, ts]) => section(`${labels[st]} (${ts.length})`, ts.map(taskLine))),
      section('Who has what', Object.entries(o.people).map(([p, n]) => `- **${p}**: ${n.open} open${n.overdue ? `, ${n.overdue} overdue` : ''}${n.review ? `, ${n.review} to review` : ''}`)),
      section('By client', o.clients.map((c) => `- ${c.client}: ${c.open} open`)),
      section('Done in the last 2 weeks', o.done_recently.map(taskLine)),
    ].filter(Boolean).join('\n\n') || 'Nothing open.');
  }, { readOnly: true });

  tool('view_kanban', 'View kanban', 'Draws the kanban board in the chat: columns TO DO, DOING, WAITING, REVIEW, DONE, one card per task with owner, client and flags. Use when someone types "view kanban", "show the board" or "kanban". Optionally one client. In apps that cannot show it, share the board link it returns.', {
    client: optStr('Only this client'),
  }, async ({ client }) => {
    const slug = client ? await session.resolveClient(client) : null;
    const [tasks, clients, people, allIdeas, brand] = await Promise.all([session.tasks(slug ? { client: slug } : {}), session.clients(), session.teamList(), session.ideas(), loadBrand(session.ws)]);
    const ideas = slug ? allIdeas.filter((i) => i.data.client === slug) : allIdeas;
    const open = tasks.filter((t) => t.data.status !== 'done');
    const count = (st) => open.filter((t) => t.data.status === st).length;
    const summary = `${open.length} OPEN · ${count('review')} IN REVIEW · ${open.filter((t) => !t.data.assignee).length} UP FOR GRABS`;
    const title = slug ? (clients.find((c) => c.client === slug)?.name ?? slug).toUpperCase() : `${session.ws.name.toUpperCase()} · ALL CLIENTS`;
    const link = session.host ? `${session.host}/board${slug ? `?client=${encodeURIComponent(slug)}` : ''}` : '/board';
    return reply(`Board drawn${slug ? ` for ${slug}` : ''}: ${summary.toLowerCase()}. If it isn't visible here, open ${link}`, {
      structuredContent: { title, summary, html: renderKanban({ tasks, ideas, clients, people, me: me.id }), link, css: brand.css, scheme: brand.scheme, style: brand.style },
    });
  }, { readOnly: true, meta: { ui: { resourceUri: WIDGET_URI }, 'ui/resourceUri': WIDGET_URI, 'openai/outputTemplate': WIDGET_URI_OPENAI, 'openai/toolInvocation/invoking': 'Drawing the board', 'openai/toolInvocation/invoked': 'Board ready', 'openai/widgetAccessible': false } });

  tool('how_to_use', 'How to use this', 'Plain-language guide: what to say to create, assign, unassign, hand off, review, and set up meetings.', {}, async () => {
    const g = await session.get('playbooks/start-here.md');
    return reply(g?.body ?? 'Say "what is on my plate" to start.');
  }, { readOnly: true });

  tool('recent_activity', 'Recent activity', 'What changed on the board lately and who did it: people, and the AI apps they connected (for example "Claude (Sam\'s) moved Draft the PTO policy to Review"), newest first, plus which AI apps are connected right now. Use it to see what other agents did before you act, or when someone asks "what changed" or "what did Claude do".', {
    since: z.string().optional().describe('Only changes after this time, e.g. 2026-10-07T14:00'),
    limit: z.number().int().min(1).max(50).optional().describe('At most this many (default 15)'),
  }, async ({ since, limit = 15 }) => {
    const all = await recentActivity(session.store);
    const mine = all.filter((a) => !a.item?.path || session.canItem(a.item.path, a.item.access ?? {})).slice(0, limit);
    const on = connectedNow(session.store);
    return reply(`${activityLines(mine, { since })}${on.length ? `\n\nConnected now: ${on.map((c) => `${c.label}${c.working ? ' (working)' : ''}`).join(', ')}` : ''}`);
  }, { readOnly: true });

  tool('add_note', 'Save a note', 'Save meeting notes, call notes, a decision or context to a client. Write the body in clean markdown.', {
    client: z.string(),
    title: z.string().describe('e.g. "Kickoff call with the managing partner"'),
    body: z.string(),
    private_to: privateTo,
  }, async (a) => {
    const n = await session.addNote(a);
    return reply(`Saved to \`${n.path}\`.`);
  });

  tool('list_ideas', 'Ideas board', 'The shared brainstorm board: ideas anyone on the team has posted, newest first.', {}, async () => {
    const ideas = await session.ideas();
    return reply(ideas.length ? ideas.map((i) => `- **${i.data.title}** by ${i.data.created_by}, ${i.data.created}${i.data.client ? `, for ${i.data.client}` : ''} [${i.data.status ?? 'new'}] (\`${i.path}\`)\n  ${firstLine(i.body)}`).join('\n') : 'The ideas board is empty. Be the first.');
  }, { readOnly: true });

  tool('add_idea', 'Post an idea', 'Put an idea on the shared board: a service to offer, a process fix, a tool to try, a thought about a client.', {
    title: z.string(),
    body: optStr('The idea, worked out as far as it goes'),
    client: optStr('If it is about one client'),
    tags: z.array(z.string()).optional(),
  }, async (a) => {
    const i = await session.addIdea(a);
    return reply(`Posted to the ideas board: \`${i.path}\`.`);
  });

  tool('comment', 'Comment', 'Reply on an idea, note or task. The person who created it gets an alert.', {
    item: z.string().describe('The path from a listing, e.g. ideas/2026-10-05-client-portal-ab12.md, or a task id'),
    text: z.string(),
  }, async (a) => {
    const r = await session.comment(a);
    return reply(`Commented on \`${r.path}\`.`);
  });

  tool('send_alert', 'Send an alert', 'Tell one or more teammates something: a heads-up, a blocker, a request. Urgent alerts are also emailed.', {
    to: z.union([z.array(z.string()), z.string()]).describe('Names, or "everyone"'),
    message: z.string(),
    client: optStr('Client it is about'),
    urgent: z.boolean().optional(),
  }, async (a) => {
    const client = a.client ? await session.resolveClient(a.client) : undefined;
    const r = await session.alert({ ...a, client });
    return reply(`Alert sent to ${r.to.join(', ')}.`);
  });

  tool('my_alerts', 'My alerts', 'Read alerts sent to this person. Marks them read unless asked not to.', {
    include_read: z.boolean().optional().describe('Also show alerts already read'),
    keep_unread: z.boolean().optional(),
  }, async ({ include_read, keep_unread }) => {
    const list = await session.inbox({ include_read });
    if (!keep_unread) await session.markRead();
    return reply(list.length ? list.map(alertLine).join('\n') : 'No alerts.');
  });

  tool('search', 'Search', 'Search everything this person can see: clients, tasks, notes, ideas, playbooks. Returns ids to pass to fetch.', { query: z.string() }, async ({ query }) => {
    const hits = await session.search(query);
    // Shape matches what ChatGPT expects from a search tool.
    return { content: [{ type: 'text', text: JSON.stringify({ results: hits.map((h) => ({ id: h.path, title: h.data.title ?? h.data.name ?? h.path, url: session.url(h.path) })) }) }] };
  }, { readOnly: true });

  tool('fetch', 'Read a file', 'Read one item in full by its id/path (from search or any listing).', { id: z.string() }, async ({ id }) => {
    const task = await session.findTask(id).catch(() => null);
    const it = (await session.get(id.replace(/^\/+/, ''))) ?? (task && (await session.get(task.path)));
    if (!it) return { isError: true, content: [{ type: 'text', text: `Nothing at ${id} that you can see.` }] };
    return { content: [{ type: 'text', text: JSON.stringify({ id: it.path, title: it.data.title ?? it.data.name ?? it.path, text: it.text, url: session.url(it.path), metadata: it.data }) }] };
  }, { readOnly: true });

  tool('save_document', 'Save a document', 'Create or overwrite any other file: a playbook in playbooks/, a client doc in clients/<client>/docs/, a private draft in people/<your id>/. Use for longer documents, not tasks or notes.', {
    path: z.string().describe('e.g. playbooks/onboarding-a-new-client.md'),
    content: z.string(),
  }, async (a) => {
    const r = await session.saveDocument(a);
    return reply(`Saved \`${r.path}\`.`);
  });

  tool('team', 'Team', 'Who is on the team and their role.', {}, async () => {
    const t = await session.teamList();
    return reply(t.map((p) => `- **${p.name}** (\`${p.id}\`) ${p.title ?? p.role}${p.id === me.id ? ' (you)' : ''}`).join('\n'));
  }, { readOnly: true });

  tool('connect_links', 'Connect links', 'How to use this board from each app: the one-click Claude link, the Claude Code and Codex commands, the MCP address and the board in a browser. Use when someone asks how to connect, or how a teammate gets set up.', {}, async () => {
    const host = session.host ?? '';
    return reply(`How to use ${session.ws.name}:\n${linksText(boardLinks(host, session.ws.name))}`);
  }, { readOnly: true, gpt: false });

  if (session.isOwner) {
    tool('add_person', 'Invite someone', 'Owner only. Adds someone to the team (people.yml) and returns their personal setup link. Give their name and their GitHub username, or the email on their GitHub account. role "owner" sees everything; "team" sees only the clients listed (or "all"). sees "own" limits them to their own tasks.', {
      name: z.string().describe('Their name, e.g. "Jordan Lee"'),
      github: optStr('Their GitHub username'),
      email: optStr('The email on their GitHub account, if you do not know their username'),
      role: z.enum(['team', 'owner']).optional(),
      clients: z.union([z.array(z.string()), z.string()]).optional().describe('Client names they work on, or "all"'),
      sees: z.enum(['all', 'own']).optional(),
      title: optStr('What they do, e.g. "Assistant"'),
    }, async (a) => {
      const p = await session.addPerson(a);
      const url = `${session.host ?? ''}/INSTRUCTIONS.md?for=${encodeURIComponent(signInvite(p.id))}`;
      return reply(`Added ${p.name} (${p.role}${p.role === 'owner' ? '' : `, clients: ${p.clients === 'all' ? 'all' : p.clients.join(', ') || 'none yet'}`}). Send them this setup link; they hand it to their AI app:\n${url}`);
    });

    tool('update_person', 'Change someone\'s access', 'Owner only. Change someone\'s role (owner or team), the clients they see, or limit them to their own tasks.', {
      person: z.string().describe('Name or id'),
      role: z.enum(['team', 'owner']).optional(),
      clients: z.union([z.array(z.string()), z.string()]).optional().describe('Client names, or "all"'),
      sees: z.enum(['all', 'own']).optional(),
      title: optStr('What they do'),
    }, async (a) => {
      const p = await session.updatePerson(a);
      return reply(`${p.name}: ${p.role}${p.role === 'owner' ? '' : `, clients ${p.clients === 'all' ? 'all' : (p.clients ?? []).join(', ') || 'none'}${p.sees === 'own' ? ', own tasks only' : ''}`}.`);
    });

    tool('remove_person', 'Remove someone', 'Owner only. Takes someone off the team. They are signed out everywhere at once. Their past work stays.', {
      person: z.string().describe('Name or id'),
    }, async (a) => {
      const r = await session.removePerson(a);
      return reply(`Removed ${r.name ?? r.id}. They are signed out everywhere.`);
    }, { gpt: false });

    tool('clear_examples', 'Clear the examples', 'Owner only. Removes the example cards a new board starts with (and their Examples client). Use when someone says "clear the examples" or is ready to start for real. Real work is never touched: only items marked as examples.', {}, async () => {
      const r = await session.clearExamples();
      return reply(r.cleared ? `Cleared ${r.cleared} example item${r.cleared > 1 ? 's' : ''}. The board is yours.` : 'No examples left to clear.');
    }, { gpt: false });

    tool('export_board', 'Download everything', 'Owner only. A link to a zip of everything on this board: every task, note, idea and file. It is all in your GitHub repo too. The link works for ten minutes.', {}, async () => {
      const repo = session.store.repo;
      return reply(`Download (works for ten minutes): ${exportLink(session.host ?? '', me)}${repo ? `\nIt is also your GitHub repo: https://github.com/${repo}` : ''}`);
    }, { readOnly: true, gpt: false });

    if (session.ws?.hosting) {
      tool('move_to_own_hosting', 'Move to my own hosting', 'Owner only, hosted boards. How to move this board to your own Vercel account: your data stays in your GitHub repo, the app runs on your account, and people are sent to the new address. Returns the one command to run.', {}, async () => {
        const cmd = moveCommand({ repo: session.store.repo, from: session.host });
        return reply(`${MOVE_LINES.join('\n')}\n\nRun this on a computer with Node 20 or later (it walks you through the rest, and --dry-run shows each step first):\n\`\`\`\n${cmd}\n\`\`\``);
      }, { readOnly: true, gpt: false });
    }

    tool('invite_link', 'Invite link', 'Owner only. A personal setup link for someone in people.yml: the instructions file, greeting them by name and telling them which email to use on GitHub. Send it to them; they drop it into their agent.', {
      person: z.string().describe('Name or id from people.yml'),
    }, async ({ person }) => {
      const id = await session.resolvePerson(person);
      const p = (await session.ws.team()).find((x) => x.id === id);
      if (!p) throw new Error(`Nobody called ${person} in people.yml`);
      const url = `${session.host ?? ''}/INSTRUCTIONS.md?for=${encodeURIComponent(signInvite(p.id))}`;
      return reply(`Setup link for ${p.name}${p.email ? ` (GitHub email: ${p.email})` : ''}:\n${url}`);
    });

    tool('add_client', 'Add a client', 'Owner only. Start a new client folder.', {
      name: z.string(),
      summary: optStr('What the engagement is'),
      contacts: z.array(z.string()).optional(),
    }, async (a) => {
      const r = await session.addClient(a);
      return reply(`Created \`clients/${r.slug}/\`. Teammates see it once it is added to their clients list in people.yml.`);
    });
  }

}

const d2 = (tasks, id) => tasks.filter((t) => t.data.assignee === id && t.data.status === 'review');
// Empty sections are dropped: nothing to say means nothing said.
const section = (title, lines) => (lines.length ? `## ${title}\n${lines.join('\n')}` : '');
const list = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '');
const nextOf = (t) => (t.data.next_step && t.data.status !== 'done' ? ` Next: ${t.data.next_step}` : '');
const taskLine = (t) => `- [${t.data.status}${t.data.waiting_for ? `: ${t.data.waiting_for}` : ''}] **${t.data.title}** (${t.data.client}) ${t.data.assignee ? `owner ${t.data.assignee}` : 'unassigned'}${t.data.due ? `, due ${t.data.due}` : ''}${t.data.priority && t.data.priority !== 'normal' ? `, ${t.data.priority}` : ''}${t.data.sent_back && t.data.status !== 'done' ? `. SENT BACK by ${t.data.handed_by}` : ''}.${nextOf(t)} id \`${t.id}\``;
const alertLine = (a) => `- ${String(a.data.created).slice(0, 16).replace('T', ' ')} from **${a.data.from}**${a.data.urgent ? ' URGENT' : ''}${a.data.client ? ` (${a.data.client})` : ''}: ${a.body}${a.data.link ? ` [\`${a.data.link}\`]` : ''}`;
const firstLine = (s) => (s.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '').slice(0, 160);
const fm = (d, keys) => keys.filter((k) => d[k]).map((k) => `**${k}:** ${Array.isArray(d[k]) ? d[k].join(', ') : d[k]}`).join(' · ');
