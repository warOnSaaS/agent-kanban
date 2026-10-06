import { handleRest } from '../lib/rest.mjs';
import { workspaceFromEnv } from '../lib/http.mjs';

export default async function handler(req, res) {
  await handleRest(req, res, workspaceFromEnv(), req.query.tool);
}
