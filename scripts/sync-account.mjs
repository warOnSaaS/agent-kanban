// Copies the warOnSaaS Account client library into lib/account-client.mjs. The library's source of truth is the
// account repo (warOnSaaS/account, client/account-client.mjs); never edit the copy here.
// Usage: node scripts/sync-account.mjs [path-to-account-repo]   (default ../wos-account)
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2] ?? path.resolve('..', 'wos-account');
const src = path.join(repo, 'client', 'account-client.mjs');
const code = fs.readFileSync(src, 'utf8');
const header = `// Copied from warOnSaaS/account (client/account-client.mjs) by scripts/sync-account.mjs. Do not edit here:\n// change it in the account repo and run the sync again.\n`;
fs.writeFileSync('lib/account-client.mjs', header + code);
console.log(`synced account client (${code.length} bytes) from ${src}`);
