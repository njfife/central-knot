# Central Knot

A desktop app that shows the configuration each AI coding tool has and moves it between them. This early package covers user-wide **standalone skills** in **Claude Code CLI** and **GitHub Copilot CLI**. It holds plan slices 1a, 1b's first checkpoint and 8a's Preview and First copy. The interface follows `docs/ui-reference.md`.

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

## Homes

- **Practice copy** (opens first): a throwaway copy of `fixtures/home` made for this launch and removed at Quit. Start and Undo really write here.
- **Another folder…**: a simulated home. Start and Undo write only inside it. A folder that is, contains or links into your real home's harness folders is read-only.
- **This Mac’s home**: your real skills and a bounded `--version` probe of each CLI. Only choosing this writes real folders, and only on macOS; each launch opens on the practice copy again.

## What sharing does

Preview writes nothing. Start replans from disk, then:

- copies a skill one selected tool lacks into that tool's own folder, byte-exact with file modes, without nested `.git` or Finder's `.DS_Store` files;
- takes over an identical copy, or tools already reading the same folder, with zero writes;
- leaves same-name different skills separate and shows their diff as **Needs a decision**;
- holds a skill containing a link, or a destination already occupied by something else, with the reason;
- skips a destination that will not load the skill, and names known behaviour losses (`docs/capability-data.md` §4).

State lives in one folder with no second copy, `.central-knot/` inside the selected home: `sync.json` and imported revisions under `items/`. Nathan accepted that limit on November 7, 2026, so owner-restore and overwritten-record rollback (AT-62(f), (g)) stay Unmet. A damaged, missing, newer, replaced or differently owned record stops writes and deletes nothing.

**Undo** removes only copies a Start created that still match their recorded hash, and never the last real copy of a skill. Changed copies, sources and imported bytes stay. An item it removed becomes Don't share.

## Not here yet

Choosing a version in a collision, Share after Don't share, History and Restore, background sync, two-way edits, and other kinds and tools. Nothing here claims a skill has loaded in a session: Written means the bytes are on disk.

The product boundary is in `AGENTS.md`. Planning inputs are under `docs/`. `LEDGER.md` records what was run.
