// Path-based teams: one deployment serves many teams at <host>/t/<team>/... The app's pages are written for
// a board at the root ("/board", "/v1/add_task"). Rather than thread a prefix through every page, the hosted
// router strips /t/<team> from the request and puts it back on the way out: in links, form targets, script
// calls and redirects. Only same-site absolute paths change; full addresses and "//" are left alone.

const ATTR = /\b(href|src|action|data-next|formaction)=(["'])\/(?!\/)/g;
const FETCH = /\bfetch\((["'])\/(?!\/)/g;

export function rebaseHtml(html, base) {
  if (!base) return html;
  return String(html).replace(ATTR, (_, a, q) => `${a}=${q}${base}/`).replace(FETCH, (_, q) => `fetch(${q}${base}/`);
}

export const rebasePath = (loc, base) => (base && typeof loc === 'string' && loc.startsWith('/') && !loc.startsWith('//') && !loc.startsWith(`${base}/`) && loc !== base ? `${base}${loc}` : loc);

// Wraps a Node response so HTML bodies and Location headers come out under `base`.
export function rebaseResponse(res, base) {
  if (!base) return res;
  let type = '';
  const fixHeaders = (h) => {
    if (!h || typeof h !== 'object') return h;
    const out = Array.isArray(h) ? h : { ...h };
    if (!Array.isArray(out)) for (const k of Object.keys(out)) {
      const lk = k.toLowerCase();
      if (lk === 'location') out[k] = rebasePath(out[k], base);
      if (lk === 'content-type') type = String(out[k]);
    }
    return out;
  };
  const { writeHead, setHeader, end } = res;
  res.writeHead = function (status, ...rest) {
    const i = rest.findIndex((x) => x && typeof x === 'object');
    if (i >= 0) rest[i] = fixHeaders(rest[i]);
    return writeHead.call(this, status, ...rest);
  };
  res.setHeader = function (name, value) {
    const lk = String(name).toLowerCase();
    if (lk === 'location') value = rebasePath(value, base);
    if (lk === 'content-type') type = String(value);
    return setHeader.call(this, name, value);
  };
  res.end = function (chunk, ...rest) {
    const ct = type || String(res.getHeader?.('content-type') ?? '');
    if (chunk != null && /text\/html/i.test(ct)) {
      const html = rebaseHtml(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk), base);
      if (!res.headersSent) res.removeHeader?.('content-length');
      return end.call(this, html, ...rest);
    }
    return end.call(this, chunk, ...rest);
  };
  return res;
}
