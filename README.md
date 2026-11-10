# Central Knot

A desktop app that shows the configuration each AI coding tool has and moves it between them. This early package covers user-wide **standalone skills** in **Claude Code CLI**, **GitHub Copilot CLI**, **Codex** (the CLI, and the ChatGPT desktop app, which reads the same `~/.codex`) and **Pi** (`~/.pi/agent`). It holds plan slices 1a, 1b's first checkpoint and 8a, with the managed table Nathan chose on November 8, 2026. The interface follows `docs/ui-reference.md`. An **MCP** page shows each tool's user-wide MCP servers (Claude Code `~/.claude.json`, Copilot `mcp-config.json`, Codex `config.toml`, Pi `mcp.json`) with the same managed table; writes edit only that server's entry, and Claude Code's waits for **Write to Claude Code** with Claude closed (MCP-02). An **Agents** page does the same for Claude Code, Copilot and Codex agents. Pi has no agents or plugins here: it gets skills and MCP servers, and **Convert to skill** copies an agent into Pi's skills folder once. An **Instructions** page opens each tool's own instruction file to read and edit in place. A **Plugins** page adds marketplaces (Git URL, `owner/repo` or folder), shows each plugin's components and what each tool gets from them, and installs or uninstalls through each CLI's own plugin commands, confirmed by reading that tool's own record. `npm run test:harness` runs those installs with the real CLIs in disposable homes.

## Run

Node 24.9 or newer:

```sh
npm ci
npm start
npm test
npm run package:mac
```

Mac packaging runs on the selected Apple Silicon Mac and produces `release/Central-Knot-0.3.0-mac-arm64.zip`. `npm run package:mac` signs with the Mac's Developer ID Application certificate and notarizes through the `central-knot-notary` keychain profile when both are there. Otherwise, or with `CK_SIGN=0`, it applies and verifies an ad-hoc signature, and macOS still refuses an ad-hoc copy that arrives with a download's quarantine flag (V-10). `npm run package:mac:release` never falls back to ad hoc.

`npm run smoke:mac` opens a hidden, fixture-only window with disposable app data and checks the rendered rows and sharing plan. It never selects an actual home.

`npm run e2e` drives the packaged app end to end in a throwaway HOME, including force-kills during copies. Run it after `npm run package:mac`.

## Homes

- **This Mac’s home** (listed first; a released build opens it first): your real skills and a bounded `--version` probe of each CLI. Only choosing this writes real folders, and only on macOS. The app reopens on the home you last used, so a start at sign-in keeps syncing it.
- **Another folder…**: a simulated home. Apply all writes only inside it. A folder that is, contains or links into your real home's harness folders is read-only.
- **Practice copy** (dev builds and tests only): a throwaway copy of `fixtures/home` made for this launch and removed at Quit. Apply all really writes here. A dev build opens it first, so a development run never syncs your real tools. A released build does not offer it, and a remembered Practice copy opens this Mac's home instead.

## The Overview and the managed table

The **Overview** shows one card each for skills, MCP servers and agents, with counts and anything that needs a choice. A card opens its page.

The **Skills**, **MCP** and **Agents** pages each hold the managed table: one row per item, one column per installed tool. Nothing is managed until you choose it. The bullets below use skills; MCP servers and agents work the same way.

- **Managed** switch: a managed skill keeps one copy in every tool it syncs to. Unmanaged skills are left alone.
- **Tool cells** are toggles. Filled means syncing to that tool is on. Green check: synced. Blue: waits for Apply all. Amber: copies differ. Ring: has a copy that is not synced. Empty: no copy. Hatched: that tool cannot load it, with the reason.
- **Tool menus**, from a column header: add all of that tool's skills to another tool, or **Stop syncing here** (copies stay).
- **Manage all** queues every unmanaged skill without differing copies. Changes wait for **Apply all**, or **Discard**.
- **Copies differ**: open the row and choose which tool's copy every tool uses (the replaced copy is kept in `.central-knot/items`), or keep both as they are.
- **Catch-up**: opening a home or **Refresh** copies a managed skill back into a tool it syncs to that lacks it, and says which. Turn a tool off for a skill to stop that.
- Copies are written only into each tool's own skills folder, byte-exact with file modes, without nested `.git` or Finder's `.DS_Store`. Central Knot never writes through a link or into a folder other tools share, such as `~/.agents/skills`; a differing copy there is reported for you to change.

State lives in one folder with no second copy, `.central-knot/` inside the selected home: `sync.json` and imported revisions under `items/`. Nathan accepted that limit on November 7, 2026, so owner-restore and overwritten-record rollback (AT-62(f), (g)) stay Unmet. A damaged, missing, newer, replaced or differently owned record stops writes and deletes nothing.

`--design-preview` (or `=b`, `=b3`) opens the managed table on sample data, without touching any files.

## Two-way sync, History and the background

- **Automatic sync (status bar switch, on by default).** A managed skill, MCP server or agent edited in one tool spreads to the others within seconds. A deletion spreads after a 2 s settle. Competing skill edits are decided by the newest action, or the fixed tool order (Copilot, Claude Code, Codex, Pi) when the order can't be proved. Competing MCP server and agent edits always use the fixed order (Copilot, Claude Code, Codex, then Pi for MCP). Each outcome shows a notice with Undo or Restore.
- **With Automatic sync off,** edits and deletions are noted as waiting, and **Sync once** spreads them once. **Apply all** writes only what it shows.
- **History** lists what sync did on its own, with Undo or Restore. Every replaced or removed version is kept first in `.central-knot/` (skills, agent files, and each tool's own MCP settings).
- **Safety.** A folder or file that can't be read, is half-written, or was reset is held, never read as a deletion. Every write checks the file first and never overwrites a save made meanwhile.
- **Agents** (Claude Code `~/.claude/agents`, Copilot `~/.copilot/agents`, Codex `~/.codex/agents`) sync name, description and prompt. A tool that lacks the origin's other fields gets the agent **With limits**, one-way: changes there stay there. Pi has no agents; **Convert to skill** writes one as a Pi skill, once, and never writes back to the agent.
- **MCP:** Claude Code's `~/.claude.json` is written only by **Write to Claude Code**, with Claude Code quit (it refuses while Claude Code runs). Codex servers written inline or with dotted keys are left alone.
- **Background:** closing the window keeps Central Knot syncing. The app menu (and the menu bar icon, when the menu bar has room) has Automatic sync, Sync once (shown while Automatic sync is off), Start at sign-in and Quit. Start at sign-in is on by default once the app is in `/Applications`.

## Profiles

A **profile** is a named set of skills and MCP servers to have on, such as *Incident* or *Development*, chosen from what the home already has (**Profiles** in the sidebar). Switching to one, from that page, the status bar or the menu bar icon's **Profile** menu, turns everything it leaves out **off with each tool's own switch** and turns back on what an earlier switch turned off. Nothing is moved or deleted, and the MCP entries themselves are never edited:

| Tool | Skill switch | MCP server switch |
|---|---|---|
| Claude Code | `skillOverrides` in `~/.claude/settings.json` | `deniedMcpServers` in `~/.claude/settings.json` (never `~/.claude.json`, so no Write now) |
| Copilot CLI | `disabledSkills` in `~/.copilot/settings.json` | `disabledMcpServers` in the same file |
| Codex | `[[skills.config]]` by path in `config.toml` | `enabled = false` in the server's table |
| Pi | a `-skills/…` filter in `settings.json` | `"enabled": false` in `mcp.json` |

- **One step in History.** A switch is one History row; **Undo switch** puts back every switch it changed (where it is still as the switch left it) and the profile before.
- **Hand-made choices stay.** A skill you turned off in one tool yourself (Disable on the Skills page) stays off; profiles only turn back on what a profile turned off. **No profile** turns all of that back on.
- **Managed keeps syncing.** A managed item that a profile turned off still receives edits, so it is current when it comes back. Profiles never change Managed.
- Agents have no off-switch in any tool, so they are not in profiles. Profiles are kept in `.central-knot/profiles.json` in the home. A switch takes effect from each tool's next session.

## Trying v1 on your Mac

1. Optional first: back up `~/.claude ~/.copilot ~/.codex ~/.pi ~/.agents ~/.claude.json` with `tar`. Central Knot keeps its own History, but a backup costs nothing.
2. Open the build (the newest under `~/agent-builds/central-knot/`, or `release/` after `npm run package:mac`). It opens on **This Mac’s home**, your real setup. To try things on sample files first, run `npm start` from the source: a dev build opens the **Practice copy**.
3. Nothing is managed until you choose it: **Manage all** or single switches, then **Apply all**.
4. For MCP into Claude Code, quit Claude Code, then **Write to Claude Code**.
5. To make it start at sign-in, copy it to `/Applications`. An ad-hoc build may need right-click → **Open** the first time.
6. If something looks wrong, `~/Library/Application Support/central-knot/central-knot.log` records window events and failed requests.

## Not here yet

Disable, plugin updates, plugins for Pi, Cowork, the bundled build, Windows and Linux. Nothing here claims an item has loaded in a session: Written means the bytes are on disk.

The product boundary is in `AGENTS.md`. Planning inputs are under `docs/`. `LEDGER.md` records what was run and every check round.
