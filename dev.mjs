// Local server against a folder instead of GitHub: WORKSPACE_DIR=example-workspace node dev.mjs
// Routes mirror vercel.json.
import http from 'node:http';
import path from 'node:path';
import { Workspace } from './lib/workspace.mjs';
import { FsStore } from './lib/store.mjs';
import { workspaceFromEnv } from './lib/http.mjs';
import { routeBoard } from './lib/routes.mjs';

export function serve(ws, port = 0) {
  const srv = http.createServer(async (req, res) => {
    // PUBLIC_URL: the board's public https address when it runs behind a proxy (any Node host).
    const host = process.env.PUBLIC_URL?.replace(/\/$/, '') || `http://${req.headers.host}`;
    try {
      if (await routeBoard(req, res, ws, host)) return;
      res.writeHead(404).end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500).end(String(e.message));
    }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3977);
  if (process.env.HOSTED === '1') {
    // Many teams from one server: HOSTED=1 npm run dev (demo mode unless a GitHub App is configured).
    const { serveHosted } = await import('./lib/hosted.mjs');
    const srv = await serveHosted(port);
    console.log(`agent-kanban (hosted) on http://localhost:${srv.address().port}  (create a board at /)`);
  } else {
    // DEMO_BOARD=1 npm run dev: the public demo board (no sign-in, changes reset).
    const ws = process.env.WORKSPACE_REPO || process.env.DEMO_BOARD === '1' ? workspaceFromEnv() : new Workspace(new FsStore(path.resolve(process.env.WORKSPACE_DIR || 'example-workspace')));
    const srv = await serve(ws, port);
    console.log(`agent-kanban on http://localhost:${srv.address().port}  (connect agents to /mcp, open /board)`);
  }
}
