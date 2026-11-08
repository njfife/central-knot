# Central Knot

A desktop app that shows the configuration each AI coding tool has and moves it between them. This early package covers user-wide **standalone skills** in **Claude Code CLI**, **GitHub Copilot CLI** and **Codex** (the CLI, and the ChatGPT desktop app, which reads the same `~/.codex`). It holds plan slices 1a, 1b's first checkpoint and 8a, with the managed Overview Nathan chose on November 8, 2026. The interface follows `docs/ui-reference.md`.

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
- **This Mac’s home**: your real skills and a bounded `--version` probe of each CLI. Only choosing this writes real folders, and only on macOS; each launch opens on the practice copy again.

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

## Not here yet

History and Restore, background sync while the app is open, two-way edits (an edit in one tool shows as copies differ), spreading deletions (catch-up brings a deleted copy back while the tool stays on), the Skills and Tools pages in the new design, and other kinds and tools. Nothing here claims a skill has loaded in a session: Written means the bytes are on disk.

The product boundary is in `AGENTS.md`. Planning inputs are under `docs/`. `LEDGER.md` records what was run.
