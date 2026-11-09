// A realistic marketplace folder for the e2e run and the UI tour: a README, plugins with skills, commands, agents, hooks
// and an MCP server, a root-level entry that lists its own skills ("strict": false), and one whose files live on GitHub.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const file = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const skill = (root, path, name, description) => file(root, `${path}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\nFollow the steps.\n`);

export function writeMarket(root, name = 'team-tools') {
  file(root, '.claude-plugin/marketplace.json', JSON.stringify({
    name, owner: { name: 'Platform team' }, description: 'Plugins the platform team keeps for everyday work.',
    plugins: [
      { name: 'document-tools', source: './plugins/document-tools', version: '1.2.0', category: 'productivity', author: { name: 'Docs crew' }, description: 'Read PDFs and tidy spreadsheets.', keywords: ['pdf', 'xlsx'] },
      { name: 'release-helper', source: './plugins/release-helper', version: '0.4.1', category: 'development', description: 'Release notes, a review agent and a check before each commit.' },
      { name: 'issue-tracker', source: './plugins/issue-tracker', version: '2.0.0', category: 'development', description: 'Look up and triage issues through an MCP server.', homepage: 'https://example.com/issue-tracker' },
      { name: 'starter-skills', source: './', strict: false, skills: ['./skills/hello'], category: 'productivity', description: 'One example skill from this repository’s own skills folder.' },
      { name: 'spark', source: { source: 'github', repo: 'github/copilot-plugins', path: 'plugins/spark' }, category: 'development', description: 'GitHub Spark, kept in GitHub’s own plugins repository.' },
    ],
  }, null, 2));
  file(root, 'README.md', [
    '<p align="center"><img src="logo.png"></p>',
    '# Team tools',
    '',
    'Plugins the **platform team** keeps for everyday work. Each one is reviewed before it lands here.',
    '',
    '## What is inside',
    '',
    '- `document-tools`: read PDFs and tidy spreadsheets',
    '- `release-helper`: release notes and a commit check',
    '- `issue-tracker`: issues through an MCP server',
    '',
    '## Adding it by hand',
    '',
    '```',
    'claude plugin marketplace add example/team-tools',
    '```',
    '',
    '| Plugin | Owner |',
    '| --- | --- |',
    '| document-tools | Docs crew |',
    '| release-helper | Release crew |',
    '',
    'Questions go to [the team page](https://example.com/team).',
  ].join('\n'));
  skill(root, 'plugins/document-tools/skills', 'pdf-reader', 'Reads PDF files and pulls out their text and tables, keeping headings and lists, so a long report can be searched or quoted.');
  skill(root, 'plugins/document-tools/skills', 'spreadsheet', 'Cleans up spreadsheets: headers, types and totals.');
  file(root, 'plugins/document-tools/README.md', '# document-tools\n\nTwo skills for everyday documents.\n\n- **pdf-reader** pulls text and tables out of PDFs.\n- **spreadsheet** fixes headers and totals.\n');
  file(root, 'plugins/release-helper/commands/release-notes.md', '---\ndescription: Drafts release notes from the merged pull requests.\n---\n\nDraft the notes.\n');
  file(root, 'plugins/release-helper/agents/release-reviewer.md', '---\nname: release-reviewer\ndescription: Reviews a release branch before it ships.\n---\n\nReview it.\n');
  file(root, 'plugins/release-helper/hooks/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo checked' }] }] } }));
  skill(root, 'plugins/issue-tracker/skills', 'triage', 'Sorts new issues by area and urgency.');
  file(root, 'plugins/issue-tracker/.mcp.json', JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp'] } } }));
  skill(root, 'skills', 'hello', 'Says hello, as a first example.');
  skill(root, 'skills', 'unlisted', 'Not part of any plugin entry.');
}
