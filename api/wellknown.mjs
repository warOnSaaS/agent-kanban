import { resourceMetadata, serverMetadata, json } from '../lib/auth.mjs';
import { hostOf } from '../lib/http.mjs';

export default function handler(req, res) {
  const host = hostOf(req);
  json(res, 200, req.query.doc === 'resource' ? resourceMetadata(host) : serverMetadata(host), { 'access-control-allow-origin': '*' });
}
