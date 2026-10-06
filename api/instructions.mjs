import { handleInstructions, hostOf, workspaceFromEnv } from '../lib/http.mjs';

export default async function handler(req, res) {
  await handleInstructions(req, res, workspaceFromEnv(), hostOf(req));
}
