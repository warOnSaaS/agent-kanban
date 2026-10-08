// The hosted pages: the front page with "Create a board", the create form, a board's Settings, and the notice a
// board shows after it moved. Every action on them posts to a tool (/v1/<tool>), the same tool an agent calls
// over MCP. Elements that act carry data-tool (it runs that tool) or data-agent-tool (the tool that does the
// same thing from an agent); test/hosted.test.mjs fails if an action has neither.
import css from './ui/wos-css.mjs';
import { esc, promptScript, usesAccount, ACCOUNT_PATH } from './auth.mjs';
import { MOVE_LINES, SELF_HOST } from './links.mjs';

const PAGE_CSS = `
.hero{padding-top:var(--s8);padding-bottom:var(--s6);display:grid;gap:var(--s4)}
.hero h1,.hero .lead{max-width:760px}
.hero h1{font-size:clamp(32px,5vw,56px);line-height:1.05;margin:0}
.hero .lead{margin:0;color:var(--body);font-size:var(--t-lg)}
.hero .cta{display:flex;gap:var(--s3);flex-wrap:wrap;align-items:center}
.points{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));padding-bottom:var(--s6)}
.point{border:1px solid var(--rule);border-radius:calc(var(--radius) + 6px);padding:var(--s5);display:grid;gap:var(--s2);background:var(--bg)}
.point h2{font-size:var(--t-lg);margin:0}
.point p{margin:0;color:var(--dim);font-size:var(--t-sm)}
.page{padding-top:var(--s6);padding-bottom:var(--s8);display:grid;gap:var(--s6)}
.page > *{max-width:760px;min-width:0}
.page h1{margin:0;font-size:clamp(26px,4vw,40px);line-height:1.1}
.sect{display:grid;gap:var(--s3);border-top:1px solid var(--rule);padding-top:var(--s5)}
.sect h2{margin:0;font-size:var(--t-xl)}
.sect p{margin:0}
.cmd{display:flex;align-items:stretch;gap:var(--s2);background:var(--cell);border:1px solid var(--rule);border-radius:var(--radius);padding:var(--s1) var(--s1) var(--s1) var(--s3);min-width:0}
.cmd code{flex:1;min-width:0;background:none;border:0;padding:var(--s2) 0;white-space:nowrap;overflow-x:auto;font-size:var(--t-xs);align-self:center}
.cmd .btn{flex:none}
.people{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.people li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s2) var(--s3);align-items:center;border:1px solid var(--rule);border-radius:var(--radius);padding:var(--s3)}
.people .who b{display:block;color:var(--fg)}
.people .who span{font-size:var(--t-xs);color:var(--dim)}
.people form{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap}
.people .select{width:auto;min-height:34px;padding:var(--s1) var(--s2)}
.form-grid{display:grid;gap:var(--s3);grid-template-columns:1fr 1fr}
@media (max-width:620px){.form-grid{grid-template-columns:1fr}.people li{grid-template-columns:1fr}}
.form-error{color:var(--fg);font-weight:700;font-size:var(--t-sm);margin:0}
.boards{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.boards a{display:flex;justify-content:space-between;gap:var(--s3);border:1px solid var(--rule);border-radius:var(--radius);padding:var(--s3) var(--s4);text-decoration:none}
.boards a:hover{border-color:var(--accent)}
.boards span{color:var(--dim);font-size:var(--t-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.choices{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));padding-bottom:var(--s3)}
.choice{border:1px solid var(--rule);border-radius:calc(var(--radius) + 6px);padding:var(--s5);display:grid;gap:var(--s3);align-content:start;background:var(--bg)}
.choice h2{margin:0;font-size:var(--t-xl)}
.choice p{margin:0}
.calm{color:var(--dim);font-size:var(--t-sm);margin-top:0;margin-bottom:var(--s6)}
.mcp-line{font-size:var(--t-sm);color:var(--dim);margin:0;overflow-wrap:anywhere}
#toast{position:fixed;left:50%;bottom:var(--s5);transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:var(--s2) var(--s4);font-size:var(--t-sm);font-weight:700;border-radius:var(--radius);opacity:0;transition:opacity .2s;pointer-events:none;z-index:10;max-width:calc(100vw - 32px);text-align:center}
#toast.on{opacity:1}
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
  .then(function(r){return r.json().then(function(j){if(r.status===401&&window.wosAccount){window.wosAccount.prompt();throw new Error('Sign in to continue.')}if(!r.ok)throw new Error((j.error&&j.error.message)||j.error||'That did not work.');return j})})
  .then(function(j){if(j.data&&j.data.next){location.href=j.data.next;return}if(j.data&&j.data.open){window.open(j.data.open,'_blank','noopener');if(err)err.textContent='GitHub opened in a new tab. Install agent-kanban there, then come back and click the button again.';if(btn){btn.disabled=false;if(btn.dataset.label)btn.textContent=btn.dataset.label}return}toast(f.dataset.done||'Saved');setTimeout(function(){location.reload()},500)})
  .catch(function(x){if(err)err.textContent=x.message;if(btn){btn.disabled=false;if(btn.dataset.label)btn.textContent=btn.dataset.label}});
})});
})();`;

function shell({ title, body, nav = '', demo = false, brand = 'agent-kanban', signedIn = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${css}${PAGE_CSS}</style></head><body>
<header class="header"><div class="wrap">
  <a class="brand" href="/"><span>${esc(brand)}</span></a>
  <nav class="nav" aria-label="Main">${nav}${demo ? '<span class="chip chip-soft">Preview</span>' : ''}</nav>
</div></header>
${body}
<div id="toast" role="status" aria-live="polite"></div>
<script>${CLIENT}</script>
${demo ? '' : promptScript({ signedIn })}
</body></html>`;
}

// The header's sign-in or sign-out link. With the account, signing in starts at /auth/waronsaas.
const signNav = (signedIn, next = '/') => (signedIn ? '<a href="/logout">Sign out</a>' : usesAccount() ? `<a href="${ACCOUNT_PATH}?next=${encodeURIComponent(next)}" data-tool="none">Sign in</a>` : '');

const command = (line, tool) => `<div class="cmd"><code>${esc(line)}</code><button type="button" class="btn btn-sm" data-copy="${esc(line)}" data-agent-tool="${tool}" aria-label="Copy the command">Copy</button></div>`;

// ---------- the front page ----------

export function homePage({ origin, signedIn, boards = [], demo }) {
  const list = boards.length ? `<section class="wrap" style="padding-bottom:var(--s6)"><div class="sect"><h2>Your boards</h2><ul class="boards">${boards.map((b) => `<li><a href="/t/${esc(b.slug)}/" data-agent-tool="my_boards"><b>${esc(b.name)}</b><span>${esc(`${origin}/t/${b.slug}`)}</span></a></li>`).join('')}</ul></div></section>` : '';
  return shell({
    title: 'agent-kanban: a board for your team and your AI agents',
    demo,
    signedIn,
    nav: signNav(signedIn),
    body: `<main>
<section class="wrap hero">
  <h1>One board for your team and your AI agents</h1>
  <p class="lead">Tasks, hand-offs and reviews that you and your agents work on together, from Claude, ChatGPT, Claude Code or Codex.</p>
</section>
<section class="wrap choices">
  <div class="choice"><h2>Create your board</h2><p>${usesAccount() ? 'Sign in, name your team, pick the GitHub account for its repo, done.' : 'Sign in with GitHub, name your team, done.'} We run it for you.</p><div><a class="btn" href="/create" data-agent-tool="create_board">Create your board</a></div>
    <p class="mcp-line">Or from your AI app: add <code>${esc(origin)}/mcp</code> and say "make me a board for my team".</p></div>
  <div class="choice"><h2>Host it yourself, free</h2><p>Your server, your GitHub repo, no account with us.</p><div><a class="btn btn-secondary" href="${SELF_HOST}">Self-host steps</a></div></div>
</section>
<p class="wrap calm">Either way, your data is always in your own GitHub repo, and a board we host can move to your own hosting any time.</p>
<section class="wrap points">
  <div class="point"><h2>Your data stays yours</h2><p>Everything is saved in a private GitHub repo in your own account, from the first minute.</p></div>
  <div class="point"><h2>Works from your AI</h2><p>Pick your app, click once, type start. Every action works from an agent.</p></div>
  <div class="point"><h2>Leave any time</h2><p>Download everything as a zip, or move the board to your own hosting with one command.</p></div>
</section>
${list}
</main>`,
  });
}

// ---------- create ----------

// person: null for a signed-out visitor. The page still shows; the form asks for a sign-in when it is sent.
// github: whether the signed-in person has connected GitHub yet (the repo is made with their own GitHub sign-in).
export function createPage({ person, accounts, demo, name = '', github = true }) {
  const opts = accounts.map((a) => `<option value="${esc(a.login)}">${esc(a.label)}</option>`).join('');
  const who = !person ? 'Looking is free. Sending this form asks you to sign in.'
    : `Signed in as <b>${esc(person.name)}</b>${person.github ? ` (@${esc(person.github)})` : ''}.${!demo && !github ? ' Next, GitHub asks once which account the repo goes in.' : ''}`;
  const keep = person && (github || demo)
    ? `<label class="field"><span class="label">Keep its data in</span><select class="select" name="account">${opts}<option value="*other">Another organization...</option></select>
      <span class="hint">We make a private repo there, named after the team (for example <code>acme-ops-board</code>). It is yours: every task and note is a file you can see, download or take with you.</span></label>`
    : `<p class="hint">Its data goes in a private GitHub repo in your own account or organization, named after the team (for example <code>acme-ops-board</code>). It is yours: every task and note is a file you can see, download or take with you.</p>`;
  return shell({
    title: 'Create a board · agent-kanban',
    demo,
    signedIn: !!person,
    nav: demo ? '' : signNav(!!person, `/create${name ? `?name=${encodeURIComponent(name)}` : ''}`),
    body: `<main class="wrap page">
  <div class="stack"><h1>Create a board</h1><p class="lead">${who}</p></div>
  <form data-tool="create_board" data-busy="Creating..." class="stack" style="max-width:520px">
    <label class="field"><span class="label">Team name</span><input class="input" name="name" required maxlength="60" value="${esc(name)}" placeholder="Acme Ops" autofocus></label>
    ${keep}
    <p class="form-error"></p>
    <div><button class="btn" data-label="Create the board">Create the board</button></div>
  </form>
  ${demo ? '<p class="notice notice-quiet">This is a preview: GitHub is not connected yet, so the board is made up and resets. Nothing is saved to GitHub.</p>' : ''}
</main>`,
  });
}

// ---------- settings ----------

export function settingsPage({ team, ws, me, people, clients, links, repo, moveCommand, demo }) {
  const roleSel = (p) => `<select class="select" name="role" aria-label="Role for ${esc(p.name)}">${[['team', 'Team'], ['owner', 'Owner']].map(([v, l]) => `<option value="${v}"${p.role === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const who = (p) => `${p.role === 'owner' ? 'Owner, sees everything' : `Team, ${p.clients === 'all' ? 'all clients' : (p.clients ?? []).join(', ') || 'no clients yet'}${p.sees === 'own' ? ', own tasks only' : ''}`}${p.github ? ` · @${p.github}` : p.email ? ` · ${p.email}` : ''}`;
  return shell({
    title: `Settings · ${ws.name}`,
    brand: ws.name,
    signedIn: true,
    nav: `<a href="/board">Board</a><a href="/">Connect your AI</a><a href="/settings" aria-current="page">Settings</a>`,
    body: `<main class="wrap page">
  <div class="stack"><h1>Settings</h1><p class="lead">${esc(ws.name)} · ${esc(links.connect_page.replace(/\/$/, ''))}</p></div>

  <section class="sect" id="people"><h2>People</h2>
    <ul class="people">${people.map((p) => `<li><div class="who"><b>${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</b><span>${esc(who(p))}</span></div>
      ${p.id === me.id ? '' : `<div class="row" style="gap:var(--s2)"><form data-tool="update_person" data-done="Updated"><input type="hidden" name="person" value="${esc(p.id)}">${roleSel(p)}<button class="btn btn-sm btn-secondary">Save</button></form>
      <form data-tool="remove_person" data-confirm="Remove ${esc(p.name)}? They are signed out everywhere." data-done="Removed"><input type="hidden" name="person" value="${esc(p.id)}"><button class="btn btn-sm btn-ghost">Remove</button></form></div>`}</li>`).join('')}</ul>
    <form data-tool="add_person" data-done="Invited" class="stack panel">
      <span class="label">Invite someone</span>
      <div class="form-grid">
        <label class="field"><span class="label">Name</span><input class="input" name="name" required placeholder="Jordan Lee"></label>
        <label class="field"><span class="label">GitHub username</span><input class="input" name="github" placeholder="jordan-lee"></label>
        <label class="field"><span class="label">Or their email</span><input class="input" name="email" type="email" placeholder="jordan@example.com"></label>
        <label class="field"><span class="label">Clients they work on</span><select class="select" name="clients"><option value="all">All clients</option>${clients.map((c) => `<option value="${esc(c.client)}">${esc(c.name ?? c.client)}</option>`).join('')}</select></label>
      </div>
      <p class="form-error"></p><div><button class="btn btn-sm">Invite</button></div>
      <span class="hint">They get a setup link to hand to their AI app. You can also say "invite Jordan" to your AI.</span>
    </form>
  </section>

  <section class="sect" id="connect"><h2>Connect</h2>
    <p>Anyone on the team picks their app on the Connect page and types <b>start</b>.</p>
    <div><a class="btn btn-secondary" href="/" data-agent-tool="connect_links">Open the Connect page</a></div>
    <p class="mcp-line">MCP address for any other app: <code>${esc(links.mcp)}</code></p>
  </section>

  <section class="sect" id="data"><h2>Your data</h2>
    <p>Every task, note and idea is a file in ${repo ? `your GitHub repo <a href="https://github.com/${esc(repo)}">${esc(repo)}</a>` : 'this board'}.</p>
    <div><a class="btn btn-secondary" href="/export.zip" data-agent-tool="export_board">Download everything (zip)</a></div>
  </section>

  <section class="sect" id="move"><h2>Move to my own hosting</h2>
    ${MOVE_LINES.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${command(moveCommand, 'move_to_own_hosting')}
    <p class="hint">Run it on a computer with Node 20 or later. Add <code>--dry-run</code> to see each step first. Nothing changes here until the new board is live.</p>
  </section>
</main>`,
  });
}

// Settings for a signed-out visitor: the page says what it is for, and Sign in brings up the account prompt.
export function settingsSignedOutPage({ ws }) {
  return shell({
    title: `Settings · ${ws.name}`,
    brand: ws.name,
    nav: `<a href="/board">Board</a><a href="/">Connect your AI</a><a href="/settings" aria-current="page">Settings</a>`,
    body: `<main class="wrap page"><div class="stack"><h1>Settings</h1>
<p class="lead">Who is on the ${esc(ws.name)} team, how to connect an AI app, downloads, and moving the board to your own hosting. The owner manages these.</p>
<div><button type="button" class="btn" data-needs-account data-action-label="open the ${esc(ws.name)} settings">Sign in</button></div></div></main>`,
  });
}

export function notFoundPage({ slug, signedIn = false }) {
  return shell({
    title: 'No board here',
    signedIn,
    body: `<main class="wrap page"><div class="stack"><h1>No board at this address</h1>
<p class="lead">There is no board called <b>${esc(slug)}</b>. Check the link, or make one.</p>
<div><a class="btn" href="/create" data-agent-tool="create_board">Create a board</a></div></div></main>`,
  });
}
