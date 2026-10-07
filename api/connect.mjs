import { handleConnect } from '../lib/connect.mjs';
import { hostOf, workspaceFromEnv } from '../lib/http.mjs';

// The script behind the Claude Code and Codex tiles: curl -fsSL <board>/connect/claude | sh
export default function handler(req, res) {
  handleConnect(req, res, workspaceFromEnv(), hostOf(req), req.query.app);
}
