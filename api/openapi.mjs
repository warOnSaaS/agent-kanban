import { openApi } from '../lib/rest.mjs';
import { hostOf } from '../lib/http.mjs';

export default function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(openApi(hostOf(req)), null, 2));
}
