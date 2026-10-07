// Every route a board serves, in one table. dev.mjs (any Node host) uses it for a single board; the hosted
// router (lib/hosted.mjs) uses it for each team under /t/<team>. vercel.json maps the same paths to api/.
import { handleMcp, handleBoard, handleInstructions, handleLogout, handleExport } from './http.mjs';
import { handleBrandFile } from './brand.mjs';
import { handleAuthorize, handleToken, handleRegister, handleGithubCallback, handleLogin, resourceMetadata, serverMetadata, json } from './auth.mjs';
import { handleRest, openApi } from './rest.mjs';
import { handleHome, handleConnect } from './connect.mjs';

// Returns false when nothing matched, so the caller can 404 or try its own routes.
export async function routeBoard(req, res, ws, host, p = new URL(req.url, 'http://x').pathname) {
  if (p === '/mcp') return await handleMcp(req, res, ws, host), true;
  if (p.startsWith('/.well-known/') && ws.demo) return json(res, 404, { error: 'This board needs no sign-in.' }), true;
  if (p.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, resourceMetadata(host), { 'access-control-allow-origin': '*' }), true;
  if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration')) return json(res, 200, serverMetadata(host), { 'access-control-allow-origin': '*' }), true;
  if (p === '/oauth/authorize') return await handleAuthorize(req, res, host), true;
  if (p === '/oauth/token') return await handleToken(req, res, ws), true;
  if (p === '/oauth/register') return await handleRegister(req, res), true;
  if (p === '/oauth/github/callback') return await handleGithubCallback(req, res, ws, host), true;
  if (p === '/login') return handleLogin(req, res, host), true;
  if (p === '/board' || p.startsWith('/board/')) {
    const [, , kind, id] = p.split('/');
    return await handleBoard(req, res, ws, { kind, id: id && decodeURIComponent(id) }), true;
  }
  if (p.startsWith('/brand/')) return await handleBrandFile(req, res, ws, decodeURIComponent(p.slice(7))), true;
  if (p === '/logout') return handleLogout(req, res), true;
  if (p === '/instructions' || p === '/INSTRUCTIONS.md') return await handleInstructions(req, res, ws, host), true;
  if (p.startsWith('/v1/')) return await handleRest(req, res, ws, p.slice(4), host), true;
  if (p === '/openapi.json') return json(res, 200, openApi(host)), true;
  if (p === '/export.zip') return await handleExport(req, res, ws), true;
  if (p === '/' || p === '/privacy') return await handleHome(req, res, ws, host, p === '/privacy' ? 'privacy' : undefined), true;
  if (p === '/connect' || p.startsWith('/connect/')) return handleConnect(req, res, ws, host, p.split('/')[2]), true;
  return false;
}
