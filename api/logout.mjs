import { handleLogout } from '../lib/http.mjs';

export default function handler(req, res) {
  handleLogout(req, res);
}
