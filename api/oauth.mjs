import { handleAuthorize, handleToken, handleRegister, handleGithubCallback, handleLogin } from '../lib/auth.mjs';
import { hostOf, workspaceFromEnv } from '../lib/http.mjs';

export default async function handler(req, res) {
  const host = hostOf(req);
  switch (req.query.step) {
    case 'authorize': return handleAuthorize(req, res, host);
    case 'token': return handleToken(req, res, workspaceFromEnv());
    case 'register': return handleRegister(req, res);
    case 'github-callback': return handleGithubCallback(req, res, workspaceFromEnv(), host);
    case 'login': return handleLogin(req, res, host);
    default: res.writeHead(404).end();
  }
}
