// Fails if any instance-specific name (from instances/*.names, git-ignored) appears in a tracked file.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = 'instances';
const names = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.names')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  : [];
if (!names.length) {
  console.log('check:clean: no instances/*.names files, nothing to check');
  process.exit(0);
}
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const hits = [];
for (const f of files) {
  if (!fs.existsSync(f) || fs.lstatSync(f).isSymbolicLink()) continue;
  const text = fs.readFileSync(f, 'utf8').toLowerCase();
  for (const n of names) if (text.includes(n.toLowerCase())) hits.push(`${f}: "${n}"`);
}
if (hits.length) {
  console.error(`check:clean: instance-specific names in tracked files:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:clean: ${files.length} files clean of ${names.length} instance names`);
