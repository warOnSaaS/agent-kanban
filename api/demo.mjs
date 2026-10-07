// The public demo board as one function. The demo keeps changes in memory, and on Vercel each file in
// api/ is a separate function with its own memory, so a change an agent made through /mcp never reached
// /board. vercel.demo.json sends every path here, and this applies vercel.json's rewrites (copied below,
// because a deploy with vercel.demo.json ships that file as vercel.json) to the same handlers. A test
// fails if the copy and vercel.json drift. Deploy with: scripts/deploy.sh demo (instances/demo.env sets
// VERCEL_CONFIG=vercel.demo.json). Team boards keep a function per route: their data is in GitHub.
import board from './board.mjs';
import brand from './brand.mjs';
import connect from './connect.mjs';
import home from './home.mjs';
import instructions from './instructions.mjs';
import logout from './logout.mjs';
import mcp from './mcp.mjs';
import oauth from './oauth.mjs';
import openapi from './openapi.mjs';
import v1 from './v1.mjs';
import wellknown from './wellknown.mjs';

const HANDLERS = { board, brand, connect, home, instructions, logout, mcp, oauth, openapi, v1, wellknown };
export const REWRITES = [
  ['/mcp', '/api/mcp'],
  ['/.well-known/oauth-protected-resource', '/api/wellknown?doc=resource'],
  ['/.well-known/oauth-protected-resource/mcp', '/api/wellknown?doc=resource'],
  ['/.well-known/oauth-authorization-server', '/api/wellknown?doc=server'],
  ['/.well-known/oauth-authorization-server/mcp', '/api/wellknown?doc=server'],
  ['/oauth/github/callback', '/api/oauth?step=github-callback'],
  ['/oauth/:step', '/api/oauth?step=:step'],
  ['/login', '/api/oauth?step=login'],
  ['/board', '/api/board'],
  ['/board/:kind', '/api/board?kind=:kind'],
  ['/board/:kind/:id', '/api/board?kind=:kind&id=:id'],
  ['/brand/:file', '/api/brand?file=:file'],
  ['/logout', '/api/logout'],
  ['/instructions', '/api/instructions'],
  ['/INSTRUCTIONS.md', '/api/instructions'],
  ['/v1/:tool', '/api/v1?tool=:tool'],
  ['/openapi.json', '/api/openapi'],
  ['/connect', '/api/connect'],
  ['/connect/:app', '/api/connect?app=:app'],
  ['/privacy', '/api/home?page=privacy'],
  ['/', '/api/home'],
].map(([source, destination]) => ({ source, destination }));

// "/board/:kind/:id" against "/board/t/abc" -> { kind: 't', id: 'abc' }
export function match(source, path) {
  const a = source.split('/'), b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) { if (!b[i]) return null; params[a[i].slice(1)] = decodeURIComponent(b[i]); }
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function route(path) {
  for (const r of REWRITES) {
    const params = match(r.source, path);
    if (!params) continue;
    const dest = new URL(r.destination.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? '')), 'http://x');
    const name = dest.pathname.replace(/^\/api\//, '');
    if (HANDLERS[name]) return { handler: HANDLERS[name], query: Object.fromEntries(dest.searchParams) };
  }
  return null;
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const path = u.searchParams.get('__p') ?? u.pathname;
  u.searchParams.delete('__p');
  const hit = route(path);
  if (!hit) return res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  const search = u.searchParams.toString();
  req.url = path + (search ? `?${search}` : '');
  Object.defineProperty(req, 'query', { value: { ...Object.fromEntries(u.searchParams), ...hit.query }, configurable: true, writable: true });
  return hit.handler(req, res);
}
