# Hosted boards

One deployment serves many teams. A team gets a board by clicking **Create a board** (or by asking its AI app), and its data lives in a private repo in its own GitHub account from the first minute. Nothing locks it in: the repo is theirs, the owner can download a zip at any time, and one command moves the app to their own hosting.

Self-hosted boards are unchanged. Hosted mode only runs when `HOSTED=1`.

## What a person sees

1. They open the front page and click **Create your board**. Looking is free: the page shows to everyone.
2. They type the team name and press **Create the board**. Signed out, the warOnSaaS account prompt appears (GitHub, Google or an email link); they sign in and land back on the form.
3. Once, GitHub asks them to connect their GitHub account (one click, **Authorize**): the board's repo is made in their own account with their own sign-in, so it is theirs from the first second. Then they pick where the repo goes: their own account, or an organization.
4. The first time only, GitHub opens in a new tab to install the app on that account. They click **Install** and come back.
5. They click **Create the board**. We make the private repo `<team>-board` in their account, with them as owner and five example cards, and they land on the board's Connect page at `<host>/t/<team>/`: the app tiles, pointed at `<host>/t/<team>/mcp`.
6. Settings (owners only) invites people, changes roles, links to the Connect page, downloads everything, and shows the "Move to my own hosting" command.

From an AI app instead: add `<host>/mcp` as a connector and say "make me a board for my team". The account-level tools are `create_board`, `my_boards`, `board_links`, `invite_person`, `export_board` and `move_to_own_hosting`. Each board's own address has every board tool plus `connect_links`, `add_person`, `update_person`, `remove_person`, `clear_examples`, `export_board` and `move_to_own_hosting`. Every button on every page calls one of these tools (`test/parity.test.mjs` fails if a page grows an action no tool covers).

## Sign-in: the warOnSaaS account

The hosted copy runs with `AUTH_PROVIDER=waronsaas`: everyone signs in with their warOnSaaS account at account.waronsaas.com (GitHub, Google or an email link). Self-hosted boards keep their own GitHub sign-in (`AUTH_PROVIDER=github`, the default when no account client is set); nothing changes for them.

- **Look freely, sign in to use.** The front page, Create a board, every team's Connect page, board and Settings render for a signed-out visitor (a team's cards stay private: the board says what it is and offers Sign in). Doing anything (moving a card, adding, commenting, inviting, creating a board) asks for a sign-in: every page carries `prompt.js` from the account, which catches presses on actions and shows the prompt. The API and MCP answer `401 { "error": { "code": "sign_in", "message": "Sign in to your warOnSaaS account" } }`.
- **One callback for the deployment and every team:** `https://<host>/auth/waronsaas/callback`. The team rides along in the flow (`carry`), so a team's `/t/<team>/login` and `/t/<team>/auth/waronsaas` work, and the session cookie still lands on `/t/<team>` only.
- **Who someone is on a team:** people.yml, as always. The first sign-in is matched by GitHub login (the `github_login` claim) or verified email, and the account id is saved as `account:`; later sign-ins match on that. Someone not on the team is turned away and the owner is told.
- **Sign out everywhere:** every cookie and token carries the account session (`sid`) and is checked against the account (cached a minute), so ending sessions on the account ends them here. The board's own Sign out also signs out of the account.
- **AI apps** (Claude, ChatGPT, Claude Code, Codex) still use the board's `/mcp` OAuth; the sign-in step goes to the account as a connection ("Claude Code via agent-kanban"), which the person can see and end on their account page.
- **The GitHub App stays** for the data: each team's repo is still reached through it, and creating a board still needs it installed on the team's own account. GitHub is no longer how people sign in; connecting it is one click inside Create a board.

`lib/account-client.mjs` is a copy of the account's client library (`scripts/sync-account.mjs` refreshes it; never edit the copy). `test/account.test.mjs` runs the whole flow against a fake account server.

## Addresses

Path-based, so no DNS is needed: `<host>/t/<team>/` (Connect page), `/t/<team>/board`, `/t/<team>/mcp`, `/t/<team>/settings`, `/t/<team>/export.zip`. OAuth discovery works at both `/t/<team>/.well-known/...` and `/.well-known/oauth-authorization-server/t/<team>`.

A subdomain per team (`acme-ops.kanban.waronsaas.com`) is a later option: the router would read the team from the host instead of the path, and nothing else changes. It needs a wildcard domain on the Vercel project.

## How teams are kept apart

- The address decides the team, and the team decides the repo. A request for `/t/acme-ops/...` can only ever read `acme-ops`'s repo.
- Each team's repo is reached with a token for the GitHub App installation that holds it, so GitHub itself refuses any other repo.
- Each team signs its own sessions, tokens, sign-in codes, invite links and download links with its own key (derived from `OAUTH_SECRET`). Something issued for one team does not verify on another, even for a person who is on both.
- Each team's browser session cookie is scoped to `/t/<team>`.
- Who can see what inside a team is the same `people.yml` rule as self-hosted.

`test/hosted.test.mjs` checks all of this through MCP, the HTTPS API and the board, against a fake GitHub.

## The team registry

Which team lives at which address, and where its data is, is kept in a private GitHub repo owned by warOnSaaS (`HOSTED_REGISTRY_REPO`, for example `warOnSaaS/agent-kanban-registry`): `teams/<team>.json` and `members/<github-login>.json`.

Why a repo: it is free, it has full history, anyone with access can export it with `git clone`, and GitHub refuses to create a file that already exists, which is what stops two teams taking one address. It holds pointers only, never team data. Each team's repo also carries its own pointer in `.agent-kanban/board.json`, so the registry could be rebuilt from the teams' repos.

An entry is product-agnostic, the start of one warOnSaaS Cloud account: a team has members, a map of enabled products each with its own storage, and empty `plan` and `billing` fields kept for later. Usage (requests per team and product) is counted in `lib/hosting/meter.mjs`, with no billing behind it yet.

## Moving to your own hosting

`npx -y github:warOnSaaS/agent-kanban deploy --repo you/your-board --from <host>/t/<team>`:

1. Checks Node, the Vercel CLI and the GitHub CLI, and that you are an admin of the repo.
2. Creates a Vercel project in your account and deploys the app.
3. Creates a GitHub App of your own for sign-in and repo access (you click **Create GitHub App**, then **Install** on your one repo).
4. Saves the settings in your Vercel project and deploys again.
5. Writes `.agent-kanban/hosting.json` (`{ "moved_to": "https://..." }`) to your repo. The hosted board reads it and sends people (and their apps) to the new address. Delete the file, or run `agent-kanban point --repo you/your-board --back`, to come back.

Your data does not move: it was always in your repo.

## Running it

| Setting | What |
| --- | --- |
| `HOSTED` | `1` |
| `OAUTH_SECRET` | Long random string. Every team's key is derived from it, so never change it once teams exist. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG` | The GitHub App |
| `HOSTED_REGISTRY_REPO` | `owner/repo` of the registry; the app must be installed on it |
| `HOSTED_DEMO` | `1` keeps it in preview mode (made-up boards in memory, no GitHub) even when the app settings are present. With no app settings it is always in preview mode. |
| `HOSTED_ORIGIN` | Optional, the public address if it differs from the request's host |
| `AUTH_PROVIDER` | `waronsaas` for the hosted copy. `github` (the default without an account client) keeps GitHub sign-in. |
| `WOS_ACCOUNT_CLIENT_ID`, `WOS_ACCOUNT_CLIENT_SECRET` | The board's client at the account (from the Accounts lane). Registered callback: `https://<host>/auth/waronsaas/callback`. |
| `WOS_ACCOUNT_URL` | Optional, `https://account.waronsaas.com` unless you run the account yourself |

Deploy: `vercel deploy --prod -A vercel.hosted.json` (every path goes to `api/hosted.mjs`).

## What the GitHub App needs

- Repository permissions: **Contents** read and write (the board), **Metadata** read, **Administration** read and write (to create the team's repo with the person's own sign-in).
- Account permissions: **Email addresses** read (so someone invited by email is recognised the first time they sign in). Optional: without it, invite people by GitHub username. In a manifest this permission is called `emails`, not `email_addresses`; GitHub rejects the other name.
- A callback URL of `<host>/github/callback`. GitHub requires the sign-in return address to match one of the app's callback URLs exactly.
- Public ("Any account"), so other people can install it.
- No Setup URL, Device Flow or "Request user authorization during installation" is needed. If the Setup URL is set to `<host>/github/setup`, the board is made the moment the install finishes; otherwise the person comes back to the tab and clicks Create again.
