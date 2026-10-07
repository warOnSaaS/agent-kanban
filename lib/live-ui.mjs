// The live layer on the board pages: a "Live" button with who is connected, a drawer of recent activity,
// and, when something changes elsewhere, the page updates in place: the changed card is outlined for a
// moment with a label ("Claude moved this to Review") and a card that changed column glides there.
// Polls /board/live every two seconds while the tab is visible, every thirty while it is hidden.
// Monochrome, in the kit's tokens. prefers-reduced-motion: no movement, no pulse; outlines and labels stay.
import { CLAUDE, OPENAI } from './logos.mjs';

const mono = (svg) => svg.replace(/fill="#[0-9A-Fa-f]{3,6}"/g, 'fill="currentColor"');
const CURSOR = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3.5 19 11l-6.2 1.6L9.5 19z"/></svg>';
const TERMINAL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15"/><path d="m7 10 3 2.5L7 15M12.5 15.5H17"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z"/></svg>';
export const APP_ICONS = { claude: mono(CLAUDE), 'claude-code': TERMINAL, codex: TERMINAL, chatgpt: mono(OPENAI), gpt: mono(OPENAI), cursor: CURSOR, browser: CURSOR, agent: SPARK, import: SPARK };

export const liveCss = `
.kcard,.task-head,.idea-head{position:relative}
.live-btn{display:inline-flex;align-items:center;gap:var(--s2);font:inherit;font-size:var(--t-sm);color:var(--body);background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:2px var(--s2);min-height:28px;cursor:pointer}
.live-btn:hover,.live-btn[aria-expanded="true"]{color:var(--fg);border-color:var(--fg)}
.live-dot{width:8px;height:8px;border-radius:var(--pill);background:var(--dim);flex:none;position:relative}
.live-btn.is-on .live-dot{background:var(--fg)}
.live-btn.is-working .live-dot::after,.live-who.is-working .live-dot::after{content:"";position:absolute;inset:-4px;border:1px solid var(--fg);border-radius:var(--pill);animation:live-pulse 1.6s ease-out infinite}
@keyframes live-pulse{from{opacity:.9;transform:scale(.6)}to{opacity:0;transform:scale(1.6)}}
.live-apps{display:inline-flex;gap:2px}
.live-ic{display:inline-grid;place-items:center;width:18px;height:18px;flex:none;color:var(--fg)}
.live-ic svg{width:14px;height:14px}
.live-panel{position:fixed;top:0;right:0;bottom:0;width:min(360px,100vw);background:var(--bg);border-left:var(--header-rule);z-index:20;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease;visibility:hidden}
.live-panel.is-open{transform:none;visibility:visible}
.live-head{display:flex;align-items:center;justify-content:space-between;padding:var(--s3) var(--s4);border-bottom:1px solid var(--rule)}
.live-head b{color:var(--fg)}
.live-body{overflow:auto;padding:var(--s3) var(--s4) var(--s6);display:grid;gap:var(--s4);align-content:start}
.live-body h4{margin:0 0 var(--s2);font-size:var(--t-xs);color:var(--dim);font-weight:600;letter-spacing:var(--track)}
.live-on{display:grid;gap:var(--s2);margin:0;padding:0;list-style:none}
.live-who{display:flex;align-items:center;gap:var(--s2);font-size:var(--t-sm);color:var(--fg)}
.live-who small{margin-left:auto;color:var(--dim);font-size:var(--t-xs)}
.live-feed{display:grid;gap:0;margin:0;padding:0;list-style:none}
.live-feed li{display:grid;grid-template-columns:18px 1fr;gap:var(--s2);padding:var(--s2) 0;border-top:1px solid var(--rule);font-size:var(--t-sm);line-height:1.45;color:var(--body)}
.live-feed li:first-child{border-top:0}
.live-feed li.is-new{animation:live-in .5s ease}
@keyframes live-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.live-feed b{color:var(--fg);font-weight:600}
.live-feed a{color:var(--fg)}
.live-feed time{display:block;color:var(--dim);font-size:var(--t-xs)}
.live-feed .avatar{width:18px;height:18px;font-size:8px}
.live-empty{color:var(--dim);font-size:var(--t-sm)}
.live-hit{outline:2px solid var(--fg);outline-offset:2px;transition:outline-color 1.2s ease}
.live-hit.is-fading{outline-color:transparent}
.live-tag{position:absolute;left:var(--s2);top:0;transform:translateY(-50%);z-index:2;max-width:calc(100% - var(--s4));font-size:var(--t-xs);font-weight:700;line-height:16px;padding:2px var(--s2);background:var(--fg);color:var(--bg);border-radius:var(--pill);pointer-events:none;transition:opacity .6s ease}
.live-tag.is-fading{opacity:0}
#toast{max-width:calc(100vw - 32px);text-align:center}
.live-scrim{position:fixed;inset:0;z-index:19;background:transparent}
@media (max-width:640px){.live-btn .live-word{display:none}}
@media (prefers-reduced-motion:reduce){.live-btn.is-working .live-dot::after,.live-who.is-working .live-dot::after,.live-feed li.is-new{animation:none}.live-panel,.live-hit,.live-tag{transition:none}}
`;

export const liveButton = '<button type="button" class="live-btn" data-live-open aria-expanded="false" aria-controls="live-panel" title="Live activity"><span class="live-dot" aria-hidden="true"></span><span class="live-word">Live</span><span class="live-apps" aria-hidden="true"></span></button>';

export const livePanel = `<aside class="live-panel" id="live-panel" aria-label="Live activity" aria-hidden="true">
  <div class="live-head"><b>Live</b><button type="button" class="btn btn-ghost btn-sm" data-live-close>Close</button></div>
  <div class="live-body">
    <section><h4>Connected now</h4><ul class="live-on" id="live-on"><li class="live-empty">No AI apps in the last five minutes.</li></ul></section>
    <section><h4>Recent activity</h4><ol class="live-feed" id="live-feed"><li class="live-empty">Nothing yet.</li></ol></section>
  </div>
</aside>`;

// Browser side. Expects window.AK_REFRESH (the page's quiet refresh) and window.AK_ME_ID.
export const liveScript = () => `
(function () {
  var ICONS = ${JSON.stringify(APP_ICONS)};
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var v = null, seen = {}, pending = null, timer = null, wait = 2000, entries = [], stopped = false;
  var panel = document.getElementById('live-panel'), lastOn = [];
  // The header is redrawn by a refresh, so the button is looked up each time.
  function liveBtn() { return document.querySelector('[data-live-open]'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function first(n) { return String(n || '').split(' ')[0]; }
  function initials(n) { return String(n || '?').split(/\\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function icon(a) { return a.via === 'web' ? '<span class="avatar" title="' + esc(a.name) + '">' + esc(initials(a.name)) + '</span>' : '<span class="live-ic" title="' + esc(a.agent || 'AI app') + '">' + (ICONS[a.app] || ICONS.agent) + '</span>'; }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return String(iso).slice(0, 10);
  }
  function said(a) { var p = String(a.verb).split('{item}'); return '<b>' + esc(a.label) + '</b> ' + esc(p[0]) + (p.length > 1 ? (a.item && a.item.href ? '<a href="' + esc(a.item.href) + '">' + esc(a.item.title) + '</a>' : esc(a.item ? a.item.title : '')) + esc(p[1]) : ''); }
  function short(a) { return (a.via === 'web' ? first(a.name) : (a.agent || 'An AI app')) + ' ' + String(a.verb).replace('{item}', 'this'); }

  function drawFeed(fresh) {
    var ol = document.getElementById('live-feed'); if (!ol) return;
    ol.innerHTML = entries.length ? entries.map(function (a) {
      return '<li' + (fresh[a.id] ? ' class="is-new"' : '') + '>' + icon(a) + '<span>' + said(a) + '<time datetime="' + esc(a.at) + '">' + ago(a.at) + '</time></span></li>';
    }).join('') : '<li class="live-empty">Nothing yet.</li>';
  }
  function drawConnected(list) {
    lastOn = list;
    var btn = liveBtn(), ul = document.getElementById('live-on'), working = list.some(function (c) { return c.working; });
    if (ul) ul.innerHTML = list.length ? list.map(function (c) {
      return '<li class="live-who' + (c.working ? ' is-working' : '') + '"><span class="live-dot" aria-hidden="true"></span><span class="live-ic">' + (ICONS[c.app] || ICONS.agent) + '</span>' + esc(c.label) + '<small>' + (c.working ? 'working' : ago(c.last)) + '</small></li>';
    }).join('') : '<li class="live-empty">No AI apps in the last five minutes.</li>';
    if (!btn) return;
    btn.classList.toggle('is-on', list.length > 0);
    btn.classList.toggle('is-working', working);
    var apps = []; list.forEach(function (c) { if (apps.indexOf(c.app) < 0) apps.push(c.app); });
    btn.querySelector('.live-apps').innerHTML = apps.slice(0, 3).map(function (k) { return '<span class="live-ic">' + (ICONS[k] || ICONS.agent) + '</span>'; }).join('');
    btn.setAttribute('aria-label', 'Live activity' + (list.length ? ', ' + list.length + ' AI app' + (list.length > 1 ? 's' : '') + ' connected' + (working ? ', working now' : '') : ''));
  }

  // Someone is typing, dragging or has a dialog open: the page waits, the feed does not.
  function busyHere() {
    if (document.querySelector('dialog[open]') || document.querySelector('.pending')) return true;
    var el = document.activeElement;
    if (el && el.closest && el.closest('main') && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    return Array.prototype.some.call(document.querySelectorAll('main textarea, main input[type=text], main input:not([type])'), function (x) { return x.value && x.value !== x.defaultValue; });
  }

  function rects() { var m = {}; document.querySelectorAll('main [data-item]').forEach(function (el) { m[el.getAttribute('data-item')] = el.getBoundingClientRect(); }); return m; }
  function glide(before) {
    if (reduce) return;
    document.querySelectorAll('main [data-item]').forEach(function (el) {
      var b = before[el.getAttribute('data-item')]; if (!b) return;
      var a = el.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
  }
  // In view: inside the window and inside the board's own scroller (a phone scrolls the board sideways).
  function inView(el) {
    var r = el.getBoundingClientRect(), box = el.closest('.kanban');
    var b = box ? box.getBoundingClientRect() : { left: 0, right: innerWidth };
    return r.bottom > 0 && r.top < innerHeight && r.right > Math.max(0, b.left) && r.left < Math.min(innerWidth, b.right);
  }
  function note(text) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = text; t.classList.add('on');
    clearTimeout(note.t); note.t = setTimeout(function () { t.classList.remove('on'); }, 4000);
  }
  function mark(list) {
    list.forEach(function (a) {
      if (!a.item || !a.item.id) return;
      document.querySelectorAll('main [data-item="' + CSS.escape(a.item.id) + '"]').forEach(function (el) {
        var old = el.querySelector(':scope > .live-tag'); if (old) old.remove();
        var tag = document.createElement('span'); tag.className = 'live-tag'; tag.textContent = short(a);
        el.prepend(tag); el.classList.remove('is-fading'); el.classList.add('live-hit');
        setTimeout(function () { el.classList.add('is-fading'); tag.classList.add('is-fading'); }, 4200);
        setTimeout(function () { el.classList.remove('live-hit', 'is-fading'); tag.remove(); }, 5600);
      });
    });
    // A change that is not on screen (checked once a moving card has landed): say so once, quietly, at the bottom.
    setTimeout(function () {
      var away = list.filter(function (a) { return a.item && a.item.id && !Array.prototype.some.call(document.querySelectorAll('main [data-item="' + CSS.escape(a.item.id) + '"]'), inView); })[0];
      if (away && !(panel && panel.classList.contains('is-open'))) note(away.label + ' ' + String(away.verb).replace('{item}', away.item.title));
    }, reduce ? 0 : 560);
  }

  function apply(fresh) {
    if (busyHere()) { pending = fresh.concat(pending || []); return; }
    pending = null;
    var before = rects();
    var go = window.AK_REFRESH ? window.AK_REFRESH() : Promise.resolve();
    go.then(function () {
      drawConnected(lastOn);
      var b = liveBtn(); if (b && panel) b.setAttribute('aria-expanded', String(panel.classList.contains('is-open')));
      glide(before);
      mark(fresh.filter(function (a) { return !(a.via === 'web' && a.by === window.AK_ME_ID); }));
    });
  }

  function poll() {
    clearTimeout(timer);
    if (stopped) return;
    fetch('/board/live?v=' + encodeURIComponent(v || ''), { headers: { 'x-requested-with': 'agent-kanban' }, credentials: 'same-origin' })
      .then(function (r) { if (r.status === 401) { stopped = true; throw 0; } if (!r.ok) throw 0; return r.json(); })
      .then(function (s) {
        wait = 2000;
        var firstCall = v === null;
        if (s.changed && s.activity) {
          var fresh = s.activity.filter(function (a) { return !seen[a.id]; }), isNew = {};
          s.activity.forEach(function (a) { seen[a.id] = 1; });
          fresh.forEach(function (a) { isNew[a.id] = 1; });
          entries = s.activity;
          drawFeed(firstCall ? {} : isNew);
          if (!firstCall) apply(fresh);
        } else if (pending) apply([]);
        v = s.v;
        drawConnected(s.connected || []);
        document.querySelectorAll('#live-feed time').forEach(function (t) { t.textContent = ago(t.getAttribute('datetime')); });
      })
      .catch(function () { wait = Math.min(wait * 2, 30000); })
      .then(function () { if (!stopped) timer = setTimeout(poll, document.hidden ? Math.max(wait, 30000) : wait); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  document.addEventListener('focusout', function () { if (pending) setTimeout(function () { if (pending) apply([]); }, 50); });

  function open(on) {
    if (!panel) return;
    panel.classList.toggle('is-open', on); panel.setAttribute('aria-hidden', String(!on));
    var btn = liveBtn(); if (btn) btn.setAttribute('aria-expanded', String(on));
    var scrim = document.querySelector('.live-scrim');
    // On a phone the drawer covers the page, so a tap outside closes it. On a desk the board stays usable.
    if (on && !scrim && innerWidth < 900) { scrim = document.createElement('div'); scrim.className = 'live-scrim'; scrim.addEventListener('click', function () { open(false); }); document.body.appendChild(scrim); }
    if (!on && scrim) scrim.remove();
    try { localStorage.setItem('ak-live-open', on ? '1' : ''); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-live-open]')) open(!panel.classList.contains('is-open'));
    if (e.target.closest('[data-live-close]')) open(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && panel.classList.contains('is-open')) open(false); });
  try { if (localStorage.getItem('ak-live-open') === '1' && innerWidth >= 1100) open(true); } catch (e) {}
  poll();
})();
`;
