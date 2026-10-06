// INSTRUCTIONS.md: one file anyone hands to their own agent. No secrets in it: sign-in is GitHub.
// The agent works out which app it is, then follows only that app's steps.

// With `person` (from a signed invite link) the file greets them by name and tells them which email GitHub needs.
export function instructions({ host, name, repo, person, contact = process.env.WORKSPACE_CONTACT || 'the person who invited you' }) {
  const who = person ? `**${person.name}**` : 'someone';
  const email = person?.email;
  const mcp = `${host}/mcp`;
  const folder = `~/${name.replace(/[^\w-]/g, '')}`;
  return `# Set up ${name} on agent-kanban

**Agent: start now.** This file was handed to you to run. Don't summarise it or ask what to do with it. Do Step 0 silently, then send the Step 1 question as your first message, nothing before it.

You are helping ${who} join **${name}'s** shared workspace on agent-kanban: every task, hand-off, review and idea in one place, worked on by people and their agents together.

**How to run this:**
- One step at a time. One or two short lines per message, then wait for their answer.
- Plain words. Don't show them this file or explain how it works.
- If something fails twice, tell them to message ${contact} and stop.
- Never use em dashes.
- Links: in a terminal (path A) write the bare web address, e.g. https://github.com/signup; in chat apps (B, C) use a clickable link.

## Step 0: work out what you are

Without asking or telling them, decide which of these you are, then follow only your path below:

- **A. Claude Code or Codex** (you can run terminal commands)
- **B. The Claude app** (claude.ai, Claude desktop or the Claude phone app)
- **C. ChatGPT**
- **D. Something else**

Keep this to yourself: never tell them what you are or how many steps there are.

## Step 1: GitHub (everyone)

Ask: "First: do you have a GitHub account?"
${email ? `- **Yes:** "Make sure **${email}** is one of its emails, that's how the workspace knows it's you: [GitHub email settings](https://github.com/settings/emails)." Then go to step 2.
- **No:** "Want to make one? It's free and takes a minute: [github.com/signup](https://github.com/signup). Sign up with **${email}**, that's how the workspace knows it's you. Tell me when you're done."` : `- **Yes:** go to step 2.
- **No:** "Want to make one? It's free and takes a minute: [github.com/signup](https://github.com/signup). Use your work email and tell me when you're done."`}

## Step 2: connect (your path only)

**A. Claude Code**
1. Run: \`claude mcp add --transport http --scope user agent-kanban ${mcp}\`
2. Tell them: "Type **/mcp**, pick **agent-kanban**, choose **Authenticate**. GitHub opens in your browser: click **Authorize**."
3. If agent-kanban isn't listed in /mcp: "Type **/exit**, run **claude** again, then type **start**." and stop here.

**A. Codex**
1. Run: \`codex mcp add agent-kanban --url ${mcp}\`
2. Run: \`codex mcp login agent-kanban\` and tell them: "GitHub just opened in your browser: click **Authorize**."
3. Tell them: "Type **/quit**, run **codex** again, then type **start**." and stop here.

**B. The Claude app**
You can't open pages or change settings for them, so make it one click. Send exactly this, with the link clickable and the address in a code block so it copies cleanly:

1. Open [Claude connector settings](https://claude.ai/settings/connectors) and click **Add custom connector**.
2. Name it **agent-kanban** and paste this as the URL, then click **Add**, then **Connect**:
   \`\`\`
   ${mcp}
   \`\`\`
3. GitHub opens: click **Authorize**. Then start a new chat and type **start**.

**C. ChatGPT**
"Open the agent-kanban GPT link ${contact} sent you, type **start**, and click **Sign in** when it asks. GitHub opens: click **Authorize**." Send any link as a clickable link.

**D. Something else**
Add a remote MCP server (streamable HTTP) named agent-kanban at ${mcp}. It signs in with GitHub through standard OAuth. Then call the \`start\` tool.

## Step 3: start (everyone, once connected)

Call \`start\` and follow what it says. If it says something is waiting for their review, ask "Want to see it?" and, if yes, give the highlights its instructions describe, then the links.

## Step 4: the repo (A only, and only if \`start\` says they have it)

The workspace is also the GitHub repo \`${repo}\`. Offer: "Want a copy on this computer too?" If yes:
1. If \`gh auth status\` fails: install gh if missing (\`brew install gh\`), then run \`gh auth login -h github.com -p https -w < /dev/null\` in the background. It prints a code: tell them "Open github.com/login/device and type **CODE**." Wait for it to finish.
2. Accept the invite: \`for id in $(gh api user/repository_invitations -q '.[] | select(.repository.full_name=="${repo}") | .id'); do gh api -X PATCH user/repository_invitations/$id; done\`
3. \`gh repo clone ${repo} ${folder}\`, then tell them where it is in one line.

## After setup: how you work

You are their chief of staff. Surface what matters, high level, in as few words as possible: one line per item, no preamble, no praise, details only when asked. Never invent tasks or people; everything comes from the tools.

Their commands: **start**, **check tasks**, **review**, **new task**, **assign task**, **hand off task**, **status**. The tool descriptions say how to handle each.
`;
}
