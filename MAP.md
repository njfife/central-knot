# Map of the code

Read this first. Each area says what it is for, its files (one entry each: what the file owns), where to start reading and where its worked examples are (tests); then the paths that cross areas, names that mean two things, and where the recipes for common changes are. `tests/map.test.ts` fails when a file is added, renamed or removed and this map is not.

**What the app is.** Central Knot is an Electron app (plain TypeScript and the DOM, no framework) that moves AI coding tools' configuration (skills, MCP servers, agents, instructions, plugins) between the tools in one home and keeps it in step: Claude Code, Copilot CLI, Codex, Pi and OpenCode (a "harness" in the code, `types.ts HarnessId`). `main.ts` is the main process, which runs the engines (files, the tools' CLIs) and the background pass; the window starts at `renderer.ts`; the two talk only through `preload.ts`. What it keeps about a home is in `.central-knot/` inside it; its own settings and log are in the app's data folder (README's "State").

**Two ideas to hold.**
1. *Items live in Central Knot's library and are applied to the managed tools.* A tool is where an item is applied, not where it lives, and every content is kept before anything is written over. The model is `library.ts`'s header.
2. *Skills and agents are on the library today.* MCP servers (`mcp.ts`) are still on their own older engine, where the tools' files are the truth and Central Knot records what it syncs. The item pages read all three through one shape (`itemrow.ts kindSource`). Moving a kind onto the library is the recipe in `librarypass.ts`'s header.

## The library: skills and agents on it
An item Central Knot holds with its versions, On or Off, applied to every managed tool it is not kept out of.
- `library.ts` the model and its one rule, pure; `carryOut`, the order one item's plan is carried out in · `librarypass.ts` the pass on real files, the same for every kind; `Kind`, what a kind implements
- `skills.ts` skills' `Kind` (`skillKind`), the ways a tool has a skill that aren't Central Knot's (`anotherWay`), their clicks (`applySkills`), page view (`skillsView`), `clearSwitch` and `takeOver` · `skillfiles.ts` a skill's folder in a tool, read, written and removed, checked
- `skillstore.ts` where skills are kept in `.central-knot/` (skills.json, and versions under items/skills/) · `skillmigrate.ts` the skills sync.json held before the library, made items once
- `agents.ts` agents' `Kind` (`agentKind`), their clicks (`applyAgents`) and page view (`agentsView`) · `agentfiles.ts` each tool's agent file, read and written
- `agentstore.ts` where agents are kept in `.central-knot/` · `agentmigrate.ts` the record from before the library, made items once · `agentskill.ts` Convert to a Pi skill (a copy, not sync)
- `libraryrow.ts` a library item's row without the DOM: marks, clicks, sentences in the kind's words · `librarypages.ts` what else a kind gives its page · `versionlist.ts` an opened row's versions
- `skillswitch.ts` a tool's own switch for a skill: read for its mark, cleared by `skills.ts clearSwitch`, flipped by profiles (`profiles.ts`) and for a plugin's skill (`plugins.ts`)
- **Start:** `library.ts`'s header, then `librarypass.ts`'s. **Examples:** `tests/library.test.ts` (one per row of the rule), `tests/librarypass.test.ts` (a toy kind), `tests/skills.test.ts` and `tests/agents.test.ts` (real files), `tests/skillmigrate.test.ts` and `tests/agentmigrate.test.ts`, `tests/skillsafety.test.ts`, `tests/libraryrow.test.ts`, `tests/agentswalk.test.ts` (the seeded walk, clicking through `tests/agentclicks.ts`; skills' clicks are `tests/skillclicks.ts`).

## MCP servers, on their own engine
The kind not on the library yet: each tool's own files are the truth; Central Knot records what it syncs, spreads edits and deletions, and keeps what it replaces.
- `mcp.ts` MCP servers: each tool's entries in one shape (`NeutralServer`, read from a tool's file by `fromJson`; a tool's own fields ride along as extras), sync (`applyMcp`), Restore, Write to Claude Code · `mcpswitch.ts` a server off in one tool, by its own switch
- `choiceundo.ts` a copy choice's Undo, for MCP servers
- **Start:** `mcp.ts applyMcp`. **Examples:** `tests/mcp.test.ts`, `tests/opencode.test.ts`, `tests/skillswitch.test.ts`; the `tests/*-check-*.test.ts` files are regressions from earlier review rounds.

## The tools in a home
Which tools a home has, where each keeps its files, and which of them Central Knot manages.
- `harnesses.ts` each tool's definition: config folder, skill roots, binary · `discovery.ts` one tool in a home read (`discover`): its skills, CLI version, desktop apps
- `platform.ts` where CLIs and apps are looked for · `presence.ts` the tools present (`presentTools`) and managed (`managedTools`), and what each can hold
- `toolchoice.ts` the one place the managed tools change (`chooseTools`); no page calls it yet, the tests do
- **Start:** `presence.ts`. **Examples:** `tests/discovery.test.ts`, `tests/presence.test.ts`, `tests/cowork.test.ts`.

## The item pages: Overview, Skills, MCP servers, Agents, Harnesses
One row per item with one On/Off switch, applied in every managed tool; each click's result comes with one Undo.
- `pages.ts` Overview, and the Skills, MCP servers and Agents pages around their tables · `matrix.ts` the tables: rows, details, bands, the copy question, library rows (`librarySwitch`)
- `harnesspage.ts` Harnesses: a page per tool, the same tables with it first · `itemrow.ts` every kind's rows as the pages read them (`kindSource`); skills' and servers' marks (`cellOf`)
- `clickplan.ts` what one click changes, and what its Undo puts back · `roworder.ts` the order of rows · `syncrules.ts` which copies are compared · `copywords.ts` the copy question's words
- **Start:** `matrix.ts itemsTable`; a click leaves through `app.ts applyClick`. **Examples:** `tests/clickplan.test.ts`, `tests/roworder.test.ts`, `tests/copywords.test.ts`; on screen, the flows in `scripts/e2e.mjs`.

## History
What Central Knot did, on its own or on a click, newest first, with Undo or Restore while the kept content allows it.
- `historypage.ts` the page, and what the entries of MCP servers, profiles and instructions say (`describe`) · `historyactions.ts` skills' and agents' entries: whose (`libraryEntry`), sentence, action, done words
- `history.ts` the file, kept for every kind (`appendHistory`, `readHistory`) and pruned by History's days (`pruneHistory`; Settings sets the days); an entry is a `types.ts HistoryEvent`, its action `app.ts restoreEvent` (paths below).
- **Start:** `historypage.ts describe`. **Examples:** `tests/historyactions.test.ts`; each kind's Restore in `tests/skills.test.ts`, `tests/mcp.test.ts` and `tests/agents.test.ts`.

## Plugins and marketplaces
Marketplaces browsed, plugins chosen per tool and applied through each tool's own CLI; what installed plugins bring shows on the item pages.
- `plugins.ts` catalogs, Git, and install, update, uninstall through each tool's CLI · `marketplaces.ts` the marketplace list and the Plugins page's requests, in main
- `catalogdetail.ts` READMEs and what each plugin holds, read only · `suggested.ts` marketplaces offered unasked · `pluginoutcomes.ts` what each component does in each tool
- `parts.ts` a plugin's parts written as ordinary items where a tool can't take the plugin · `partswitch.ts` one MCP server or agent of a plugin, off in one tool
- `pluginitems.ts` what installed plugins bring, read with the home · `pluginupdates.ts` the background check that runs Update all by itself (`autoUpdates`)
- `pluginspage.ts` the Plugins page · `pluginpage.ts` one plugin's page · `pluginstate.ts` the Plugins page's state and actions · `pluginplan.ts` what is chosen, Apply all, its Undo
- `pluginstatus.ts` what the pages say of a plugin in a tool; which tools Update brings up to date (`updateTools`) · `pluginparts.ts` pieces both pages draw (not `parts.ts`'s parts)
- `pluginrows.ts` plugin items as rows of the item pages · `pluginswitch.ts` those rows' switch · `pluginupdateview.ts` the automatic updates' note and Settings row
- `markdown.ts` the README reader · `reads.ts` background reads, the newest kept
- **Start:** `plugins.ts`'s header, then `pluginstate.ts applyPluginOps`. **Examples:** `tests/plugins.test.ts`, `tests/pluginplan.test.ts`, `tests/pluginstatus.test.ts`, `tests/parts.test.ts`, `tests/pluginitems.test.ts`, `tests/pluginupdates.test.ts`, `tests/marketplaces.test.ts`; real CLIs in `tests/harness/plugins.harness.ts`.

## Profiles
Named sets of skills and MCP servers to have on, switched in one step by each tool's own switch (`skillswitch.ts`, `mcpswitch.ts`).
- `profiles.ts` the profiles kept, and a switch carried out (`switchProfile`) · `profileplan.ts` what a switch changes, for main and the page alike · `profilespage.ts` the page
- **Start:** `profileplan.ts`. **Examples:** `tests/profiles.test.ts`.

## The Git repo
The Managed set kept in a git repo, with Pull and Push; nothing moves until one is clicked.
- `gitrepo.ts` connect, Pull, Push, and the repo's layout (its header) · `repopage.ts` the page
- **Start:** `gitrepo.ts`'s header. **Examples:** `tests/gitrepo.test.ts`, `tests/gitrepo-pull.test.ts`, `tests/gitrepo-edits.test.ts` (shared setup in `tests/gitrepo-world.ts`).

## Instructions
Each tool's own instruction file, edited in place; and one base text kept in a marked block in the chosen tools' files.
- `instructions.ts` the files: read, checked save, versions, the base applied (`applyBase`) · `instructionspage.ts` the page · `editparts.ts` diffs, versions, the discard question
- `basecard.ts` the base instructions card · `basetext.ts` the base's block in a tool's file · `draftbase.ts` a first draft by one of the person's tools · `drafts.ts` when a draft is replaced
- **Start:** `instructions.ts`'s header. **Examples:** `tests/instructions.test.ts`, `tests/baseinstructions.test.ts`, `tests/draftbase.test.ts`, `tests/drafts.test.ts`.

## Updates, packaging and custom builds
The app updating itself from GitHub releases, its Mac packages, and custom builds that carry a marketplace.
- `updates.ts` release lines, which release is newer, and the words (no Node) · `updateflow.ts` an update's steps in main · `updater.ts` Electron's parts: the build's tag, Squirrel
- `updateview.ts` the sidebar's update control and Settings' Updates row · `bundle.ts` a custom build and the marketplace it carries · `bundlefeed.ts` a bundled build's feed
- `bundlepack.ts` a custom build's inputs, packed and staged · `scripts/build.mjs` builds `dist/` · `scripts/package-mac.mjs` the Mac app and its two downloads, signed
- `scripts/mac-dmg.mjs` the disk image · `scripts/mac-dmg-layout.sh` its window's layout · `scripts/release-tag.mjs` the tag a build records · `scripts/release-tag.d.mts` its types
- `scripts/custom-build.mjs` stages a custom build · `scripts/publish-bundle.mjs` a marketplace release onto a feed
- **Start:** `updates.ts`'s header; README's "Packaging and release". **Examples:** `tests/updates.test.ts`, `tests/updateflow.test.ts`, `tests/releasetag.test.ts`, `tests/bundle.test.ts`, `tests/bundlefeed.test.ts`.

## The app's shell and Settings
The main process, the window's frame, Settings, and what every page shares.
- `main.ts` the main process: window, menu bar, folder watching, the background pass, settings storage, every IPC handler · `preload.ts` the page's calls into main (`types.ts DesktopApi`)
- `signin.ts` Start at sign-in · `machine.ts` how this computer, its home and keys are named · `trayicon.ts` the menu bar icon · `index.html` the window's frame
- `renderer.ts` the page's entry: sidebar, header, status bar, which page draws (`renderPage`) · `app.ts` the page's state and most pages' actions (`applyClick`, `restoreEvent`)
- `settingspage.ts` Settings · `style.css` every style · `dom.ts` the `h` element builder and small controls · `icons.ts` the glyphs · `brand.ts` each tool's mark
- `types.ts` the shapes main and the page share · `words.ts` tools' and kinds' names, lists in words · `model.ts` small helpers: times, counts · `flags.ts` per-viewer flags
- `pagedata.ts` a page's own read, apart from the home's · `diff.ts` line and word diffs
- **Start:** `renderer.ts` for the window; `main.ts`'s handlers for what a call does. **Examples:** `tests/signin.test.ts`, `tests/words.test.ts`, `tests/model.test.ts`, `tests/pagedata.test.ts`; every page opened in `scripts/e2e.mjs`.

## The store and safe writes
What every engine stands on: `.central-knot/`, which build syncs a home, and writes that never lose a save made meanwhile.
- `share.ts` the store: the home's record of who syncs it and its tools (`readRecord`), which build syncs here (`syncGate`), checked writes (`writeFileChecked`), a skill's folder copied (`placeCopy`)
- `textedit.ts` one entry of a JSON or TOML file changed, every other byte kept · `values.ts` untrusted values checked, with safe defaults
- **Start:** `share.ts`'s exports, by their comments; a skill's copy is written over by `skillfiles.ts swapFolder`. **Examples:** `tests/share-recovery.test.ts`, `tests/textedit.test.ts`, `tests/skillsafety.test.ts`.

## Test and tour scripts
How each is run: `AGENTS.md` ("Checking a change") and README ("For developers"); the Mac run is `.github/workflows/mac.yml`. Unit tests are `tests/*.test.ts`.
- `scripts/e2e.mjs` the end-to-end checks on the real app in a throwaway home · `scripts/ui-tour.mjs` the screenshot tour · `scripts/cdp.mjs` the DevTools client the scripts drive the app with
- `scripts/fixture-market.mjs` a realistic marketplace · `scripts/git-http-fixture.mjs` Git repos served here · `scripts/update-fixture.mjs` a stand-in for GitHub's releases
- `scripts/update-proof.mjs` a real signed update, on a Mac · `scripts/alpha-check.mjs` the alpha beside the standard app · `scripts/bundled-check.mjs` a bundled build end to end
- `scripts/real-home-trial.ts` the two-way trial on a real home its owner opened for it

## Paths that cross areas
- **A click on an item page:** a row's switch in `matrix.ts` → `app.ts applyClick`, sent by `app.ts kindPages` through `preload.ts` → `main.ts changes` (the sanitizer) → `skills.ts applySkills` or `agents.ts applyAgents` (→ `librarypass.ts runPass`), or `mcp.ts applyMcp` → the result kept for `app.ts lastResult`, drawn by `matrix.ts outcomeBand`.
- **A background pass:** a folder watch or the poll (`main.ts startWatching`) → `main.ts backgroundPass` → `main.ts pass` (with Sync on: skills, MCP servers and agents) → `sync:changed` → `app.ts backgroundRefresh` → `main.ts syncThenView`, which builds the `types.ts HomeView` every page reads.
- **A History action:** a button in `historypage.ts` → `app.ts restoreEvent` → `main.ts`'s `history:restore`, sent on by the entry → `skills.ts restoreSkill` or `agents.ts restoreAgent` (→ `librarypass.ts restore`), `mcp.ts restoreMcp`, `profiles.ts undoProfileSwitch` or `gitrepo.ts undoPulledBase`.
- **An update check:** the timer in `updateflow.ts updateFlow` (started by `updater.ts startUpdater`) or Check now (`updateview.ts checkNow`) → GitHub's releases → `updates.ts newerRelease` → `updates:changed` → `updateview.ts followUpdates` redraws the control.
- **A plugin's Apply all:** boxes on `pluginspage.ts` or `pluginpage.ts` fill the plan → `pluginstate.ts applyPluginOps` → `pluginplan.ts runPlan` → the handlers in `marketplaces.ts registerMarketplaces` → `plugins.ts install`, `plugins.ts update`, `plugins.ts uninstall` or `parts.ts installParts`.

## Names that mean two things
- **A kind:** `app.ts PageKind` is a page's name for it (agents), `library.ts ItemKind` the library's (agent), `profileplan.ts ItemKind` a profile's (skill or mcp), `presence.ts HomeKind` every kind with a page of its own (instructions and plugins too); `librarypass.ts Kind` is what a kind implements.
- **A switch:** `skillswitch.ts` and `mcpswitch.ts` are a tool's own off-switch for a skill or a server; `partswitch.ts` the same for one part of a plugin; `pluginswitch.ts` the item pages' switch for an item a plugin brings; `plugins.ts setSkill` one skill of a plugin.
- **History:** stored for every kind by `history.ts`; worded by `historypage.ts`, except skills' and agents' entries, which `historyactions.ts` words.
- **One name, two things:** `Outcome` (`app.ts Outcome` a result the page tells; `types.ts Outcome` a plugin component in a tool), `standing`, `toggle`, `updateButton`, `Waiting`, `CHECK_EVERY_MS` (`updateflow.ts`: the app's own updates; `pluginupdates.ts`: plugins'), `PassOptions`, `pluginTools`: read each with its file. `model.ts fileName` and `words.ts fileName` are one function written twice.

## To add or change
- **A kind of item onto the library:** every place it is wired in is the recipe in `librarypass.ts`'s header.
- **A tool:** its definition in `harnesses.ts`, its id in `types.ts HarnessId`, its name in `words.ts toolNames`, and each kind's reader and writer for it (`agentfiles.ts`, `mcp.ts`, `skillswitch.ts`, `discovery.ts`).
- **A field on a click (`types.ts Change`):** `main.ts changes` must copy it too, or the packaged app drops it while the unit tests pass.
- **A History entry or action:** for agents, the recipe at the end of `historyactions.ts`'s header; for the other kinds, a case in `historypage.ts describe`.
- **A call from the page to main:** `types.ts DesktopApi`, `preload.ts`, and its handler in `main.ts`.
- **A page:** `app.ts pages` and `renderer.ts renderPage`. **A Settings row:** a section or row in `settingspage.ts settingsPage`; its value saved by `main.ts saveAppSettings` (`main.ts AppSettings`) and sent to the page as `types.ts AppPreferences`.
- **A file added, renamed or removed:** its entry here; `tests/map.test.ts` names what to change.
