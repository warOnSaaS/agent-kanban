import { resourceMetadata, serverMetadata, json } from '../lib/auth.mjs';
import { hostOf } from '../lib/http.mjs';

export default function handler(req, res) {
  // The demo board has no sign-in, so it offers none: apps then connect without asking.
  if (process.env.DEMO_BOARD === '1') return json(res, 404, { error: 'This board needs no sign-in.' });
  const host = hostOf(req);
  json(res, 200, req.query.doc === 'resource' ? resourceMetadata(host) : serverMetadata(host), { 'access-control-allow-origin': '*' });
}
