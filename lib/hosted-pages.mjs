// The hosted pages: the front page with "Create a board", the create form, a board's Settings, and the notice a
// board shows after it moved. Every action on them posts to a tool (/v1/<tool>), the same tool an agent calls
// over MCP. Elements that act carry data-tool (it runs that tool) or data-agent-tool (the tool that does the
// same thing from an agent); test/hosted.test.mjs fails if an action has neither.
// Built on the ui-design kit (lib/ui/page.mjs), in its default look.
import { esc } from './auth.mjs';
import { MOVE_LINES, SELF_HOST } from './links.mjs';
import { head, topBar } from './ui/page.mjs';
import { build as brandOf } from './brand.mjs';

const PAGE_CSS = `
.ak-hero{display:grid;justify-items:center;text-align:center;gap:var(--ui-s4);padding:clamp(24px,7vh,72px) 0 var(--ui-s8)}
.ak-hero .ak-h1{font-size:clamp(34px,5.4vw,60px);line-height:1.03;max-width:19ch}
.ak-hero .ak-lede{font-size:17px;max-width:56ch}
.ak-mark{width:52px;height:52px;border-radius:calc(var(--ui-radius-lg) + 2px);display:grid;place-items:center;background:var(--ui-accent);box-shadow:0 16px 40px -14px var(--ui-accent-line)}
.ak-mark::after{content:"";width:16px;height:16px;border-radius:50%;background:var(--ui-on-accent)}
.ak-choices{display:grid;gap:var(--ui-s3);grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
.ak-choice{display:grid;gap:var(--ui-s3);align-content:start;padding:var(--ui-s6);border-radius:var(--ui-radius-lg)}
.ak-choice.is-main{border-color:var(--ui-accent-line);box-shadow:0 0 0 4px var(--ui-accent-wash),var(--ui-card-shadow)}
.ak-choice p{margin:0;color:var(--ui-ink-2)}
.ak-choice .ui-btn{justify-self:start}
.ak-mcp{margin:0;font-size:13px;color:var(--ui-ink-3);overflow-wrap:anywhere}
.ak-calm{text-align:center;margin:var(--ui-s4) auto 0;max-width:60ch}
.ak-points{display:grid;gap:var(--ui-s3);grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));margin-top:var(--ui-s10)}
.ak-point{display:grid;gap:6px;padding:var(--ui-s5)}
.ak-point p{margin:0;font-size:14px;color:var(--ui-ink-2);line-height:1.55}
.ak-point .ui-mark-ic{width:34px;height:34px;margin-bottom:6px}
.ak-sect{display:grid;gap:var(--ui-s3);padding:var(--ui-s6) 0;border-top:1px solid var(--ui-line)}
.ak-sect p{margin:0;color:var(--ui-ink-2);line-height:1.6}
.ak-sect p b{color:var(--ui-ink)}
.ak-sect a:not(.ui-btn){color:var(--ui-ask-ink)}
.ak-boards{display:grid;gap:var(--ui-s2)}
.ak-form{display:grid;gap:var(--ui-s4);padding:var(--ui-s6);border-radius:var(--ui-radius-lg)}
.ak-form .ui-field{margin:0}
.ak-person{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--ui-s3);align-items:center;padding:12px 0;border-top:1px solid var(--ui-line)}
.ak-person:first-child{border-top:0}
.ak-person .ui-who b{font-weight:500}
.ak-person form{display:flex;gap:var(--ui-s2);align-items:center}
.ak-person .ui-select{width:auto;min-height:32px;padding-top:4px;padding-bottom:4px;font-size:13.5px}
.ak-people{padding:4px var(--ui-s5)}
.ak-invite{display:grid;gap:var(--ui-s3);padding:var(--ui-s5)}
@media (max-width:620px){.ak-person{grid-template-columns:auto minmax(0,1fr)}.ak-person>.ak-row{grid-column:1/-1}.ak-choice,.ak-form{padding:var(--ui-s5)}}
`;

// Forms post their fields to /v1/<data-tool>; on success they follow data.next, or reload. Copy buttons copy.
const CLIENT = `(function(){
var t=document.getElementById('toast'),h;
function toast(m){if(!t)return;t.textContent=m;t.classList.add('on');clearTimeout(h);h=setTimeout(function(){t.classList.remove('on')},2400)}
function copy(s){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(s);var a=document.createElement('textarea');a.value=s;document.body.appendChild(a);a.select();try{document.execCommand('copy')}finally{a.remove()}return Promise.resolve()}
document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;copy(b.dataset.copy).then(function(){b.textContent='Copied';toast('Copied');setTimeout(function(){b.textContent='Copy'},2000)})});
document.querySelectorAll('form[data-tool]').forEach(function(f){f.addEventListener('submit',function(e){
  e.preventDefault();var args={};
  Array.prototype.forEach.call(f.elements,function(el){if(!el.name||el.disabled)return;var v=el.value.trim();if(el.hasAttribute('data-list'))v=v.split(/,/).map(function(x){return x.trim()}).filter(Boolean);if(v===''||(Array.isArray(v)&&!v.length))return;args[el.name]=v});
  var btn=f.querySelector('button:not([type=button])'),err=f.querySelector('.form-error');if(btn)btn.disabled=true;if(err)err.textContent='';
  if(f.dataset.confirm&&!confirm(f.dataset.confirm)){if(btn)btn.disabled=false;return}
  if(f.dataset.busy&&btn)btn.textContent=f.dataset.busy;
  fetch('/v1/'+f.getAttribute('data-tool'),{method:'POST',headers:{'content-type':'application/json','x-requested-with':'agent-kanban'},body:JSON.stringify(args)})
  .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'That did not work.');return j})})
  .then(function(j){if(j.data&&j.data.next){location.href=j.data.next;return}if(j.data&&j.data.open){window.open(j.data.open,'_blank','noopener');if(err)err.textContent='GitHub opened in a new tab. Install agent-kanban there, then come back and click the button again.';if(btn){btn.disabled=false;if(btn.dataset.label)btn.textContent=btn.dataset.label}return}toast(f.dataset.done||'Saved');setTimeout(function(){location.reload()},500)})
  .catch(function(x){if(err)err.textContent=x.message;if(btn){btn.disabled=false;if(btn.dataset.label)btn.textContent=btn.dataset.label}});
})});
})();`;

function shell({ title, body, nav = '', demo = false, brand = 'agent-kanban', narrow = false }) {
  const look = brandOf(null, brand);
  return `${head({ title, brand: look, css: PAGE_CSS })}<body>
${topBar({ brand: look, home: '/', nav: `${nav}${demo ? '<span class="ui-chip is-soft">Preview</span>' : ''}` })}
<main class="ak-wrap${narrow ? ' ak-narrow' : ''}">${body}</main>
<div id="toast" class="ui-toast" role="status" aria-live="polite"></div>
<script>${CLIENT}</script>
</body></html>`;
}

const command = (line, tool) => `<div class="ui-copy"><code>${esc(line)}</code><button type="button" class="ui-btn is-quiet is-sm" data-copy="${esc(line)}" data-agent-tool="${tool}" aria-label="Copy the command">Copy</button></div>`;
const icon = (d) => `<span class="ui-mark-ic" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;

// ---------- the front page ----------

export function homePage({ origin, signedIn, boards = [], demo }) {
  const list = boards.length ? `<section class="ak-sect"><h2 class="ak-h2">Your boards</h2><div class="ui-records ak-boards">${boards.map((b) => `<a class="ui-record" href="/t/${esc(b.slug)}/" data-agent-tool="my_boards"><span class="ak-logo" aria-hidden="true"></span><span><b>${esc(b.name)}</b><small>${esc(`${origin}/t/${b.slug}`)}</small></span><em>Open</em></a>`).join('')}</div></section>` : '';
  return shell({
    title: 'agent-kanban: a board for your team and your AI agents',
    demo,
    nav: signedIn ? '<a href="/logout">Sign out</a>' : '',
    body: `
<section class="ak-hero">
  <span class="ak-mark" aria-hidden="true"></span>
  <h1 class="ak-h1">One board for your team and your AI agents</h1>
  <p class="ak-lede">Tasks, hand-offs and reviews that you and your agents work on together, from Claude, ChatGPT, Claude Code or Codex.</p>
</section>
<section class="ak-choices">
  <div class="ui-card ak-choice is-main"><h2 class="ak-h2">Create your board</h2><p>Sign in with GitHub, name your team, done. We run it for you.</p><a class="ui-btn is-accent is-lg" href="/create" data-agent-tool="create_board">Create your board</a>
    <p class="ak-mcp">Or from your AI app: add <code>${esc(origin)}/mcp</code> and say "make me a board for my team".</p></div>
  <div class="ui-card ak-choice"><h2 class="ak-h2">Host it yourself, free</h2><p>Your server, your GitHub repo, no account with us.</p><a class="ui-btn is-quiet is-lg" href="${SELF_HOST}">Self-host steps</a></div>
</section>
<p class="ak-small ak-calm">Either way, your data is always in your own GitHub repo, and a board we host can move to your own hosting any time.</p>
<section class="ak-points">
  <div class="ui-card ak-point">${icon('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>')}<b>Your data stays yours</b><p>Everything is saved in a private GitHub repo in your own account, from the first minute.</p></div>
  <div class="ui-card ak-point">${icon('<path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z"/>')}<b>Works from your AI</b><p>Pick your app, click once, type start. Every action works from an agent.</p></div>
  <div class="ui-card ak-point">${icon('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>')}<b>Leave any time</b><p>Download everything as a zip, or move the board to your own hosting with one command.</p></div>
</section>
${list}`,
  });
}

// ---------- create ----------

export function createPage({ person, accounts, demo, name = '' }) {
  const opts = accounts.map((a) => `<option value="${esc(a.login)}">${esc(a.label)}</option>`).join('');
  return shell({
    title: 'Create a board · agent-kanban',
    demo,
    narrow: true,
    nav: demo ? '' : '<a href="/logout">Sign out</a>',
    body: `<div class="ak-stack">
  <div class="ak-stack" style="gap:var(--ui-s2)"><h1 class="ak-h1">Create a board</h1><p class="ak-lede">Signed in as <b>${esc(person.name)}</b>${person.github ? ` (@${esc(person.github)})` : ''}.</p></div>
  <form data-tool="create_board" data-busy="Creating..." class="ui-card ak-form">
    <label class="ui-field"><span>Team name</span><input class="ui-input" name="name" required maxlength="60" value="${esc(name)}" placeholder="Acme Ops" autofocus></label>
    <label class="ui-field"><span>Keep its data in</span><select class="ui-select" name="account">${opts}<option value="*other">Another organization...</option></select>
      <span class="ui-hint">We make a private repo there, named after the team (for example <code>acme-ops-board</code>). It is yours: every task and note is a file you can see, download or take with you.</span></label>
    <p class="ak-err form-error"></p>
    <div><button class="ui-btn is-accent is-lg" data-label="Create the board">Create the board</button></div>
  </form>
  ${demo ? '<p class="ui-notice is-quiet">This is a preview: GitHub is not connected yet, so the board is made up and resets. Nothing is saved to GitHub.</p>' : ''}
</div>`,
  });
}

// ---------- settings ----------

export function settingsPage({ team, ws, me, people, clients, links, repo, moveCommand, demo }) {
  const roleSel = (p) => `<select class="ui-select" name="role" aria-label="Role for ${esc(p.name)}">${[['team', 'Team'], ['owner', 'Owner']].map(([v, l]) => `<option value="${v}"${p.role === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const who = (p) => `${p.role === 'owner' ? 'Owner, sees everything' : `Team, ${p.clients === 'all' ? 'all clients' : (p.clients ?? []).join(', ') || 'no clients yet'}${p.sees === 'own' ? ', own tasks only' : ''}`}${p.github ? ` · @${p.github}` : p.email ? ` · ${p.email}` : ''}`;
  const ini = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return shell({
    title: `Settings · ${ws.name}`,
    brand: ws.name,
    narrow: true,
    nav: `<a href="/board">Board</a><a href="/" class="ak-hide-sm">Connect your AI</a><a href="/settings" aria-current="page">Settings</a>`,
    body: `<div class="ak-stack" style="gap:0">
  <div class="ui-ph"><div><h1>Settings</h1><p>${esc(ws.name)} · ${esc(links.connect_page.replace(/\/$/, ''))}</p></div></div>

  <section class="ak-sect" id="people"><h2 class="ak-h2">People</h2>
    <div class="ui-card ak-people">${people.map((p) => `<div class="ak-person"><span class="ui-avatar is-sm" data-tone="${p.role === 'owner' ? 1 : 2}">${esc(ini(p.name))}</span><span class="ui-who"><span><b>${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</b><small>${esc(who(p))}</small></span></span>
      ${p.id === me.id ? '' : `<div class="ak-row"><form data-tool="update_person" data-done="Updated"><input type="hidden" name="person" value="${esc(p.id)}">${roleSel(p)}<button class="ui-btn is-quiet is-sm">Save</button></form>
      <form data-tool="remove_person" data-confirm="Remove ${esc(p.name)}? They are signed out everywhere." data-done="Removed"><input type="hidden" name="person" value="${esc(p.id)}"><button class="ui-btn is-danger is-sm">Remove</button></form></div>`}</div>`).join('')}</div>
    <form data-tool="add_person" data-done="Invited" class="ui-card ak-invite">
      <div class="ui-card-h"><h3>Invite someone</h3></div>
      <div class="ui-fields">
        <label class="ui-field"><span>Name</span><input class="ui-input" name="name" required placeholder="Jordan Lee"></label>
        <label class="ui-field"><span>GitHub username</span><input class="ui-input" name="github" placeholder="jordan-lee"></label>
        <label class="ui-field"><span>Or the email on their GitHub</span><input class="ui-input" name="email" type="email" placeholder="jordan@example.com"></label>
        <label class="ui-field"><span>Clients they work on</span><select class="ui-select" name="clients"><option value="all">All clients</option>${clients.map((c) => `<option value="${esc(c.client)}">${esc(c.name ?? c.client)}</option>`).join('')}</select></label>
      </div>
      <p class="ak-err form-error"></p><div><button class="ui-btn is-accent is-sm">Invite</button></div>
      <span class="ui-hint">They get a setup link to hand to their AI app. You can also say "invite Jordan" to your AI.</span>
    </form>
  </section>

  <section class="ak-sect" id="connect"><h2 class="ak-h2">Connect</h2>
    <p>Anyone on the team picks their app on the Connect page and types <b>start</b>.</p>
    <div><a class="ui-btn is-quiet" href="/" data-agent-tool="connect_links">Open the Connect page</a></div>
    <p class="ak-mcp">MCP address for any other app: <code>${esc(links.mcp)}</code></p>
  </section>

  <section class="ak-sect" id="data"><h2 class="ak-h2">Your data</h2>
    <p>Every task, note and idea is a file in ${repo ? `your GitHub repo <a href="https://github.com/${esc(repo)}">${esc(repo)}</a>` : 'this board'}.</p>
    <div><a class="ui-btn is-quiet" href="/export.zip" data-agent-tool="export_board">Download everything (zip)</a></div>
  </section>

  <section class="ak-sect" id="move"><h2 class="ak-h2">Move to my own hosting</h2>
    ${MOVE_LINES.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${command(moveCommand, 'move_to_own_hosting')}
    <p class="ui-hint">Run it on a computer with Node 20 or later. Add <code>--dry-run</code> to see each step first. Nothing changes here until the new board is live.</p>
  </section>
</div>`,
  });
}

export function notFoundPage({ slug }) {
  return shell({
    title: 'No board here',
    narrow: true,
    body: `<div class="ui-card ui-blank" style="margin-top:var(--ui-s8)"><span class="ui-mark-ic" aria-hidden="true">?</span><b>No board at this address</b>
<p>There is no board called <b>${esc(slug)}</b>. Check the link, or make one.</p>
<a class="ui-btn is-accent" href="/create" data-agent-tool="create_board">Create a board</a></div>`,
  });
}
