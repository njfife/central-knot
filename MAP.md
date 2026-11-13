# Map of the code

Read this first. Each area says what it is for, its files (one entry each: what the file owns; every source file is under `src/`, every script under `scripts/`), where to start reading and where its worked examples are (tests); then the paths that cross areas, names that mean two things, and where the recipes for common changes are. `tests/map.test.ts` fails when a file is added, renamed or removed and this map is not.

**What the app is.** Central Knot is an Electron app (plain TypeScript and the DOM, no framework) that moves AI coding tools' configuration (skills, MCP servers, agents, instructions, plugins) between the tools in one home and keeps it in step: Claude Code, Copilot CLI, Codex, Pi and OpenCode (a "harness" in the code, `types.ts HarnessId`). `main.ts` is the main process, which runs the engines (files, the tools' CLIs) and the background pass; the window starts at `renderer.ts`; the two talk only through `preload.ts`. What it keeps about a home is in `.central-knot/` inside it; its own settings and log are in the app's data folder (README's "State").

**Two ideas to hold.**
1. *Items live in Central Knot's library and are applied to the managed tools.* A tool is where an item is applied, not where it lives, and every content is kept before anything is written over. The model is `library.ts`'s header.
2. *Skills, MCP servers and agents are all on the library.* The item pages read all three through one shape (`itemrow.ts kindSource`). Putting a kind onto the library is the recipe in `librarypass.ts`'s header.

## The library: skills, MCP servers and agents on it
An item Central Knot holds with its versions, On or Off, applied to every managed tool it is not kept out of.
- `library.ts` the model and its one rule, pure; what takes a found item in, a click's Add or Synchronize everything (`takeInAnswer`); `carryOut`, the order one item's plan is carried out in · `librarypass.ts` the pass on real files, the same for every kind; `Kind`, what a kind implements; Synchronize everything's step (`takeInByRule`)
- `skills.ts` skills' `Kind` (`skillKind`), the ways a tool has a skill that aren't Central Knot's (`anotherWay`), their clicks (`applySkills`), page view (`skillsView`; a row's sentences: `libraryrow.ts sentences`), `clearSwitch` and `takeOver` · `skillfiles.ts` a skill's folder in a tool, read, written and removed, checked
- `skillstore.ts` where skills are kept in `.central-knot/` (skills.json, and versions under items/skills/) · `skillmigrate.ts` the skills sync.json held before the library, made items once
- `servers.ts` MCP servers' `Kind` (`serverKind`), their clicks (`applyServers`), Write to Claude Code (`writeToClaude`), page view (`serversView`), and a Claude Code deny the profiles migration kept, cleared once the server is wanted there (`releaseKeptDenies`) · `mcp.ts` one tool's MCP entries in one shape (`NeutralServer`, and the tool's own part, `OwnPart`), which tool can hold which transport (`cannotHold`), and one entry written or removed (`editEntry`)
- `serverstore.ts` where servers are kept in `.central-knot/` (mcp.json, versions and each tool's own fields under items/mcp/, and claude-denies.json: `keptDenies`) · `servermigrate.ts` the MCP record from before the library, made items once
- `mcpswitch.ts` a tool's own switch for a server: read for its mark, cleared by the profiles migration and for a Claude Code deny it kept (`servers.ts releaseKeptDenies`)
- `agents.ts` agents' `Kind` (`agentKind`), their clicks (`applyAgents`) and page view (`agentsView`) · `agentfiles.ts` each tool's agent file, read and written
- `agentstore.ts` where agents are kept in `.central-knot/` · `agentmigrate.ts` the record from before the library, made items once · `agentskill.ts` Convert to a Pi skill (a copy, not sync)
- `libraryrow.ts` a library item's row without the DOM: marks, clicks, sentences in the kind's words · `librarypages.ts` what else a kind gives its page · `versionlist.ts` an opened row's versions
- `skillswitch.ts` a tool's own switch for a skill: read for its mark, cleared by `skills.ts clearSwitch` and by the profiles migration, flipped for a plugin's skill
- **Start:** `library.ts`'s header, then `librarypass.ts`'s. **Examples:** `tests/library.test.ts` (one per row of the rule), `tests/librarypass.test.ts` (a toy kind), `tests/skills.test.ts`, `tests/servers.test.ts` and `tests/agents.test.ts` (real files), `tests/synceverything.test.ts` (Synchronize everything, every kind on real files), `tests/skillmigrate.test.ts`, `tests/servermigrate.test.ts` and `tests/agentmigrate.test.ts`, the four migrations as one upgrade over homes two older versions made (`tests/upgrade.test.ts`, the homes and how they were made in tests/upgrade/), `tests/skillsafety.test.ts`, `tests/libraryrow.test.ts`, the seeded walks `tests/agentswalk.test.ts` (an agent, clicking through `tests/agentclicks.ts`), `tests/librarywalk.test.ts` (a skill and an agent in one home, clicking through `tests/skillclicks.ts`) and `tests/serverswalk.test.ts` (a server with a skill and an agent in one home); the `tests/*-check-*.test.ts` files are regressions from earlier review rounds.

## The tools in a home
Which tools a home has, where each keeps its files, and which of them Central Knot manages: every installed tool but the ones whose Manage switch is off (kept in the home's record as the tools left out: `share.ts SyncRecord leftOut`). A tool left out has its card and switch on Harnesses and shows on no other page; nothing of Central Knot's is written there.
- `harnesses.ts` each tool's definition: config folder, skill roots, binary · `discovery.ts` one tool in a home read (`discover`): its skills, CLI version, desktop apps
- `platform.ts` where CLIs and apps are looked for · `presence.ts` the tools present (`presentTools`) and managed (`managedTools`), and what each can hold
- `toolchoice.ts` a tool's Manage switch: the one place the managed tools change (`chooseTools`), and what turning one on would do there (`whatJoiningDoes`, from `librarypass.ts joinCounts`) · `managecard.ts` the switch on a Harnesses card, the line beside it and the band after it
- **Start:** `presence.ts`, then `toolchoice.ts`. **Examples:** `tests/managetool.test.ts` (the switch on real files, each way it can go wrong), `tests/discovery.test.ts`, `tests/presence.test.ts`, `tests/cowork.test.ts`; on screen, `scripts/e2e.mjs manageFlow`.

## The item pages: Overview, Skills, MCP servers, Agents, Harnesses
One row per item with one On/Off switch, applied in every managed tool; each click's result comes with one Undo.
- `pages.ts` Overview, and the Skills, MCP servers and Agents pages around their tables · `matrix.ts` the tables: rows, details, bands, the copy question, library rows (`librarySwitch`)
- `harnesspage.ts` Harnesses: a card per tool (its Manage switch is managecard.ts, under The tools in a home), and a page per managed tool, the same tables with it first · `itemrow.ts` every kind's rows as the pages read them (`kindSource`)
- `clickplan.ts` which of a pass's results are a click's own (`clickResults`) · `copywords.ts` the copy question's words
- **Start:** `matrix.ts itemsTable`; a click leaves through `app.ts applyClick`. **Examples:** `tests/clickplan.test.ts`, `tests/copywords.test.ts`; on screen, the flows in `scripts/e2e.mjs`.

## History
What Central Knot did, on its own or on a click, newest first, with Undo or Restore while the kept content allows it.
- `historypage.ts` the page, and what the entries of profiles and instructions say (`describe`) · `historyactions.ts` skills', MCP servers' and agents' entries: whose (`libraryEntry`), sentence, action, done words
- `history.ts` the file, kept for every kind (`appendHistory`, `readHistory`) and pruned by History's days (`pruneHistory`; Settings sets the days); an entry is a `types.ts HistoryEvent`, its action `app.ts restoreEvent` (paths below).
- **Start:** `historypage.ts describe`. **Examples:** `tests/historyactions.test.ts`; each kind's Restore in `tests/skills.test.ts`, `tests/servers.test.ts` and `tests/agents.test.ts`.

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
Named sets of library items to have On: switching to one turns those On and every other library item Off, by the library's own clicks; which profile is in use is worked out, never stored.
- `profileplan.ts` the rules, pure: what a switch changes (`switchPlan`), which profiles are in use (`inUse`), what a switch's Undo turns back (`undoPlan`)
- `profiles.ts` profiles.json, a switch carried out (`switchProfile`, one History entry: `librarypass.ts PassOptions told`) and its Undo (`undoSwitch`) · `profilemigrate.ts` a profiles file from before profiles were sets of items, moved once (`migrateProfiles`)
- `profilespage.ts` the page and every word it shows, and the status bar's profile menu; the menu bar's is `main.ts profileMenu`; a profile entry's sentence and Undo in History are `historypage.ts profileSwitch`
- **Start:** `profileplan.ts`, then `profiles.ts`'s header. **Examples:** `tests/profiles.test.ts` (the migration's fixture home included), and the move in a whole old home in `tests/upgrade.test.ts`; profile switches among `tests/serverswalk.test.ts`'s steps.

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
- `homepass.ts` what one pass does, in order, at start and at every look (`homePass`): a profiles file from before moved, then with Sync on skills, MCP servers and agents
- `signin.ts` Start at sign-in · `machine.ts` how this computer, its home and keys are named · `trayicon.ts` the menu bar icon · `index.html` the window's frame
- `renderer.ts` the page's entry: sidebar, header, status bar, which page draws (`renderPage`) · `app.ts` the page's state and most pages' actions (`applyClick`, `restoreEvent`)
- `settingspage.ts` Settings, and the open home's Synchronize everything row (kept in the home's record: `share.ts setSyncEverything`) · `style.css` every style · `dom.ts` the `h` element builder and small controls · `icons.ts` the glyphs · `brand.ts` each tool's mark
- `types.ts` the shapes main and the page share · `words.ts` tools' and kinds' names, lists in words · `model.ts` small helpers: times, counts · `flags.ts` per-viewer flags
- `pagedata.ts` a page's own read, apart from the home's · `diff.ts` line and word diffs
- **Start:** `renderer.ts` for the window; `main.ts`'s handlers for what a call does. **Examples:** `tests/signin.test.ts`, `tests/words.test.ts`, `tests/model.test.ts`, `tests/pagedata.test.ts`; every page opened in `scripts/e2e.mjs`.

## The store and safe writes
What every engine stands on: `.central-knot/`, which build syncs a home, and writes that never lose a save made meanwhile.
- `share.ts` the store: the home's record of who syncs it, the tools left out and Synchronize everything (`readRecord`, `setSyncEverything`), which build syncs here (`syncGate`), checked writes (`writeFileChecked`), a skill's folder copied (`placeCopy`)
- `textedit.ts` one entry of a JSON or TOML file changed, every other byte kept · `values.ts` untrusted values checked, with safe defaults
- **Start:** `share.ts`'s exports, by their comments; a skill's copy is written over by `skillfiles.ts swapFolder`. **Examples:** `tests/share-recovery.test.ts`, `tests/textedit.test.ts`, `tests/skillsafety.test.ts`.

## Test and tour scripts
How each is run: `AGENTS.md` ("Checking a change") and README ("For developers"); the Mac run is `.github/workflows/mac.yml`. Unit tests are `tests/*.test.ts`.
- `scripts/e2e.mjs` the end-to-end checks on the real app in a throwaway home · `scripts/ui-tour.mjs` the screenshot tour · `scripts/cdp.mjs` the DevTools client the scripts drive the app with
- `scripts/fixture-market.mjs` a realistic marketplace · `scripts/git-http-fixture.mjs` Git repos served here · `scripts/update-fixture.mjs` a stand-in for GitHub's releases
- `scripts/update-proof.mjs` a real signed update, on a Mac · `scripts/alpha-check.mjs` the alpha beside the standard app · `scripts/bundled-check.mjs` a bundled build end to end
- `scripts/real-home-trial.ts` the two-way trial on a real home its owner opened for it

## Paths that cross areas
- **A click on an item page:** a row's switch in `matrix.ts` → `app.ts applyClick`, sent by `app.ts kindPages` through `preload.ts` → `main.ts changes` (the sanitizer) → `skills.ts applySkills`, `servers.ts applyServers` or `agents.ts applyAgents` (→ `librarypass.ts runPass`) → the result kept for `app.ts lastResult`, drawn by `matrix.ts outcomeBand`. Write to Claude Code: the band in `matrix.ts` → `app.ts writeClaudeNow` → `main.ts` (Claude closed) → `servers.ts writeToClaude`.
- **A tool's Manage switch:** the switch on its Harnesses card (`managecard.ts`) → `main.ts`'s `tools:manage` → `toolchoice.ts chooseTools` (the record's tools left out, the folders let go, one History entry) → `main.ts syncThenView`, whose pass brings a tool turned on into line, and whose view counts again what turning each tool left out on would do (`SyncView joining`).
- **A background pass:** a folder watch or the poll (`main.ts startWatching`) → `main.ts backgroundPass` → `main.ts pass` → `homepass.ts homePass` (a profiles file from before moved, then with Sync on, or Sync once: skills, MCP servers and agents, `librarypass.ts PassOptions background`, the one pass Synchronize everything takes found items in: `librarypass.ts takeInByRule`) → `sync:changed` → `app.ts backgroundRefresh` → `main.ts syncThenView`, which builds the `types.ts HomeView` every page reads.
- **A History action:** a button in `historypage.ts` → `app.ts restoreEvent` → `main.ts`'s `history:restore`, sent on by the entry → `skills.ts restoreSkill`, `servers.ts restoreServer` or `agents.ts restoreAgent` (→ `librarypass.ts restore`), `profiles.ts undoSwitch` or `gitrepo.ts undoPulledBase`.
- **A profile switch:** the page's Switch or the status bar's menu (`profilespage.ts`) → `main.ts`'s `profiles:switch`, or the menu bar's (`main.ts profileMenu` → `main.ts switchFromMenu`) → `profiles.ts switchProfile` (`profileplan.ts switchPlan`; the entry first, then `skills.ts applySkills`, `servers.ts applyServers` and `agents.ts applyAgents` with the clicks) → `app.ts switchToProfile`'s band, with Write to Claude Code when a server waits.
- **A sync notice:** made by a pass (`librarypass.ts logItem`, `takenInNotice`), sent once with main's next view (`main.ts syncThenView`), carried across reads until its page shows it (`app.ts keepUnshown`), then kept or folded on that page (`matrix.ts toldNotices`).
- **An update check:** the timer in `updateflow.ts updateFlow` (started by `updater.ts startUpdater`) or Check now (`updateview.ts checkNow`) → GitHub's releases → `updates.ts newerRelease` → `updates:changed` → `updateview.ts followUpdates` redraws the control.
- **A plugin's Apply all:** boxes on `pluginspage.ts` or `pluginpage.ts` fill the plan → `pluginstate.ts applyPluginOps` → `pluginplan.ts runPlan` → the handlers in `marketplaces.ts registerMarketplaces` → `plugins.ts install`, `plugins.ts update`, `plugins.ts uninstall` or `parts.ts installParts`.

## Names that mean two things
- **A kind:** `app.ts PageKind` is a page's name for it (agents), `library.ts ItemKind` the library's and a profile's (agent), `presence.ts HomeKind` every kind with a page of its own (instructions and plugins too); `librarypass.ts Kind` is what a kind implements.
- **An item's key:** `library.ts itemKey` of its name (also exported by `share.ts`); a profile names an item by its kind and key, `skill:notes` (`profileplan.ts itemId`).
- **A switch:** `skillswitch.ts` and `mcpswitch.ts` are a tool's own off-switch for a skill or a server (never the item's On/Off); `partswitch.ts` the same for one part of a plugin; `pluginswitch.ts` the item pages' switch for an item a plugin brings; `plugins.ts setSkill` one skill of a plugin.
- **History:** stored for every kind by `history.ts`; worded by `historypage.ts`, except skills', MCP servers' and agents' entries, which `historyactions.ts` words.
- **One name, two things:** `Outcome` (`app.ts Outcome` a result the page tells; `types.ts Outcome` a plugin component in a tool), `standing`, `toggle`, `updateButton`, `Waiting`, `CHECK_EVERY_MS` (`updateflow.ts`: the app's own updates; `pluginupdates.ts`: plugins'), `PassOptions`, `pluginTools`: read each with its file. `model.ts fileName` and `words.ts fileName` are one function written twice.

## To add or change
- **A kind of item onto the library:** every place it is wired in is the recipe in `librarypass.ts`'s header.
- **A tool:** its definition in `harnesses.ts`, its id in `types.ts HarnessId`, its name in `words.ts toolNames`, and each kind's reader and writer for it (`agentfiles.ts`, `mcp.ts`, `mcpswitch.ts`, `skillswitch.ts`, `discovery.ts`).
- **A field on a click (`types.ts Change`):** `main.ts changes` must copy it too, or the packaged app drops it while the unit tests pass.
- **A History entry or action:** for skills, MCP servers and agents (the library's kinds), the recipe at the end of `historyactions.ts`'s header; for profiles and instructions, a case in `historypage.ts describe`.
- **A skill folder name a tool keeps for itself:** `harnesses.ts HarnessDefinition.reservedSkills` (that tool's definition); its three readers are `discovery.ts`, `skillfiles.ts readSkillsFolder` and `skills.ts cannotTake`; tests in `tests/skills.test.ts` (a name a tool keeps for itself) and `tests/discovery.test.ts`.
- **A call from the page to main:** `types.ts DesktopApi`, `preload.ts`, and its handler in `main.ts`.
- **A page:** `app.ts pages` and `renderer.ts renderPage`. **A Settings row:** a section or row in `settingspage.ts settingsPage`; its value saved by `main.ts saveAppSettings` (`main.ts AppSettings`) and sent to the page as `types.ts AppPreferences`; a home's own setting (Synchronize everything) is kept in its sync record instead (`share.ts SyncRecord`) and reaches the page in `types.ts SyncView`.
- **A file added, renamed or removed:** its entry here; `tests/map.test.ts` names what to change.
