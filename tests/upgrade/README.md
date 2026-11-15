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
- **`alpha-1-parts/`** (home C), by tag `v0.6.0-alpha.1`'s parts engine (`parts.ts installParts` and its picks), for the move of
  plugin parts to the library (partsmigrate.ts): home B with Pi and OpenCode installed (their folders; no pass, Automatic sync
  being off) and two folder marketplaces kept inside it, team (`market/`) and gone (`gone-market/`, which the test removes).
  Claude Code's and Copilot CLI's records of plugins installed whole are written as their own commands write them: memo (a copy
  of its whole plugin folder), tasks and old (from gone) in Claude Code, xlsx from the Anthropic Directory, tasks in Copilot CLI
  turned off there. Then, by alpha 1:
  - docs (skills pdf, review and forms; the agent writer; the server lookup, whose entry has `args: []` and an environment
    variable; and bundled, which runs from the plugin's folder, so is never a part) as parts in Pi, OpenCode and Codex (whose
    installer can't run here; the test leaves Codex out, a tool left out since);
  - memo (its skill, its server memo-index, and its agent scribe, which Pi took no part of, so is no part anywhere) and old as
    parts in Pi; memo's server then switched off in Claude Code with alpha 1's switch for one server of a plugin;
  - journal as parts in OpenCode alone;
  - sheet (skills sheet and chart) into Pi and OpenCode at 1.0.0, then 2.0.0 published and sheet picked in Pi alone, then chart
    turned off in OpenCode, so OpenCode's later time is the older version's;
  - picks picked part by part in Pi, one alone, so two and three are recorded out and never written; forms turned off in OpenCode.
  By hand: pdf edited in Pi, review deleted from Pi, lookup's environment variable edited in Pi, writer edited in OpenCode. Last,
  one taken in with Add on the Skills page, the click's item alone: his own item now. That click's pass noted Pi's and OpenCode's
  skills folders, so skills.json knows them (pdf's edit is let go as his own); agents.json never saw OpenCode (writer's edit stays
  OpenCode's own); the MCP record from before the library is moved by this version, which notes every tool's file then.

To make them again (the homes are made at `/tmp/ck-upgrade-fixture/home`, and their records keep paths under it):

```sh
git worktree add --detach ../ck-preview-9 v0.5.0-preview.9 && ln -s "$PWD/node_modules" ../ck-preview-9/node_modules
git worktree add --detach ../ck-alpha-1 v0.6.0-alpha.1 && ln -s "$PWD/node_modules" ../ck-alpha-1/node_modules
node tests/upgrade/make.mjs preview-9 ../ck-preview-9
node tests/upgrade/make.mjs alpha-1 ../ck-alpha-1
node tests/upgrade/make.mjs alpha-1-parts ../ck-alpha-1
git worktree remove --force ../ck-preview-9 && git worktree remove --force ../ck-alpha-1
```

`start.ts` is one start of this version on a home, in a process of its own; the test runs it. These homes are kept as files
because the code that made them is gone from this version (alpha 1's parts engine included); they are never deleted, as a home
last opened by alpha 1 may first be opened by a much later version (`src/partsmigrate.ts`'s header).
