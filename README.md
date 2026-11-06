# Central Knot — first look

A fresh implementation, starting at plan slice **1a only**. There is no old application code or old Git history in this source tree.

This package reads user-wide **Claude Code CLI standalone skills**. It opens on two bundled fixtures. Choose another simulated home folder, or explicitly choose **This Mac’s home** to read its actual user-wide skills and run a bounded `claude --version` probe. A selected folder means a simulated home, not a workspace to manage. `CLAUDE_CONFIG_DIR` is honored only for the actual home; an unknown relative override is reported, never replaced with a default.

## Run

Node 24.9 or newer:

```sh
npm ci
npm start
npm test
npm run package:mac
```

Mac packaging runs on the selected Apple Silicon Mac. The output is `release/Central-Knot-0.1.0-mac-arm64.zip`, containing `Central Knot.app`. Unzip and open it normally in Finder. This initial package is not a signing or ordinary-download proof; any macOS refusal remains an open V-10 result. No security bypass is part of the try.

`npm run smoke:mac` opens a hidden, fixture-only Electron window with disposable app data and checks that the renderer receives and displays the two fixtures. It does not select an actual home or invoke a real harness. Pure tests also run on Linux; that is not a Linux desktop release.

## What is and is not here

- A read-only skill list and item detail; original contents and file locations appear only in detail.
- Distinct missing, empty, restricted, failed and malformed results, with config-folder evidence kept separate from installation evidence.
- No native lists, sign-in, session, MCP server, registry initialization or configuration writes.
- No sharing, install, toggles, background task, instruction sync, owner record, content store, updater or Compatibility page.
- No claim that a file has loaded in a harness; no system probe until the actual-home choice.

The approved product boundary is in `AGENTS.md`. Planning inputs live under `docs/`; their existing unresolved choices and proof gates remain open. `LEDGER.md` records this batch, not product proof that has not run.
