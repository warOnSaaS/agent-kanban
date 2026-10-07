// The board's screens inside wOS: mount(el, ctx). The same screens as the standalone board (lib/board.mjs), drawn
// by the board.render_screen tool, and every action calls the same tools agents use, through ctx.callTool only.
// Every button names its tool (data-tool), or says it only moves around the screen (data-tool="none" data-why).
import BOARD_CSS from 'board-css';

const BASE = '/a/board';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The standalone board's addresses, as addresses inside the app.
function inApp(href) {
  if (!href || !href.startsWith('/board')) return null;
  const u = new URL(href, 'http://x');
  const client = u.searchParams.get('client');
  if (u.pathname === '/board' || u.pathname === '/board/') return client ? `/client/${encodeURIComponent(client)}` : u.searchParams.get('view') === 'mine' ? '/mine' : '/';
  return u.pathname.slice('/board'.length);
}

const WHY = { open: 'Opens a form', close: 'Closes the form', reveal: 'Shows or hides a form' };

export default {
  title: 'Board',
  mount(el, ctx) {
    const root = document.createElement('div');
    root.className = 'wos-board';
    root.innerHTML = `<style>${BOARD_CSS}</style><div class="ak-wrap is-wide ak-stack"><div class="wb-head"><nav class="ui-tabs" aria-label="Board" data-nav></nav></div><div class="ak-stack" data-body><p class="ak-small">Loading the board...</p></div></div>`;
    el.appendChild(root);
    const body = root.querySelector('[data-body]');
    const nav = root.querySelector('[data-nav]');
    let path = ctx.path || '/';
    let seq = 0;
    let dragged = null;

    const call = async (tool, args) => ctx.callTool(tool.includes('.') ? tool : `board.${tool}`, args);
    const toast = (m) => (ctx.toast ? ctx.toast(m) : null);

    function drawNav(r) {
      const tab = (p, label, on) => `<a href="${BASE}${p === '/' ? '' : p}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
      const cur = r.current;
      nav.innerHTML = tab('/', 'Board', cur === 'board')
        + tab('/alerts', `Alerts${r.unread ? ` <span class="ui-badge">${r.unread}</span>` : ''}`, cur === 'alerts')
        + tab('/settings', 'Settings', cur === 'settings');
    }

    // Name every action's tool, and turn the standalone addresses into in-app ones.
    function decorate(box) {
      for (const a of box.querySelectorAll('a[href]')) {
        const p = inApp(a.getAttribute('href'));
        if (p !== null) a.setAttribute('href', `${BASE}${p === '/' ? '' : p}`);
      }
      for (const f of box.querySelectorAll('form[data-tool]')) {
        const t = f.getAttribute('data-tool');
        const full = t.includes('.') ? t : `board.${t}`;
        f.setAttribute('data-tool', full);
        for (const b of f.querySelectorAll('button:not([type=button])')) b.setAttribute('data-tool', full);
      }
      for (const b of box.querySelectorAll('button:not([data-tool])')) {
        const k = ['open', 'close', 'reveal'].find((x) => b.hasAttribute(`data-${x}`));
        if (k) { b.setAttribute('data-tool', 'none'); b.setAttribute('data-why', WHY[k]); }
      }
      for (const card of box.querySelectorAll('[data-task]')) {
        card.addEventListener('dragstart', (e) => { dragged = card; card.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      }
    }

    async function render(p = path, { quiet = false } = {}) {
      path = p || '/';
      const me = ++seq;
      if (!quiet) body.classList.add('is-loading');
      try {
        const r = await call('board.render_screen', { path });
        if (me !== seq) return;
        const open = [...body.querySelectorAll('details[open] > summary')].map((s) => s.textContent);
        const y = quiet ? window.scrollY : 0;
        body.innerHTML = r.body;
        decorate(body);
        body.querySelectorAll('details').forEach((d) => { if (open.includes(d.querySelector('summary')?.textContent)) d.open = true; });
        drawNav(r);
        if (quiet) window.scrollTo(0, y);
      } catch (e) {
        if (me === seq) body.innerHTML = `<div class="ui-card ui-blank"><b>The board did not load</b><p>${esc(e.message)}</p></div>`;
      } finally {
        if (me === seq) body.classList.remove('is-loading');
      }
    }

    // A form as tool input, as the standalone board reads it.
    function argsOf(f) {
      const args = {};
      for (const x of f.elements) {
        if (!x.name || x.disabled) continue;
        if ((x.type === 'checkbox' || x.type === 'radio') && !x.checked) continue;
        let v = x.value.trim();
        if (x.hasAttribute('data-list')) v = v.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
        if (v === '' || (Array.isArray(v) && !v.length)) continue;
        if (v === 'true' || v === 'false') v = v === 'true';
        args[x.name] = v;
      }
      return args;
    }

    async function onSubmit(e) {
      const f = e.target.closest('form[data-tool]');
      if (!f || !root.contains(f)) return;
      e.preventDefault();
      const args = argsOf(f);
      const btn = f.querySelector('button:not([type=button])');
      const err = f.querySelector('.form-error');
      if (btn) btn.disabled = true;
      if (err) err.textContent = '';
      try {
        const r = await call(f.getAttribute('data-tool'), args);
        const dlg = f.closest('dialog');
        if (dlg) { dlg.close(); f.reset(); }
        toast(r?.pending ? 'Waiting for approval in your inbox' : 'Saved');
        const next = f.getAttribute('data-next');
        if (next) { const p = inApp(next) ?? '/'; ctx.navigate(p); await render(p); } else await render(path, { quiet: true });
      } catch (x) {
        if (err) err.textContent = x.message; else toast(x.message);
        if (btn) btn.disabled = false;
      }
    }

    function onClick(e) {
      const open = e.target.closest('[data-open]');
      if (open && root.contains(open)) { root.querySelector(`#${CSS.escape(open.getAttribute('data-open'))}`)?.showModal(); return; }
      const close = e.target.closest('[data-close]');
      if (close && root.contains(close)) { close.closest('dialog')?.close(); return; }
      const rev = e.target.closest('[data-reveal]');
      if (rev && root.contains(rev)) {
        const f = root.querySelector(`#${CSS.escape(rev.getAttribute('data-reveal'))}`);
        if (f) {
          root.querySelectorAll('.ui-decide-more').forEach((x) => { if (x !== f) x.hidden = true; });
          f.hidden = !f.hidden;
          if (!f.hidden) f.querySelector('textarea')?.focus();
        }
        return;
      }
      if (e.target.matches?.('dialog.ui-dialog')) { e.target.close(); return; }
      const a = e.target.closest('a[href]');
      if (!a || !root.contains(a) || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const href = a.getAttribute('href');
      if (href === BASE || href.startsWith(`${BASE}/`)) {
        e.preventDefault();
        const p = href.slice(BASE.length) || '/';
        ctx.navigate(p);
        render(p);
      }
    }

    // Drag a card to another stage: the same board.update_task an agent calls.
    function lane(e) { return e.target.closest?.('.ui-lane[data-status]'); }
    function onDragOver(e) { const col = lane(e); if (col && dragged) { e.preventDefault(); col.classList.add('drop-target'); } }
    function onDragLeave(e) { lane(e)?.classList.remove('drop-target'); }
    async function onDrop(e) {
      const col = lane(e);
      if (!col) return;
      e.preventDefault();
      col.classList.remove('drop-target');
      const card = dragged; dragged = null;
      if (!card) return;
      const from = card.parentNode, next = card.nextSibling, cards = col.querySelector('.ui-lane-cards');
      cards.querySelector('.ui-lane-empty')?.remove();
      cards.prepend(card); card.classList.add('pending');
      try { await call('board.update_task', { task: card.getAttribute('data-task'), status: col.getAttribute('data-status') }); toast('Moved'); await render(path, { quiet: true }); }
      catch (x) { from.insertBefore(card, next); card.classList.remove('pending'); toast(x.message); }
    }

    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);

    // Changes made elsewhere (a teammate, an agent): show them, without losing the place.
    let timer;
    const off = ctx.on ? ctx.on('board.item.changed', () => { clearTimeout(timer); timer = setTimeout(() => { if (!root.querySelector('dialog[open]') && !root.contains(document.activeElement?.closest?.('form'))) render(path, { quiet: true }); }, 400); }) : null;

    render(path);
    return {
      update(p) { if ((p || '/') !== path) render(p); },
      unmount() { clearTimeout(timer); if (typeof off === 'function') off(); root.remove(); },
    };
  },
};
