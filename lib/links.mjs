import { sign } from './auth.mjs';
import { claudeInstallLink, connectLine } from './connect.mjs';

// The addresses a person needs to use a board, in one place: the Connect page, the connect_links tool and
// the hosted tools all read them from here, so they never disagree.


export function boardLinks(host, name) {
  const mcp = `${host}/mcp`;
  return {
    connect_page: `${host}/`,
    board: `${host}/board`,
    mcp,
    claude: claudeInstallLink(name, mcp),
    claude_code: connectLine(host, 'claude'),
    codex: connectLine(host, 'codex'),
    chatgpt_actions: `${host}/openapi.json`,
    instructions: `${host}/INSTRUCTIONS.md`,
  };
}

export const linksText = (l) => [
  `- Connect page (pick your app): ${l.connect_page}`,
  `- Claude (web, desktop, phone): ${l.claude}`,
  `- Claude Code: \`${l.claude_code}\``,
  `- Codex: \`${l.codex}\``,
  `- Any MCP app: ${l.mcp}`,
  `- Browser: ${l.board}`,
].join('\n');

// A ten-minute download link for the owner's zip, so an agent can hand over a link that works without a cookie.
export const exportLink = (host, person) => `${host}/export.zip?key=${encodeURIComponent(sign({ k: 'export', id: person.id, g: person.github, exp: Math.floor(Date.now() / 1000) + 600 }))}`;

// The command that moves a hosted board to the team's own hosting. Their repo stays where it is.
export const MOVE_PACKAGE = process.env.AGENT_KANBAN_PACKAGE || 'github:warOnSaaS/agent-kanban';
export const moveCommand = ({ repo, from }) => `npx -y ${MOVE_PACKAGE} deploy --repo ${repo}${from ? ` --from ${from}` : ''}`;
export const MOVE_LINES = [
  'Your board runs on our servers, but your data is already in your own GitHub repo, and it stays there.',
  'This command puts a copy of the app on your own Vercel account, using that same repo, and sends everyone to the new address.',
];
export const SELF_HOST = 'https://github.com/warOnSaaS/agent-kanban#host-it-yourself';
