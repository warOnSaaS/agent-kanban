const privacy = (name) => `${name} on agent-kanban: privacy

This is a private workspace for the ${name} team. It is not for the public.

What it stores: the tasks, notes, ideas, alerts and documents team members add, kept in a private GitHub repository the workspace owner controls.
Who can see it: only people listed in the workspace's people.yml, each limited to the clients they work on. Items marked private are visible only to the people named.
How you sign in: with your GitHub account. Signing in from ChatGPT, Claude or another agent gives that app access to the workspace as you, and only as you. GitHub tells the workspace your username and verified email addresses, nothing else.
What is shared: nothing is sold or shared outside the team. Your AI provider processes what you ask it under its own terms.
Removal: ask the workspace owner to delete anything, or to remove you from people.yml, which signs you out everywhere.
`;

export default function handler(req, res) {
  const name = process.env.WORKSPACE_NAME || 'Team';
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(req.query.page === 'privacy' ? privacy(name) : `${name} on agent-kanban. Connect your agent to /mcp, or open /board.\n`);
}
