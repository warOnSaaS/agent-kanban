// Local server against a folder instead of GitHub: WORKSPACE_DIR=example-workspace node dev.mjs
// Routes mirror vercel.json.
import http from 'node:http';
import path from 'node:path';
import { Workspace } from './lib/workspace.mjs';
import { FsStore, GitHubStore } from './lib/store.mjs';
import { handleMcp, handleBoard, handleInstructions, handleLogout, workspaceFromEnv } from './lib/http.mjs';
import { handleBrandFile } from './lib/brand.mjs';
import { handleAuthorize, handleToken, handleRegister, handleGithubCallback, handleLogin, resourceMetadata, serverMetadata, json } from './lib/auth.mjs';
import { handleRest, openApi } from './lib/rest.mjs';
import { handleHome, handleConnect } from './lib/connect.mjs';

export function serve(ws, port = 0) {
  const srv = http.createServer(async (req, res) => {
    const host = `http://${req.headers.host}`;
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/mcp') return await handleMcp(req, res, ws, host);
      if (p.startsWith('/.well-known/') && ws.demo) return json(res, 404, { error: 'This board needs no sign-in.' });
      if (p.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, resourceMetadata(host));
      if (p.startsWith('/.well-known/oauth-authorization-server')) return json(res, 200, serverMetadata(host));
      if (p === '/oauth/authorize') return await handleAuthorize(req, res, host);
      if (p === '/oauth/token') return await handleToken(req, res, ws);
      if (p === '/oauth/register') return await handleRegister(req, res);
      if (p === '/oauth/github/callback') return await handleGithubCallback(req, res, ws, host);
      if (p === '/login') return handleLogin(req, res, host);
      if (p === '/board' || p.startsWith('/board/')) {
        const [, , kind, id] = p.split('/');
        return await handleBoard(req, res, ws, { kind, id: id && decodeURIComponent(id) });
      }
      if (p.startsWith('/brand/')) return await handleBrandFile(req, res, ws, decodeURIComponent(p.slice(7)));
      if (p === '/logout') return handleLogout(req, res);
      if (p === '/instructions' || p === '/INSTRUCTIONS.md') return await handleInstructions(req, res, ws, host);
      if (p.startsWith('/v1/')) return await handleRest(req, res, ws, p.slice(4));
      if (p === '/openapi.json') return json(res, 200, openApi(host));
      if (p === '/' || p === '/privacy') return await handleHome(req, res, ws, host, p === '/privacy' ? 'privacy' : undefined);
      if (p === '/connect' || p.startsWith('/connect/')) return handleConnect(req, res, ws, host, p.split('/')[2]);
      res.writeHead(404).end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500).end(String(e.message));
    }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // DEMO_BOARD=1 npm run dev: the public demo board (no sign-in, changes reset).
  const ws = process.env.DEMO_BOARD === '1'
    ? workspaceFromEnv()
    : new Workspace(process.env.WORKSPACE_REPO
      ? new GitHubStore({ repo: process.env.WORKSPACE_REPO, token: process.env.GITHUB_TOKEN })
      : new FsStore(path.resolve(process.env.WORKSPACE_DIR || 'example-workspace')));
  const srv = await serve(ws, Number(process.env.PORT || 3977));
  console.log(`agent-kanban on http://localhost:${srv.address().port}  (connect agents to /mcp, open /board)`);
}
