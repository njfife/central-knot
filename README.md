# Central Knot

A desktop app that shows the configuration each AI coding tool has and moves it between them. This early package covers user-wide **standalone skills** in **Claude Code CLI**, **GitHub Copilot CLI** and **Codex** (the CLI, and the ChatGPT desktop app, which reads the same `~/.codex`). It holds plan slices 1a, 1b's first checkpoint and 8a, with the managed Overview Nathan chose on November 8, 2026. The interface follows `docs/ui-reference.md`. An **MCP** page shows each tool's user-wide MCP servers (Claude Code `~/.claude.json`, Copilot `mcp-config.json`, Codex `config.toml`) with the same managed table; writes edit only that server's entry, and Claude Code's waits for **Write now** with Claude closed (MCP-02). A **Plugins** page adds marketplaces (Git URL, `owner/repo` or folder), shows each plugin's components and what each tool gets from them, and installs or uninstalls through each CLI's own plugin commands, confirmed by reading that tool's own record. `npm run test:harness` runs those installs with the real CLIs in disposable homes.

## Run

Node 24.9 or newer:

```sh
npm ci
npm start
npm test
npm run package:mac
```

Mac packaging runs on the selected Apple Silicon Mac and produces `release/Central-Knot-0.3.0-mac-arm64.zip`. `npm run package:mac` applies and verifies an ad-hoc signature. That is not a Developer ID signature, so macOS still refuses a copy that arrives with a download's quarantine flag; this remains open as V-10, and no bypass is part of the try.

`npm run smoke:mac` opens a hidden, fixture-only window with disposable app data and checks the rendered rows and sharing plan. It never selects an actual home.

`npm run e2e` drives the packaged app end to end in a throwaway HOME, including force-kills during copies. Run it after `npm run package:mac`.

## Homes

- **Practice copy** (opens first): a throwaway copy of `fixtures/home` made for this launch and removed at Quit. Apply all really writes here.
- **Another folder…**: a simulated home. Apply all writes only inside it. A folder that is, contains or links into your real home's harness folders is read-only.
- **This Mac’s home**: your real skills and a bounded `--version` probe of each CLI. Only choosing this writes real folders, and only on macOS. The app reopens on the home you last used, so a start at sign-in keeps syncing it.

## The Overview

One row per skill, one column per installed tool. Nothing is managed until you choose it.

- **Managed** switch: a managed skill keeps one copy in every tool it syncs to. Unmanaged skills are left alone.
- **Tool cells** are toggles. Filled means syncing to that tool is on. Green check: synced. Blue: waits for Apply all. Amber: copies differ. Ring: has a copy that is not synced. Empty: no copy. Hatched: that tool cannot load it, with the reason.
- **Tool menus**, from a column header: **Add all** of that tool's skills to another tool, or **Stop all** syncing to it (copies stay).
- **Manage all** queues every unmanaged skill without differing copies. Changes wait for **Apply all**, or **Discard**.
- **Copies differ**: open the row and choose which tool's copy every tool uses (the replaced copy is kept in `.central-knot/items`), or keep both as they are.
- **Catch-up**: opening a home or **Read again** copies a managed skill back into a tool it syncs to that lacks it, and says which. Turn a tool off for a skill to stop that.
- Copies are written only into each tool's own skills folder, byte-exact with file modes, without nested `.git` or Finder's `.DS_Store`. Central Knot never writes through a link or into a folder other tools share, such as `~/.agents/skills`; a differing copy there is reported for you to change.

State lives in one folder with no second copy, `.central-knot/` inside the selected home: `sync.json` and imported revisions under `items/`. Nathan accepted that limit on November 7, 2026, so owner-restore and overwritten-record rollback (AT-62(f), (g)) stay Unmet. A damaged, missing, newer, replaced or differently owned record stops writes and deletes nothing.

`--design-preview` (or `=b`, `=b3`) opens the Overview on sample data, without touching any files.

## Two-way sync, History and the background

- **Sync (status bar switch, on by default).** A managed skill, MCP server or agent edited in one tool spreads to the others within seconds. A deletion spreads after a 2 s settle. Competing edits are decided by the newest action, or the fixed tool order (Copilot, Claude Code, Codex) when the order can't be proved. Each outcome shows a notice with Undo or Restore.
- **With Sync off,** edits and deletions are noted as waiting, and **Sync now** spreads them once. **Apply all** writes only what it shows.
- **History** lists what sync did on its own, with Undo or Restore. Every replaced or removed version is kept first in `.central-knot/` (skills, agent files, and each tool's own MCP settings).
- **Safety.** A folder or file that can't be read, is half-written, or was reset is held, never read as a deletion. Every write checks the file first and never overwrites a save made meanwhile.
- **Agents** (Claude Code `~/.claude/agents`, Copilot `~/.copilot/agents`, Codex `~/.codex/agents`) sync name, description and prompt. A tool that lacks the origin's other fields gets the agent **With limits**, one-way: changes there stay there.
- **MCP:** Claude Code's `~/.claude.json` is written only by **Write now**, with Claude Code quit (Write now refuses while it runs). Codex servers written inline or with dotted keys are left alone.
- **Background:** closing the window keeps Central Knot syncing. The app menu (and the menu bar icon, when the menu bar has room) has Sync, Sync now, Start at sign-in and Quit. Start at sign-in is on by default once the app is in `/Applications`.

## Trying v1 on your Mac

1. Open the build (the newest under `~/agent-builds/central-knot/`, or `release/` after `npm run package:mac`). It opens on the **Practice copy**; try things there first.
2. Choose **This Mac’s home** to use your real setup. Nothing is managed until you choose it: **Manage all** or single switches, then **Apply all**.
3. Optional first: back up `~/.claude ~/.copilot ~/.codex ~/.agents ~/.claude.json` with `tar`. Central Knot keeps its own History, but a backup costs nothing.
4. For MCP into Claude Code, quit Claude Code, then **Write now**.
5. To make it start at sign-in, copy it to `/Applications`. An ad-hoc build may need right-click → **Open** the first time.
6. If something looks wrong, `~/Library/Application Support/central-knot/central-knot.log` records window events and failed requests.

## Not here yet

Convert to skill, instructions, Disable, plugin updates, Cowork, the bundled build, Windows and Linux. Nothing here claims an item has loaded in a session: Written means the bytes are on disk.

The product boundary is in `AGENTS.md`. Planning inputs are under `docs/`. `LEDGER.md` records what was run and every check round.
