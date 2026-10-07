// The in-chat board for view_kanban. The server renders the board; this page only shows it.
// Speaks the MCP Apps standard (ui/initialize, then ui/notifications/tool-result) and ChatGPT's
// window.openai.toolOutput, so the same page works in Claude and ChatGPT.
import css from './ui/kit-css.mjs';
import { build } from './brand.mjs';

const LOOK = build(null, '');

export const WIDGET_URI = 'ui://agent-kanban/kanban.html';
export const WIDGET_URI_OPENAI = 'ui://agent-kanban/kanban-openai.html';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
export const OPENAI_MIME = 'text/html+skybridge';

export function widgetHtml() {
  return `<!doctype html><html lang="en"${LOOK.attrs} data-mode="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}
body{background:transparent;padding:8px;min-height:0;font-size:14px}
.board-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:12px}
.board-head .count{font-size:12.5px;color:var(--ui-ink-3)}
a{text-decoration:none}
</style></head><body>
<div id="root"><div class="ui-lane-empty">Loading the board</div></div>
<script>
(function () {
  var root = document.getElementById('root');
  var shown = false;
  function show(result) {
    var sc = result && (result.structuredContent || result);
    if (!sc || !sc.html) return;
    if (sc.css) { var st = document.getElementById('brand') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'brand' })); st.textContent = sc.css; }
    if (sc.style) Object.keys(sc.style).forEach(function (k) { if (/^[a-z]+$/.test(k) && /^[a-z]+$/.test(sc.style[k])) document.documentElement.setAttribute('data-' + k, sc.style[k]); });
    if (sc.scheme) theme(sc.scheme);
    root.innerHTML = '<div class="board-head"><span class="ui-label">' + esc(sc.title || 'Board') + '</span><span class="count">' + esc(sc.summary || '') + '</span></div>' + sc.html;
    shown = true;
    size();
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function theme(t) { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-mode', t); }

  // ChatGPT
  if (window.openai) {
    theme(window.openai.theme);
    if (window.openai.toolOutput) show(window.openai.toolOutput);
    window.addEventListener('openai:set_globals', function (e) {
      var g = (e.detail && e.detail.globals) || {};
      if (g.theme) theme(g.theme);
      if (g.toolOutput) show(g.toolOutput);
    });
  }

  // MCP Apps (Claude and other hosts)
  var nextId = 1, pending = {};
  function send(msg) { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); }
  function request(method, params) { var id = nextId++; send({ id: id, method: method, params: params }); return new Promise(function (r) { pending[id] = r; }); }
  function size() { if (window.parent !== window) send({ method: 'ui/notifications/size-changed', params: { height: Math.ceil(document.documentElement.scrollHeight) } }); }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id && pending[m.id]) { pending[m.id](m.result || {}); delete pending[m.id]; return; }
    if (m.method === 'ui/notifications/tool-result') show(m.params);
    if (m.method === 'ui/notifications/host-context-changed' && m.params) theme(m.params.theme);
  });
  if (window.parent !== window && !window.openai) {
    request('ui/initialize', { appInfo: { name: 'agent-kanban', version: '1.0.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' }).then(function (r) {
      theme(r.hostContext && r.hostContext.theme);
      send({ method: 'ui/notifications/initialized', params: {} });
    });
  }
  new ResizeObserver(size).observe(document.body);
})();
</script></body></html>`;
}
