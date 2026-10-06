// Pull the actual work into the review, so the agent judges the deliverable and not just the description.
// Done on the server because not every chat app can open links itself.

const MAX_LINKS = 4;
const MAX_CHARS = 4000;

export function linksIn(text) {
  const urls = [...new Set((String(text).match(/https:\/\/[^\s)>\]"'`]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, '')))];
  const paths = [...new Set(String(text).match(/\b(?:clients|playbooks|ideas|people|internal)\/[\w./-]+\.\w+/g) ?? [])];
  return { urls: urls.slice(0, MAX_LINKS), paths: paths.slice(0, MAX_LINKS) };
}

export async function fetchPage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { url, error: 'not a valid link' };
  }
  // Public web pages only.
  if (u.protocol !== 'https:' || /^(localhost|[\d.]+|\[.*\])$/.test(u.hostname) || u.hostname.endsWith('.internal')) return { url, error: 'skipped (not a public https page)' };
  try {
    const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'agent-kanban-review/1.0' } });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text')) return { url, status: res.status, error: `not a web page (${type || 'unknown type'})` };
    const full = (await res.text()).slice(0, 400_000);
    // Read the page's main content when it marks one, so menus and footers don't crowd out the work.
    const lean = full.replace(/<(header|nav|footer)[\s>][\s\S]*?<\/\1>/gi, ' ');
    const main = /<main[\s>][\s\S]*?<\/main>/i.exec(lean)?.[0];
    const html = `${/<title[^>]*>[\s\S]*?<\/title>/i.exec(full)?.[0] ?? ''}${main ?? lean}`;
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
    const text = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/h\d|\/li|\/div|\/section|\/header|\/footer|\/nav)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    const interactive = text.length < 200;
    return { url, status: res.status, title, interactive, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
  } catch (e) {
    return { url, error: e.name === 'TimeoutError' ? 'did not load within 6 seconds' : `could not load (${e.message})` };
  }
}
