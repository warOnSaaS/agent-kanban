import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

// Which team a request belongs to, for code that runs deep inside it (sign-in, cookies, signed tokens).
// Self-hosted, there is no context and everything falls back to the instance's own env, exactly as before.
// Hosted, the router runs each request inside its team's context:
//   { team, base, secret, cookie: { name, path }, github: { clientId, clientSecret, callback } }
// Product-agnostic: agent-kanban, the CRM or any other warOnSaaS app reads the same shape.

const als = new AsyncLocalStorage();

export const runInContext = (ctx, fn) => als.run(ctx, fn);
export const currentContext = () => als.getStore() ?? null;

// Each team signs with its own key, derived from the one root secret. A token, cookie, sign-in code or
// invite link made for one team never verifies on another, even for the same person.
export const deriveSecret = (root, scope) => crypto.createHmac('sha256', String(root)).update(`warOnSaaS-tenant:${scope}`).digest('base64url');
