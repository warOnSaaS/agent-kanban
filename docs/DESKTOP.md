# Running "Move to my own hosting" from the wOS Desktop app

The move is a plain command line program, so the desktop app can run it behind one button without knowing how it works.

## The call

From the main process (the renderer has no Node), spawn:

```
npx -y github:warOnSaaS/agent-kanban deploy --repo <owner/repo> --from <hosted board address> --json --no-open
```

- `--json`: every line on stdout is one JSON object. Nothing else is printed there.
- `--no-open`: the command does not open a browser itself; it sends an `open` event and the app opens the link (in the system browser, so the person's GitHub session is there).
- `--dry-run`: runs nothing and lists every command it would run. Good for a "what will happen" screen.
- Optional: `--name "Team name"`, `--project <vercel project>`, `--scope <vercel team>`.

It needs Node 20+, the Vercel CLI signed in (`vercel login`) and the GitHub CLI signed in (`gh auth login`). The first event fails with a plain message if one is missing.

## The events

```json
{"event":"step","id":"vercel","title":"Create the Vercel project acme-ops-board and deploy","status":"start"}
{"event":"step","id":"command","title":"vercel deploy --prod --yes","status":"plan","command":"vercel deploy --prod --yes"}
{"event":"step","id":"vercel","title":"...","status":"done"}
{"event":"open","url":"http://127.0.0.1:53122/","why":"click Create GitHub App"}
{"event":"open","url":"https://github.com/apps/acme-ops-board/installations/new","why":"click Install, and pick only acme/acme-ops-board"}
{"event":"result","ok":true,"url":"https://acme-ops-board.vercel.app","mcp":"https://acme-ops-board.vercel.app/mcp","connect":"https://acme-ops-board.vercel.app/","project":"acme-ops-board","repo":"acme/acme-ops-board","steps":[...]}
```

- `step` with `status` `start`, `done`, `fail` (with `error`) or `plan` (a command it runs, with secrets shown as `(secret)`). Step ids in order: `tools`, `repo`, `stage`, `vercel`, `github-app`, `env`, `redeploy`, `verify`, `point`.
- `open`: show the link with its `why` line, and open it.
- `result`: the last line. `ok: false` comes with `error`.

Exit codes: `0` done, `1` a step failed (the `result` says which and why), `2` a usage mistake.

The two `open` events are the only moments a person has to act, and both are in GitHub: **Create GitHub App**, then **Install**. The command waits (up to about ten minutes) for the install.

## Coming back

`agent-kanban point --repo <owner/repo> --back --json` removes the pointer, so the hosted board serves the team again. Their data never moved either way.
