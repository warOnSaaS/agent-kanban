import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { defineTools } from './mcp.mjs';
import { personFromRequest, bodyObject, json } from './auth.mjs';
import { actorFor, busy } from './live.mjs';

// The same tools as the MCP server, as plain HTTPS calls, for a ChatGPT GPT with Actions:
// those work on every paid ChatGPT plan and in the phone apps. Sign-in is the same GitHub OAuth.

// ---------- the tools over HTTPS ----------

export async function handleRest(req, res, ws, name, host) {
  const person = await personFromRequest(ws, req);
  if (!person) return json(res, 401, { error: 'Sign in again: your GitHub sign-in is missing or expired.' });
  // Browser calls ride on the session cookie. Only our own pages send this header (another site can't
  // without a CORS preflight we never allow), so a forged form post from elsewhere is refused.
  if (!req.headers.authorization && req.headers['x-requested-with'] !== 'agent-kanban') return json(res, 403, { error: 'Missing request header' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });

  const session = ws.as(person);
  session.host = host ?? `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  const tools = collect(session);
  const t = tools.get(name);
  if (!t) return json(res, 404, { error: `No action called ${name}` });
  // The web pages (a cookie) or a ChatGPT GPT (a token): who it was, for the live feed.
  session.actor = actorFor(req, person, { channel: 'rest' });
  const body = await bodyObject(req);
  const parsed = z.object(t.shape).safeParse(body ?? {});
  if (!parsed.success) return json(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  const done = busy(ws.store, session.actor);
  const out = await t.run(parsed.data).finally(done);
  const text = out.content.map((c) => c.text).join('\n');
  json(res, out.isError ? 400 : 200, out.isError ? { error: text } : { result: text });
}

function collect(session) {
  const tools = new Map();
  defineTools(session, (name, meta, run) => tools.set(name, { ...meta, run }));
  return tools;
}

// ---------- the spec the GPT imports ----------

export function openApi(host) {
  // Owner view, so every action is described; who may actually do what is decided per call.
  const tools = collect({ me: { id: 'you', name: 'the person signed in', role: 'owner' }, isOwner: true });
  const paths = {};
  for (const [name, t] of tools) {
    if (t.gpt === false) continue;
    const schema = zodToJsonSchema(z.object(t.shape), { target: 'openApi3', $refStrategy: 'none' });
    delete schema.$schema;
    paths[`/v1/${name}`] = {
      post: {
        operationId: name,
        summary: t.title,
        description: t.description.slice(0, 300),
        'x-openai-isConsequential': false,
        requestBody: { required: true, content: { 'application/json': { schema } } },
        responses: { 200: { description: 'Done', content: { 'application/json': { schema: { type: 'object', properties: { result: { type: 'string' } } } } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'agent-kanban', version: '1.0.0', description: 'Shared tasks, hand-offs, reviews, notes and ideas for a team and their agents.' },
    servers: [{ url: host }],
    paths,
    components: { schemas: {} },
  };
}
