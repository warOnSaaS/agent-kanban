// Writes tools.json, the board's tool catalogue in the wOS suite format, from the same defineTools the MCP server
// and /v1 use (lib/mcp.mjs), plus the suite-only tools in server.mjs. --check fails if tools.json is out of date.
//   node scripts/tools-json.mjs [--check]
import fs from 'node:fs';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { defineTools } from '../lib/mcp.mjs';
import { SUITE_TOOLS, ADMIN_TOOLS, APP } from '../server.mjs';

const schemaOf = (shape) => {
  const s = zodToJsonSchema(z.object(shape ?? {}), { target: 'jsonSchema7', $refStrategy: 'none' });
  delete s.$schema;
  return { type: 'object', ...s };
};
const clean = (s) => String(s).replace(/\u2014/g, ',');
const TEXT = { type: 'object', properties: { result: { type: 'string' } } };

const tools = [];
const session = { me: { id: 'you', name: 'the person signed in', role: 'owner' }, isOwner: true };
defineTools(session, (name, meta) => {
  let description = clean(meta.description ?? meta.title ?? name);
  if (description.length < 20) description = `${description} (board).`.padEnd(20, '.');
  tools.push({
    name: `${APP}.${name}`,
    title: clean(meta.title ?? name).slice(0, 60),
    description: description.slice(0, 1200),
    input: schemaOf(meta.shape),
    output: TEXT,
    scope: meta.readOnly ? 'read' : ADMIN_TOOLS.has(name) ? 'admin' : 'write',
    confirm: 'none',
    emits: meta.readOnly ? [] : ['board.item.changed'],
    test: 'test/suite.test.mjs',
  });
});
for (const [name, t] of Object.entries(SUITE_TOOLS)) {
  tools.push({
    name: `${APP}.${name}`,
    title: t.title,
    description: t.description,
    input: schemaOf(t.shape),
    output: name === 'render_screen'
      ? { type: 'object', properties: { title: { type: 'string' }, current: { type: 'string' }, body: { type: 'string' }, unread: { type: 'number' }, me: { type: 'string' }, admin: { type: 'boolean' } } }
      : { type: 'object', properties: { result: { type: 'string' }, mode: { type: 'string' }, repo: { type: ['string', 'null'] } } },
    scope: t.scope,
    confirm: 'none',
    emits: t.scope === 'read' ? [] : ['board.item.changed'],
    test: 'test/suite.test.mjs',
  });
}
for (const t of tools) if (!t.emits.length) delete t.emits;

const out = JSON.stringify({ $schema: 'https://raw.githubusercontent.com/warOnSaaS/suite/main/packages/tools/tools.schema.json', app: APP, version: 1, tools }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync('tools.json') || fs.readFileSync('tools.json', 'utf8') !== out) { console.error('tools.json is out of date: run node scripts/tools-json.mjs'); process.exit(1); }
  console.log(`tools.json is current (${tools.length} tools)`);
} else {
  fs.writeFileSync('tools.json', out);
  console.log(`wrote tools.json (${tools.length} tools)`);
}
