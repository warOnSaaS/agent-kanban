# instances/

Local, git-ignored config for the instances you run. Per instance:

- `<name>.env`: `VERCEL_ORG_ID=...` and `VERCEL_PROJECT_ID=...` for that instance's Vercel project. Deploy with `scripts/deploy.sh <name>`.
- `<name>.names`: names that must never appear in this repo (the team's clients and people), one per line. `npm run check:clean` enforces it.

Everything else about an instance lives in its Vercel project env and its private workspace repo. See AGENTS.md.
