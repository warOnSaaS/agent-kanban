// A stand-in for account.waronsaas.com, enough for the account tests: the OpenID Connect code flow with PKCE,
// RS256 ID tokens, the keys endpoint, "is this session still live", and end-session. Who signs in is decided by
// the test (fake.who); prompt=none answers login_required unless fake.browserSignedIn is set.
import http from 'node:http';
import crypto from 'node:crypto';

export function fakeAccount({ clientId = 'board', clientSecret = 'board-secret' } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const codes = new Map();
  const fake = { who: null, browserSignedIn: true, dead: new Set(), authorizations: [], checks: 0, srv: null, issuer: null };
  let n = 0;

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (claims) => {
    const body = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
    return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
  };

  fake.srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, fake.issuer);
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    const q = Object.fromEntries(u.searchParams);

    if (u.pathname === '/jwks.json') return send(200, { keys: [jwk] });

    if (u.pathname === '/oauth/authorize') {
      fake.authorizations.push(q);
      const back = new URL(q.redirect_uri);
      if (q.state) back.searchParams.set('state', q.state);
      back.searchParams.set('iss', fake.issuer);
      if (q.client_id !== clientId) return send(400, { error: 'unknown client' });
      if (q.prompt === 'none' && !fake.browserSignedIn) {
        back.searchParams.set('error', 'login_required');
        return res.writeHead(302, { location: back.toString() }).end();
      }
      if (!fake.who) return send(500, { error: 'the test did not say who signs in (fake.who)' });
      const code = `code-${++n}`;
      const sid = fake.who.sid ?? `ses_${n}`;
      codes.set(code, { cc: q.code_challenge, nonce: q.nonce, redirect: q.redirect_uri, scope: q.scope, connection: q.connection ?? null, profile: { ...fake.who, sid } });
      back.searchParams.set('code', code);
      return res.writeHead(302, { location: back.toString() }).end();
    }

    if (u.pathname === '/oauth/token') {
      const auth = Buffer.from((req.headers.authorization ?? '').replace(/^Basic\s+/i, ''), 'base64').toString().split(':').map(decodeURIComponent);
      if (auth[0] !== clientId || auth[1] !== clientSecret) return send(401, { error: 'invalid_client' });
      const b = Object.fromEntries(new URLSearchParams(raw));
      const g = codes.get(b.code);
      codes.delete(b.code);
      if (!g || g.redirect !== b.redirect_uri) return send(400, { error: 'invalid_grant' });
      if (crypto.createHash('sha256').update(String(b.code_verifier ?? '')).digest('base64url') !== g.cc) return send(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const now = Math.floor(Date.now() / 1000);
      const { sid, ...p } = g.profile;
      return send(200, { access_token: `at-${sid}`, token_type: 'Bearer', expires_in: 3600, id_token: idToken({ iss: fake.issuer, aud: clientId, iat: now, exp: now + 600, nonce: g.nonce, sid, auth_time: now, amr: ['pwd'], ...p }) });
    }

    if (u.pathname === '/api/sessions/check') {
      fake.checks++;
      const b = JSON.parse(raw || '{}');
      const sids = [].concat(b.sid ?? []);
      return send(200, { sessions: Object.fromEntries(sids.map((s) => [s, !fake.dead.has(s)])) });
    }

    if (u.pathname === '/oauth/end-session') {
      fake.endedWith = q;
      return res.writeHead(302, { location: q.post_logout_redirect_uri || fake.issuer }).end();
    }

    send(404, { error: 'not found' });
  });

  fake.listen = () => new Promise((r) => fake.srv.listen(0, () => { fake.issuer = `http://localhost:${fake.srv.address().port}`; r(fake.issuer); }));
  fake.close = () => fake.srv.close();
  return fake;
}

// Walks the browser through the account: our /auth/waronsaas, the fake's authorize, back to our callback.
// Returns the callback response and the flow cookie it was sent with.
export async function signInThrough(origin, startPath, { cookies = '' } = {}) {
  const start = await fetch(origin + startPath, { redirect: 'manual', headers: cookies ? { cookie: cookies } : {} });
  if (start.status !== 302) throw new Error(`expected a redirect from ${startPath}, got ${start.status}`);
  const flow = (start.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('wos_acct_flow='))?.split(';')[0];
  const toAccount = start.headers.get('location');
  const back = await fetch(toAccount, { redirect: 'manual' });
  const cb = back.headers.get('location');
  if (!cb) throw new Error(`the account did not redirect back: ${back.status}`);
  const res = await fetch(cb, { redirect: 'manual', headers: { cookie: [flow, cookies].filter(Boolean).join('; ') } });
  return { res, authorizeUrl: new URL(toAccount), callbackUrl: new URL(cb) };
}

export const cookieFrom = (res, name) => {
  const c = (res.headers.getSetCookie?.() ?? []).find((x) => x.startsWith(`${name}=`) && !/Max-Age=0/.test(x));
  return c ? { header: c.split(';')[0], value: decodeURIComponent(c.split(';')[0].slice(name.length + 1)), path: /Path=([^;]+)/.exec(c)?.[1], raw: c } : null;
};
