// Per-team usage, counted but not billed. Requests and bytes served, per product, held in memory and handed to
// whatever sink is configured. There is no sink yet: this is the hook billing plugs into later, so counting
// costs nothing today and nothing has to change in the request path when it arrives.

const counts = new Map();
let sink = null;

export function meter(team, product, { requests = 1, bytes = 0 } = {}) {
  if (!team) return;
  const k = `${team}\u0000${product}`;
  const c = counts.get(k) ?? { team, product, requests: 0, bytes: 0, since: new Date().toISOString() };
  c.requests += requests;
  c.bytes += bytes;
  counts.set(k, c);
}

export const usage = (team) => [...counts.values()].filter((c) => !team || c.team === team);
export const setMeterSink = (fn) => { sink = fn; };
export async function flushMeter() {
  if (!sink) return;
  const batch = [...counts.values()];
  counts.clear();
  await sink(batch);
}
