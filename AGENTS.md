# agent-kanban: rules for agents and contributors

agent-kanban is an open-source template. Teams run their own **instance** of it.
Read this before changing anything.

## Every change is one of three kinds

| Kind | What it is | Where it goes |
| --- | --- | --- |
| **TEMPLATE** | Code, tools, tool wording, defaults, pages, docs, `example-workspace/`, tests | This repo. Every instance gets it on its next deploy. |
| **INSTANCE CONFIG** | Workspace name, workspace repo, time zone, contact name, GitHub OAuth app, Vercel project, secrets | That instance's Vercel project env, and `instances/<name>.env` locally. Never committed. |
| **INSTANCE CONTENT** | Clients, tasks, notes, ideas, `people.yml`, a team's own playbooks | That instance's private workspace repo. Never here. |

How to decide:
- Would a different team want it? Yes: **TEMPLATE**. Only this team: **CONFIG** or **CONTENT**.
- Does it name a real client, person or company? Then it is not **TEMPLATE**. Make the template generic (a setting, or a neutral default) and put the specific value in config.
- A request from one client that would help everyone ("make review shorter") is **TEMPLATE**. Say so when you report back: "this changes the template for every instance".
- When unsure, ask. State which kind you think it is.

## Before you commit

- `npm test` passes.
- `npm run check:clean` passes. It fails if any name listed in `instances/*.names` (git-ignored, one per line) appears in a tracked file. Each instance lists its client and people names there.
- Example data stays fictional: Acme Dental, Birch Law, Sam, Jordan, Casey, Riley.
- No em dashes.

## Layout

- `lib/`: the server. `workspace.mjs` (people, access, tasks, alerts), `mcp.mjs` (tools), `auth.mjs` (GitHub sign-in over MCP OAuth), `rest.mjs` (the same tools for ChatGPT GPT Actions), `review.mjs`, `board.mjs`, `instructions.mjs`, `connect.mjs` (the front page of app tiles and the `/connect` script for Claude Code and Codex).
- `api/`: Vercel entry points. `vercel.json` maps routes; `dev.mjs` mirrors them locally.
- `example-workspace/`: starter content for a new instance, and the test fixture.
- `instances/`: local, git-ignored config for the instances you run (`<name>.env`, `<name>.names`).
