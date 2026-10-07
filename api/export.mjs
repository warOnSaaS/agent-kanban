import { handleExport, workspaceFromEnv } from '../lib/http.mjs';

// The owner's zip of everything: /export.zip
export default async function handler(req, res) {
  await handleExport(req, res, workspaceFromEnv());
}
