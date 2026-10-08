# agent-kanban

A shared kanban for people **and their agents**. Tasks, hand-offs, reviews, notes and ideas live as files in a private GitHub repo. Everyone works on them from the agent they already use: Claude, ChatGPT, Claude Code, Codex, or anything that speaks MCP.

Part of [warOnSaaS](https://waronsaas.com). Licensed AGPL-3.0. UI from the wOS UI kit (`lib/ui/wos.css`, synced from warOnSaaS/site with `node scripts/sync-kit.mjs`).

Two ways to run it:

- **Create your board.** Sign in with your free warOnSaaS account, name your team, done: [kanban.waronsaas.com](https://kanban.waronsaas.com). We run the app; your board's data goes into a private repo in your own GitHub account. Looking is free: every page shows before you sign in.
- **Host it yourself, free.** Your server, your GitHub repo, no account with us. [The steps](#host-it-yourself).

Either way, your data is always in your own GitHub repo, and a board we host can move to your own hosting any time with one command (`npx -y github:warOnSaaS/agent-kanban deploy`).

## WHAT IT DOES

- One board per team. Clients, tasks, notes, docs, ideas, alerts. Plain markdown files in your repo, with history.
- Sign in with GitHub. Who you are comes from GitHub; what you can see comes from `people.yml`.
- Access per person: owner sees everything; teammates see their clients; `sees: own` limits someone to their own tasks; any item can be private to named people. Enforced by the server: the repo itself goes to the owner only, because GitHub can't hide folders.
- Hand-offs: "what I did / what's next" goes into the task, the next person's agent picks it up.
- Review: the agent opens the actual work (linked pages, linked files), says Ready or Not ready, up to 3 issues, then approve / send back / meet.
- Alerts on hand-offs, comments and changes. Unread count on every reply.
- Short commands: `start`, `check tasks`, `review`, `new task`, `assign task`, `hand off task`, `status`, `view kanban`.
- `view kanban` draws the board inside Claude and ChatGPT chats (MCP Apps); `/board` shows it in a browser, by client.

## HOW PEOPLE JOIN

Send them your board's address. Its front page is a row of app tiles: they pick their app, click once, sign in with GitHub, and type `start`.

| Tile | What the click does |
| --- | --- |
| Claude (web, desktop, phone) | Opens Claude's "Add custom connector" form already filled in. They click Add, then Connect. |
| ChatGPT | Opens your team's GPT (shown only when you set `CHATGPT_GPT_URL`). They click Sign in when it asks. |
| Claude Code, Codex | Shows one line to paste in a terminal: `curl -fsSL <board>/connect/claude \| sh` (or `/connect/codex`). The script adds the board and starts sign-in. It prints each command before running it and is safe to run again; add `\| sh -s -- --dry-run` to see what it would do. |
| Browser | Opens the board. |

Agents can still read `/INSTRUCTIONS.md`, which walks any agent through joining. People never need to read it.

## HOST IT YOURSELF

About 20 minutes. You need a GitHub account and a free Vercel account. Nothing to install.

1. **Make the private repo that holds your board.**
   Go to github.com/new, name it (for example `acme-board`), choose **Private**, and create it.
   Then copy the `example-workspace` folder from this repo into it: on your new repo's page click **Add file**, **Upload files**, and drag in everything inside `example-workspace`.

2. **Put your team in `people.yml`.**
   In your new repo, open `people.yml`, click the pencil, and replace the made-up people with your own. For each person: a short id, their name, their GitHub username, `role: owner` for you and `role: team` for everyone else, and `clients`: `all`, or the client folders they work on. Save.
   The `clients` folder holds two made-up clients to show the shape. Keep them while you try it, then rename or delete them.

3. **Put the app online.**
   Open [Deploy to Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FwarOnSaaS%2Fagent-kanban&project-name=agent-kanban&repository-name=agent-kanban&env=WORKSPACE_REPO,GITHUB_TOKEN,OAUTH_SECRET,WORKSPACE_NAME,WORKSPACE_CONTACT&envDescription=What%20each%20setting%20is&envLink=https%3A%2F%2Fgithub.com%2FwarOnSaaS%2Fagent-kanban%23the-settings). Vercel copies this app into your GitHub and asks for five settings; the table below says what to put in each.
   When it finishes, Vercel shows your board's address, for example `https://acme-board.vercel.app`. That address is what you send people.

4. **Turn on "Sign in with GitHub".**
   Go to github.com/settings/developers, click **New OAuth App**, and fill in:
   - Application name: your team's name
   - Homepage URL: your board's address from step 3
   - Authorization callback URL: your board's address followed by `/oauth/github/callback`, for example `https://acme-board.vercel.app/oauth/github/callback`

   Click **Register**, then **Generate a new client secret**. Put the Client ID and the secret into Vercel (your project, **Settings**, **Environment Variables**) as `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`, then redeploy (**Deployments**, the three dots on the latest one, **Redeploy**).

5. **Send people your board's address.** They pick their app and type `start`.

### The settings

| Setting | What to put |
| --- | --- |
| `WORKSPACE_REPO` | Your repo from step 1, written as `your-github-name/repo-name`, for example `acme/acme-board` |
| `GITHUB_TOKEN` | A key that lets the app read and write that repo. Make it at github.com/settings/personal-access-tokens/new: pick only that repo, and give **Contents** and **Administration** read and write. |
| `OAUTH_SECRET` | Any long random text. It signs people's sessions. Keep it secret. |
| `WORKSPACE_NAME` | Your team's name as people see it, for example `Acme Ops` |
| `WORKSPACE_TZ` | Your time zone, for example `America/New_York` (leave it out for UTC) |
| `WORKSPACE_CONTACT` | Who people message when they get stuck, for example `Sam` |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | From step 4 |

Optional:

| Setting | What it does |
| --- | --- |
| `WORKSPACE_CONTACT_EMAIL` | That person's email, offered when someone's GitHub account uses a different email |
| `CHATGPT_GPT_URL` | Your team's ChatGPT GPT link. Shows the ChatGPT tile. How to make the GPT: `docs/chatgpt-gpt.md` (about five minutes). |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | Needed for that GPT, see the same doc |
| `RESEND_API_KEY` | Emails urgent alerts |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Instead of `GITHUB_TOKEN`: a GitHub App installed on your repo. `agent-kanban deploy` sets this up for you. Its client id and secret go in `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`. |
| `PUBLIC_URL` | Your board's https address, when you run `node dev.mjs` on your own server behind a proxy |
| `DEMO_BOARD` | `1` runs the public demo: the made-up team in `example-workspace`, no sign-in, changes kept in memory and reset every 30 minutes. It ignores `WORKSPACE_REPO`. Never set it on a real board. |

Your board can look like your brand: add `brand/brand.json` and a logo to your repo (see `lib/brand.mjs`).

## HOSTED BOARDS, AND MOVING ONE

One deployment can also serve many teams (`HOSTED=1`, deployed with `vercel.hosted.json`). Each team's board is at `<host>/t/<team>/`, its MCP address at `<host>/t/<team>/mcp`, and its data in a private repo in the team owner's own GitHub account. `<host>/mcp` lets an agent make and manage boards: "make me a board for my team". How it works, the isolation rules and the setup: `docs/HOSTED.md`.

To move a hosted board to your own Vercel account (your repo stays where it is, people are sent to the new address):

```
npx -y github:warOnSaaS/agent-kanban deploy --repo you/your-board --from https://<host>/t/<team>
```

Add `--dry-run` to see every step first. `--target node` prints the steps for any other Node host. The owner can also download everything as a zip at any time (`/export.zip`, or ask your AI app for the link).

## WORKS WITH

Claude and Claude Code are trademarks of Anthropic. ChatGPT, Codex and the OpenAI logo are trademarks of OpenAI. The connect page shows their marks, unmodified, only to say which apps the board works with. agent-kanban is not made or endorsed by Anthropic or OpenAI.

## DEVELOP

```
npm install
npm test                 # end-to-end tests against example-workspace and a fake GitHub
npm run dev              # local board on example-workspace at http://localhost:3977
DEMO_BOARD=1 npm run dev # the demo board, no sign-in
HOSTED=1 npm run dev     # many teams, "Create a board" (a preview with no GitHub App: made-up boards)
npm run check:clean      # no instance names in tracked files
```

Read `AGENTS.md` before changing anything: every change is TEMPLATE, INSTANCE CONFIG or INSTANCE CONTENT.
