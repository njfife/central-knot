# Old homes for the upgrade test

`tests/upgrade.test.ts` opens each home here with this version, as a person who upgrades does. Both were made by the old
versions' own engines, never written by hand; `make.mjs` is every step, each checked to have done what it is for.

- **`preview-9/`** (home A), by tag `v0.5.0-preview.9`: in a home with Claude Code, Copilot CLI and Codex, the skills notes
  (everywhere), style (kept out of Codex, which keeps its own), clash (copies differ, turned on, no copy chosen) and drafts
  (Claude Code alone) turned on, scratch left found; the MCP servers docs (Copilot CLI's, everywhere, with Write to Claude
  Code) and search (Claude Code alone) turned on, local-db left found; the agents reviewer (everywhere) and planner (one-way
  from Claude Code) turned on, helper left found; notes edited in Claude Code and spread, with its History entry; the profile
  Focus made (all but drafts and search) and switched to; then, with Automatic sync off, notes edited in Copilot CLI by hand.
- **`alpha-1/`** (home B), by tag `v0.6.0-alpha.1`: home A opened once with Automatic sync on (skills and agents onto its
  library, Copilot CLI's edit taken in), left as it left it; then, with Automatic sync off, notes edited in Codex by hand.

To make them again (the homes are made at `/tmp/ck-upgrade-fixture/home`, and their records keep paths under it):

```sh
git worktree add --detach ../ck-preview-9 v0.5.0-preview.9 && ln -s "$PWD/node_modules" ../ck-preview-9/node_modules
git worktree add --detach ../ck-alpha-1 v0.6.0-alpha.1 && ln -s "$PWD/node_modules" ../ck-alpha-1/node_modules
node tests/upgrade/make.mjs preview-9 ../ck-preview-9
node tests/upgrade/make.mjs alpha-1 ../ck-alpha-1
git worktree remove --force ../ck-preview-9 && git worktree remove --force ../ck-alpha-1
```

`start.ts` is one start of this version on a home, in a process of its own; the test runs it.
