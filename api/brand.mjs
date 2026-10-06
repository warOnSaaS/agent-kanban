import { handleBrandFile } from '../lib/brand.mjs';
import { workspaceFromEnv } from '../lib/http.mjs';

export default async function handler(req, res) {
  await handleBrandFile(req, res, workspaceFromEnv(), req.query.file);
}
