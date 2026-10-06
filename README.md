# agent-kanban

A shared kanban for people **and their agents**. Tasks, hand-offs, reviews, notes and ideas live as files in a private GitHub repo. Everyone works on them from the agent they already use: Claude, ChatGPT, Claude Code, Codex, or anything that speaks MCP.

Part of [warOnSaaS](https://waronsaas.com).

## WHAT IT DOES

- One board per team. Clients, tasks, notes, docs, ideas, alerts. Plain markdown files in your repo, with history.
- Sign in with GitHub. Who you are comes from GitHub; what you can see comes from `people.yml`.
- Access per person: owner sees everything; teammates see their clients; any item can be private to named people.
- Hand-offs: "what I did / what's next" goes into the task, the next person's agent picks it up.
- Review: the agent opens the actual work (linked pages, linked files), says Ready or Not ready, up to 3 issues, then approve / send back / meet.
- Alerts on hand-offs, comments and changes. Unread count on every reply.
- Short commands: `start`, `check tasks`, `review`, `new task`, `assign task`, `hand off task`, `status`.
- Agents act as chief of staff: one line per item, detail on request.

## HOW PEOPLE JOIN

Send them `https://<your-instance>/INSTRUCTIONS.md`. They hand it to their agent. The agent works out what it is (Claude Code, Codex, Claude app, ChatGPT) and walks them through: GitHub account, connect, sign in, `start`. The file holds no secrets.

## RUN YOUR OWN INSTANCE

1. **Workspace repo.** Create a private GitHub repo. Copy `example-workspace/` into it. Edit `people.yml`: GitHub usernames, roles, clients.
2. **GitHub OAuth app.** github.com/settings/developers, New OAuth App. Callback URL: `https://<your-instance>/oauth/github/callback`.
3. **Deploy** this repo to Vercel (or anything that runs Node functions; `dev.mjs` is a plain Node server). Environment:

| Variable | What |
| --- | --- |
| `WORKSPACE_REPO` | `owner/repo` of the workspace repo |
| `GITHUB_TOKEN` | Token that can read and write that repo (fine-grained: Contents read/write, Administration read/write to invite the owner) |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | From step 2 |
| `OAUTH_SECRET` | Long random string; signs sessions and tokens |
| `WORKSPACE_NAME` | Shown to people, e.g. `Acme Ops` |
| `WORKSPACE_TZ` | e.g. `America/New_York` (default UTC) |
| `WORKSPACE_CONTACT` | Who people message when stuck |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | Optional, for the ChatGPT GPT. See `docs/chatgpt-gpt.md` |
| `RESEND_API_KEY` | Optional, emails urgent alerts |

4. Send people `INSTRUCTIONS.md`.

## WHERE IT WORKS

| App | How |
| --- | --- |
| Claude Code | `claude mcp add --transport http --scope user agent-kanban https://<instance>/mcp`, then `/mcp` to authenticate |
| Codex | `codex mcp add agent-kanban --url https://<instance>/mcp`, then `codex mcp login agent-kanban` |
| Claude (web, desktop, phone) | Settings, Connectors, Add custom connector, URL `https://<instance>/mcp` |
| ChatGPT (any paid plan, web and phone) | A GPT with Actions from `/openapi.json`. See `docs/chatgpt-gpt.md` |
| Browser | `https://<instance>/board`, read-only |

## DEVELOP

```
npm install
npm test                 # 21 end-to-end tests against example-workspace and a fake GitHub
npm run dev              # local server on example-workspace
npm run check:clean      # no instance names in tracked files
```

Read `AGENTS.md` before changing anything: every change is TEMPLATE, INSTANCE CONFIG or INSTANCE CONTENT.
