// Local server against a folder instead of GitHub: WORKSPACE_DIR=example-workspace node dev.mjs
// Routes mirror vercel.json.
import http from 'node:http';
import path from 'node:path';
import { Workspace } from './lib/workspace.mjs';
import { FsStore, GitHubStore } from './lib/store.mjs';
import { handleMcp, handleBoard, handleInstructions } from './lib/http.mjs';
import { handleAuthorize, handleToken, handleRegister, handleGithubCallback, handleLogin, resourceMetadata, serverMetadata, json } from './lib/auth.mjs';
import { handleRest, openApi } from './lib/rest.mjs';

export function serve(ws, port = 0) {
  const srv = http.createServer(async (req, res) => {
    const host = `http://${req.headers.host}`;
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/mcp') return await handleMcp(req, res, ws, host);
      if (p.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, resourceMetadata(host));
      if (p.startsWith('/.well-known/oauth-authorization-server')) return json(res, 200, serverMetadata(host));
      if (p === '/oauth/authorize') return await handleAuthorize(req, res, host);
      if (p === '/oauth/token') return await handleToken(req, res, ws);
      if (p === '/oauth/register') return await handleRegister(req, res);
      if (p === '/oauth/github/callback') return await handleGithubCallback(req, res, ws, host);
      if (p === '/login') return handleLogin(req, res, host);
      if (p === '/board') return await handleBoard(req, res, ws);
      if (p === '/instructions' || p === '/INSTRUCTIONS.md') return await handleInstructions(req, res, ws, host);
      if (p.startsWith('/v1/')) return await handleRest(req, res, ws, p.slice(4));
      if (p === '/openapi.json') return json(res, 200, openApi(host));
      res.writeHead(404).end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500).end(String(e.message));
    }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const store = process.env.WORKSPACE_REPO
    ? new GitHubStore({ repo: process.env.WORKSPACE_REPO, token: process.env.GITHUB_TOKEN })
    : new FsStore(path.resolve(process.env.WORKSPACE_DIR || 'example-workspace'));
  const srv = await serve(new Workspace(store), Number(process.env.PORT || 3977));
  console.log(`agent-kanban on http://localhost:${srv.address().port}  (connect agents to /mcp, open /board)`);
}
