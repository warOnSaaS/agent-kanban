// Live: open pages notice changes made elsewhere (by a person, Claude, ChatGPT, Claude Code, Codex, a GPT)
// within a couple of seconds, and show who did what. Kept in step with the crm's lib/live.mjs.
//
//   who did it   every write carries an actor: the person, or the agent and the connection it came through,
//                "Claude (Sam's)". Named from the OAuth client the app registered, the MCP client name, or
//                the user agent.
//   version      a cheap string that changes whenever the data does. On GitHub it is the branch head, asked
//                with If-None-Match (an unchanged answer is a 304, which GitHub does not count against the
//                rate limit) and cached here for 1.5 seconds, so any number of open tabs cost at most one
//                check per warm server every 1.5 seconds. Elsewhere it is a counter bumped on every write.
//   activity     on GitHub, a one-line trailer on each commit ("Activity: {...}") read back from the commit
//                list, fetched once per new head. Elsewhere, kept in memory. Nothing extra is written.
//   presence     which AI apps are connected and working: requests seen by this server, plus anything an
//                agent wrote in the last few minutes. Best effort: on serverless it only sees its own requests.
import { verify } from './auth.mjs';

export const RECENT_MS = 5 * 60_000; // "connected now" means active in the last five minutes
const WORKING_MS = 12_000;
const VERSION_TTL = 1500;
const KEEP = 100;
const BOOT = Math.random().toString(36).slice(2, 7);

// ---------- who did it ----------

// The apps people connect, by what they call themselves. Order matters: Claude Code before Claude.
const APPS = [
  ['claude-code', 'Claude Code', /claude[\s_-]*code/i],
  ['codex', 'Codex', /codex/i],
  ['gpt', 'GPT', /^gpt$/i],
  ['chatgpt', 'ChatGPT', /chatgpt|openai/i],
  ['claude', 'Claude', /claude|anthropic/i],
  ['cursor', 'Cursor', /cursor/i],
];

export function appOf(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const hit = APPS.find(([, , re]) => re.test(s));
  return hit ? { app: hit[0], agent: hit[1] } : null;
}

const first = (name) => String(name ?? '').split(' ')[0] || 'Someone';

export function makeActor(person, { via = 'web', app = null, agent = null } = {}) {
  const name = person?.name ?? 'Someone';
  const what = via === 'web' ? null : via === 'import' ? 'Import' : agent ?? 'AI app';
  return { by: person?.id ?? null, name, via, app: app ?? (via === 'web' ? 'browser' : via === 'import' ? 'import' : 'agent'), agent: what, label: what ? `${what} (${first(name)}'s)` : first(name) };
}
export const webActor = (person) => makeActor(person, { via: 'web' });

// MCP clients say their name once, on initialize. The server is stateless, so later calls are matched to it
// by person and user agent, in memory on this server.
const named = new Map();
const fingerprint = (req, person) => `${person?.id}|${req.headers['user-agent'] ?? ''}`;

// channel: 'mcp' for /mcp, 'rest' for /v1 (the web pages with a cookie, or a ChatGPT GPT with a token).
export function actorFor(req, person, { channel = 'mcp', body } = {}) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = bearer ? verify(bearer, 'access') : null;
  const ua = req.headers['user-agent'] ?? '';
  if (channel === 'rest' && !bearer) return webActor(person);
  if (channel === 'rest') {
    const a = appOf(claims?.a) ?? appOf(ua);
    // A ChatGPT that calls /v1 with a token is a GPT with Actions.
    const gpt = !a || a.app === 'gpt' || a.app === 'chatgpt';
    return gpt ? makeActor(person, { via: 'gpt', app: 'gpt', agent: 'GPT' }) : makeActor(person, { via: 'agent', ...a });
  }
  const msgs = Array.isArray(body) ? body : [body];
  const init = msgs.find((m) => m?.method === 'initialize')?.params?.clientInfo?.name;
  if (init) {
    named.set(fingerprint(req, person), init);
    if (named.size > 500) named.delete(named.keys().next().value);
  }
  const openaiMeta = msgs.some((m) => Object.keys(m?.params?._meta ?? {}).some((k) => k.startsWith('openai/')));
  const a = appOf(claims?.a) ?? appOf(init ?? named.get(fingerprint(req, person))) ?? (openaiMeta ? appOf('chatgpt') : null) ?? appOf(ua);
  return makeActor(person, { via: 'agent', ...(a ?? {}) });
}

// ---------- per-store state ----------

const byKey = new Map(); // GitHub repos: one state per repo and branch, shared by every request on this server
const byStore = new WeakMap(); // everything else: one state per store object
const isGitHub = (store) => !!store?.repo;
function stateOf(store) {
  if (isGitHub(store)) {
    const k = `${store.repo}@${store.branch ?? 'main'}`;
    if (!byKey.has(k)) byKey.set(k, fresh());
    return byKey.get(k);
  }
  if (!byStore.has(store)) byStore.set(store, fresh());
  return byStore.get(store);
}
const fresh = () => ({ n: 0, entries: [], presence: new Map(), ver: null, feed: null });

// Every write through the store bumps the version, and a write with an activity entry records it.
// Installed once per store, so every writer (tasks, alerts, documents, the team list) is covered.
export function track(store) {
  if (!store || store.__live) return store;
  const write = store.write.bind(store);
  store.write = async (p, text, opts = {}) => {
    const a = opts.activity;
    const message = a && isGitHub(store) ? `${opts.message}\n\nActivity: ${JSON.stringify(a)}` : opts.message;
    const out = await write(p, text, { ...opts, message });
    const st = stateOf(store);
    st.n++;
    st.ver = null;
    if (a) remember(st, a);
    return out;
  };
  Object.defineProperty(store, '__live', { value: true });
  return store;
}

function remember(st, a) {
  st.entries.unshift(a);
  st.entries.length = Math.min(st.entries.length, KEEP);
  if (a.via !== 'web' && a.via !== 'import') seen(st, a).last = Date.parse(a.at);
}

// One activity entry. verb has {item} where the item's name goes: "moved {item} to Review".
export function entry(actor, verb, item) {
  const a = actor ?? makeActor(null);
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    by: a.by, name: a.name, via: a.via, app: a.app, agent: a.agent, label: a.label,
    verb, item,
  };
}

// ---------- version ----------

async function gh(store, url, etag) {
  const token = typeof store.token === 'function' ? await store.token() : store.token;
  const base = store.apiBase ?? process.env.GITHUB_API_BASE ?? 'https://api.github.com';
  return fetch(`${base}/repos/${store.repo}${url}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'agent-kanban', ...(etag ? { 'if-none-match': etag } : {}) },
  });
}

export async function liveVersion(store) {
  const st = stateOf(store);
  if (!isGitHub(store)) return `${BOOT}.${store.since ?? 0}.${st.n}`;
  const now = Date.now();
  if (st.ver && now - st.ver.at < VERSION_TTL) return st.ver.value;
  // One question to GitHub at a time, however many tabs ask.
  st.asking ??= (async () => {
    try {
      const res = await gh(store, `/git/ref/heads/${store.branch ?? 'main'}`, st.ver?.etag);
      if (res.status === 304 && st.ver) { st.ver = { ...st.ver, at: Date.now() }; return st.ver.value; }
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const ref = await res.json();
      st.ver = { value: ref.object.sha, etag: res.headers.get('etag'), at: Date.now() };
      return st.ver.value;
    } finally { st.asking = null; }
  })();
  return st.asking;
}

// ---------- activity ----------

export async function recentActivity(store) {
  const st = stateOf(store);
  if (!isGitHub(store)) return st.entries;
  const head = await liveVersion(store);
  if (st.feed?.head === head) return st.feed.entries;
  const res = await gh(store, `/commits?sha=${encodeURIComponent(store.branch ?? 'main')}&per_page=60`, st.feed?.etag);
  if (res.status === 304 && st.feed) { st.feed.head = head; return st.feed.entries; }
  if (!res.ok) return st.feed?.entries ?? [];
  const list = await res.json();
  const entries = [];
  for (const c of list) {
    const m = /^Activity: (\{.*\})\s*$/m.exec(c.commit?.message ?? '');
    if (!m) continue;
    try { entries.push(JSON.parse(m[1])); } catch { /* not ours */ }
  }
  st.feed = { head, etag: res.headers.get('etag'), entries };
  for (const a of entries) if (a.via !== 'web' && a.via !== 'import') { const p = seen(st, a); p.last = Math.max(p.last, Date.parse(a.at)); }
  return entries;
}

// ---------- presence ----------

function seen(st, actor) {
  const k = `${actor.by}|${actor.app}`;
  if (!st.presence.has(k)) st.presence.set(k, { by: actor.by, app: actor.app, agent: actor.agent, label: actor.label, last: 0, busy: 0 });
  return st.presence.get(k);
}

// An agent's request starts: it shows as working until it ends. Returns the function that ends it.
export function busy(store, actor) {
  if (!actor || actor.via === 'web' || actor.via === 'import') return () => {};
  const p = seen(stateOf(store), actor);
  p.busy++;
  p.last = Date.now();
  let done = false;
  return () => { if (!done) { done = true; p.busy = Math.max(0, p.busy - 1); p.last = Date.now(); } };
}

export function connectedNow(store, { visible = () => true } = {}) {
  const now = Date.now();
  return [...stateOf(store).presence.values()]
    .filter((p) => now - p.last < RECENT_MS && visible(p))
    .sort((a, b) => b.last - a.last)
    .map((p) => ({ label: p.label, app: p.app, agent: p.agent, by: p.by, last: new Date(p.last).toISOString(), working: p.busy > 0 || now - p.last < WORKING_MS }));
}

// ---------- the endpoint pages poll ----------

// GET <live>?v=<version the page has>. Unchanged: { v, changed: false, connected }. Changed (or the first
// call): also the latest activity this person may see, newest first.
export async function liveState(store, { v, visible = () => true, limit = 30 } = {}) {
  const now = await liveVersion(store);
  const out = { v: now, changed: now !== v };
  if (out.changed) out.activity = (await recentActivity(store)).filter(visible).slice(0, limit);
  out.connected = connectedNow(store);
  return out;
}

// Plain-text lines for agents (the recent_activity tool).
export function activityLines(entries, { since } = {}) {
  const shown = since ? entries.filter((a) => a.at > since) : entries;
  if (!shown.length) return 'Nothing yet.';
  return shown.map((a) => `- ${a.at.slice(0, 16).replace('T', ' ')} ${a.label} ${String(a.verb).replace('{item}', a.item?.title ? `"${a.item.title}"` : 'an item')}${a.item?.id ? ` (${a.item.id})` : ''}`).join('\n');
}
