// wOS Board screen part, built from screens/index.mjs by scripts/build-screens.mjs. AGPL-3.0. Do not edit.

// dist/.board-css.mjs
var board_css_default = '.wos-board{font-size:15px}.wos-board a{text-decoration:none}.wos-board .ak-wrap{width:min(var(--ak-w,1160px),100%);margin:0 auto;padding:var(--ui-s8) clamp(16px,3vw,28px) 96px}.wos-board .ak-wrap.is-wide{--ak-w:1600px}.wos-board .ak-narrow{--ak-w:820px}.wos-board .ak-stack{display:grid;gap:var(--ui-s5);align-content:start;min-width:0;grid-template-columns:minmax(0,1fr)}.wos-board .ak-stack>*{min-width:0}.wos-board .ui-input[type=date]{min-width:0;max-width:100%}.wos-board .ak-row{display:flex;align-items:center;gap:var(--ui-s2);flex-wrap:wrap}.wos-board .ak-h1{margin:0;font-family:var(--ui-display);font-weight:var(--ui-display-weight);font-size:clamp(28px,3.4vw,40px);letter-spacing:calc(var(--ui-display-track) * .9);line-height:1.08;text-wrap:balance}.wos-board .ak-lede{margin:0;color:var(--ui-ink-2);font-size:16px;line-height:1.6;max-width:62ch}.wos-board .ak-lede b{color:var(--ui-ink);font-weight:var(--ui-weight-strong)}.wos-board .ak-h2{margin:0;font-family:var(--ui-display);font-weight:var(--ui-weight-strong);font-size:18px;letter-spacing:calc(var(--ui-display-track) / 3)}.wos-board .ak-h3{margin:0;font-size:15px;font-weight:var(--ui-weight-strong)}.wos-board .ak-small{font-size:13px;color:var(--ui-ink-3);margin:0}.wos-board .ak-small a,.wos-board .ak-lede a{color:var(--ui-ask-ink)}.wos-board .ak-err{margin:0;color:color-mix(in oklab,var(--ui-bad) 70%,var(--ui-ink));font-size:13.5px;min-height:0}.wos-board .ak-err:empty{display:none}.wos-board .dim{color:var(--ui-ink-3)}.wos-board code{font-family:var(--ui-mono);font-size:.88em;padding:1px 6px;border-radius:var(--ui-radius-xs);background:var(--ui-hover);color:var(--ui-ink)}.wos-board .ui-copy code{padding:0;background:none}.wos-board .ui-dialog form{display:grid;gap:var(--ui-s3)}.wos-board .ui-dialog .ui-field{margin:0}@media(max-width:700px){.wos-board .ak-wrap{padding-top:var(--ui-s6)}.wos-board .ak-hide-sm{display:none!important}}.wos-board .ak-toolbar{display:flex;justify-content:space-between;align-items:flex-end;gap:var(--ui-s3);flex-wrap:wrap}.wos-board .ak-toolbar .ui-tabs{flex:1;min-width:0}.wos-board .ak-board-note{margin:0}.wos-board .ui-lane.drop-target .ui-lane-cards{outline:1.5px dashed var(--ui-accent);outline-offset:4px;border-radius:var(--ui-radius)}.wos-board .ak-task-head{display:grid;gap:var(--ui-s2)}.wos-board .ak-task-head .ak-meta{margin:0;color:var(--ui-ink-3);font-size:14px}.wos-board .ui-decide-a form{display:inline}.wos-board .ui-decide-more[hidden]{display:none}.wos-board .ak-block{display:grid;gap:var(--ui-s3)}.wos-board .ak-prose{line-height:1.65;color:var(--ui-ink);max-width:70ch}.wos-board .ak-prose h1,.wos-board .ak-prose h2,.wos-board .ak-prose h3{font-family:var(--ui-display);font-weight:var(--ui-weight-strong);margin:var(--ui-s5) 0 var(--ui-s2);font-size:17px}.wos-board .ak-prose p{margin:0 0 var(--ui-s3)}.wos-board .ak-prose ul,.wos-board .ak-prose ol{margin:0 0 var(--ui-s3);padding-left:var(--ui-s5)}.wos-board .ak-prose a{color:var(--ui-ask-ink);text-decoration:underline;text-decoration-color:var(--ui-accent-line);text-underline-offset:3px}.wos-board .ak-prose hr{border:0;border-top:1px solid var(--ui-line);margin:var(--ui-s5) 0}.wos-board .ui-checks a,.wos-board .ui-steps a{color:var(--ui-ask-ink)}.wos-board .ak-comment{display:grid;gap:var(--ui-s2);margin-top:var(--ui-s2)}.wos-board .ak-side-form{display:grid;gap:var(--ui-s3);margin-top:var(--ui-s4);padding-top:var(--ui-s4);border-top:1px solid var(--ui-line)}.wos-board .ak-side-form .ui-field{margin:0}.wos-board details.ui-card>summary{cursor:pointer;font-weight:var(--ui-weight-strong);list-style:none;display:flex;justify-content:space-between;align-items:center}.wos-board details.ui-card>summary::-webkit-details-marker{display:none}.wos-board details.ui-card>summary::after{content:"";width:7px;height:7px;border-right:1.5px solid var(--ui-ink-3);border-bottom:1.5px solid var(--ui-ink-3);transform:rotate(45deg);transition:transform var(--ui-dur) var(--ui-ease)}.wos-board details.ui-card[open]>summary::after{transform:translateY(3px) rotate(-135deg)}.wos-board details.ak-older>summary{cursor:pointer;color:var(--ui-ink-2);font-size:14px}.wos-board .ui-timeline .pending,.wos-board .ui-feed .pending,.wos-board .pending{opacity:.55}.wos-board .ak-thread{list-style:none;margin:0;padding:0;display:grid}.wos-board .ak-thread li{padding:var(--ui-s3) 0;border-top:1px solid var(--ui-line);font-size:14px;color:var(--ui-ink-2)}.wos-board .ak-thread li:first-child{border-top:0}.wos-board .ak-alerts .ui-inbox-i{cursor:default}.wos-board .ak-alerts .ui-inbox-s{white-space:normal}.wos-board .ak-alerts a{color:var(--ui-ask-ink)}\n.wos-board{display:block;min-width:0}\n.wos-board .wb-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ui-s3);flex-wrap:wrap}\n.wos-board .wb-head .ui-tabs{min-width:0;overflow-x:auto;scrollbar-width:none}\n.wos-board .ak-wrap{padding-top:var(--ui-s5)}\n.wos-board .ui-board{overflow-x:auto;-webkit-overflow-scrolling:touch}\n.wos-board .is-loading{opacity:.6;transition:opacity .15s}\n';

// screens/index.mjs
var BASE = "/a/board";
var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function inApp(href) {
  if (!href || !href.startsWith("/board")) return null;
  const u = new URL(href, "http://x");
  const client = u.searchParams.get("client");
  if (u.pathname === "/board" || u.pathname === "/board/") return client ? `/client/${encodeURIComponent(client)}` : u.searchParams.get("view") === "mine" ? "/mine" : "/";
  return u.pathname.slice("/board".length);
}
var WHY = { open: "Opens a form", close: "Closes the form", reveal: "Shows or hides a form" };
var index_default = {
  title: "Board",
  mount(el, ctx) {
    const root = document.createElement("div");
    root.className = "wos-board";
    root.innerHTML = `<style>${board_css_default}</style><div class="ak-wrap is-wide ak-stack"><div class="wb-head"><nav class="ui-tabs" aria-label="Board" data-nav></nav></div><div class="ak-stack" data-body><p class="ak-small">Loading the board...</p></div></div>`;
    el.appendChild(root);
    const body = root.querySelector("[data-body]");
    const nav = root.querySelector("[data-nav]");
    let path = ctx.path || "/";
    let seq = 0;
    let dragged = null;
    const call = async (tool, args) => ctx.callTool(tool.includes(".") ? tool : `board.${tool}`, args);
    const toast = (m) => ctx.toast ? ctx.toast(m) : null;
    function drawNav(r) {
      const tab = (p, label, on) => `<a href="${BASE}${p === "/" ? "" : p}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
      const cur = r.current;
      nav.innerHTML = tab("/", "Board", cur === "board") + tab("/alerts", `Alerts${r.unread ? ` <span class="ui-badge">${r.unread}</span>` : ""}`, cur === "alerts") + tab("/settings", "Settings", cur === "settings");
    }
    function decorate(box) {
      for (const a of box.querySelectorAll("a[href]")) {
        const p = inApp(a.getAttribute("href"));
        if (p !== null) a.setAttribute("href", `${BASE}${p === "/" ? "" : p}`);
      }
      for (const f of box.querySelectorAll("form[data-tool]")) {
        const t = f.getAttribute("data-tool");
        const full = t.includes(".") ? t : `board.${t}`;
        f.setAttribute("data-tool", full);
        for (const b of f.querySelectorAll("button:not([type=button])")) b.setAttribute("data-tool", full);
      }
      for (const b of box.querySelectorAll("button:not([data-tool])")) {
        const k = ["open", "close", "reveal"].find((x) => b.hasAttribute(`data-${x}`));
        if (k) {
          b.setAttribute("data-tool", "none");
          b.setAttribute("data-why", WHY[k]);
        }
      }
      for (const card of box.querySelectorAll("[data-task]")) {
        card.addEventListener("dragstart", (e) => {
          dragged = card;
          card.classList.add("is-dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
      }
    }
    async function render(p = path, { quiet = false } = {}) {
      path = p || "/";
      const me = ++seq;
      if (!quiet) body.classList.add("is-loading");
      try {
        const r = await call("board.render_screen", { path });
        if (me !== seq) return;
        const open = [...body.querySelectorAll("details[open] > summary")].map((s) => s.textContent);
        const y = quiet ? window.scrollY : 0;
        body.innerHTML = r.body;
        decorate(body);
        body.querySelectorAll("details").forEach((d) => {
          if (open.includes(d.querySelector("summary")?.textContent)) d.open = true;
        });
        drawNav(r);
        if (quiet) window.scrollTo(0, y);
      } catch (e) {
        if (me === seq) body.innerHTML = `<div class="ui-card ui-blank"><b>The board did not load</b><p>${esc(e.message)}</p></div>`;
      } finally {
        if (me === seq) body.classList.remove("is-loading");
      }
    }
    function argsOf(f) {
      const args = {};
      for (const x of f.elements) {
        if (!x.name || x.disabled) continue;
        if ((x.type === "checkbox" || x.type === "radio") && !x.checked) continue;
        let v = x.value.trim();
        if (x.hasAttribute("data-list")) v = v.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
        if (v === "" || Array.isArray(v) && !v.length) continue;
        if (v === "true" || v === "false") v = v === "true";
        args[x.name] = v;
      }
      return args;
    }
    async function onSubmit(e) {
      const f = e.target.closest("form[data-tool]");
      if (!f || !root.contains(f)) return;
      e.preventDefault();
      const args = argsOf(f);
      const btn = f.querySelector("button:not([type=button])");
      const err = f.querySelector(".form-error");
      if (btn) btn.disabled = true;
      if (err) err.textContent = "";
      try {
        const r = await call(f.getAttribute("data-tool"), args);
        const dlg = f.closest("dialog");
        if (dlg) {
          dlg.close();
          f.reset();
        }
        toast(r?.pending ? "Waiting for approval in your inbox" : "Saved");
        const next = f.getAttribute("data-next");
        if (next) {
          const p = inApp(next) ?? "/";
          ctx.navigate(p);
          await render(p);
        } else await render(path, { quiet: true });
      } catch (x) {
        if (err) err.textContent = x.message;
        else toast(x.message);
        if (btn) btn.disabled = false;
      }
    }
    function onClick(e) {
      const open = e.target.closest("[data-open]");
      if (open && root.contains(open)) {
        root.querySelector(`#${CSS.escape(open.getAttribute("data-open"))}`)?.showModal();
        return;
      }
      const close = e.target.closest("[data-close]");
      if (close && root.contains(close)) {
        close.closest("dialog")?.close();
        return;
      }
      const rev = e.target.closest("[data-reveal]");
      if (rev && root.contains(rev)) {
        const f = root.querySelector(`#${CSS.escape(rev.getAttribute("data-reveal"))}`);
        if (f) {
          root.querySelectorAll(".ui-decide-more").forEach((x) => {
            if (x !== f) x.hidden = true;
          });
          f.hidden = !f.hidden;
          if (!f.hidden) f.querySelector("textarea")?.focus();
        }
        return;
      }
      if (e.target.matches?.("dialog.ui-dialog")) {
        e.target.close();
        return;
      }
      const a = e.target.closest("a[href]");
      if (!a || !root.contains(a) || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const href = a.getAttribute("href");
      if (href === BASE || href.startsWith(`${BASE}/`)) {
        e.preventDefault();
        const p = href.slice(BASE.length) || "/";
        ctx.navigate(p);
        render(p);
      }
    }
    function lane(e) {
      return e.target.closest?.(".ui-lane[data-status]");
    }
    function onDragOver(e) {
      const col = lane(e);
      if (col && dragged) {
        e.preventDefault();
        col.classList.add("drop-target");
      }
    }
    function onDragLeave(e) {
      lane(e)?.classList.remove("drop-target");
    }
    async function onDrop(e) {
      const col = lane(e);
      if (!col) return;
      e.preventDefault();
      col.classList.remove("drop-target");
      const card = dragged;
      dragged = null;
      if (!card) return;
      const from = card.parentNode, next = card.nextSibling, cards = col.querySelector(".ui-lane-cards");
      cards.querySelector(".ui-lane-empty")?.remove();
      cards.prepend(card);
      card.classList.add("pending");
      try {
        await call("board.update_task", { task: card.getAttribute("data-task"), status: col.getAttribute("data-status") });
        toast("Moved");
        await render(path, { quiet: true });
      } catch (x) {
        from.insertBefore(card, next);
        card.classList.remove("pending");
        toast(x.message);
      }
    }
    root.addEventListener("submit", onSubmit);
    root.addEventListener("click", onClick);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);
    let timer;
    const off = ctx.on ? ctx.on("board.item.changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!root.querySelector("dialog[open]") && !root.contains(document.activeElement?.closest?.("form"))) render(path, { quiet: true });
      }, 400);
    }) : null;
    render(path);
    return {
      update(p) {
        if ((p || "/") !== path) render(p);
      },
      unmount() {
        clearTimeout(timer);
        if (typeof off === "function") off();
        root.remove();
      }
    };
  }
};
export {
  index_default as default
};
