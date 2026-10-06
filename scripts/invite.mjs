// A personal setup link for someone in an instance's people.yml, without signing in:
//   node scripts/invite.mjs <instance> <person-id>
// Needs OAUTH_SECRET and PUBLIC_URL in instances/<instance>.env (the same secret as the instance's Vercel env).
import fs from 'node:fs';

const [instance, id] = process.argv.slice(2);
if (!instance || !id) { console.error('usage: node scripts/invite.mjs <instance> <person-id>'); process.exit(1); }
const env = Object.fromEntries(fs.readFileSync(`instances/${instance}.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!env.OAUTH_SECRET || !env.PUBLIC_URL) { console.error(`instances/${instance}.env needs OAUTH_SECRET and PUBLIC_URL`); process.exit(1); }
process.env.OAUTH_SECRET = env.OAUTH_SECRET;
const { sign } = await import('../lib/auth.mjs');
console.log(`${env.PUBLIC_URL}/INSTRUCTIONS.md?for=${encodeURIComponent(sign({ k: 'invite', id }))}`);
