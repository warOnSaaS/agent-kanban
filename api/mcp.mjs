import { handleMcp, hostOf, workspaceFromEnv } from '../lib/http.mjs';

export default async function handler(req, res) {
  await handleMcp(req, res, workspaceFromEnv(), hostOf(req));
}
