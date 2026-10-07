import { handleHome } from '../lib/connect.mjs';
import { hostOf, workspaceFromEnv } from '../lib/http.mjs';

// The board's front door: the connect page (pick your app). /privacy is the privacy note.
export default async function handler(req, res) {
  await handleHome(req, res, workspaceFromEnv(), hostOf(req), req.query.page);
}
