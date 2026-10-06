import { handleBoard, workspaceFromEnv } from '../lib/http.mjs';

export default async function handler(req, res) {
  await handleBoard(req, res, workspaceFromEnv());
}
