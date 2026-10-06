import YAML from 'yaml';

// Every item in the workspace is a markdown file with a YAML header.
export function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text ?? '');
  if (!m) return { data: {}, body: (text ?? '').trim() };
  return { data: YAML.parse(m[1]) ?? {}, body: m[2].trim() };
}

export function stringify(data, body = '') {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50) || 'item';
}

// Dates are the team's local day, not UTC, so an evening task isn't stamped tomorrow.
const TZ = process.env.WORKSPACE_TZ || 'UTC';
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const stamp = () => new Date().toISOString().slice(0, 16).replace(':', '');
export const shortId = () => Math.random().toString(36).slice(2, 6);
