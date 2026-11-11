# Central Knot

Central Knot is a desktop app that shows the skills, MCP servers, agents, instructions and plugins each AI coding tool on your computer has, and keeps the ones you choose the same across those tools. It works with Claude Code, GitHub Copilot CLI, Codex, Pi and OpenCode, through their CLIs or their desktop apps (Claude desktop, the GitHub Copilot app, ChatGPT desktop, OpenCode desktop), and it only reads and writes each tool's own user-wide files.

## Getting it

Download the Mac disk image (Apple silicon), `Central-Knot-<version>-mac-arm64.dmg`, from the [GitHub releases](https://github.com/njfife/central-knot/releases). Open it, drag **Central Knot** onto the **Applications** folder beside it, then open Central Knot from Applications. It is signed with a Developer ID and notarized. Each release also has the same app as a zip.

A released build opens on **This Mac's home**: your real tools. Nothing is changed until you choose it. The sidebar's **Home** list also has **Another folder…**, for a backup or another account's home; Central Knot writes only inside that folder, and one that is or links into your real tool folders is read-only. The **Practice copy** (sample data in a throwaway folder, removed at Quit) is only in development builds: run `npm start` from the source to try things on sample files first.

Real-home writes happen only on macOS. If something looks wrong, Settings → **Show log file** opens Central Knot's own log: each plugin change with what it came to and why, and each item an Apply all couldn't change.

## The pages

### Overview

One card each for skills, MCP servers and agents, with counts and anything that needs a choice. A card opens its page.

### Harnesses

One card per tool found on this computer, with its skills, MCP servers, agents, instruction file, plugins and config folder. A tool counts as found when its CLI or its desktop app is there; when both are, their versions are shown separately. A settings folder with no CLI or app beside it (left behind by an uninstall, say) doesn't count, and a CLI is looked for wherever your terminal finds it, including folders that nvm, bun and the like add to your PATH. Each harness has its own page with tabs for Skills, MCP servers, Agents, Instructions, Plugins and About, and you can manage that tool's items there directly. Only the tools you have are shown anywhere in the app. pi-gui, a third-party desktop app for Pi, counts as Pi's app. Under the cards, **Also on this Mac** names T3 Code and VS Code when they are installed: they are no tool of their own, but T3 Code starts your tools, and VS Code's built-in Copilot lists skills from their folders.

### Skills, MCP servers and Agents

Each of these pages holds the managed table: one row per item, one column per tool. Nothing is managed until you choose it.

- **Managed** switch: a managed item keeps one copy in every tool it syncs to. Unmanaged items are left alone.
- **Tool cells** are toggles. Green check: synced. Blue: waits for Apply all. Amber: copies differ. Ring: has a copy that is not synced. Empty: no copy. Hatched: that tool cannot load it, with the reason.
- **Column menus**: add all of one tool's items to another tool, or **Stop syncing here** (copies stay).
- **Manage all** queues every unmanaged item without differing copies. Changes wait for **Apply all**, or **Discard**.
- **Copies differ**: open the row and choose which tool's copy every tool uses, or keep both as they are.
- **Catch-up**: opening a home or **Refresh** copies a managed item back into a tool it syncs to that lacks it.

Skills also have, per tool and for any skill, managed or not:

- **Disable / Enable**, with the tool's own switch: Claude Code `skillOverrides`, Copilot `disabledSkills`, Codex `[[skills.config]]` by path, Pi's `settings.json` filter, OpenCode a `deny` rule for the skill's name in its settings file. Disable is best effort: it is offered whatever the tool's version, written and then read back. On a build older than the one it was checked on, a short note says it may not take effect.
- **Remove** takes that tool's copy out. History keeps it for Restore.
- **Delete everywhere** (unmanaged skills) removes every copy Central Knot may change, kept in History.

OpenCode loads Claude Code's skills folder and `~/.agents/skills` as well as its own. A skill in Claude Code's folder is Claude Code's copy, which OpenCode reads: its box carries a link mark, both rows say so, no second copy is written for it, and it never stands in the way of choosing between differing copies. Disable works on it; Remove is offered only for a copy in OpenCode's own folder, and says when OpenCode still reads Claude Code's. If Claude Code is left out of a managed skill, or its copy is removed, OpenCode gets that copy as its own first; removing an unmanaged one says OpenCode no longer has it. OpenCode settings with a `"*"` rule written after `skill` in `permission` are not edited (that rule decides for every skill), and Disable says so. OpenCode 1.x leaves out a skill with no `name` in its frontmatter, so such a skill is marked as one OpenCode can't load.

MCP servers: each tool's user-wide file (Claude Code `~/.claude.json`, Copilot `mcp-config.json`, Codex `config.toml`, Pi `mcp.json`, OpenCode `opencode.json`, or `opencode.jsonc` when there is one). Writes edit only that server's entry. Claude Code's file is written only by **Write to Claude Code**, which waits while Claude Code, Claude desktop or its Code tab is open. Codex servers written inline or with dotted keys are left alone. OpenCode's servers are read from both places its settings keep them (`mcp` and `mcp.servers`); an entry is changed where it is, a new one goes under `mcp`, and comments in the file stay. Open a server to **disable or enable** it in one tool, with that tool's own switch (the table under Profiles); its entry stays, and History has the Undo.

Agents: Claude Code `~/.claude/agents`, Copilot `~/.copilot/agents`, Codex `~/.codex/agents`, OpenCode `~/.config/opencode/agents`. Name, description and prompt sync. A tool that lacks the origin's other fields gets the agent **With limits**, one way: changes there stay there. An agent new to OpenCode is written with `mode: all`, so both of OpenCode's lines offer it to choose and to hand work to. Pi has no agents; **Convert to skill** writes one as a Pi skill, once.

Copies are written only into each tool's own folder, byte-exact with file modes, without nested `.git` or `.DS_Store`. Central Knot never writes through a link or into a folder other tools share, such as `~/.agents/skills`.

### Two-way sync

- **Automatic sync** (status bar switch, on by default): a managed item edited in one tool spreads to the others within seconds. A deletion spreads after a 2 s settle. Competing skill edits are decided by the newest action, or the fixed order Copilot, Claude Code, Codex, Pi, OpenCode when the order can't be proved. Competing MCP server and agent edits always use that fixed order. Each outcome shows a notice with Undo or Restore.
- With Automatic sync off, edits and deletions are noted as waiting, and **Sync once** spreads them once.
- A folder or file that can't be read, is half-written or was reset is held, never read as a deletion. Every write checks the file first and never overwrites a save made meanwhile.
- Closing the window keeps Central Knot syncing, and updating plugins (see Plugins). On a Mac it then leaves the Dock and runs from its menu bar icon alone, until the window is opened again. The menu bar icon has Open, Settings, the profile, Automatic sync, Sync once (while Automatic sync is off), Start at sign-in and Quit.

### Instructions

Opens each tool's own instruction file to read and edit in place, with **Undo save**. OpenCode's card says when OpenCode 1.x is reading Claude Code's `CLAUDE.md` because it has no `AGENTS.md` yet.

**Base instructions**: you write a base once and choose which tools get it. It is added after each tool's own instructions as one marked block; the tool's own text is never rewritten. Every write is reviewed first (**Review changes**), a copy edited outside the app is found, and each save can be undone. A typed draft is not lost when you switch homes: the app asks first.

**Draft with a tool**: instead of writing the base yourself, have one of your tools write a first draft from the instruction files you already have. Choose the tool (any with a CLI on this computer, except OpenCode); it runs once and sorts your files into a base for every tool and what stays only in each tool's file. You see the draft, including any line it did not carry over as written, and can change it; one **Save** then sets the base and updates every file, with **Undo**. Nothing is saved before that.

### Plugins

- **Marketplaces**: add one by Git URL, `owner/repo` or folder. A Git address is checked (`git ls-remote`) before it is added. Claude-format and Codex marketplaces (including `.agents/plugins/marketplace.json`) are read.
- **Suggested**: a marketplace from the maker of each plugin tool you have is offered under the list, with **Add**: Anthropic's `claude-plugins-official` for Claude Code and Codex, GitHub's `copilot-plugins` for Copilot CLI. One is offered only where its tool is installed and nothing lists it yet; nothing is fetched until you add it, adding installs nothing, and the × beside one stops it being offered (with Undo). A custom build that carries its own marketplace suggests none.
- Each plugin shows its parts (skills, MCP servers, agents and more), what each tool gets from them, its skill text, and each tool's installed version next to the marketplace's.
- **Install and uninstall** run through each tool's own plugin commands, and count only when that tool's own record shows the result. Nothing runs until **Apply all**.
- **Parts** for a tool that can't take the whole plugin (Pi and OpenCode always): the plugin's skills, MCP servers and agents go in as ordinary items. They are removed together, can be undone, and show **Update parts** when the plugin changes. Under **What it holds**, each part has a switch per such tool, so you can put in only the ones you want; a part turned off stays out when the parts are updated. Claude Code has no switch for one skill of a plugin, so with the plugin not installed there, the same switches put single skills into Claude Code as separate items.
- **One item, however a tool has it**: on Skills, MCP servers and Agents, a tool that has an item through the plugin itself shows **Through a plugin** (the box opens the plugin's page) rather than "No copy", and sync never places a separate copy beside the plugin's. This applies to items Central Knot installed elsewhere as that plugin's parts and to skills whose SKILL.md is the same; another item that only shares the name stays an ordinary item.
- **What plugins bring, on the pages**: Skills, MCP servers and Agents also list every skill, server and agent an installed plugin brings, in a **From plugins** section, each marked with the plugin's icon and "from <plugin>". They are read from each tool's own records, so a plugin installed with the tool's own command counts too. They are never managed or synced there; their row says where they are handled. A **From plugins** filter shows only these.
- **Per-skill switch**: turn off one skill of an installed plugin in Codex or Copilot CLI.
- **Update**: where a tool has an older version than the marketplace, the plugin box, list row and plugin page offer Update (**Update all** for a marketplace with two or more behind). Each tool refreshes its copy of the marketplace and updates through its own command. An update can't be undone, and the result says so. A plugin turned off in a tool is still off after its update.
- **Updates that arrive by themselves**: every four hours, with the window closed too, Central Knot reads your marketplaces again and makes the updates that Update all would offer, through each tool's own command. It only updates what a tool already has: a plugin turned off stays off, one you uninstalled from a tool is not put back, and parts in a tool that can't take the whole plugin are updated with the parts you turned off left out. A note on the Plugins page says which plugins were updated in which tools and what couldn't be; a failed update is tried again, less often each time, and the log has each step. It is on unless you turn off **Update plugins automatically** in Settings, and it pauses while Automatic sync is off. **Check now** in Settings runs a check at once.
- **No longer offered**: a plugin its marketplace has dropped stays installed as it is, marked "No longer offered", until you uninstall it.
- **Cowork**: where Claude desktop is installed, Claude Code's card and each plugin's page say that Cowork uses the plugins in your Claude account, so Central Knot doesn't install there; plugins for Cowork are added in Claude desktop, under Customize › Plugins (as Claude documents; not tried here). (When this was tried on Claude desktop 5.1231.0, a plugin put into Cowork's folder on the computer was listed by Claude desktop, but the new Cowork session, which ran in the cloud, didn't load it: `docs/capability-data.md`, section 7.)
- **Desktop apps without a CLI**: Claude desktop (its Code tab), the GitHub Copilot app and ChatGPT desktop each carry their own copy of the tool. With no CLI installed, Central Knot runs the plugin commands through that copy, and the plugin box says which route it uses. A CLI is used when one is installed. If the app's copy isn't on disk yet (for example, the Code tab has never been opened), the plugin's parts are offered instead. macOS app locations only.

### Profiles

A profile is a named set of skills and MCP servers to have on, such as *Incident* or *Development*. Switching to one, from the Profiles page, the status bar or the menu bar icon's **Profile** menu, turns off what it leaves out with each tool's own switch and turns back on what an earlier switch turned off. Nothing is moved or deleted.

| Tool | Skill switch | MCP server switch |
|---|---|---|
| Claude Code | `skillOverrides` in `~/.claude/settings.json` | `deniedMcpServers` in `~/.claude/settings.json` (never `~/.claude.json`) |
| Copilot CLI | `disabledSkills` in `~/.copilot/settings.json` | `disabledMcpServers` in the same file |
| Codex | `[[skills.config]]` by path in `config.toml` | `enabled = false` in the server's table |
| Pi | a `-skills/…` filter in `settings.json` | `"enabled": false` in `mcp.json` |
| OpenCode | `"<name>": "deny"` under `permission.skill` in `opencode.json` | `"enabled": false` on the server's entry in `opencode.json` (`"disabled": true` for one under `mcp.servers`) |

- A switch is one History row, and **Undo switch** puts back what it changed.
- A skill or server you disabled by hand stays off; profiles only turn back on what a profile turned off.
- A managed item a profile turned off still receives edits. Profiles never change Managed.
- Agents have no off switch in any tool, so they are not in profiles. Profiles are kept in `.central-knot/profiles.json`. A switch takes effect from each tool's next session.

### History

Lists what Central Knot and sync did, with **Undo** or **Restore**. Every replaced or removed version is kept first in `.central-knot/` (skills, agent files and each tool's own MCP settings). Undo says what it could not put back. History keeps things for 30 days by default; Settings offers 7, 30 or 90.

### Git repo

Keeps the Managed set (skills, MCP servers, agents and base instructions) in a git repo on GitHub, GitLab or any git remote. Connect with a repo address and an optional branch; Central Knot uses this computer's own git sign-in. Nothing moves until you click **Pull** or **Push**. Pull brings the repo's changes into your tools through the normal sync, so each one is in History with Undo. Push makes one commit of the Managed set. The page lists what would come in and what would go out, and the sidebar shows the counts. The repo layout is `skills/<folder>/`, `mcp/<name>.json`, `agents/<name>.md` and `instructions/base.md`; other files in the repo are left alone.

### Settings

Start at sign-in, Appearance (System, Light or Dark), Updates, Update plugins automatically (with Check now and what the last check came to), Keep history for (7, 30 or 90 days) and Show log file.

### Updates

The Mac app updates itself from this project's [GitHub releases](https://github.com/njfife/central-knot/releases). Shortly after it opens, and every few hours while it runs (window closed too), it asks GitHub's public API for the releases; nothing about you is sent. When there is a newer one, the version at the bottom right becomes **Update to …**: one click downloads it, shows progress, and restarts into it. If an instructions draft isn't saved or changes wait for Apply all, it waits and the button says **Restart to update**. It never restarts during a write. Afterwards the status bar says once which version is now running, with its release notes.

A build made from a preview is offered newer previews and finals; one made from a final release, finals only. The new app must be signed by the same developer before it replaces the old one (Electron's Squirrel.Mac checks this), and a failed or interrupted update leaves the installed app as it was. Settings › **Updates** shows the version and release tag in use, **Check now** and the last result. An app outside the Applications folder (or `~/Applications`), an unsigned or untagged build and a development build don't update themselves; Settings says why and links the release page. Windows and Linux have no releases yet, so nothing is shown there. **Check for Updates…** is in the app menu.

## Custom builds

A custom build is Central Knot made by someone for their own group, under its own name. It installs beside the standard app and keeps its own settings (`~/Library/Application Support/com.centralknot.custom.<its id>/` on a Mac), so the two never share or overwrite each other's settings, and it never takes the standard app's updates. Settings › **This build** says what it is.

A **bundled build** also carries a marketplace, with every plugin's files inside the app. Whoever opens it needs no access to where the marketplace came from:

- **Plugins** lists that marketplace first, marked **Built in**, under the name and picture the build gave it. Its About tab says which release of the marketplace this is. It can't be removed from the list.
- At the first open the build unpacks the marketplace into its own data folder (`bundled/marketplace` there). That folder is an ordinary folder marketplace from then on: its plugins are browsed, installed, updated and uninstalled the same way as any other's.
- A plugin the marketplace lists but the build could not pack (an npm package, say, or a repository that could not be fetched) is still listed, says that it can't be installed from this app and why (About has the reason, and who to ask).
- **In your tools' own plugin lists.** The first time it opens this Mac's home, the build adds its marketplace to the own plugin list of each tool found here that takes plugins (Claude Code, Copilot CLI, Codex), with that tool's own command, so the plugins also show there. It installs nothing, and the status bar says so and which tools. This is the one thing a bundled build changes without being asked. Each tool is given it once: take it out in a tool and it stays out, until **List in …** on the marketplace's About tab puts it back. A tool installed later gets it the next time the home is read. A tool that already has a different marketplace under the same name is left alone, and so is a folder opened as a home. The About tab says which tools list it, and that the app added it.
- **Newer plugins without a new app.** A build made with a feed (`--feed`) looks at that address shortly after it opens and every few hours while it runs, window closed too. When a newer release of the marketplace is published there, the app downloads it, checks it against its manifest and puts it in use, and the status bar says so. Claude Code and Copilot CLI load a folder marketplace's plugins from the folder, so they have the new ones at their next session; a tool that keeps its own copy (Codex) shows **Update** on the Plugins page, as for any marketplace. The marketplace's About tab says when the feed was last looked at and has **Check now**.
- A release that can't be read, downloaded whole or unpacked changes nothing: the plugins in use stay, About says why, and the app looks again in a quarter of an hour. A release that names a newer app than this one waits until the app is that new.
- A plugin a release no longer offers stays, files and entry, while a tool on this Mac has it installed: its row says **No longer offered**, its page says it stays in the tools that have it, and it can be uninstalled but not installed anywhere else. (Without that, Claude Code stops loading an installed plugin the moment its marketplace no longer lists it.) The first release after it is uninstalled leaves it out.
- A later build that carries a newer release of the marketplace replaces the unpacked one at its first open, keeping such plugins the same way. An older one never does. A release that can't be unpacked leaves the last working one in place, and the log says why.

**One build syncs a home at a time.** A custom build and the standard app can both be on one Mac and open one home, but skills, MCP servers and agents are kept in sync by one of them: the one that managed something there first, until another is told to take over. The other one names it on Overview, Skills, MCP servers and Agents (and whether it is open now), changes nothing there, and offers **Take over syncing**. Taking over starts nothing again: the record of what is managed, every choice and History live in the home (`.central-knot/`), so the new owner carries on from exactly where the other left it, and the other stops at its next look and offers the same button. Syncing never changes hands by itself. Plugins are each build's own business either way: both install, update and list their marketplaces as before, and an instruction file can still be saved from either.

Not there yet: a custom build's own updates (it says so in Settings).

## State

Central Knot's state lives in one folder, `.central-knot/` inside the selected home: `sync.json`, kept revisions under `items/`, profiles and base instructions. There is no second copy. A damaged, missing, newer, replaced or differently owned record stops writes and deletes nothing. App settings (home, appearance, history length) and the log are in the normal Electron app data folder (`~/Library/Application Support/central-knot/` on a Mac).

## Not here yet

Windows and Linux real-home writes and desktop app locations, installing a plugin into Cowork (the one Cowork session tried had only the Claude account's plugins, see Plugins), and a plugin installed through a desktop app shown loading in a signed-in session. For OpenCode: its own (npm) plugins, Disable for one agent, agents kept in the older `agent` folder, and writing a draft of the base instructions. Nothing here claims an item has loaded in a session: Written means the bytes are on disk.

## For developers

Node 24.9 or newer.

```sh
npm ci
npm start            # dev build, opens the Practice copy
npm test             # TypeScript check and unit tests (tests/*.test.ts)
```

- **End to end:** `npm run e2e` (`scripts/e2e.mjs`) drives the app over its debug port in a throwaway HOME. `--electron` runs the dev build instead of the packaged app; on Linux add `--no-sandbox` and run it under `xvfb-run`. `--flows openCodeFlow,…` runs only the named flows while working on one.
- **UI tour:** `node scripts/ui-tour.mjs <outDir> [--electron]` is the light tour: the app opens on the Practice copy and each page is opened once, one picture each, in a few seconds. `--only shell,skills,…` takes the pictures of the named features; `--full` takes every feature at 860×560 up to 2560×1440, dark and light (about ten minutes, for a new release).
- **Harness tests:** `npm run test:harness` installs, updates and uninstalls a marker plugin with the real `claude`, `copilot` and `codex` CLIs in disposable homes (a missing one is skipped), checks that a plugin turned off stays off through an update and that one its marketplace dropped keeps its copy, and takes a bundled build's marketplace through being packed, unpacked, added to each tool's own list, installed and uninstalled. `CK_HARNESS_APPS=1` runs the same tests through the copy each desktop app carries.
- **Smoke:** `npm run smoke:mac` opens a hidden window on fixture data only.
- **CI:** `.github/workflows/mac.yml` runs the unit tests, packages the app, then runs the light tour (its pictures are the run's `light-tour` download) and the end-to-end checks against the packaged app. It runs on every push to `next`, and on any pushed branch with `gh workflow run mac.yml --ref <branch>`.

### Packaging and release

`npm run package:mac` (`scripts/package-mac.mjs`) builds the app on an Apple silicon Mac and puts it in two downloads under `release/`: `Central-Knot-<version>-mac-arm64.dmg`, a disk image whose window shows the app beside a shortcut to Applications, and `Central-Knot-<version>-mac-arm64.zip`. It signs with the Mac's Developer ID Application certificate and notarizes through the `central-knot-notary` keychain profile when both are there; otherwise, or with `CK_SIGN=0`, it signs ad hoc. The disk image is signed, notarized and stapled the same way, in its own right. `npm run package:mac:release` never falls back to ad hoc. The version comes from `package.json`. The release tag is recorded in the app (`build-info.json`) from the highest version tag on the commit being built (`v0.5.0-preview.5`), or `CK_RELEASE_TAG`; a release build refuses to package without one, and an untagged build never offers updates. Each release must carry both downloads: the disk image is for people, and the zip, named `Central-Knot-<version>-mac-arm64.zip`, is what the app's own updater downloads. `node scripts/update-proof.mjs` proves an update between two signed test builds in throwaway folders (instructions at its top).

The disk image is made by `scripts/mac-dmg.mjs`. Its window's picture is `assets/dmg/background.svg`, kept as PNGs at both sizes beside it; the window's size and icon places are in `assets/dmg/DS_Store`, which `scripts/mac-dmg-layout.sh` makes again on a Mac after a layout change. Releases are published on GitHub with their checks in the release notes.

### Building a custom build

The same packaging command takes optional inputs. With none it builds the standard app; with any, a custom build, which must be given its name (`--app-name`):

```sh
npm run package:mac -- --marketplace acme/plugins --app-name "Acme Knot" \
  --app-icon acme.png --marketplace-name "Acme plugins" --marketplace-logo acme-plugins.svg
```

| Input | What it sets |
|---|---|
| `--marketplace <owner/repo, Git URL or folder>` | The marketplace to carry. A Git source is fetched with this computer's own Git sign-in; a folder is carried as it is on disk, uncommitted changes included. Every plugin's files are packed, including plugins the marketplace keeps in other Git repositories. |
| `--app-name "<name>"` | The app's name, everywhere the app says it. Required, and never "Central Knot": under its own name the app sits beside the standard one in Applications, where a second "Central Knot" would take the standard app's place. |
| `--app-id <id>` | Its identity: its bundle id is `com.centralknot.custom.<id>`, which also names its settings folder. Made from the app's name when left out ("Acme Knot" is `acme-knot`). |
| `--app-icon <file.png or file.icns>` | The app's icon (a 1024 by 1024 .png, or a Mac .icns), also shown in the sidebar. |
| `--marketplace-name "<name>"` | The marketplace's name in the app. The tools still know it by the name in its `marketplace.json`. |
| `--marketplace-logo <file.png, .svg or .jpg>` | Its picture in the app. |
| `--feed <http or https address>` | Where newer releases of the marketplace will be published: the address of a folder (below). Needs `--marketplace`, the release the build starts with. Without it the marketplace changes only with a new build. |
| `--sequence <number>` | The release's place in the order of releases. Left out, it is the time of the build (seconds since 1970, about 1.8 billion now), so a later build is a later release. A number given by hand must be higher than every earlier build's, that default included: an installed copy keeps the content it has when the build it opens carries a lower number, and its log says so. |

The result is `release/<Name>-darwin-arm64/<Name>.app`, its zip `release/<Name>-<version>-mac-arm64.zip`, and `release/<Name>-build-report.txt`. The report lists the identity, the marketplace release (what it was made from, with the commit when there is one), each plugin packed, each plugin that could **not** be packed with the reason, a note when one entry makes Copilot CLI refuse the whole marketplace (an npm, pip or archive plugin does), the feed's address or that there is none, and that the build has no update location. A plugin that can't be packed doesn't stop the build. A missing `--app-name`, marketplace branding without `--marketplace`, or an input that can't be read stops it before anything is fetched. Signing is as for the standard app: your own Developer ID when one is in the keychain, otherwise (or with `CK_SIGN=0`) ad hoc. A custom build has no disk image yet.

What is packed is the marketplace as it is, without the fetch's own `.git` folders. A plugin kept in another repository is copied into `_bundled/<plugin>/` and its entry in `marketplace.json` pointed there; that file is then written again as JSON with every other value as it was, and a marketplace with no such plugin is carried byte for byte. What Central Knot writes outside the app (the markers around base instructions in a tool's file, a Git repo commit's author and message) says "Central Knot" in every build, so a custom build and the standard app read each other's. Inside the app the release is two files, `dist/bundle/release.json` (the manifest: marketplace, sequence, date, source, plugins, the archive's size and SHA-256) and one `.tgz` archive (`src/bundle.ts`, `src/bundlepack.ts`).

### Publishing newer plugins to a feed

A feed is a folder served over http or https that holds two files: `release.json` (the manifest) and the archive it names. Any static web server, bucket or file share behind a web address does; the app signs in to nothing, so who can reach the address is for whoever hosts it. To publish a new release of the marketplace:

```sh
node scripts/publish-bundle.mjs --marketplace acme/plugins --out ./feed
```

It packs the marketplace exactly as the build does and writes the archive, then `release.json`, into `--out`. Serve that folder at the build's `--feed` address; when copying it to a server, copy the archive before `release.json`. The earlier archive is no longer needed. `--sequence <number>` sets the release's place in the order (default: the time it is made) and `--min-app <version>` the oldest app that can use it.

- Nothing is published, and the command exits 1, when the marketplace can't be read, when a plugin's files couldn't be fetched this time (try again: a release never loses a plugin to a network hiccup), when the sequence isn't higher than the one already in `--out`, or when `--out` holds another marketplace's releases.
- A plugin that can never be packed (an npm or pip package) doesn't stop it: it is left out and named in what the command prints, and copies of it that people have installed stay as they are.
- What it prints also names each plugin the release no longer lists.

- **Try one without packaging:** `node scripts/custom-build.mjs <inputs> --out build/custom` stages the build on any system, then `CK_CUSTOM_BUILD=build/custom npm start` runs it. A plain `npm run build` makes `dist/` the standard app again.
- **Check:** `node scripts/bundled-check.mjs` builds a bundled build from the fixture marketplace with the documented command, deletes the marketplace, opens the packaged app in a throwaway home and checks its name, its own settings folder, the marketplace added to each tool's own list (stand-ins for the tools' CLIs record what they were asked), the Plugins page at four window sizes, Settings, and the feed: a release published to a folder served on this computer is taken, a plugin it no longer offers stays while a tool has it, and a broken publish changes nothing (`--electron` does the same as a development run; adding to the tools is checked on a Mac only, where the home can be written). The Mac CI runs it after the end-to-end checks.

### Logo

The logo files are in `assets/`: `logo.svg` (the sidebar mark, copied into `dist/` by `scripts/build.mjs`), `icon.icns` (the Mac app icon, used by `scripts/package-mac.mjs`), `icon.png` (the window icon on Windows and Linux) and `icon.svg` (the app icon drawing). A custom build takes its app icon and sidebar mark from `--app-icon` (above). The menu bar icon is the same logo in one colour: its drawing is `assets/tray.svg`, and the 32-pixel PNG made from it is kept as text in `src/trayicon.ts`; a custom build keeps the standard menu bar icon for now.

The product boundary is in `AGENTS.md`. The requirements are in `docs/SPEC.md` and the per-tool evidence in `docs/capability-data.md`. `LEDGER.md` records what was run and every check round.
