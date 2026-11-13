# Implementation ledger

Nathan authorized slice 1a, fresh source at `~/code/central-knot-next`, fresh `next` history in `njfife/central-knot`, existing Mac CI, deletion of old GitHub branches/tags, and removal of the old Mac checkout. On November 7, 2026 he said he could not validate 1a, asked for the best validation possible and to move on to the next steps. This was taken as the plan's proposed next step: 1b's first checkpoint and 8a's Preview and First copy. He then accepted one sync location with no second copy, which opened real-home Start on the Mac, and asked for the interface to be rebuilt to match the old design with nothing taken from its code.

| Batch or release | Package hash and arrival with source commit, or record path | Evidence list or record path | Decision | Provisional choices; new persistent state and reason | Unmet named |
| --- | --- | --- | --- | --- | --- |
| Read-only package: 1a | Mac-built `Central-Knot-0.1.0-mac-arm64.zip`, SHA-256 `e94c76341815e22330e2b5a71e1aa691f382d75c51921d2835754bbd90626662`; app source `d36da31c9b5fb7488e08ff7fe5b42f3c2e890d46`; copied directly to T3, not downloaded through a browser | 11/11 fixture tests and TypeScript pass on Mac and Linux at that app source; 11/11 also pass under Finder-like PATH on Linux; Mac packaging and packaged fixture renderer pass under Finder-like PATH, two fixture rows; CI run `42173525787` passes on `ck-mac-ci` at `9d7054156901608eb352dc4fadd32df31c274cf8` (only CI configuration changed from app source) | 1a authorized; Nathan’s Finder try, row/stack acceptance and next decision pending | Electron/TypeScript, Claude Code CLI skills only; no product persistent state; normal Electron app data only | Actual-home comparison and normal Finder/ordinary-download opening not run; all V gates and later outcomes remain open; GitHub artifact hosting unavailable at account quota |
| First safe copy, disposable homes: 1b.1, 8a Preview and First copy | Mac-built `Central-Knot-0.2.0-mac-arm64.zip`, SHA-256 `92c77377aecb090c7b4d84d626c72ec7f798cd3f9a7383fe1f46d71cc5724b4b`; source `7162e7c3ff7b3f848cbb10737b4342b91197cfdb`; copied directly to T3 | 34/34 tests on Mac and Linux; CI run `42326917536` passes; end-to-end list below | Nathan’s recovery answer and his try pending | Sync record and imported revisions in `.central-knot/` inside a disposable home only; app settings file `sharing-settings.json` in normal app data; both needed by section 3 | Any real-home write; session use on either CLI; a normal Finder or ordinary-download opening (V-10); section 7's AT-48 choice parts and everything after First copy |
| User alpha 0.3.0: real-home First copy on macOS; rebuilt interface | Mac-built `Central-Knot-0.3.0-mac-arm64.zip`, SHA-256 `407b81c6e29c7ec5775d249a5ebe7da320b75f406c5d000b30410e227f5074fe`; source `269c2bcd1437c59af19d199a9b3d044236892fb9`; copied directly to T3 | 40/40 tests on Mac and Linux; CI run `42336167703` passes; real-home run below | Recovery: one location, no second copy, accepted by Nathan November 7, 2026. His own try pending | Real sync state at `~/.central-knot`, created only by Start; removed after the agent's test | AT-62(f) owner restore and AT-62(g) overwritten-record rollback, by that decision; a normal Finder or ordinary-download opening (V-10); section 8a's Continuation and everything after |
| Validation pass, 0.3.0 rebuilt | Mac-built `Central-Knot-0.3.0-mac-arm64.zip`, SHA-256 `c56d74d01dec368ce506bfe91b7d0f259c38e1f3dc2e0dc97bb88f1ad37d2bb5`; source `5b2e23c7b075970dd2c4ac05c9fb7620992a0cfe`; replaces the earlier 0.3.0 package | 75/75 tests on Mac and Linux; `scripts/e2e.mjs` 3 Mac runs, 1 Linux run; CI run `42342080955` passes, including the end-to-end test | Nathan said go; his try pending | Stages sit beside the skills folder, or in `.central-knot/staging` if that is read-only | Session use in Claude Code; real windows, Finder double-click, the native file picker and the Gatekeeper dialog; progress during long copies; every later batch |
| Managed Overview (0.3.0, rebuilt) | Mac-built `Central-Knot-0.3.0-mac-arm64.zip`, SHA-256 `3170b0f51805060f07ac1dfc182066df322448d86ef51df337fa849fadc7d6ac`; source `8b40ec86578bcc2b6122ea2f2350d565b3ef18f4` | 94/94 tests on Mac and Linux; `scripts/e2e.mjs` 280 checks on each of 2 Mac runs with 8 force-kills, 55 on Linux; CI run `42506396623` passes | Design chosen by Nathan November 8, 2026 (option B with tool menus, Add all / Stop all, Managed / Unmanaged, Apply all); his try pending | Record items gain per-tool `off` and `separate` | Background sync while open, two-way edits, spreading deletions, Skills and Tools pages in the new design, session use, V-10 |

## Evidence and limits

- Fixture tests cover user-wide-only discovery, missing binary/folder, empty results, malformed metadata/version output, failed and hung version probes, relocated/unknown roots, permission restrictions, original content and file/mode preservation, linked skills and project exclusion. Only disposable fixture executables were invoked, with `--version`.
- The packaged arm64 executable ran `--smoke-test` with `PATH=/usr/bin:/bin` and disposable Electron data. It rendered two fixture skills and exited successfully. This is not a normal Finder launch, a real harness session or ordinary-download evidence.
- CI initially rejected unpinned actions under the existing SHA-pinning policy. Full commit pins fixed that without changing repository policy. The next run passed install/tests/package but failed the extra artifact upload at account quota. That optional upload was removed; the agreed install/test/package workflow now passes. No billing setting or unrelated artifact was changed.
- Cleanup verified: `next` is the default and sole branch, all 19 former branches are deleted, no tags remain, and `~/code/central-knot` is absent on the Mac. The registered `ck-mac-ci` runner remains online. This replaces published branch/tag history; it does not claim GitHub has physically purged retained objects or historical PR/run records.
- New source: `~/code/central-knot-next` on the Mac. The package is under its `release/` directory and at `/home/picoder/.t3/projects/central-knot/artifacts/1a/e94c7634/Central-Knot-0.1.0-mac-arm64.zip` in T3. No actual harness home was selected or probed by the agent.
- Next recommendation, not authorization: Nathan opens the package in Finder, checks the fixture, then chooses “This Mac’s home” for a read-only comparison with known Claude Code CLI skills. Only after that decision consider 1b’s Copilot CLI reader and First safe copy, or the already-proposed independent Cowork proof sitting; recovery and other named choices remain unanswered.

## Agent validation of 1a, November 7, 2026 (Nathan's try not run)

Run on the Mac over SSH as nathanielfife, from a fresh unzip of the package, launched with `open` (LaunchServices, launchd parent) with a debug port added, and driven by CDP. No person looked at it and no Finder double-click occurred.

- **Passed.** Bundled fixture showed 2 rows. This Mac's home showed Installed, version 2.1.309, 39 rows. All 39 match `~/.claude/skills` on disk, and all 39 appear in the skill list Claude Code itself reports at session start (it listed 57; the other 18 were not checked individually and are out of this slice's scope, such as plugin or built-in skills). The link note was correct on linked skills. Read again and returning to the fixture worked. Hashes of 3,515 harness config files were unchanged.
- **Defect found and repaired.** The package's signature was invalid (`code has no resources but signature indicates they must be present`), with identifier `Electron`. Packaging now re-signs ad hoc and verifies, so CI would catch a regression.
- **Open, V-10.** A copy carrying a simulated download quarantine flag does not run: the process stays at 0.01s CPU with no helpers and no window while a system dialog is up, on the 1a package. `spctl` still reports `rejected` for the repaired ad-hoc signature, and the repaired package was not opened under quarantine. The dialog's text could not be read over SSH, and whether a download through T3 adds the flag is unknown. That test's dialog may remain on the Mac's screen; it could not be dismissed over SSH.
- **Not run.** The Another folder dialog, and any look at the app by a person.

## Evidence for First safe copy

Fixture tests cover the Copilot reader; zero-write Preview; collision diff; identical and same-folder takeover; internal link held; `Review` versus `review`; bytes, modes and `.git`; zero-write repeat; Don't share; AT-27 skips and named losses; AT-34 skill parts; interrupted write before and after rename; linked root and dangling target; an occupied destination; Undo's rules; holds after sharing; section 3's stops and resume; the real-home write guard. Not tested on Windows.

End-to-end on the Mac, build `c9098e43…` (same source, differing from the final package only by the packaged README; the final package passed the packaged smoke test):

- **Practice copy.** Preview showed 2 to copy, 1 to decide and 1 identical. Start wrote 2 copies, and the collision was untouched. On that disposable home, real binaries listed the copies: `copilot skill list` (1.0.105) and Claude Code's session-start list (2.1.309). A repeat copied nothing. Undo removed both, and both lists returned to their prior contents. A Start after Undo copied nothing.
- **This Mac's home, preview only.** Claude Code 39, Copilot CLI 38 (all from `~/.agents/skills`). 38 Already shared, because Claude's entries link to that folder, and `sec-api` Will copy, which matches disk. Start was disabled, and direct Start and Undo calls to the main process were refused. Hashes of 3,515 harness config files were unchanged, and no `.central-knot` was created there.

**Limits.** Listed is not Loaded: no skill was used in a session, because neither CLI could sign in over SSH. A frontmatter `name` differing from its folder is not compared; identity uses the folder name, and Copilot CLI lists the frontmatter name.

**Next recommendation, not authorization.** Nathan answers the recovery question, then a package enables real-home Start on the Mac; its first real effect is copying `sec-api` to `~/.copilot/skills`. Phase 2's desktop proof sittings need Nathan's sign-ins and can run alongside.

## Evidence for 0.3.0, November 7, 2026

**Real home on the Mac, agent-run through the packaged UI.** Both CLIs detected as Installed. Their versions were not captured for this run: Claude Code was 2.1.309, and Copilot CLI read 1.0.105 on November 6 and 1.0.107 right after this run, so it updated itself somewhere in between. Start wrote one copy, `sec-api`, to `~/.copilot/skills`, byte-identical to its source by `diff -r`. No tracked config file changed (3,515 hashed; that set excludes `~/.copilot/skills`).

- **Exercised Real, one session.** In a Terminal window on the Mac, `copilot -p` limited to the skill tool loaded the copied skill and replied `SKILL-SEEN sec-api`, exit 0. Agent-run, not Nathan's session. The Terminal window may remain open. Claude Code as a receiver was not session-tested.
- **Undo.** Per-item Undo removed the copy. Its source and link were unchanged, imported bytes stayed, Copilot's listing no longer showed it, and a repeat Start did not recopy it.
- **Run error, corrected.** The first Undo attempt failed because the control sat in a folded group. That script continued and deleted the sync record while the copy remained. The copy was confirmed identical to its source and removed by hand, and the run was repeated with cleanup gated on each check.
- **Left behind.** Nothing: `~/.central-knot` and `~/.copilot/skills` were removed, the real home's entry in the app's settings was removed, and config hashes match the start. Nathan's first try is a genuine first setup. Normal app data at `~/Library/Application Support/central-knot` remains.

**Interface.** A separate agent wrote `docs/ui-reference.md` and its screenshots from the archive `central-knot-archive-2026-11-04.zip`. A second agent built from those alone and never opened the old code. Checked afterwards: the engine files are unchanged by the rebuild, there is no UI framework, and `src/style.css` shares no class or custom-property name with the old stylesheets. Dark and light were compared by screenshot, in `artifacts/ui-rebuild/` in the T3 project. Controls for unbuilt features were left out rather than shown inert.

**Known limits.** Undo the last Start marks every item in that Start Don't share, including those it did not copy, and Share does not exist yet, so on the real home it would lock 39 items. A per-item Undo control sits inside a folded group when that group is long. The rebuilt UI's Another folder dialog has not been driven. Windows and Linux have not been run.

**Validation gaps found November 7, 2026.** Claude Code CLI on the Mac reports `OAuth token revoked`, so it cannot run a session until someone signs in again. A Terminal window reaches the private fixture repository through `gh`; an SSH session cannot. Over SSH there is no screen capture or UI control, so native windows and dialogs are unverified. The end-to-end drivers so far were throwaway scripts, and CI runs only tests and packaging.

## Validation pass, November 7, 2026

**Repeatable test.** `npm run e2e` drives the real app in a throwaway HOME, so This Mac's home is disposable too: practice flow, real-home flow, stops and resume, and force-kills during copies (Mac only). It runs in Mac CI. To allow that, the runner's LaunchAgent lost `SessionCreate`, which gave it a separate session with no window access. Its prior plist is at `/Users/ck-ci/runner-plist-before-sessioncreate-removal.plist` on the Mac; restoring it undoes this and makes CI's end-to-end step fail.

**Results at the source above.** Mac: 155 to 157 checks passed across 3 runs, 0 failed; counts vary with how many skills each kill round leaves. Linux in Docker with a virtual display: 50 passed, with real-home writing refused as intended. Each Mac run's 8 kill rounds all interrupted a copy; none left a half-written skill visible.

**Stress, on the build before these fixes.** 1,000 skills: read 1.9 s, Start 19 s, Undo 5 s. One skill with a 20 MB SKILL.md and a 1.2 GB file: Start 13 s. A copy of this Mac's real skill folders with 2 planted conflicts: correct plan, conflicts untouched.

**Real home, rerun on the fixed engine, agent-run.** Start copied `sec-api` identically, Copilot CLI listed it, per-item Undo removed it, source and link were unchanged, and a repeat did not recopy. The Mac was then restored: no store, no `~/.copilot/skills`, 3,515 tracked hashes identical. No session was run in this rerun.

**Independent testing.** One agent filed 19 defects against the rebuilt UI. A second retested the fixes: 12 fixed, 7 partly, plus further defects. All confirmed ones were then repaired with regression tests or end-to-end checks, apart from the limits below. **That last round of repairs has not had an independent retest.**

Worst defects found and fixed: a failed home switch could leave Start writing to a home other than the one shown; Undo could delete a folder Start never created, or the only real copy once a skills root became a link; read-only folders broke Undo and later Starts; one unreadable file stopped a whole home; Written was shown for skills Copilot refuses; a crash could expose a half-written skill to Claude Code, which loads dot-folders.

**Known limits, not fixed.**
- Long copies show only "Copying…", with no count (UX-03).
- A skill whose frontmatter is valid only to Claude Code's parser, such as `description: Use when: x`, is a read problem here and is not listed, though Claude Code loads it.
- After a disk change outside the app, Overview stays stale until Read again.
- A SKILL.md that is itself a pipe, not a link to one, is skipped with no read problem.
- A removal that fails part-way moves the copy back, but anything already deleted stays deleted.
- Copilot's load rules were measured on 1.0.107, and it updates itself.

## Managed Overview, November 8, 2026

**Design.** Five rounds with three independent judges (Opus 5.5, GPT-6 Astra, Grok 4.7) reached 7, 7 and 6 out of 10; nothing reached the 8 target. Nathan then chose option B with per-tool header menus after reviewing variants. Prototype screenshots: `artifacts/ui-iteration/` in the T3 project.

**Engine.** `src/manage.ts`: what every tool has per skill, and one apply call that records Managed and per-tool choices, then copies managed skills where missing, and for differing copies replaces the others with the chosen one, keeping replaced bytes in the store. Opening a home or Read again runs it with no changes (catch-up). Writes go only into each tool's own skills folder, never through a link or into a shared folder such as `~/.agents/skills`.

**Independent testing.** One agent filed 10 defects against the first build. All 10 were fixed with unit or end-to-end checks: a second Copilot copy in `.agents` silently blocking sync; choosing a copy writing through links and into `.agents`, and changing permissions on a link's target; pending edits that disagreed with Apply all; an unfinishable "to sync"; Add all including held skills; focus lost after actions; lowercased names; a vanished chosen copy swapped silently; a copy Copilot refuses shown as normal; unclear wording. **These fixes have not had an independent retest.**

**Known limits.** Catch-up brings back a copy deleted in a tool that stays on (DEL-02 spreading deletions is not built); the band names what it copied. An edit in one tool shows as copies differ until someone chooses. With Find active, menu actions act on the rows shown.

## Prune and Skills page, November 8, 2026

**Fixes from Nathan's try.** Choosing a copy now previews as blue pending checks (the choice was skipped for managed skills), and the row shows a compact "<tool>'s copy" chip with an undo icon instead of the wrapping pill and text. An e2e check asserts the cells and that the name cell neither overflows nor wraps.

**Pruned.** The old Share panel, item panel, preview/Start/Undo engine, their IPC calls, row model and tests are gone (about 2,000 lines). Twelve guarantees that still apply were ported to `applyChanges` tests: bytes and modes copied with `.git` left out and a repeat changing no byte; internal links held; a non-skill folder never overwritten; unreadable folders get nothing; stuck stages cleared; `.DS_Store` no difference; odd names; every gate stop; lost-settings resume; the real-home write guard by every route; real-home relative override and absent tool; the practice fixture.

**Found by the port.** An apply with nothing to do rewrote `sync.json` (same content, new mtime), and catch-up runs on every read. The record is now saved only when it changes.

**Skills page.** Rebuilt on the managed facts: a list with a managed dot and one small cell per tool, beside the same details, copy choice, switch and Apply all as the Overview; pending changes are shared between the two pages. Tools page reads where new copies go from the manage view.

**Test fix.** The crash e2e's kill timings now spread across any round count; with 4 rounds every kill had landed before choices were saved, leaving nothing to catch up.

**Validation.** 49 unit tests. Mac e2e 293/293 with 8 crash rounds (also 4 rounds: 202/202), smoke pass, real home untouched; Linux Docker e2e 64/64.


## Break-it round 3, November 8, 2026

An independent tester filed 9 defects against the pruned build. All fixed:
1. **High:** a tool's skills folder that is a link (for example `~/.copilot/skills` → `~/.agents/skills`) was written through. Such a folder, or one that resolves to another tool's or the shared `.agents` folder, is now never written: new copies are "can't load" with the reason, differing copies there are reported, and the Tools page says "Nowhere" with why.
2. The page compared copies across every tool while Apply all compares only tools that sync and can load the skill, so a choice could show blue checks, do nothing, and leave "Copies differ" forever. The page now compares exactly as the engine does and offers only copies that count.
3. A skill that can't be managed no longer offers a copy choice; its pill no longer wraps.
4. A copy choice is put on record before any copy is replaced, so a crash part-way finishes it at the next pass; a choice whose copy changed since is held with "choose again".
5. Lost settings now show a Resume button even when nothing is waiting, and "Resume and apply all" when something is.
6. Undoing a copy choice puts Managed back as it was before the choice.
7. A pending change for a skill that vanished is dropped.
8. `/` focuses Find on the Skills page and Escape clears the Overview's Find; fixed IDs no longer share a prefix with per-skill IDs.
9. The record check now rejects a non-list `off`, unknown tools, bad copy status and a malformed choice. "Another folder…" inside the real `.claude`, `.copilot`, `.agents` or `.central-knot` is preview-only.

**Held up under test:** no-op reads change no byte, gate stops, crash recovery at 13 kill points, never overwriting non-skill folders, pending changes shared across pages, long and odd names.

**Validation.** 55 unit tests (6 new). Mac e2e 297/297 with 8 crash rounds, smoke pass, real home untouched; Linux Docker e2e 68/68.

## Re-check of round 3, and real-window checks, November 8, 2026

**Re-check.** A fresh tester confirmed fixes 3, 5 and 6, and found the rest incomplete. All gaps are now closed:
- **Folders not made yet.** A skills folder that does not exist yet was not checked. It is now followed to where it would land, through linked parents and overrides and case-folded on macOS, so `~/.copilot` linked to `~/.agents`, `COPILOT_HOME=~/.agents`, or two tools sharing one folder are refused. The folder is checked again just before every write.
- **Choices Apply all could not carry out.** The engine now tells the page, for each tool's copy, what would block it: a differing copy Central Knot does not change (such as one in `~/.agents/skills`), or a tool with a copy that could not load it (for example no frontmatter). Those choices are greyed out with the reason. A blocked, changed or vanished choice sent anyway changes nothing, not even Managed.
- **Choice tied to what was seen.** The page sends the chosen copy's content ID. A copy edited after it was chosen is held with "choose again", and the page drops a choice whose copy changed or vanished. "Choose again" from catch-up is now shown.
- **Linked `.central-knot` or `.agents`** in "Another folder…" is preview-only. The guard follows every folder the home would write, including ones not made yet.
- Detail cells no longer repeat ids. The record check also requires string start ids and absolute copy folders.

**Design question for Nathan.** Any linked skills folder is refused, including a private dotfiles link such as `~/.claude/skills` → `~/dotfiles/skills` that no other tool reads.

**Real-window checks** (Codex Computer Use on the Mac, through T3's linked environment):
- **Passed:** Finder double-click launch; copy choice row (chip, blue checks, name intact) and Discard; tool menu and Escape; Skills page details and `/`; Tools page; a window about 900 points wide; the native folder picker ("Choose a simulated home folder") opening a throwaway folder; Apply all writing `demo` there; Cmd+Q.
- **Gatekeeper:** a quarantined copy is rejected (`spctl: rejected`), as expected for an ad-hoc build; the dialog itself was not captured. Developer ID signing and notarization remain the fix.

**Validation.** 60 unit tests (5 new). Mac e2e 296/296 with 8 crash rounds, smoke pass, real home untouched; Linux Docker e2e 69/69.

## Codex skills, November 8, 2026

**Plan.** Nathan moved Codex CLI and the ChatGPT desktop app's Codex into Priority 1 for v1. Updated: SPEC I-18 and §5.1, CD §2, the product brief, and the plan (a new "Codex skills" batch after the managed engine; Codex's plugin route joins CLI plugins; ChatGPT desktop joins Desktop plugins; Other families keeps Pi, OpenCode and the rest of Codex).

**Measured** on codex-cli 0.142.3 through `codex app-server` `skills/list`, in a disposable `HOME` and `CODEX_HOME` with no sign-in:
- **Roots.** Codex lists `$CODEX_HOME/skills` and `~/.agents/skills`. It installs its own skills under `$CODEX_HOME/skills/.system`.
- **Refused:** no frontmatter; a missing, empty or non-text description; a name over 64 characters.
- **Skipped silently:** dot-folders and a symlinked `SKILL.md`.
- **Loaded:** no name (the folder is used), a name differing from the folder, uppercase, spaces and non-ASCII names, extra keys, long descriptions, nested group folders, a symlinked skill folder.
- **ChatGPT.app** (bundle `com.openai.codex`, 26.1103) carries its own `codex` at `Contents/Resources/codex-cli/bin/codex`.

**Built.**
- A `codex-cli` harness ("Codex", `CODEX_HOME`). It writes only `$CODEX_HOME/skills`; `~/.agents/skills` is read and never written, and `.system` is never listed or touched.
- Load rules as `codexProblem`, so a copy Codex would refuse is "can't load", with the reason.
- Detection through the CLI or ChatGPT desktop's bundled `codex`. The Tools page discloses that ChatGPT desktop reads the same folder.
- The practice copy now has a `.codex` with only a `.system` skill.

**Load proof (Exercised, listing only).** The engine managed a Claude skill into Codex in a throwaway home, and Codex's own `skills/list` returned it with no errors. A skill without a description was not written. A real Codex session turn and ChatGPT desktop use need Nathan's sign-in and are his try.

**Validation.** 64 unit tests (4 new). Mac e2e 302/302 with 8 crash rounds, including Codex receiving the same bytes as Copilot, nothing new in `.agents`, and `.system` untouched; smoke pass; real home untouched. Linux Docker e2e 72/72.

## CLI plugins: native route measurements, November 8, 2026

Disposable `HOME` (and `CODEX_HOME`, which must already exist or Codex refuses to run) on the Mac, no sign-in for any CLI: Claude Code 2.1.311, Copilot CLI 1.0.107, Codex 0.142.3. Marker: one Claude-format marketplace (`.claude-plugin/marketplace.json`) with one plugin holding one skill.

| | Claude Code | Copilot CLI | Codex |
| --- | --- | --- | --- |
| Add | `claude plugin marketplace add <src>` | `copilot plugin marketplace add <src>` | `codex plugin marketplace add <src>` |
| Install | `claude plugin install P@M --scope user` | `copilot plugin install P@M` | `codex plugin add P@M --json` (prints `installedPath`) |
| Record read for Installed | `~/.claude/plugins/installed_plugins.json` `plugins["P@M"][].installPath` | `~/.copilot/config.json` (leading `//` comment lines) `installedPlugins[].cache_path` | `config.toml` `[plugins."P@M"] enabled`, files at `plugins/cache/M/P/<version>` |
| Marketplace declared in | `settings.json` `extraKnownMarketplaces` (+ `known_marketplaces.json`) | `settings.json` `extraKnownMarketplaces` | `config.toml` `[marketplaces.M]` |
| Local folder source | `directory` source; copied to cache | **Live link: nothing copied**; uninstall only disables | `local` source; copied to cache |
| Git over smart HTTP (localhost fixture) | Works; copied to cache | Works (`git clone --depth 1`); copied to `installed-plugins/M/P` | Works; copied to cache |
| Git over dumb HTTP | Fails | Fails: no shallow support | Works |
| `git://` | Refused | Refused | Refused |
| Uninstall | `claude plugin uninstall P@M`: record cleared, **cached files left** | `copilot plugin uninstall P@M`: files and record removed | `codex plugin remove P@M --json`: config entry and cache removed |
| After uninstall | Marketplace declaration stays | Stays | Stays |

`scripts/git-http-fixture.mjs` serves bare repositories over smart HTTP on localhost (read-only), so tests can exercise the git route on all three with no GitHub, keys or credentials.

## CLI plugins slice (3a, 3b, 3c and Codex's route), November 8, 2026

**Built.** `src/plugins.ts` and a Plugins page.
- **Catalogs.** A Git marketplace is first checked with `git ls-remote`, with prompts off and a timeout (MKT-05: sign-in, no access, unknown SSH host, passphrase, network, Git missing, or the error as it is). It is then read from a fresh shallow clone with hooks off and no submodules, so nothing from it runs. A folder is read directly. The last fetched copy stays browsable, dated, when the source can't be reached (MKT-04).
- **Browse.** Marketplaces come from Central Knot's own list plus those each tool already has, with no setup. Each plugin shows its components and, per tool, the Appendix D outcome (for example Codex: agents ignored, root-variable MCP won't start). A plugin outside the marketplace folder is not read, so its components show as known only after install.
- **Copilot (MKT-06).** An npm, pip, archive or SCP-style plugin source makes Copilot refuse the whole marketplace, so Copilot is unavailable for it with that reason and nothing is added.
- **Install and Uninstall** run each CLI's own commands with a timeout, against the home on screen and only where writing is allowed. Installed means files at the path the tool records (PLG-03); a record without files is Not known yet. A different marketplace with the same name in a tool is never replaced (D-16). Prior and new bytes of every file the native command changed are kept per build and named in the report (FIL-03). Uninstall leaves the marketplace added, and the report says so. "Remove from list" forgets a marketplace in Central Knot only.
- **Codex.** Only a real Codex CLI is used; ChatGPT desktop's bundled copy never counts (CD §3), so a desktop-only person sees "Not known yet".

**Validation.**
- 74 unit tests (10 new), including the Git route through the localhost smart-HTTP fixture.
- `npm run test:harness` on the Mac with real Claude Code 2.1.311, Copilot CLI 1.0.107 and Codex 0.142.3: install from a Git marketplace, confirmed by each record, prior bytes kept, a repeat runs nothing, then uninstall; and Copilot's live folder case. 4/4.
- Mac e2e 309/309 with 8 crash rounds: adding a folder marketplace, per-tool cells, details, a refused install reported with the tool's exit code and never claimed, and Remove from list. Smoke pass; real home untouched.
- Linux: unit 74/74, e2e 79/79.

**Not yet.**
- A session pass: the marker plugin used in a new Claude Code, Copilot and Codex session needs sign-ins, so it is Nathan's try.
- Private-source (V-16) tries against his real Git hosts.
- Update and Disable controls belong to later slices.

## Add all, told apart (three implementers and a judge panel), November 8, 2026

Nathan saw "32 to add" from Copilot CLI to Claude Code, when most were identical copies that only needed managing. Three implementers worked in separate worktrees: A was GPT-6 Astra, B Claude Opus 5.5, C Grok 4.7. Three blind judges (the same three models) scored them. **B won 2–1**, with totals of B 121, A 117 and C 107 out of 150.

**B, as shipped.** Each target tool in a tool's menu shows its counts with the table's own cell marks: new, same, off here, synced and can't. Differing copies sit on their own line, "N different: use <source>'s copy", with a switch that is off by default. Turning it on adds them to the count and shows: "You accept <source>'s copy: on Apply all, every tool these sync to uses it. The differing copies in … are replaced; Central Knot's store keeps them." Drafts go through the same resolve, prior and seen path as choosing a copy by hand, so nothing is written until Apply all.

**Fixes the panel asked for, added on top of B:**
- A pair already syncing one copy stays "synced" even when a third tool differs. Before, adding Claude to Codex could replace Copilot's copy as a side effect.
- Managed skills with syncing turned off are counted as "off here", not "same".
- The planner moved to `src/addplan.ts`, and the copy rules to `src/syncrules.ts`, with 6 unit tests: the groups, a third-tool conflict, a conflict only elsewhere, a source or target that is off, blocked, held, unloadable and kept-separate skills, and blocks that don't apply.
- The menu scrolls past a height limit, for more tools.
- "Can't" opens a keyboard-reachable list of each skill and its reason, borrowed from A.
- The button says "Manage N" when nothing gets copied, borrowed from C.

**Validation.** 80 unit tests. Mac e2e 395/395 with 8 crash rounds, smoke pass. Linux e2e 86/86. Nathan's own real-home state (`talk-like-a-dork`, managed at 13:24) is unchanged.

## Two-way skills, checkpoint 1: spreading and resolving, November 8, 2026

A managed skill's record hash is its baseline. Each pass (opening a home, Read again, Apply all) now works like this:
- **An edit in one tool spreads** to every tool the skill syncs to. The replaced copies go to Central Knot's store.
- **Competing edits:** the newest the evidence proves wins (CON-01, CON-04). Each copy keeps an observation interval while the app runs: when it was last read at the baseline, and when a change there was first read. A revision is proved older when the other location was still read at the baseline after that change was seen. Otherwise the fixed tool order decides (Copilot, then Claude Code, then Codex, then path; D-04), and the notice says so.
- **Deletion (DEL-01, DEL-02):** a recorded copy missing from a reachable skills folder counts as deleted once it stays missing past a 2-second settle window. Until then nothing is deleted or recreated. A whole skills folder going missing counts as unreachable, not as a deletion. A deletion spreads and leaves a deletion record, so a copy turning up later is new and unmanaged, never a revival (D-37).
- **A deletion racing an edit:** with order unknown, the edit is kept and the deleted copy returns, with **Delete everywhere** on offer. With order proved, the newest wins.
- **Tracking:** copies are tracked only while their tool syncs the skill. A copy removed while the tool is off, or while the skill is unmanaged, is caught up later, never spread as a deletion. The e2e caught this; it would otherwise have deleted the skill everywhere.
- **History** (`.central-knot/history.json`, last 1,000 events) records each spread, resolution and deletion with its kept content. **Undo** applies the losing side as a new revision; **Restore** returns a deleted skill to every tool it syncs to (CON-02, DEL-03). A pass with nothing to do writes no history.
- **The page:** a notice band names each item, the winning action and its tool, and whether the order was proved, with Undo, Restore or Delete everywhere right there. A new History page lists every event.

**Not yet** (checkpoint 2 and later):
- background watching and polling, the Sync on/off switch and Sync now (SYN-03, SYN-04);
- the tray indicator when the window is closed (D-36);
- 30-day retention expiry (STO-04);
- rename and case-only rename.

**Validation.** 89 unit tests (10 new). Mac e2e 403/403 with 8 crash rounds, including, through the real app: an edit spreading and Undo, the settle window, a deletion spreading, History, and Restore. Smoke pass. Linux e2e 94/94. Nathan's real-home record is unchanged.

## Two-way skills, checkpoint 2: watching, polling and the Sync switch, November 8, 2026

- **Watching (SYN-04).** While the app is open, the main process watches each tool's skills folders (recursive `fs.watch`) and the shared `.agents/skills`, and also polls every 20 s (T-08: at most 30 s). An event only prompts a pass, after a 1.5 s debounce. A follow-up pass runs just after the settle window, so a deletion finishes without a click. Background passes go through the same queue as the page's requests. Their notices are held until the page next reads, and the page refreshes quietly when one changed something. Watchers and timers stop on quit.
- **Sync switch (SYN-03),** in the status bar, saved per build:
  - **Off:** passes only observe, keeping the ordering evidence and writing nothing. A banner says so and offers **Sync now** for one full pass. Edits waiting to spread show as pending blue, not as "Copies differ", and the Apply bar does not claim them.
  - **Explicit actions still run:** with Sync off, Apply all writes exactly the skills it shows, and nothing else rides along.
- **Proved order now happens in practice.** An edit observed while the other copy was still unchanged is the older one, and a later edit elsewhere wins with "order proved", even when the tie-break would have picked the other.

**Not yet:**
- a tray or menu-bar indicator for resolutions while the window is closed (D-36); the app quits with its window today, so nothing runs closed;
- 30-day retention expiry (STO-04);
- rename and case-only rename;
- a Code tab or Copilot app session check (AT-68).

**Validation.** 92 unit tests (3 new). Mac e2e 336/336 with 8 crash rounds, including, through the real app: an edit on disk spreading with no click, the page hearing of it, Sync off noting but not spreading, the pending display, and Sync now. Linux e2e 103/103, so watching works there too. Nathan's real-home record is unchanged.

## Two-way break-it round, November 8, 2026

An independent tester filed 13 defects against checkpoints 1 and 2. Fixed, each with a regression test:
1. **Case-only rename** (`Foo` → `foo`) deleted the skill everywhere. A recorded copy found under another spelling in the same folder, or with the same key in the same tool folder, is now the same copy.
2. **A deletion removed a different, never-synced copy** of the same name. Only recorded copies, or ones identical to the synced content, are removed; a different one stays, with a note.
3. **A read-only copy** (`.agents`, a linked folder) was recorded and later "won" back, reverting edits. Read-only copies outside the record are reported, never recorded or followed, and only copies holding the new content stay on record.
4. **A changed `CLAUDE_CONFIG_DIR`, `COPILOT_HOME` or `CODEX_HOME`** read as every skill deleted. Recorded copies outside a tool's current folders are let go.
5. **A skills folder reset to empty** deleted everything everywhere. A tool losing every managed skill at once (two or more) is now treated as a reset: they are put back, with a notice. Deleting is done with Delete everywhere, now also in each skill's details.
6. **Restore and Undo gaps:**
   - Restore refuses to overwrite a new skill with the old name.
   - Undo can't run twice.
   - Restore brings back the newest content a deletion removed, not the older baseline.
   - A Restore can itself be undone.
7. **Runaway background passes:** a follow-up ran every 2.5 s forever, and a failing write added about 50 History events a minute. Follow-ups now run only while a deletion is settling. A write that fails drops that copy from the record, so it is tried once, never repeated, and never reverts the others.
8. **Unreadable History was overwritten.** It is now moved aside as `history.unreadable-<time>.json`.
9. **A stale Apply all revived a deleted skill.** Changes now carry whether the page showed the skill managed, and are refused if that changed since.
10. **An edit kept over a deletion recreated a copy deleted moments ago.** Nothing is decided while any copy is still settling.
11. Turning a tool off and on while its deletion is settling brings the copy back. Left as is: turning a tool off is explicit, and its copies stop being tracked.
12. **Notices named the wrong tools.** A conflict names only the tools that competed, an edit names only the tools actually updated, and Delete everywhere is offered only when the order was not proved.
13. **A crash mid-replace** later read as a deletion. The copy is marked pending before the replace, so the next pass finishes it.

**Validation.** 104 unit tests (12 new). Mac e2e 412/412 with 8 crash rounds, smoke pass. Linux unit 104/104 and e2e 103/103. Nathan's real record is unchanged. A fresh re-check follows.

## Two-way re-check round, November 8, 2026

A fresh tester confirmed fixes 1 and 10, found 9 partly fixed, found 9 not fixed in practice, and filed 13 problems. The model changed:
- **Per-copy content.** Each recorded copy now remembers the content last seen or written there. A copy that differs from that was **edited**. One that still matches it but not the synced content is only **behind**: it catches up from the synced content (from the store if no tool holds it) and never wins as an edit. An unrecorded copy holding an earlier revision of the skill (a folder switched back, a copy that once failed) is adopted as behind, not treated as a collision. This fixes the stuck syncing after a failed write or a switched-back `*_HOME`, the linked skill whose source edits never spread, and copies wrongly called "never synced".
- **Resets by folder identity.** Each skills folder's identity (inode and creation time) is recorded after every pass. A folder deleted and made again, even while the app was closed, is a reset: its copies are put back, with a notice. Skills deleted inside the same folder are real deletions, even the last two. This replaces the "lost every managed skill at once" count. On filesystems with no creation time that reuse an inode, a reset done in place falls back to ordinary deletion semantics.

**Also fixed:**
- A crash during Undo or Restore: copies are marked pending first, so it is never read as a deletion.
- A stale Apply all in the app: a draft remembers whether the skill was managed when the change was first made. The engine refuses it if that no longer holds, and the page drops the draft when a background change touches the skill.
- Delete everywhere removes only the skill's own copies, and Restore prefers an unspread edit over behind copies.
- Removing the shared `.agents` folder is unreachable, not a deletion; reachability is checked on each copy's own folder.
- Restoring an old deletion is refused when the name is managed again with other content.
- History rows for a Restore have Undo.
- With Sync off, Apply all holds a skill with a pending edit or deletion instead of carrying it along.
- History of the wrong shape is moved aside.
- **Retention (STO-04):** History events older than 30 days are dropped, and store revisions no record, copy or retained event points at are removed.
- Delete everywhere asks for a confirming second click.

**Validation.** 114 unit tests (10 new). Mac e2e 337/337 with 8 crash rounds, now also checking through the app that a pending change can't revive a skill the background deleted. Linux unit 114/114 and e2e 107/107. Nathan's real record is unchanged.

## Real-home trial on the Mac, November 8, 2026

Nathan opened the Mac's real home for testing, real skills included. Before the trial, a backup was taken: `~/ck-real-backup-20261108-163144.tgz` (569 entries: `.claude/skills`, `.copilot/skills`, `.codex/skills`, `.agents/skills`, `.central-knot`), with Central Knot not running. The engine ran on the real home with the app's own identity and settings (build `com.centralknot.firstlook`), on a disposable skill `ck-trial`:
- **Catch-up:** nothing to do.
- **Manage:** copied into the real `~/.copilot/skills` and `~/.codex/skills`.
- **Edit in Copilot:** spread to Claude Code and Codex.
- **Competing edits in Claude Code and Codex:** Claude Code won by the fixed order, notice "unproved".
- **Deleted in Codex:** held during the settle window, then spread.
- **Restore, then Delete everywhere:** back in all three, then gone.
- **Quiet pass:** no writes.
- **Everything else unchanged:** 559 entries (Nathan's skills, the `.agents` links, the `.agents` folder) are byte-identical, mtimes included.

**Exercised Real, listing only:** a second disposable skill managed from Claude Code was listed by real Codex (`skills/list`: `~/.codex/skills/ck-trial-load`) and real Copilot CLI (`copilot skill list`). Delete everywhere then removed it. Session turns still need sign-ins.

## Two-way third check, November 8, 2026

**The verdict was "not safe yet".** It confirmed two permanent-loss paths, one deletion of a just-installed skill, and silent stuck sync. Fixed, each with a regression test (T1–T9, P8):
- **Nothing overwritten goes unreferenced.**
  - A competing edit that loses while a deletion races is now named in the `kept-edit` event.
  - A copy replaced by "use this copy" gets a `chosen` History event, which can be undone.
  - Hashes mentioned in a moved-aside unreadable History are never pruned.
- **Deletion works copy by copy.** A copy that can't be removed (read-only folder, locked file) no longer aborts the pass. It is kept as `removing` and retried while unchanged. The record and History are always written, and a pass that stops now shows on the page.
- **Gone from every tool.** A managed skill missing from every reachable tool becomes a deletion after the settle window, so a later install is new and unmanaged, never deleted or revived.
- **Content actually held.** Each copy records what it holds, including what a replace actually wrote. The baseline is the content the pass decided on, so an edit saved mid-spread is never reverted.
- **Moves.** A copy moved into another folder its tool reads (for example `~/.agents/skills`) with the same content is a move, not a deletion.
- **Folder identity.** A folder's new identity isn't saved while skills in it were skipped, so a reset first seen by a Sync-off Apply all is still a reset.
- **Restored folders.** A folder restored from an older backup catches up: an earlier stored revision in a reset folder is behind, not an edit.
- **Undo after deletion.** Undo of an edit is refused once the skill was deleted; Restore the deletion instead.

**Known, accepted for now:**
- A clock jump of more than 30 days forward drops History in one pass (P9).
- A skills folder swapped out wholesale with `mv` reads as a reset and puts skills back, per the spec (P11).
- An installer that removes a skill and rewrites it more than about 2.5 s later spreads a deletion (P12).

**Validation.**
- 124 unit tests (10 new). Mac e2e 338/338 with 8 crash rounds, smoke pass. Linux unit 124/124 and e2e 107/107.
- **Real home again** (`scripts/real-home-trial.ts`, backup `~/ck-real-backup-2026-11-08T22-40-00-190Z.tgz`):
  - Manage, an edit, competing edits, a deletion, Restore and Delete everywhere were all correct. Codex and Copilot listed the trial skill.
  - The other 488 entries were byte-identical.
  - Codex rewrites its own `.codex/skills/.system` whenever its app server starts, so the trial no longer counts that folder.

## MCP servers, checkpoint 1, November 8, 2026

**Built.**
- **Reading.** `src/mcp.ts` reads each tool's user-wide servers into one neutral record (transport, command, args, env, cwd, url, headers): Claude Code `~/.claude.json` (moves with `CLAUDE_CONFIG_DIR`), Copilot `mcp-config.json`, and Codex `config.toml` `[mcp_servers.*]` with its `env` subtable. Each tool's own fields (Copilot `tools`, Codex timeouts, `enabled`, approval mode) stay at that tool and are not compared (MCP-01).
- **Never offered:** ChatGPT desktop's own entries (`node_repl`, or a command inside an app bundle).
- **Unsupported:** SSE to Codex is "can't load".
- **Values as-is:** headers and env are copied verbatim (AT-18).
- **Preserving editors (FIL-02).** `src/textedit.ts` edits one JSON member, or one TOML server table with its subtables, and leaves every other byte as it was, comments included. Every write rereads the file and checks the entry is still what was decided on.
- **Same model as skills,** in its own record `.central-knot/mcp.json`: Managed and per-tool off, copies where missing, a choice when copies differ, one-sided edits spreading, deletions spreading after a settle, and competing edits by the fixed order.
- **Claude Code (MCP-02):** never written in the background. A band names what waits and offers **Write now**, after quitting Claude Code. It edits only those entries.
- **The page.** A new MCP page reuses the Overview's table, with separate pending changes for MCP. The practice copy now has servers in all three tools.

**Not yet:**
- MCP History, Undo and Restore (CON-02);
- the observation intervals skills use for proved order;
- background MCP passes between page reads (they run on each read and with Sync now);
- Claude desktop's `claude_desktop_config.json` (D-11).

**Validation.** 134 unit tests (10 new, including byte-preservation of JSON and TOML). Mac e2e 188/188 with 4 crash rounds, including the MCP page, Apply all, a byte-identical config.toml prefix and Write now. Linux unit 134/134 and e2e 113/113. The real-home two-way trial was not rerun; MCP was not exercised on the real home.

## MCP servers, checkpoint 2: History, Undo and Restore, November 8, 2026

- **Kept versions.** Every server version Central Knot replaces or removes is kept first in `.central-knot/items/mcp/<name>/<hash>.json`.
- **History.** An MCP edit that spread, a conflict and a deletion are History events in the shared `history.json`, keyed `mcp:<name>`, with notices on the MCP page. Background and catch-up MCP notices reach the page as skills' do.
- **Undo and Restore** (`restoreMcp`, routed from History):
  - The kept version becomes the baseline and is written to Copilot and Codex; Claude Code still waits for Write now.
  - Undo runs once.
  - A deleted server whose name is set up again with other settings is not overwritten, and Undo of an edit after a deletion is refused.

**Validation.** 135 unit tests (1 new, covering an edit spread, Undo, a second Undo refused, a deletion and Restore). Linux unit and e2e below. The Mac e2e will run after the judges finish with the Mac checkout.

## Agents (9b), checkpoint 1, November 8, 2026

- **Formats.** Claude Code `~/.claude/agents/*.md`, Copilot `~/.copilot/agents/*.agent.md`, Codex `$CODEX_HOME/agents/*.toml` (`name`, `description`, `developer_instructions`). A file that cannot be read is reported on the page and never written.
- **What crosses (TRN-01).** Name, description and prompt are Representable everywhere. Every other field (tools, model, permission mode, hooks, Codex keys and tables) belongs to its origin tool, because no equivalent is recorded. A destination without them gets the agent **With limits**, and the details name the missing fields.
- **Direction (TRN-02, D-26).**
  - Two-way among copies that hold all of the origin's fields.
  - One-way to a copy that lacks some. An edit or deletion there stays local. Central Knot stops updating that copy and says so.
- **Rules (D-32).** Same model as skills and MCP, in `.central-knot/agents.json`:
  - Managed and per-tool off.
  - A choice when copies with the same name differ.
  - One-sided edits spread, and competing edits are decided by the fixed order.
  - A deletion of a two-way copy spreads after a 2 s settle. A missing agents folder is never a deletion: the copy is put back.
  - Kept versions go in `items/agents/`. History events are keyed `agent:<name>`, with Undo and Restore (`restoreAgent`).
- **Preserving.** Updating a destination writes only name, description and prompt. That tool's own frontmatter fields, comments, Codex keys and tables stay. The TOML reader now parses multi-line strings properly: escapes, tabs, and quotes next to the delimiter.
- **The page.** A new Agents page uses the same table. The details show the With limits line per tool and a note that runtime equivalence is unchecked (AGT-01, V-07). History rows now say Skill, MCP server or Agent. Agents folders are watched, and they follow the Sync switch.
- **Practice copy.** `code-reviewer`, a Claude agent with `tools` and `model`, reaches the others With limits. `release-notes`, a plain Codex agent, is two-way.

**Not yet:**
- Convert to skill (AGT-02, AGT-03);
- per-destination invocation modes in the details;
- AT-68 session proofs (they need Nathan's sign-ins).

**Validation.** 141 unit tests (6 new: two-way edits, one-way limits and stopping, preserving updates with tricky TOML, a collision choice, deletion with settle and Restore, a missing folder, unreadable files). Linux e2e 118/118, including the Agents page.

## Running in the background (7a, no plugin part), November 8, 2026

- **Menu bar (PLT-04).** Central Knot has a menu bar icon (two linked rings, a template image) with these items:
  - Open Central Knot;
  - a status line: Sync on or off, and the home;
  - a Sync checkbox and Sync now, which take their turn in the same queue as the page;
  - Start at sign-in;
  - Quit Central Knot.
- **Closing the window hides it,** and watching and polling go on. Quit, Cmd+Q, SIGTERM and SIGINT stop everything. If the window is ever gone, Open makes a new one.
- **Unseen changes (D-36).** When sync changes something while the window is hidden or in the background, the icon shows a dot and the menu says so. Focusing the window clears it.
- **Start at sign-in (PLT-03).**
  - On by default, but registered only for an installed app in `/Applications`. A test or dev build never adds itself; the menu item says to move the app first.
  - A start at sign-in opens hidden (`--hidden`, or `wasOpenedAtLogin` where macOS reports it).
- **The last home is reopened** at launch (`userData/app-settings.json`), so a start at sign-in syncs it again. A remembered folder that is gone falls back to the practice copy.
- **Found on the way:** a page-made `window.close()` destroys the window without a `close` event (probed in Electron 45). A real close only hides it.

**Validation.** 141 unit tests. Linux e2e 120/120: with the window destroyed, the app keeps running and an agent edit spreads in the background. On macOS, the e2e also checks that a new launch opens the last home.

## Two-way fourth check (Astra and computer use on 09db120), November 8, 2026

Astra: "not safe yet", with 8 reproduced cases. Computer use: 8 of 9 steps passed; step 6 failed (with Sync off, an edit still showed Synced until Read again). All are fixed. Each Astra case is now a regression test in `tests/twoway-recovery.test.ts`; all 11 tests fail on the old engine and pass now.

1. **Edit made during a replace.** `replaceCopy` takes the content the pass decided to replace. If the copy holds anything else, or changes between being kept and being moved aside, it is put back untouched and held. The next pass sees it as an edit.
2. **Crash between destinations.** Content about to be overwritten or removed goes on record first (`RecordItem.displaced`), before the disk changes. Pruning keeps it. The next pass gives any displaced content no event names its own History entry, and only then drops the hold.
3. **Delete everywhere failing part-way.** Each copy is tried on its own. One that can't go is recorded as `removing` and retried. The record and History are always written, and an unspread edit is put on record before removal.
4. **Unreadable is not absent.** A deletion needs the tool's folder to be readable and the copy's folder to be really gone (ENOENT). A copy folder that exists but did not read as a skill (permissions, a SKILL.md broken for now) holds the skill until it reads again.
5. **Every folder restored to the same older backup.** This now catches up to the newest content from the store, instead of rolling the baseline back.
6. **Retrying a removal after a folder reset.** A folder made again holds a new install, so the old removal is dropped.
7. **Retrying a removal outside Apply all's scope.** With Sync off, Apply all for one skill no longer finishes another skill's deletion.
8. **Every folder made again empty.** The skill is put back from the store, with the reset notice, instead of becoming a deletion.
- **Computer use, step 6.** With Sync off, a watcher event makes the page read again quietly, so an edit shows as waiting. The e2e now checks this without clicking Read again.

**Validation.** 152 unit tests. Linux e2e 121/121.

## Two-way: the Opus fourth check (on 09db120), November 8, 2026

Opus: "not safe yet". It ran on throwaway homes and on the Mac's real home with `ck-test-` skills, and left the real home byte-identical apart from its History and record entries. b66f9ce already fixed problems 1 ("Use this copy" handled per copy, with History and Undo), 2 (a copy that can't be read holds the skill) and 3a (replace checks first). This round fixes the rest:

- **3b. A removal checks first.** `removeChecked` moves the copy aside and checks it holds what the pass decided on. An edit saved just then is put back and kept. This applies to deletion spreading, Delete everywhere and retries.
- **4. A held skill no longer keeps a folder "reset" forever.** Its copies in a folder made again are let go (adopted or put back once it is handled), so the folder's new identity is always saved.
- **5. Restore for each overwritten edit.** `restorableChoices` covers a kept-edit's overwritten edit and every loser of a conflict. History shows one "Use X's" button per edit, and `restoreFromHistory` takes the choice.
- **6. Missing times don't outlive a skipped pass.** A held or out-of-scope skill clears its copies' missing times, so the settle is never skipped later.
- **7. A copy moved into `~/.agents/skills`** is no longer followed, with a message to move it back. Only copies Central Knot can write are adopted.
- **8. Smaller fixes:**
  - a retry stops once the skill is put back by hand in another tool;
  - the retry for a skill deleted in the same pass waits for the next pass;
  - editor leftovers (`.*.swp`, `.#*` locks, `#*#`, `*~`, `4913`) are not content and not links.

**Validation.** 159 unit tests; the 7 new ones cover these findings, and 5 of them fail on b66f9ce. Linux e2e 121/121.

## Agents and background: Opus and Astra checks (on e805d21), November 9, 2026

Both said "not yet". Opus confirmed 7 problems, Astra 11, overlapping. The agents engine was rewritten on the skills engine's safety rules. Both judges' reproductions now pass and are kept as `tests/agents-opus-check.test.ts` (4) and `tests/agents-astra-check.test.ts` (12).

- **Kept versions keep every tool's whole file.** They are stored per tool under the content ID (`items/agents/<key>/<hash>/<tool>.txt`), and Restore puts back each tool's own file, fields and tables included (Opus 1, Astra 2).
- **Unreadable is not absent.** A file that can't be read as an agent, or an agents folder that can't be listed, holds the agent: no deletion and no overwrite. A new file is created exclusively, so nothing there is ever replaced (Astra 1).
- **Checked writes and removals.** A write rereads the file and refuses if it changed. A removal moves the file aside and checks it, putting back an edit saved meanwhile.
- **Deletions follow DEL-01 and DEL-02:**
  - only recorded copies are removed; a different, never-synced copy stays (Astra 5);
  - a tool whose folder is away gets a `removing` entry and is deleted when it returns with the same bytes (Opus 4);
  - a folder that comes back empty puts the copy back;
  - a moved config root lets old copies go, never deletes (Astra 6).
- **One-way copies (D-26):**
  - any change to the whole file, own fields included, stops them (Astra 11);
  - stopped copies are kept on record, so Restore and Undo never write them and never take them for another agent (Opus 2 and 3, Astra 3).
- **Restore:**
  - it respects the sync gate (Astra 7);
  - it never overwrites an agent managed again with other content (Astra 4);
  - it can choose any overwritten edit.
- **History:** "Use this copy" is a `chosen` event, and an edit racing a deletion is a `kept-edit` event with a notice (Astra 10). The origin stays the same tool unless it is chosen, so one-way never flips by itself (Opus's design note).
- **Formats:**
  - TOML keys are replaced at their own positions, never by searching text (Opus 5, Astra 8);
  - frontmatter edits change only the `name` and `description` lines, keeping every other line as written (Opus 6);
  - DEL is escaped in TOML strings (Opus 7).
- **Names that differ only by case** are one agent across tools, and a clash needs a choice.
- **Sync off:** Apply all and Write now write only what they show, for MCP and agents too (Astra 9).
- **Smaller fixes:**
  - MCP Restore respects the sync gate;
  - MCP and agent deletions get the 2.5 s follow-up pass;
  - the menu bar dot shows when the window is gone;
  - Start at sign-in is registered once, at first launch, and a later "off" in Login Items is respected (the menu reads the system's state).

**Validation.** 179 unit tests. Linux e2e 121/121.

## Computer use on e805d21 (agents and menu bar), November 9, 2026

Agents passed in the real window: steps 1–5 (Manage all, files and limits, the runtime note, an edit spreading with Undo, History's Agent tag and Undo). The background steps found two problems:
- **A second launch opened its own window** ("Could not read this home"). `app.quit()` let the second instance start up before exiting. It now exits at once (`app.exit`), and only the first instance shows its window.
- **The menu bar icon was not found:** a crowded menu bar (and the MacBook notch) hides status items. The app menu now carries Sync, Sync now, Start at sign-in and Quit too, so they are always reachable. The Dock icon also reopens the window.

Closing the window kept the app running, and a background edit reached Codex (step 6, first half).

## Fifth check, Astra (on 51a5d32), November 9, 2026

"Not yet", with 11 confirmed cases, mostly in MCP sync, which had not had the skills engine's safety pass. All 11 are fixed. The reproductions are kept in `tests/fifth-check-astra.test.ts` (13 tests; the two race tests inject the save at the new write step).

- **Checked writes** (`writeFileChecked`, `removeFileChecked` in `share.ts`, used by MCP and agents). The current file is moved aside and checked, then the new one is linked into place exclusively. A save landing in that moment is never overwritten, whether it is an agent prompt or an unrelated Codex setting (N1, N10).
- **MCP deletions:**
  - only recorded copies are removed; a never-synced entry with the same name stays (N4);
  - a missing settings file (moved config root) makes that tool away, not deleted (N3);
  - a copy recorded in an old file is let go;
  - Claude Code's removal waits as `removing` until Write now (N7).
- **MCP kept versions per tool.** Each tool's own settings (Codex `enabled`, timeouts) are kept and put back by Restore (N8).
- **MCP Restore** refuses to overwrite a server managed again with other settings (N5).
- **Write now** is offered for Claude Code entries that are behind or still to be removed, not only missing ones (N6, N7).
- **History:** MCP "Use this copy" and an edit kept over a deletion are History events (N9).
- **Displaced records** in MCP and agents: content about to be overwritten goes on record first, and an interrupted pass names it in History next time (N11).
- **Agents folder identity.** A folder made again between two passes is a reset: copies are put back, never deleted (N2).

**Validation.** 192 unit tests. Linux e2e 121/121.

## Fifth check, Opus (on 51a5d32), November 9, 2026

"Not yet". No new problem in skills sync; the claimed skills fixes were rechecked in the code and hold. Findings 1, 2, 3 and 5 are fixed here. Finding 4 (the gap in the agent write check) was already closed in 27218f0 by `writeFileChecked`, so its probe no longer injects. The other 8 probes are kept in `tests/fifth-check-opus-*.test.ts`.

1. **An MCP edit saved during a pass no longer becomes the baseline.**
   - A written copy is recorded with the decided content, never a later read.
   - A copy not written keeps what was recorded, so a change there is still an edit next pass.
   - A copy a choice will replace but can't yet (Claude Code waiting) is recorded as behind.
2. **With Sync off, Apply all no longer spreads an agent's or server's own pending edit or deletion.** It is held "waiting for Sync", as for skills.
3. **A Codex agent TOML with no `developer_instructions`** (empty, or cut off mid-save) is not an agent yet. It is held, never read as an edit that empties the others.
4. **Quoted frontmatter keys** (`"name":`) are found and replaced, never duplicated.

The Mac real home was not used, because a Central Knot app was running there (a computer-use session).

## Sixth check, Astra (on 15c8652), November 9, 2026

"Not yet", with 6 confirmed cases and 1 suspected; skills had no blocker. All are fixed, and the reproductions are kept in `tests/sixth-check-astra.test.ts` (6 tests, one with a real process exit).

- **Codex MCP subtables** (`env_http_headers`, tool settings) are kept whole as that tool's own and written back as they were. `[mcp_servers.x.http_headers]` as a table now reads as headers (S1).
- **A destination's own MCP settings** come from the file as reread just before writing, never from an older read, so `enabled = false` saved meanwhile stays (S2).
- **Apply all with Sync off no longer records agents folder identities**, so a reset is still seen by the next full pass (S3).
- **Crash recovery** (`recoverParked`): a file moved aside by an interrupted write or removal is put back before anything is read, in agents folders and MCP settings folders, so it is never read as deleted (S4).
- **A malformed MCP entry** (`"docs": null`) is held, never read as absent. A non-object `mcpServers` makes the whole file unreadable (S5).
- **MCP Restore records what it wrote**, never a later read (S6).
- **Background failures are shown:** failed MCP and agents passes, and copies they could not write, reach the page's band, de-duplicated (suspected item 7).

**Validation.** 206 unit tests. Linux e2e 121/121.

## Sixth check, Opus (on 15c8652), November 9, 2026

"Not yet" for MCP, which writes the file Nathan uses every day; skills and agents held up. The real home was not used, because the computer-use session's app was running. Several findings were already fixed in a7de923 (Codex subtables, including per-tool approval settings, kept and restored; `http_headers` tables read; background failures shown). This round fixes the rest. The probes are kept in `tests/sixth-check-opus.test.ts` (10 tests).

- **Codex servers written inline or as dotted keys** (`[mcp_servers]` with `docs = { … }`) are held and never get a second definition. Before, Central Knot wrote a duplicate that Codex refused to load (P3, checked by Opus against the real Codex binary).
- **A settings file reset is not deletions.** A file rewritten without a servers section, or one where two or more managed servers vanish together, is a reset: its servers are put back, with the reset notice (P4). Deleting a single server in a tool still spreads.
- **An edit to a copy that was behind** (Claude Code waiting for Write now) is a conflict, not a silent one-sided edit, and it is told as one (P9).
- **Write now refuses while Claude Code is running** (`pgrep -x claude`, real home only). A running Claude Code would write its older copy back (P10, MCP-02's risk).
- **One write error never stops the MCP pass:** `editEntry` returns a message for any failure (P7).
- **Writes through links:** a symlinked settings or agent file is written where it points, and the link stays (P5).
- **No hard links on the disk:** the old file is put back first, then the ordinary replace runs, so it is never left under its temporary name.
- **Choices are checked:** a chosen MCP or agent copy that changed after the page showed it is refused before anything is recorded.
- **Write now with Sync on** is no longer scoped as if Sync were off.
- **Cosmetic:**
  - a comment just above the next TOML table stays when a server's table is rewritten (P6);
  - agent frontmatter ends only at a line that is `---` (P8).

**Validation.** 216 unit tests. Linux e2e 121/121.

## Computer use on 0024bce, November 9, 2026

8 of 10 steps passed: skills and Sync off, MCP with Write now, agents with limits, the app menu, background sync with the window closed, the second launch and Quit. Fixed:
- **MCP edits spread slowly.** Settings files were not watched, so an edit waited for the 20 s poll. Each MCP settings file's folder is now watched without recursion, and only that file's events prompt a pass. The e2e checks the edit reaches Codex within 6 s.
- **"Could not read this home" right after closing the window,** seen again (the tester's Dock clicks timed out on its side). A window opened while a home is open now shows that home without reading it anew. A main-process log (`central-knot.log` in the app's data folder) records window life and failed requests, so the next session can show what happens on close.

## Seventh check, Astra (on 0024bce), November 9, 2026

"Not yet", with 4 blocking cases in MCP and 2 less likely ones; nothing new in skills or agents. All are fixed, and the reproductions are kept in `tests/seventh-check-astra.test.ts` (8 tests; the independent TOML check uses Python's `tomllib` where it exists).

- **Every inline form of a Codex server is held,** never given a second definition. That covers a root `mcp_servers = { docs = { … } }`, a quoted name with dots (`"docs.v2"`) under `[mcp_servers]`, and dotted keys. TOML entries now keep their decoded key parts, so a dot inside a quoted name is never split (R1).
- **Dotted `env.X` and `http_headers.X` in a server's table are read** as its env and headers, and a rewrite writes them as a table without duplicates. Other dotted keys in a server's table hold the server (R2).
- **`"mcpServers": null`** (or any non-object) makes the file unreadable; it is never read as no servers. A missing member is still "no servers section" (R3).
- **Crash recovery follows a linked settings file** into the folder its target is in (R4).
- **Kept settings per event.** Each replaced or removed MCP entry's own settings are kept under an unchanging name that the History event records. Restore puts back exactly what that event replaced; a later version never overwrites it (R5).
- **A pending removal follows only its recorded file.** For MCP and agents, a moved config root drops it, never deletes an entry in the new place (R6).

**Validation.** 224 unit tests. Linux e2e 122/122.

## Close and reopen on the Mac (1b2058b): the second window, November 9, 2026

The new log showed two windows created at launch, 93 ms apart. macOS sends `activate` during startup, before startup has made its window. The reopen handler saw no window and made one, then startup made another. Only the second window's requests are accepted, so the first failed to read and showed "Could not read this home". Closing the working window uncovered it. This is the "Could not read this home" every computer-use session saw since e805d21.
- **Fixed:** `activate` never makes a window before startup has made the first. `createWindow` only ever makes one at a time; a live window is shown instead.
- The e2e checks there is one page at launch, which matters on macOS.

## Final check, Opus (on 1999d87), with the real Mac home, November 9, 2026

"Not yet", with one blocking item. The real-home run otherwise passed:
- the skill, MCP server and agent (`ck-test-*`) were managed, edited, deleted after the settle and restored;
- each pass changed exactly one line in `config.toml` and `.claude.json`;
- idle passes left the files byte-identical;
- after cleanup, `~/.claude.json` and `~/.codex/config.toml` were byte-identical to the backup.

All sixth-check findings stayed fixed.

- **Blocking, fixed: Restore of a deletion now brings back the deleting tool's own settings.** Each synced copy's own settings are kept each pass (written only when they change), so a server deleted in Codex comes back with `enabled = false`, its timeout and its tool approvals. It never comes back enabled (DEL-03). Kept in `tests/final-check-opus.test.ts`.
- **Fixed: no made-up History entry after Write now.** Catching up a Claude Code copy that was behind no longer puts its old entry on record as displaced, so the next pass makes no "edit, winner claude, losers claude" entry. New test in `tests/mcp.test.ts`.
- **Fixed: a save landing while a settings file is moved aside.** The original is kept beside the file as `<file>.central-knot-<time>.bak` instead of being deleted.
- **Fixed: the Write now guard also finds Claude Code run through node** (`@anthropic-ai/claude-code`).
- **Left as is (cosmetic):**
  - indentation when adding the first server to an empty `"mcpServers": {}`;
  - practice-home write guards for `~/.codex` and `~/.claude.json` (a practice home never writes there).

**Validation.** 226 unit tests. Linux e2e 123/123.

## Confirming checks (on cceda9e), November 9, 2026

**Opus: "safe to hand to Nathan".**
- All four final-check fixes confirmed. Each test fails with its fix reverted.
- The per-pass keep writes nothing on idle passes.
- Skipping displaced records for catch-up writes loses nothing.
- Two minor points, now fixed:
  - the node check for Claude Code matches only node running the package's CLI, never a shell that mentions it;
  - a failed `.bak` rename never deletes the original.

**Astra: "not yet"**, with two confirmed findings, now fixed. They are kept in `tests/confirm-check-astra.test.ts` (3 tests):
1. **An edit that changed the synced content is History even when no copy could be written yet.** Two cases: Claude Code was the only other destination and waits for Write now, or a write failed and is caught up later. The catch-up then overwrites a version that History still names, so it can be restored. Applies to MCP, agents and skills (new skills test in `tests/twoway-recovery.test.ts`; it fails without the fix). A notice is shown only when something was written.
2. **A moved-aside settings file is never deleted.** If its place is taken (a crash after the write, or another program's save), crash recovery keeps it as a visible `<file>.central-knot-<time>.bak`.

**Validation.** 230 unit tests. Linux e2e 123/123.

## Confirming checks (on b7b2ea9), November 9, 2026

**Opus: "safe to hand to Nathan".** Its three small points are fixed:
- the agents version of the "edit recorded before any write" fix now has a test, which fails without the fix;
- the Write now guard also finds a global npm Claude Code (`node …/bin/claude`);
- the `recoverParked` comment was corrected.

**Astra: "not yet"**, with two confirmed findings, now fixed:
1. **Backups never overwrite each other.** Each moved-aside file is kept under its own name (time plus a random part), placed with an exclusive link. Ten recovered originals give ten backups (`tests/share-recovery.test.ts`).
2. **The agent catch-up after a failed write no longer records the behind copy as displaced,** so no second "edit" entry with the same tool as winner and loser appears. This is MCP's existing guard, now in agents (new test in `tests/agents.test.ts`).

Both new tests fail on b7b2ea9.

**Validation.** 234 unit tests. Linux e2e 123/123.

## Confirming checks (on ee5e9e8): both judges "safe to hand to Nathan", November 9, 2026

- **Opus:**
  - confirmed `keepAsBackup`, the agents displaced guard and the Claude process pattern;
  - with the b7b2ea9 versions put back, the new tests fail;
  - 234/234 pass;
  - one comment nit, fixed.
- **Astra:**
  - 50 recovered originals stay distinct, and forced name collisions and path-taken races keep every original;
  - the agent catch-up leaves exactly one edit, correctly attributed;
  - 234/234 pass;
  - no new findings.
- **Mac:** unit tests, smoke and e2e 271/271 on ee5e9e8.

## Clean-up, fixes and Settings into next (PRs #34 to #52), November 9 and 10, 2026

- **Test audit** (PRs #1 to #33, merged November 9): duplicate and dead tests removed, 302 to 225 tests.
- **De-slop and clarity** (#34 to #36, #38, #42, #46): decisions from typed fields, not English messages; exhaustive per-tool branches.
- **Fixes:** the write guard covers every tool folder (#37); released builds open this computer's home and the Practice copy is dev-only (#39, #48); Resume works on MCP and Agents (#43); a damaged or newer MCP or agents record stops writes (#44); `git ls-remote` before a marketplace is added (#45); a person's save is never deleted, and deletions finish at folders that were away (#49, #50).
- **Settings** (#51, 4bcf711): Start at sign-in, Appearance, Keep history for 7, 30 or 90 days, Show log file.
- **UI fit** (#52, cc30f24): only present tools are shown; nothing is cut off from 860×560 to full screen.

## Feedback batch landed (PRs #53 to #61), November 10, 2026

Nathan's nine feedback threads, each on its own branch, merged into next between 02:47 and 04:02 UTC:
- #53 the Plugins column header pins under the toolbar;
- #54 turn off one skill of an installed plugin, per tool (Codex, Copilot CLI);
- #55 read a plugin's skill text and see each tool's version;
- #56 Disable or Remove a skill in one tool, managed or not;
- #57 a plugin's parts for tools that can't take the plugin;
- #58 base instructions;
- #59 profiles;
- #60 e2e skips the few-tools flow where a CLI is installed system-wide (fixed the red Mac pipeline);
- #61 the Tools page becomes Harnesses, with a page per harness.

## Release 0.4.0 preview 1 (59cd11b), November 10, 2026

`Central-Knot-0.4.0-mac-arm64.zip`, SHA-256 `7233bc0b846ec5dc221ff6f39ffb8ca5fc05a9c435e5b13fac7f4163978d2d5b`, tag `v0.4.0-preview.1`. Developer ID signed and notarized; `codesign`, `stapler validate` and `spctl` verified. First release that opens on This Mac's home.

**Validation.** 312 unit tests. Linux e2e 349/349 in Docker. Mac UI tour: all 18 sections pass, each run on its own (a full run failed on shared plugin data). The Mac CI pipeline was red on this commit (fixed in the wrap-up).

## Wrap-up, round 1: Git repo and loose ends, November 10, 2026

One agent per item, each on a `wrapup/<slug>` branch off next, integrated by the orchestrator. Reports in `~/work/ck-wrapup/reports/`.
- **Git repo** page: keeps the Managed set in a git repo, moved only by Pull or Push.
- **Engine bugs** (5e2a8ba, 9f529d0, 9d57547): the store prune keeps a parts skill's copy, so Undo of Remove parts works; a Claude Code skill override other than "off" survives a profile switch and an Enable after History's window (`skill-overrides.json`); a part MCP server's on/off key is left out of its fingerprint.
- **Plugins:** Codex folder marketplaces (`.agents/plugins/marketplace.json`) read; versions and nested parts as the tools read them; a left-out part can be added later.
- **Follow-ups and UI bugs:** a typed base-instructions draft survives a home switch; results newer than pending changes show; a profile's queued Disable is dropped; layout fixes at 860 and 2560.
- **Mac CI:** e2e passes on a packaged Mac build.
- **Tour:** a full ui-tour run passes.

## Release 0.5.0 preview 1 (9a3ed0b), November 10, 2026

`Central-Knot-0.5.0-mac-arm64.zip`, SHA-256 `ec678e12011329f03667424d0089ec49dd8cce3e406f993ab2c89d357509b737`, tag `v0.5.0-preview.1`. Signed and notarized, verified as before.

**Validation.** 338 unit tests (one run in seven had one failure that did not repeat). Linux e2e 364/364; Mac packaged e2e 473/473. Mac UI tour in one full run: 19 sections, 609 screenshots. A Computer Use pass on the Mac.

**Known.** An override 0.4.0 preview 1 kept only in History is not carried over; a repo that deletes `instructions/base.md` empties the base on Pull; profiles can turn off a Copilot CLI skill where the Skills page said Disable was unavailable.

## Wrap-up, round 2: plugin Update, Disable best effort, desktop apps, November 10, 2026

Nathan's decisions: no version gates on Disable or plugin Update, and a tool's desktop app counts without its CLI.
- **Plugin Update** (a36808a): each tool refreshes its marketplace and updates through its own command (`claude plugin update P@M --scope user`, `copilot plugin update P@M`, Codex `marketplace upgrade` then `plugin add`); counts only when the tool's record shows the new version; no Undo. Real-CLI runs, 1.0.0 to 2.0.0 in all three.
- **Disable best effort** (5269a71): offered on any build or with no CLI; a note on builds older than the one checked.
- **Desktop app without its CLI** (4724d25): Claude desktop, ChatGPT desktop and the GitHub Copilot app make their tool present; app and CLI versions shown apart; plugin parts offered where there is no CLI.

## Release 0.5.0 preview 2 (2b3ab02), November 10, 2026

SHA-256 `fc890d2e4084e7605a82000aab1ee91cbc76c55d0cd8650595022e8f24809458`, tag `v0.5.0-preview.2`. Signed and notarized, verified as before.

**Validation.** 347 unit tests on Linux and macOS. Linux e2e 369/369; Mac packaged e2e 478/478; GitHub's Mac pipeline green. Mac UI tour full run: 19 sections, 615 screenshots. A Computer Use pass on the Mac (not covering plugin Update or the app-only case).

## Wrap-up, round 3: whole plugins through the desktop app, November 10, 2026

- **12e626d:** with no CLI, the copy of the tool each desktop app carries (Claude desktop's Code tab binary, the Copilot app's runtime, ChatGPT desktop's Codex) runs the plugin commands: marketplace add, install, update, uninstall and Copilot's per-skill switch. The plugin box names the route. Parts only when the app's copy isn't on disk yet. Run with the real apps' copies on the Mac in throwaway homes.
- **28ebaa2:** a plugin change's next step names both routes; Copilot's plugin-skill switch is counted as checked from 1.0.102.

## Release 0.5.0 preview 3 (28ebaa2), November 10, 2026

SHA-256 `6f45b38130bee0ca66901f67d7f23aa4cacd7a420669271adc1bb9a0c823aa40`, tag `v0.5.0-preview.3`. Signed and notarized, verified as before.

**Validation.** 349 unit tests on Linux and macOS. Linux e2e 374/374 (including a home with only Claude desktop installing through a stand-in Code tab binary); Mac packaged e2e 478/478. Mac UI tour full run: 19 sections, 615 screenshots. No Computer Use pass on this build.

**Reviews.** Two rounds, Opus 5.5 and Fable 5.2 on interface and on code (Sol and Astra could not run: ChatGPT usage limit). First round: interface 7.5 and 8, code 7.5 and 7.5; second: interface 8 and 8.5, code 8 and 8, with every first-round fix confirmed. What they found is fixed: one record per home (a home switch wiped the other's), a failure that retrying can't fix no longer promised a retry, a failure cleared by a hand-made update and kept through an unreadable marketplace, the menu bar telling an update from a failure, Quit waiting for the note, news never told of a home switched to mid-check, the Settings row counting only failures the note still shows, a preview-only home looked at at the usual time, the "this is new" line on a first failure too.

**Not proven.** A plugin installed this way loading in a signed-in desktop session; Windows and Linux app locations.

## After preview 3: test scripts and the default logo, November 10, 2026

- **2c591e8:** e2e and ui-tour close every app they started when the run ends, however it ends.
- **c28268e:** the default logo, the "happy atom", as the app icon, sidebar mark and window icon. The files in `assets/` are the one place a branded build replaces; the menu bar icon stays the two linked rings.
- **7409a6a:** e2e checks that an Undo from History leaving a hand-changed switch says so where it can be seen.

**Validation on 7409a6a.** 349 unit tests. Linux e2e 374/374; Mac packaged e2e 478/478.

- **a618a4e:** on this computer a tool is here only when its CLI or desktop app is found; a settings folder left behind (after an uninstall) is no longer the tool, so it has no column, box, menu or note anywhere and sync writes nothing to it. Harnesses lists it as "Not found · only its folder is here". A chosen folder still goes by the folder. CLIs are looked for on the PATH the person's terminal has (asked once of the login shell), so one installed through nvm, bun or npm's own prefix is found when the app is opened from Finder.
- **11b6ce4:** Skills: a tool with no copy of its own that has the skill through an installed plugin shows a "Through a plugin" box (it opens the plugin's page) instead of "No copy", and sync, Add and Restore place no separate copy beside the plugin's. A plugin's parts in Pi and the plugin itself in Claude Code or Copilot CLI now read as one skill.
- **b148013:** the same for MCP servers and agents a tool has through a plugin (Claude Code and Copilot CLI).
- **3420601:** only an item that is the plugin's counts as held through it: one Central Knot installed elsewhere as that plugin's part, or a skill whose SKILL.md is the same. An item that merely shares a name stays an ordinary item.

**Validation on f910dfc** (with next at 87de0bc merged in). 354 unit tests. Linux e2e 408/408; Mac packaged e2e 503/503 (CI run 42881619568). The Mac count moves with how many crash rounds land mid-copy.

## Mac disk image: drag to Applications, November 10, 2026

- `npm run package:mac` now also builds `release/Central-Knot-<version>-mac-arm64.dmg` (`scripts/mac-dmg.mjs`): a window with the app on the left, a shortcut to the Applications folder on the right, an arrow between them and "Drag Central Knot to Applications" underneath. The disk carries the app's icon. The zip is still built beside it.
- With the Developer ID present, the disk image is signed, notarized and stapled in its own right, after the app. A release build took 3 min 37 s in all.
- The window's layout is a file Finder reads, `assets/dmg/DS_Store`, made by `scripts/mac-dmg-layout.sh` (dmgbuild, no Finder needed). The picture is `assets/dmg/background.svg`, kept as PNGs at both sizes. (Since the alpha line, November 12, each app's window is its own folder: these are in `assets/dmg/Central-Knot/`.)
- Every build mounts its own disk image and checks the app's signature inside it and where the shortcut leads.

**Validation (macOS 26.6.2, signed build of 9a807b0).** `codesign`, `stapler validate` and `spctl` (`accepted`, `source=Notarized Developer ID`) pass for the disk image and for the app inside it. In real Finder windows, through Computer Use: the image marked as a download opened on a double-click with no warning; its window came up by itself at 660 by 432 with no sidebar or toolbar, the picture filling it, both icons and the arrow in place, the caption 58 points above the bottom, labels readable; the disk shows the app's icon; the shortcut opens the real Applications folder. The app copied out of that image opened in a throwaway home. The drag: Nathan dragged the app onto the shortcut by hand from the first test image (unsigned, same layout but for the window's height), and Finder copied it into `/Applications`; the tester's synthetic drag does not register in Finder.

**Not proven.** The drag from a signed image. Light appearance (the Mac was in Dark; labels were black on the slate blue). Macs older than macOS 26, where the title bar is 4 points shorter and the window shows 4 more points of the picture.

## Display order: managed, then in use, then disabled everywhere, November 10, 2026

Nathan asked that what is managed come first, then what some tool has, and that what no tool has or every tool has disabled go to the very bottom, so moving an item between tools means no scrolling past what nothing loads.

- **Tables (Skills, MCP servers, Agents, and each harness's page):** Managed, Unmanaged, then on a harness's page "Not in <tool>", then **Disabled everywhere** last: items every tool that has them has disabled, managed or not. A tool that has the item through an installed plugin that is on counts as using it. Rows are placed as things stand before pending changes; a row that will join or leave the last section is told on its heading.
- **Bulk actions** (Manage all, Add all, a section's Manage all) leave the Disabled everywhere rows alone, so a skill someone disabled is not spread to other tools by a bulk click. Each row's own controls still work.
- **Skills list (files view):** the same order, with the same three headings where the group changes.
- **Plugins:** in a marketplace, plugins every tool that can take them has come first, then plugins some tool has, then plugins no tool has; by name within each. Whole or as parts both count. A tool that can't take the plugin (Pi, a blocked marketplace) doesn't keep it from the top group.
- The rule is `src/roworder.ts` (`standing`) for items and `pluginPlace` in `src/pluginstatus.ts` for plugins.
- Housekeeping: `.gitignore` now covers a `node_modules` link as well as a folder.

**Validation.** 358 unit tests. Linux e2e 409/409 on the branch with next at 31278c4 merged in; unit tests again with next at 5f06ab1. Reviews: Opus 5.5 (8 for what was asked, 8 for code) and Fable 5.2 (7 and 8) on the first commit; their findings are in the list above. Astra could not run (ChatGPT usage limit). On macOS 26.6.2, a packaged ad hoc build on the real home through Computer Use: Skills Managed 1 then Unmanaged 44; MCP servers Unmanaged 2 then Disabled everywhere 1; claude-plugins-official (317 plugins) lists its 4 installed first; nothing cut off at about 900 by 600.

**Not done.** A whole plugin turned off in every tool still counts as installed on the Plugins page: its switch is read (`installedPlugins`) but not yet carried to that page. The marketplaces list keeps its order. Mac packaged e2e was not run on this branch.

## Self-update on macOS (PLT-02a), November 10, 2026

The Mac app updates itself from the GitHub releases. `scripts/package-mac.mjs` records the build's release tag in `dist/build-info.json` inside the app (the commit's version tag, or `CK_RELEASE_TAG`; `--release` refuses to package without one). The app asks `api.github.com/repos/njfife/central-knot/releases` 10 s after launch and every 4 hours (30 min after a failed check), picks the newest newer tag with the Mac zip (previews and finals for a preview build, finals only for a final one), and shows it as the status bar's Update button. One click: the app downloads the zip itself (progress, a byte-count check, 60 s stall limit), then hands it to Electron's `autoUpdater` (Squirrel.Mac) through a loopback-only feed under a random path. Squirrel checks the new app against the running app's designated requirement (same bundle id and Developer ID team), unpacks it aside, and ShipIt swaps it in at the restart and opens the new app. Unsaved instruction drafts and changes waiting for Apply all hold the restart; the restart waits in the main queue, so never during a write. New app state: `update` in `app-settings.json` (the tag being installed), cleared at the next launch, which says once "Central Knot is now on …" with Release notes, or that the update didn't finish.

**Real signed builds** (`scripts/update-proof.mjs`, throwaway `/private/tmp/ck-update-proof`, nothing published): v0.5.0-preview.98 and .99, Developer ID signed (team 4K96M39DLN), not notarized; v0.5.0-preview.100 ad hoc. With .98 installed in the throwaway `~/Applications`: a download cut at 40 % was refused ("The download didn't finish. Central Knot wasn't changed."), and the ad hoc zip was refused by Squirrel ("code failed to satisfy specified code requirement(s)"). After both, every byte of the installed bundle was unchanged. Then one click on "Update to 0.5.0 preview 99": progress 0–99 %, "Preparing update…", the old process quit, and ShipIt logged "Installation completed successfully" and relaunched it. The relaunched app reported tag v0.5.0-preview.99 from its own page, said "is now on" with Release notes, and was still signed by the same team (`codesign --verify --deep --strict` passes). Its settings (Dark) and its data folder survived. 16/16 checks.

**Test hooks** (read only when set): `CK_UPDATE_RELEASES` (the releases list URL); `CK_UPDATE_STUB` (e2e: acts as that tag, and its install only records and quits); `CK_TEST_HOME`, `CK_TEST_USER_DATA`, `CK_TEST_DEBUG_PORT` (ShipIt relaunches through LaunchServices with no arguments and the login's HOME, so test builds carry these in `LSEnvironment` via `CK_TEST_ENVIRONMENT`, never on a release). The first proof run had no `CK_TEST_HOME`: the relaunched test app read the real home once, wrote nothing to it (no `.central-knot/sync.json` there, so nothing could sync), and was quit within minutes. Squirrel keeps its own state in `~/Library/Caches/com.centralknot.firstlook.ShipIt` and a launchd job of that name; the test copies were removed afterwards.

**Validation.** 354 unit tests (6 new). Mac packaged e2e passes, including the new update flow (stubbed install: background check, button, progress, Apply-all hold, restart, after-restart message, interrupted download, update that didn't finish, untagged build). UI tour `updates`: 23 screenshots at 1280×800, 860×560 and 1728×1117; the `settings` and `sizes` sections were re-run.

**Not proven.** A notarized build downloaded from GitHub itself (only the local fixture served zips); a real `/Applications` install by a standard (non-admin) account; the restart holding while a write is under way (by construction: it waits in the main queue); Windows and Linux (no releases, nothing shown).

## Leftovers after preview 4, November 10, 2026

What was left open after v0.5.0-preview.4, fixed or proven.

- **A pulled base-instructions edit is in History**, with "Undo pull" (the base's own Undo, as a pulled deletion already had): once, and only while the base is still as that Pull left it. A base that arrives for the first time gets a row too. After an Undo the earlier text is a change made here, which the next Push sends.
- **The Plugins list knows a copy differs from the marketplace's** without the plugin's page being opened: once the list is drawn, the files of plugins some tool has installed are read in the background, three at a time, from disk only (no Git fetch), into the cache the plugin page uses; again after Refresh and Apply all.
- **Claude Code overrides:** a profile never turns on a skill the Skills page turned off, so the listed gap could not happen. A nearby one could: an override taken out by hand came back after a profile turned the skill off and the Skills page turned it on. A profile's Disable now counts as the latest Disable.
- **Tests for two earlier fixes** (e2e): a home switch whose settings can't be saved stays on its home, still watched; Refresh on Harnesses asks for the marketplaces as last read. Each fails with its fix taken out.
- **Test runs pick their own debug ports.** The e2e and the ui-tour each chose a debug port at random; with several runs on one Mac, a run could choose a port another run's app was listening on and then drove that app (seen: a tour clicking in another checkout's window). The app is now asked for port 0 and says its ports on stderr (`cdp.mjs debugPorts`). The tour's last step also waits for the stopped app's helpers before deleting its scratch folder.
- **Desktop apps, real installs** (asked by Nathan): the GitHub Copilot app's Windows setup installs under `%LOCALAPPDATA%\Programs\GitHub Copilot`, not the folder guessed before, so it was not found; fixed. App 1.2.0 unpacks its runtime as `<version>/copilot` (1.1 on macOS: `copilot-sdk-runtime-<version>`); both are looked for, and with no CLI that runtime runs plugin commands on Windows and Linux too (run in throwaway homes on Ultra PC and Ubuntu 26.04). Claude desktop from its apt package on Ubuntu 26.04 is found; as an ordinary non-elevated process on Windows detection is as before. Details in `docs/capability-data.md` §3.

**Proven without a code change.** A plugin installed with Claude desktop's own Claude Code (2.1.321) is used in a Code tab session of the signed-in app: the session ran the test plugin's skill and gave its answer (transcript entrypoint `claude-desktop`). macOS gives the running signed preview 4 build the new icon (`NSRunningApplication.icon`, regular activation policy), and the app never sets a Dock icon of its own.

**Validation.** 367 unit tests. Mac packaged e2e 534/534. Linux e2e 441/441. UI tour `plugin-versions` (new list shots at 860 and 1728), `plugins`, `harnesses`, `settings` on the Mac; every section run alone, 17 of 18 first time (the 18th was the scratch-folder delete, fixed).

**The Dock icon** was seen by Nathan on November 10, 2026: the Dock shows the new icon (no tool here can capture the Dock).

**Not proven, left by Nathan's decision while only macOS is supported.** Where Claude desktop on Linux keeps the Code tab's copy (appears only after sign-in). The Copilot app's `.msi` location (from the package's own tables, not installed).

## Instructions: a draft of the base written by one of your tools, November 10, 2026

Nathan asked that a person be able to use one of their own tools, headless, to generate base instructions from the files they already have, with what each tool's file should become, and to have it installed in one step rather than editing files by hand; and to choose the tool when more than one can do it.

- **Draft with a tool** on the Base instructions card (INS-06). Each tool with a CLI on this computer (or a desktop app carrying one) is offered by name. The tool runs once, in an empty folder, with every file's own text in its prompt and its own tools off where it has that switch (capability-data §6 lists each command). `src/draftbase.ts`.
- **The draft opens as the base's ordinary review:** the base as it will be, then each file with the lines it keeps of its own. Lines of a file that the draft carries nowhere as written are noted under it. **Edit the draft** opens the base and each tool's part as text. One **Save** sets the base and each ticked file's own text (`BaseApply.own`), with the one Undo; an unticked file is not written, and a copy of the base edited in a file is left alone as before.
- A tool that fails says why in its own words and changes nothing; Stop ends one that is writing; a draft made from a file that has since changed can't be saved.
- Also on this card, for the hand-written flow too: a first base is shown as text rather than an all-added diff, "Show changes" for a file's diff, the tools' tick boxes sit beside their labels, and the start row is one line.

**Validation.** Unit tests 8 new (`tests/draftbase.test.ts`), all passing with the rest. Linux e2e with a new flow (stand-in tools: a failing tool, Stop, review, edit, Save, Undo, a file changed after the draft). UI audits by Opus 5.5 (6 and 6 of 10 on the first design) and Fable 5.2 (7 and 6); their findings are applied; Astra could not run (ChatGPT usage limit). On macOS 26.6.2, a packaged ad hoc build opened through LaunchServices on the real home with four sample instruction files, driven over its debug port: Codex 0.167.0 and Claude Code 2.1.311 each wrote a draft (23 s and 8 s); Save wrote all four files and Undo put them back byte for byte; an edited draft with Pi unticked wrote three files and left Pi's alone; Copilot CLI and Pi failed with their own words on screen (a model that is not available; not signed in). Copilot CLI's command was exercised separately in a Terminal window with `--model auto`. The Mac's home was put back as it was.

**Not done.** No Computer Use pass (another thread held the Mac's lock); the real window was driven over its debug port instead. A tool whose CLI is a `.cmd` shim on Windows is not handled (macOS only for now).

## Self-update follow-ups, November 10, 2026

What the reviews of the self-update (released in v0.5.0-preview.6) left open, fixed or looked at.

- **The updater's own steps are tested without an app.** They moved to `src/updateflow.ts`, which takes Electron's parts (the network, Squirrel, the quit) from `src/updater.ts`, so `tests/updateflow.test.ts` stands in for them: the release read again at the click, a release withdrawn since the check, checks kept through a failed download (asked by the clock or by Check now), a click during a check, a restart that doesn't happen or can't be asked for, a download that ends early, never answers, or goes quiet with the connection open, Squirrel refusing, and the two launches after an update. Six of the fixes were taken out one at a time; five made tests fail (the sixth, waiting for a running check, changes no outcome).
- **A wait for Squirrel that runs out no longer loses track of the update.** The record for the next launch is saved before the zip is handed to Squirrel and kept when the 10-minute wait only runs out (Squirrel can't be stopped and may still install at a quit); the app then says "Preparing the update is taking too long. Central Knot hasn’t changed. If it still finishes, Central Knot offers the restart then; otherwise try again later." If Squirrel finishes later the update shows as ready; if it then refuses, the record goes. A record that can't be saved stops the update before Squirrel has anything. So a quit during "Preparing update…" is also said at the next launch, either way.
- **A download that goes quiet is ended on the stream itself**, not only on the request, so it ends even if the connection never notices. Tried against Electron's own network stack with a fixture that sends 30 % and then nothing with the connection open (`stall`, also step 1b of `scripts/update-proof.mjs`): ended after 60 s with "The download didn’t finish…", the button usable again.
- **Keyboard focus and screen readers.** Check now and the Update button are disabled under the focus while they work; each takes the focus back when it can be pressed again, unless the person has moved on. An on-demand check says "Checking for updates…" and then what it found to screen readers (the row already shows it). "Check for Updates…" in the app menu now checks from the page: the result is announced and Check now has the focus.
- **Settings keeps the note that the launch came from an update**: "Updated to 0.5.0 preview 7." (", the newest release" once a check has gone through), with Release notes, for the whole launch; the status bar's note still goes at the first page switch. A download that failed after being started from the status bar stays said in Settings, with "Open the release page".
- **The Updates row's buttons** are the size of the page's other row buttons (32 px).
- **A checkout with changes of its own doesn't take its commit's release tag**, and `--release` refuses it (`scripts/release-tag.mjs`, `tests/releasetag.test.ts`); a test build still says its tag outright with `CK_RELEASE_TAG`. Tried on a clone of the v0.5.0-preview.6 tag: clean and after a build (`node_modules`, `dist`, `release`, logs) it records the tag; with a tracked file edited or a stray file it records none, and a release stops, naming the files.
- **The status bar at 860 wide, looked at for real.** With a profile in use and sync "On · nothing managed", the facts ran into the message's mark: 60 px short while downloading, 50 px with a restart held, 4 px after the restart (the Update state fitted). Under 1000 px the switch is now labelled "Sync" ("Automatic sync" in its tooltip and to screen readers) and the bar's parts sit 18 px apart instead of 26. The e2e checks every state of the button at 860×560, in a folder home with a long profile name, for anything running into its neighbour; the `updates` tour section pictures them.

- **The click says whether the app will restart by itself.** With changes waiting for Apply all or a draft open, the message at the click and the button's tooltip during the download promised a restart that then (rightly) waited; they now say "Something here isn’t saved yet, so Central Knot will wait for you to restart." Seen in the real window.

**Validation.** 405 unit tests (25 new for the updater's steps, 3 for the tag rule). Mac packaged run on the merged branch: e2e 583/583, the update flow now also checking focus after Check now and Update, the announced result, the Settings note, a failed download started from the status bar, and the status bar at 860×560 in each state of the button. In a real window on the Mac (Codex Computer Use; a packaged ad hoc build acting as preview 6 and then 7 against a local releases list, in a throwaway home): the button and its tooltip, the Updates row with buttons the height of "Show log file", Check now by keyboard with the focus back on it, download progress, the restart held for a change waiting for Apply all with its warning mark, message and Settings line, the focus back on "Restart to update", the status bar at the smallest window with nothing touching, the restart click; then on the next launch the note with Release notes, gone after a page switch, "Updated to 0.5.0 preview 7, the newest release." in Settings, "Check for Updates…" from the app menu landing on Settings with the focus on Check now; and on a plain launch "Up to date." before and after Check now. The published, signed preview 6 opened from an `Applications` folder its account can't write (throwaway home, local releases list): "Update available" in the status bar, and in Settings "Your account can’t change apps in this Applications folder. Download the new release and replace Central Knot by hand." with "Open 0.5.0 preview 7’s page" and no Update button; with the folder writable the same copy offers "Update to 0.5.0 preview 7". The `updates` tour section's new pictures were looked at from a Linux run only.

**The real update, preview 6 to preview 7** (after v0.5.0-preview.7 was published). The published preview 6, unpacked into a throwaway `~/Applications` under a throwaway home on the Mac, found preview 7 on GitHub: the button read "Update to 0.5.0 preview 7" about 14 s after launch. One click in a real window (Codex Computer Use) downloaded the 122 MB zip and prepared it within about 9 s; with a change waiting for Apply all it held as "Restart to update", saying what restarting loses. On "Quit Central Knot", ShipIt installed it ("Installation completed successfully") and nothing reopened. The installed app matched the published preview 7 zip file for file, signed by the same Developer ID team and notarized. Opened again in the throwaway home it said "Central Knot is now on 0.5.0 preview 7." with Release notes; Settings said "Updated to 0.5.0 preview 7, the newest release." with Release notes; Appearance, set to Light before the update, was kept; the change that was never applied was gone, as the button had said. The restart was held on purpose: a real update's own restart reopens the app on the login's real home.

One slip in that proof: after the last Quit, the Computer Use session looking for the window made macOS open the throwaway copy again, with no arguments, so on the real home and the real app data, for 63 seconds. It read the home (85 skills) and changed nothing in the tools; it rewrote Central Knot's own `app-settings.json`, and the `mcp.json` and `agents.json` records, which hold nothing. From now on what is running after a quit is read over SSH, never by a Computer Use look.

**Not proven.** With the real release: the restart by itself after the click (test builds only), a copy in the real `/Applications` (the copy there now is an ad hoc build, not a release), and an account that isn't an administrator (the runner's `ck-ci` is one; asked). An update that Squirrel finishes after the wait ran out, with the real Squirrel (stand-ins only: the wait is ten minutes).

## Plugin parts one by one, what plugins bring on the pages, and a log that says what happened, November 10, 2026

Nathan put the plugin `varo-dev` (5 skills, 2 agents) into Pi as parts on his work Mac: two skills went in and three said "it can't be read in Pi right now". He asked what was going on, to pick which skills go into Pi (and which are on in Codex and Claude Code), for skills and MCP servers that come with a plugin to show on the Skills and MCP servers pages with a mark, and for the log file to say something useful about such an error.

- **The error.** It is raised when something is in a skill's place in the tool's folder that can't be listed. The likely cause there is links left by an earlier skills install whose targets are gone (the Skills page skips those). Not confirmed on that Mac. A part's unreadable place now says what is there, the path (`~/…` in the person's home), the system's error code and what to do. A link that leads nowhere no longer blocks the skill: the part replaces it, the plan says it would, and the result says it did.
- **Single parts.** On a plugin's page, under What it holds, each skill, MCP server and agent has a switch under each tool that takes single parts: Pi, a tool that can't take the plugin here, and Claude Code where the plugin isn't installed (it has no switch for one skill of a plugin). A part turned off stays out through updates, whatever is in its place since, and Undo goes back. Beside an install or update of all a tool's parts, a pick is that run's exceptions. Where one list has both kinds of switch, each column says "in the plugin" or "separate item". Engine: `installParts(…, pick)` and `settle` in `src/parts.ts`; the choice `pick-parts`, `partStand` and `clickPart` in `src/pluginplan.ts`.
- **What plugins bring.** Skills, MCP servers and Agents list each item an installed plugin brings in a "From plugins" section, with the plugin's icon and "from <plugin>", read with the home from each tool's own records (`plugins.installedCopies`, `src/pluginitems.ts`, `src/pluginrows.ts`), whether or not its marketplace is added here. An item that is already a row of the person's own (next's "Through a plugin" box, or the plugin's part in another tool) stays that one row. Counts on Overview and Harnesses follow the rows each page draws (`inTool`).
- **Log.** `central-knot.log` records each plugin step's outcome and reason, the parts a pick named, a failed command's output and each item an Apply all couldn't change; it is trimmed at start past a megabyte.
- **Also.** `x.agent.md` is the agent `x`. The plugin page's boxes span the window. Copilot CLI's uninstall of a folder-marketplace plugin only sets `enabledPlugins` false (exercised 1.0.108, capability-data section 7), so false stays "not installed".

**Validation on the merged branch.** 386 unit tests. Mac dev-build e2e 541/541 before the last fixes; Linux e2e 421/421 after them (a debugging aid, no longer a required check). Three review rounds, Opus 5.5 and Fable 5.2 on interface and on code (Sol and Astra could not run: ChatGPT usage limit): interface 7.5/7.5, 7/7, then 8.5/8; code 7/7.5, 8/7.5, then 8.5/8.5. Their findings are fixed above or listed below. On the Mac, this build on a copy of the real home's tool settings listed 41 skills and 4 MCP servers from the plugins installed there, with no error in its log.

**Not done.** No click-through in a real window (Computer Use runs on the same ChatGPT account). The owner's own case was not reproduced on his work Mac. An installed copy whose skills folder can't be read lists nothing and says nothing. The plugin rows' drawing code sits in `src/matrix.ts`. A result can name a part as put in that was already there. "Install parts in all N tools" doesn't say which parts can't go in.

## Mac: a closed window leaves the Dock, November 10, 2026

Nathan asked that closing the app on a Mac leave it running in the top right (the menu bar), not in the Dock as well.

- Closing the window now takes Central Knot out of the Dock and the ⌘Tab list; its menu bar icon stays. Opening it again (the icon's Open Central Knot, Settings…, or opening the app from Finder, Spotlight or Launchpad) brings the Dock icon back with the window, in front.
- A minimised window and a hidden one (⌘H) keep the Dock icon. A start at sign-in with no window shows the menu bar icon only.
- The first close's "still running" dialog shows while the Dock icon is still there; the icon goes once it is answered.
- Electron drops a request to leave the Dock made within a second of the icon's return, so it is asked again until it holds (`leaveDock` in `src/main.ts`).
- The log now has a line, "opened again", each time the system asks a running Central Knot to open.
- Windows and Linux are unchanged.

**Validation (macOS 26.6.2).**
- Mac packaged e2e passes in CI (run 42895096593), with a new check of the system's view of the app (`lsappinfo`) before and after its window goes.
- An ad hoc packaged build with its own home, real clicks through Computer Use: the red close button showed the first-close dialog with the Dock icon still there; after OK the system reported a menu-bar-only app, and still did three seconds later. A second close went straight there with no dialog.
- A development run, with a real window close asked from the main process: the same, plus reopening (a Dock app again, frontmost and focused), a close 0.3 s after reopening (the icon left within a second), minimise and ⌘H (the icon stayed, also when done 0.3 s after reopening).

**Not proven.** A real click on the menu bar icon's Open Central Knot: Computer Use could not reach the menu bar icon. The same code runs when the app is opened again, which was checked.

**Lesson.** Computer Use asks macOS to open the app each time it looks at it, which rightly brings a closed window back. The log's "opened again" line shows it. A test of "stays closed" must read the state with the shell before Computer Use looks again.

## Cowork: tried on the real app, and what the app says instead, November 10, 2026

Nathan asked for the features still open in the original plan, each in its own thread. This one was Cowork (COW-01): a plugin picked in Central Knot should install and load in a Cowork session of Claude desktop, if a local route exists; if none does, say so with evidence and show Cowork honestly.

**What was found** (the full record: `docs/capability-data.md`, section 7, "Cowork on the real app"). Nathan's Mac, Claude desktop 5.1231.0 with its Claude Code 2.1.321, an ordinary claude.ai account.
- Cowork has a plugin folder on the computer, per account, in Claude Code's own format, and Claude Code writes it with a `--cowork` flag that its help doesn't list. A test plugin installed that way was listed by Claude desktop under Customize › Plugins as "Installed locally", switched on, with its skill.
- A new Cowork session did not load it. The one message sent (with Nathan's go-ahead) got "Unknown skill". The session ran in the cloud with the Mac attached as a device, and the logs show no Cowork session started on the Mac itself since at least July 2026. Claude desktop's code hands that folder's plugins only to a session that runs on the computer, and it moved locally added marketplaces into the Claude account.
- No command was found that puts a plugin into the account.

**What was built.**
- First, the whole route: Cowork as a tool on the Plugins pages, installed into through Claude desktop's own Claude Code with `--cowork`. It worked as far as Claude desktop's list, with unit and end-to-end checks. Once the session showed that nothing loads from there, it was taken out: an install that doesn't load would mislead. It is kept on the branch `cowork-local-route` (commit 69edf16) in case a later Claude desktop loads from the folder.
- What is in the app: where Claude desktop is installed, Claude Code's card on Harnesses has a row "Cowork — uses the plugins in your Claude account", and each plugin's page says under Your tools: "Cowork in Claude desktop uses the plugins in your Claude account, so Central Knot doesn't install there. Plugins for Cowork are added in Claude desktop, under Customize › Plugins." A home where apps aren't looked for (a chosen folder) says nothing. Cowork is no tool, column or destination anywhere (`hasCowork` in `src/presence.ts`, `coworkWords` in `src/words.ts`).
- README and SPEC COW-01 now say this; capability-data section 7 has the evidence and what is not established.

**On the Mac.** `~/.claude` and Claude desktop's data folder were backed up before the first write, to `~/agent-builds/central-knot/cowork/backup-2026-11-10/`. The writes were to Cowork's folder only (`cowork_plugins/`, `cowork_settings.json`, and Claude Code's own `.claude.json` and `backups/` beside them); `~/.claude` was not touched.
Afterwards the test plugin and its marketplace were removed with the same commands and the folder was put back to what the backup holds (compared file by file).

**Validation (macOS 26.6.2).**
- `npm test`: 425 pass, with a new test of when Cowork counts as here (Claude desktop found; never in a home that wasn't searched).
- Mac packaged e2e passes in CI (run 42922849554: 597 passed, 0 failed), with a check on the runner's real-home pass that Claude Code's card speaks of Cowork exactly when Claude desktop was found. The checks of the plugin page's line and of a home with the CLI alone are in the few-tools pass, which the Mac runner skips because tools are installed for everyone there; they pass in a local run (33 passed).
- Judges, two rounds: Opus 5.5 gave interface 8 and code 8.5, then 8.5 and 8.5; Fable 5.2 (in Astra's seat: Astra was out of quota) gave 8.5 and 8.5. Both ranked the plain statement above saying nothing and above an install column with a warning. Their findings were wording that claimed more than was seen, a contradiction left in COW-01, a line too wide on a large window, and two checks that could not fail; all were fixed after the last round, and not judged again.
- An ad hoc packaged build with its own empty home, real clicks through Computer Use: the Claude Code card showed the Cowork row whole and no other card mentioned Cowork; a folder marketplace added through the page showed no Cowork column; the plugin's page showed three tool boxes, no box for Cowork, and the line under them on two lines, whole at the smallest and at a large window.

**Not proven.**
- Whether any Cowork session still runs on the computer itself for an ordinary account and loads from the folder (a task given a folder, or the plugin page's own "Try in chat"). Nathan was asked for two more tries; no answer by the time this landed. The Mac's Cowork VM files had been deleted in the disk cleanup the day before, though the logs show no session on the Mac since July.
- Adding a plugin through Customize › Plugins was not done here; the line names that place from Claude's documentation and from seeing the page.
- Other Claude desktop builds, Team and Enterprise accounts, third-party-provider deployments, Windows and Linux.

**Lesson.** "The app lists it" is not "a session loads it": Claude desktop showed the test plugin as installed and switched on while the session could not find it. Only the session's own answer settled it.

## Bundled build, step 1: a custom build that carries a marketplace, November 10, 2026

Nathan asked for the features still open in the original plan, each in its own thread. This is the first of four steps of the bundled build (plan Phase 6a; SPEC ORG-01, ORG-02, ORG-06, ORG-07 and the open-and-browse part of ORG-03).

- **The build command.** `npm run package:mac` takes optional inputs: `--marketplace`, `--app-name`, `--app-id`, `--app-icon`, `--marketplace-name`, `--marketplace-logo`, `--sequence`. None of them: the standard app, as before. Any of them: a custom build with its own bundle id (`com.centralknot.custom.<id>`) and settings folder; it must be given its name, since a second "Central Knot" would take the standard app's place in Applications. Marketplace branding without a marketplace is refused before anything is fetched. `scripts/custom-build.mjs` stages the same build on any system for a development run (`CK_CUSTOM_BUILD=<folder> npm start`).
- **What is packed.** The marketplace as it is (modes and links kept), without the fetch's `.git` folders. A plugin kept in another Git repository is fetched and copied into `_bundled/<plugin>/`, and its `marketplace.json` entry is pointed there; nothing else is rewritten, and a marketplace with nothing kept elsewhere is carried byte for byte. A plugin that can't be packed (an npm package, a repository that can't be fetched) is named in the build report with the reason, and the build is still made. The release is a manifest (`release.json`: marketplace, sequence, date, what it was made from, plugins, the archive's size and SHA-256) and one `.tgz` (`src/bundlepack.ts`).
- **In the app.** A custom build reads its identity from `custom-build.json` beside its code, keeps its settings in `Application Support/com.centralknot.custom.<id>/`, and never starts the standard app's updater. A bundled build unpacks the release it carries into `bundled/marketplace` in that folder at open, checked against the manifest's size and checksum and read as a marketplace before it replaces anything. An older release never replaces a newer one, a release that can't be used leaves the last working one in place (the log says why), and a swap stopped halfway is mended at the next open (`src/bundle.ts`). Plugins lists the marketplace first, marked Built in, with the build's name and picture for it; About says which release it is and has no Remove; a plugin the build doesn't carry says why and can't be chosen. Settings has a row, This build.
- **The app's name.** `scripts/build.mjs` writes the build's name wherever the app says "Central Knot" (in the built code and the page), so the source has no second set of words. What is written outside the app keeps the product's name in every build (`PRODUCT` in `src/values.ts`): the markers around base instructions in a tool's file, and a Git repo commit's author and message. Without that a custom build and the standard app would not recognise each other's base block (found by the code review).
- **Check.** `scripts/bundled-check.mjs` runs the documented command on the fixture marketplace (plus an npm plugin), deletes the marketplace, opens the build in a throwaway home and checks it. The Mac CI runs it on the packaged app after the end-to-end checks.

**Validation.**
- 438 unit tests.
- Mac run 42925216159 on the branch with `next` merged in (after Cowork landed): end-to-end 595 passed against the packaged standard app; `scripts/bundled-check.mjs` 44 of 44 against the packaged custom app (the archive is unpacked from inside `app.asar`). The same check passes on the Mac as Nathan's own account, and as a development run.
- Side by side on the Mac, both opened through macOS (`open`) from one folder, each with a throwaway home: `Central Knot` (`com.centralknot.firstlook`) and `Acme Knot` (`com.centralknot.custom.ck-bundled-check`) ran at once, each window under its own name, the custom build with its own settings folder and its marketplace unpacked in 32 ms. Nothing in the real `Application Support/central-knot` changed.
- Reviews, Opus 5.5 and Fable 5.2 (Astra could not run: the ChatGPT usage limit was reached). Code: 7 and 7, then 8.5 and 8.5; every finding fixed, among them the base-instruction markers and commit text renamed with the app, a relative marketplace folder read as a Git source, app names that broke packaging at the end, an empty plugin folder counted as packed, and a settings folder that could have been another app's. Interface: 7.5, 8, 8.5; the last round's wording is in.

**Not done or not proven.**
- No click-through in a real window: Computer Use runs on the same ChatGPT account. The pages were driven over the debug port on the packaged app, and looked at in pictures.
- A custom build signed with a Developer ID, and a disk image for one. The menu bar icon stays the standard one.
- A plugin kept in another repository only in a Codex-format manifest, when the marketplace has both manifests, is not fetched.
- At 860 wide the app's name shows nowhere on a page (the sidebar is a rail, the status bar shows only the version), as for the standard app.
- Registering the marketplace with each tool (step 2), a content feed (step 3) and one build taking over syncing (step 4) are the next steps.

## Bundled build, step 2: the marketplace in each tool's own list, and installs from the bundle, November 10, 2026

Second of four steps (plan Phase 6b; SPEC ORG-03, ORG-04, REC-01).

- **Decision.** Which tools get the bundled marketplace added at first open was left open by the plan. Two judges (Opus 5.5 and Fable 5.2; Astra could not run, the ChatGPT usage limit was reached) both ranked "every installed tool that takes plugins, automatically" first, ahead of asking once and of adding only at the first install. Built that way, with the conditions both attached; Nathan was told and can switch it to asking once.
- **Adding.** `plugins.addMarketplace` is the step `install` already took before installing, now on its own: the tool's own `plugin marketplace add <folder>`, counted only when the tool's record then lists it, never over a different marketplace of the same name. After each read of this Mac's home (`addCarriedSoon` in `src/main.ts`, `addCarried` in `src/marketplaces.ts`), a bundled build adds its marketplace to each plugin tool it has not added it to yet: only in this computer's own home, only where writing is allowed, only for a tool whose commands can run, one tool per turn of the app's queue. `bundled/added-to-tools.json` in the build's data folder records each tool once added (an install from the build's marketplace into a tool counts too), so a marketplace taken out in a tool is not put back by itself; a failed add is tried again at the next open. The status bar says once that nothing was installed and which tools now list it.
- **By hand.** The marketplace's About tab says which tools list it, that the app added it, and that taking it out in a tool is respected; it has **List in <tool>** for one that doesn't and could.
- **Installing** needed no new code: the unpacked folder is a folder marketplace, and the Plugins page installs, updates and uninstalls from it as from any other.

**Validation.**
- 442 unit tests.
- Real CLIs on the Mac in throwaway homes (`tests/harness/plugins.harness.ts`): Claude Code 2.1.311, Copilot CLI 1.0.109 and Codex 0.142.3, and the same through the desktop apps' own copies. The bundle is packed, unpacked into a data folder with a space in its path, added to the tool's own list, installed and uninstalled; a second add runs nothing.
- Mac run 42926517721 on the branch with `next` merged in: end-to-end 595 passed; `scripts/bundled-check.mjs` 57 of 57 against the packaged custom app. Stand-ins for the tools' CLIs record what they were asked: added once to Claude Code and Codex at the first open, Copilot CLI (which refuses this fixture marketplace) left alone, not added again after it was taken out of Claude Code, and **List in Claude Code** putting it back.
- Reviews, Opus 5.5 and Fable 5.2: code 8, then 9; interface 7, 8, 8.5. Fixed on the way: a tool skipped by a home switch was never tried again; an install from the bundle was not counted as adding; "Nothing was installed" on About could become untrue.

**Not done or not proven.**
- No click-through in a real window (Computer Use shares the ChatGPT account whose usage limit was reached), and no session in a signed-in tool showing the marketplace in its own plugin browser: the tools' own records are what was read.
- Two **List in** buttons at once were not pictured (it needs two tools that lack the marketplace and can take it).
- Cowork is not a destination.

## OpenCode as a tool, November 10, 2026

Nathan asked for the features still open in the original plan, each in its own thread. This is the first of the "more tools" thread: OpenCode becomes a tool like the others (plan 11c, SPEC OC-01 to OC-04), built the way Pi was added.

**Measured first** (picoder, Linux x64, OpenCode 1.19.5 from npm `opencode-linux-x64` and 2.2.5 from `@opencode/cli-linux-x64`, throwaway homes outside any real home, a stand-in model server that records what a session is sent). Both lines agree unless said:

- Skills are listed and sent to the model from `~/.config/opencode/skills`, `~/.claude/skills` and `~/.agents/skills`.
- A skill is turned off by `"permission": { "skill": { "<name>": "deny" } }` in the settings file: by name, whichever folder holds it. The last rule that matches the name decides (`{ "x": "deny", "*": "allow" }` leaves x on), so the rule has to go last. A denied skill is left out of what a new session is sent.
- MCP servers are read from `mcp.<name>` and from `mcp.servers.<name>` (what 2.2.5's own `mcp add --global` writes). `enabled: false` turns an entry under `mcp` off on both lines; `disabled: true` turns one under `mcp.servers` off on both; `enabled: false` under `mcp.servers` is honoured by 1.19.5 only.
- Settings: 1.19.5 reads `config.json`, `opencode.json` and `opencode.jsonc`; 2.2.5 reads the last two; `opencode.jsonc` decides where both have a key. 1.19.5 adds `"$schema"` to a file it loads.
- Agents are `agents/<name>.md` (and the older `agent/`). With no `mode`, 1.19.5 makes one `all`, 2.2.5 `primary` (never handed work); `mode: all` is read by both. A `name` in the frontmatter names the agent on 1.19.5; 2.2.5 goes by the file name. `disable: true` leaves one out. `~/.claude/agents` is not read.
- `~/.config/opencode/AGENTS.md` is sent in every session. With none, 1.19.5 sends `~/.claude/CLAUDE.md` instead; 2.2.5 sends neither.
- A `"*"` rule written in `permission` after `skill` overrides the skill rules (a denied skill is sent again); written before `skill`, it does not.
- A local server's `cwd` is honoured: the server starts in that folder.
- A skill in a folder whose name starts with a dot is not sent.
- `--version` prints `1.19.5` or `opencode v2.2.5`, makes empty folders and a log, and starts nothing.
- Nathan's Mac has both lines: Homebrew's CLI 1.19.5, the installer's 2.2.5 in `~/.opencode/bin` (first on his terminal's PATH) and OpenCode.app 2.2.5, which names the OpenCode it carries in `Contents/Resources/opencode-cli.version`.

**Built.**

- **Found** when its CLI or OpenCode desktop is there (`~/.opencode/bin/opencode` first, then the usual places; `/Applications/OpenCode.app`). The app's own copy is never run: a 2.x started on a fresh data folder stops a 1.x from working (OC-03). Its folder follows `XDG_CONFIG_HOME`.
- **Skills.** One tool definition with three skill folders. A skill in the own folder of another tool that is here (Claude Code's) is that tool's copy, which OpenCode reads (`readsFrom` on the copy, `src/manage.ts` gather): it is shown for OpenCode with a link mark, and both rows say so ("Reads Claude Code's copy.", "OpenCode reads this copy too."), but it is no location of its own, so sync writes no second copy, it blocks no choice between differing copies and is never reported as an older copy. A skill new to both goes to Claude Code's folder only. Where the owner is left out of a managed skill or its copy is removed, OpenCode gets that copy as its own first; Restore puts back OpenCode's own copy, not the one it reads, and makes no second copy beside a restored Claude Code one. Remove is offered only in OpenCode's own folder and says when OpenCode still reads Claude Code's; removing an unmanaged copy OpenCode read says it no longer has the skill. Disable is the deny rule: changed in place when it already decides, else written last. Enable takes the rule out, or adds an `allow` after a wider `deny`. `permission` written as one word, or with a `"*"` rule after `skill` (it decides for every skill, and moving `skill` after it would make overruled rules count again), is reported and never edited. A skill with no frontmatter or no `name` is marked as one OpenCode 1.x can't load.
- **MCP servers.** Read from both places; a new entry goes under `mcp` in the form both lines read, an existing one is changed where it is. Each place gets its own off key. `opencode.jsonc` is the file when there is one. Comments and trailing commas stay (`readJsonc` in `src/textedit.ts`), and removing an entry or a rule takes its own line and the comment lines above it, so every other entry keeps its comments (`withoutMember`); a comment above an object's first member stays, since it may be about the whole object. A working folder is written as `cwd`. SSE has no form there, and says so.
- **Agents.** Markdown in `agents/`, named by the file. A new one is written with `mode: all` so both lines treat it alike; OpenCode's own fields stay in its file.
- **Instructions.** `AGENTS.md` in its folder, with base instructions like any other tool. With no `AGENTS.md` and a `~/.claude/CLAUDE.md`, the card says OpenCode 1.x reads that file until this one exists.
- **Plugins.** OpenCode takes no plugin whole (a Claude-format repository fails on both lines, OC-02), so a plugin's skills, MCP servers and agents go in as parts, as for Pi.
- **Five tools.** The tables, the plugin table and a plugin's part switches get narrower steps so nothing is cut off at 860×560 with five tools, sidebar open or folded.
- **Also fixed on the way.** A tool that takes no plugins (Pi too) was named among the tools marketplaces come from and plugins install into; the Git repo page's note named tools the person may not have.
- **End-to-end runs** look for OpenCode only inside their throwaway home (`CK_TEST_HOME_ONLY`): the Mac they run on has OpenCode installed, which would otherwise add a tool to every flow that opens "This Mac's home".

**Not done.** Disable for one agent (`disable: true`): no tool had an agent switch before, so it is its own step. Agents in the older `agent/` folder are not listed. With both `opencode.json` and `opencode.jsonc` present, only `opencode.jsonc` is read (managing a server that is only in `opencode.json` writes a second entry into `opencode.jsonc`, which then decides), and servers a 1.x user keeps in `config.json` are not seen. `enabled: false` under `mcp.servers` (off on 1.x only) reads as on. A block comment over several lines above a removed entry stays behind. Whether OpenCode takes an SSE server as `remote` was not measured, so SSE stays refused. After a removed Claude Code copy is restored, OpenCode keeps the copy of its own it was given. The link mark on a read copy is small. The CLAUDE.md note names both OpenCode lines whatever is installed. An OpenCode skill synced to Claude Code is then in two folders OpenCode reads; 1.x notes a duplicate name in its log and uses its own. OpenCode writes no draft of the base instructions (2.x answers through a background service Central Knot never starts). Its own npm plugins are not moved. Windows and Linux app locations. A skill with no `name` is refused for OpenCode even where only 2.x is installed.

**Review.** Three rounds, two judges each (Opus 5.5 and Fable 5.2; Astra could not run, ChatGPT usage limit). Round 1: interface 7 and 7, code 7 and 6.5; nothing cut off. Its main finding, by both: a skill OpenCode reads in Claude Code's folder was modelled as a separate copy Central Knot can't change, which blocked choices and produced wrong sentences. Round 2, after the `readsFrom` rework: interface 8 and 8, code 7.5 and 7.5; both would merge after a short list, all done above: Restore of OpenCode's own copy (a lost Undo), removing or leaving out Claude Code's copy in a Claude Code and OpenCode home, a Disable that could switch other skills off when `skill` was moved after a `"*"`, and the box and sentence of a copy that is only read. Round 3, a confirming check: interface 8.5 and 8.5, code 8 and 8, both "merge as it is", each having run its own scenarios against the code (about 40 in one case). Their four small follow-ups are in: a copy OpenCode gets as its own is in that Apply all's History, so Undo takes it out; a copy of its own that the person deleted is not made again from Claude Code's; Remove from Claude Code doesn't say OpenCode lost a skill it was given in the same pass; a settings file whose form isn't edited still shows what it turns off. Their smaller points are under Not done.

**Real window on the Mac** (ad hoc packaged build of the branch, a throwaway home made from a copy of the real tool settings, real clicks through Computer Use; the real home untouched): OpenCode's card read "Installed · 1.19.5; OpenCode desktop 2.2.5" with 40 skills; its page's tabs and About rows were right; Skills showed OpenCode as a column; Disable of `grilling` in OpenCode and Apply all gave "grilling disabled in OpenCode." and wrote `"permission": { "skill": { "grilling": "deny" } }` into that home's `opencode.json` and nothing else; nothing was cut off at the smallest window. It also showed the two faults fixed afterwards (the read copy's wording, a server with a working folder refused).

**Validation.** 447 unit tests on the branch merged with next, 12 of them new in `tests/opencode.test.ts` (the forms, both off switches, comments kept, and each case the judges broke). Mac packaged end-to-end in CI on the merged branch: 640 passed, 0 failed (run 42925661724), with a new flow, `openCodeFlow`: OpenCode found by a stand-in CLI and desktop app, its pages, writes in the Practice copy (manage, Disable and Enable, a server to Copilot CLI, a plugin's parts), and nothing cut off at 860×560 on every page with five tools. The same checks pass in a Linux development run (554), a debugging aid. Central Knot's own code wrote into fresh homes that the real OpenCode 1.19.5 and 2.2.5 then read: the servers listed and switched off as written, the agent offered, the denied skills left out of a session and an enabled one back in.

## Plugin updates that arrive by themselves (PLG-08, PLG-09), November 10, 2026

Nathan asked for the features still open in the original plan, each in its own thread; this is the plan's "7a updater". Until now a plugin update was a button.

- **What it does.** Every four hours, with or without a window, Central Knot reads every marketplace again and makes the updates that Update all would offer, through each tool's own command (`src/pluginupdates.ts` for the steps, `marketplaces.pendingUpdates` for what is due, the timer and the queue in `src/main.ts`). The first look comes a minute after the app starts, and checks only if the last check in that home is four hours old; the timer asks every five minutes, so a Mac that slept through a check's time checks soon after it wakes. A check that reached no Git marketplace (offline) or stopped partway is made again in half an hour.
- **It only updates what a tool has.** A tool without the plugin gets nothing (only updates run; an update needs the plugin installed). A plugin turned off in a tool is still off afterwards: Central Knot reads the switch before the tool's update and, where the update turned it on, turns it off again with the tool's own switch (`plugins.update`, for the Update button too). Parts in a tool that can't take the whole plugin are updated as Update parts does, with parts turned off left out.
- **Never an uninstall with nobody watching.** The button's second route for a copy that differs at the same version (uninstall, then install) is not taken by itself: an install that failed would leave the tool without the plugin. Where the tool's own update keeps such a copy, the note says so once, with "Update it on its page to reinstall it", and it is not tried again while the marketplace offers the same.
- **No longer offered.** A plugin a marketplace's catalog has dropped stays listed where a tool still has it, marked "No longer offered", with what the tool holds on its page and its Uninstall; it is never updated or removed. Nothing is inferred from a marketplace that couldn't be read.
- **What the person sees.** A note at the top of a marketplace's list on Plugins (it scrolls with the list, and stays off a plugin's own page): which plugins were updated to which version in which tools, and what couldn't be, in the tool's own words; each half closes on its own. The first such note says once that plugins now update by themselves and that Settings turns that off. A failure is tried again at the next check, then after two, four… checks' time, at least once a day; Check now tries all of them; one made by hand on the page clears its note at once. The menu bar icon gets its dot and a line ("Plugins were updated" or "A plugin couldn’t be updated") until the window is seen. The log has each check and each step (`plugin updates: …`, `plugins:update (by itself) …`). The record is `plugin-updates.json` in the app's data folder, one entry per home.
- **Settings.** A new Plugins section: **Update plugins automatically**, with **Check now** and what the last check came to.
- **Decisions** (Opus 5.5 and Fable 5.2 ranked the options and agreed on each; Sol 6.1 could not run, ChatGPT usage limit): on by default; every four hours, the app's own update rhythm (each check clones every Git marketplace again, and a plugin release is never urgent); Automatic sync off pauses it, since that switch is where a person says "write nothing to my tools in the background", and Check now still works. The old spec had hourly and "independent of Sync".
- **Quit** waits for a tool's update command under way and for its note to be saved (15 seconds at most), and starts no further step. A check that is only reading the marketplaces holds nothing up.
- **Test hook** (read only when set): `CK_PLUGIN_UPDATES_EVERY_MS`, the time between checks, or `never` for only the checks asked for. The end-to-end run and the tour set `never` for every other flow.

**Found on the way.** Codex 0.167.0's own update (`plugin add` again) turns a turned-off plugin back on; Claude Code 2.1.311 and Copilot CLI 1.0.109 keep it off. All three keep the installed copy of a plugin its marketplace dropped when their copy of the marketplace is refreshed (capability-data section 7).

**Validation.** 472 unit tests on the branch with next merged in (28 new: the steps in `tests/pluginupdates.test.ts`, what is due and dropped plugins in `tests/marketplaces.test.ts`, off-stays-off and the no-reinstall route in `tests/plugins.test.ts`). Real CLIs in disposable homes on the Mac (`tests/harness/plugins.harness.ts`): off stays off through an update, and a dropped plugin keeps its copy, for Claude Code 2.1.311, Copilot CLI 1.0.109 and Codex 0.167.0. End-to-end flow `pluginUpdatesFlow` (28 checks): with the window gone, the marketplace moves on and the stand-in Claude Code's copies are updated, the turned-off plugin off again, Codex asked for nothing, the dropped plugin kept; the note after a restart; a failure said, retried and cleared by a hand-made update; the switch; the pause with Automatic sync. Mac packaged run on the branch (run 42930040467, before the last merge of next, which on this side touched only the e2e script's list of flows and this file): 463 unit tests, e2e 625/625 with the flow in it.

On macOS 26.6.2, the packaged app (ad hoc) on a throwaway home with the three real CLIs and a Git marketplace served on the Mac: `ck-marker` 1.0.0 in Claude Code and Codex, turned off in both, not in Copilot CLI; `ck-other` in all three. The marketplace moved `ck-marker` to 2.0.0 and dropped `ck-other`. The app was started, its window closed 15 seconds later (the system then listed it as a menu-bar-only app), and at one minute its own first check updated `ck-marker` to 2.0.0 in Claude Code and Codex, both still off; Copilot CLI still without it; `ck-other` still 1.0.0 in all three. Then a real-window pass through Computer Use on the reopened window: the note, the "No longer offered" mark, the note's Settings link, the switch off and on, Check now ("Nothing needed updating"), the row at the smallest window size, the red close button.

**Not proven.** A full four-hour wait and a wake from sleep on a real Mac (the schedule was run at two seconds end to end, and at its real one-minute first look on the Mac). A real plugin from a real marketplace on the real home. Parts in Pi updated by themselves in the real app (unit tests only). Quit during a real tool's update.

**Left as it is.** An update of a tool's parts brings in a part the plugin has added since, as Update parts on the page does. The reading of the marketplaces waits its turn in the app's one queue, as Refresh does, so an Apply all clicked just then waits for it. A plugin turned off in every tool still shows a check on the Plugins page (open since the display-order work).

## Bundled build, step 3: publishing newer plugins, and the feed, November 11, 2026

Third of four steps (plan 7b's publisher and feed; SPEC ORG-05, D-35, the bundle part of PLG-08).

- **Decisions.** The plan left two choices open; two judges ranked the options (Opus 5.5 and Fable 5.2; Astra could not run) and Nathan was given the recommendations, which are built. A publish with a plugin that can't be packed: one that can never be packed (npm, pip) is left out and named, one whose fetch failed this time holds the release (Fable's first choice, Opus's second). Where things come from: the feed is any http or https address given at build time; a custom build's own app updates stay "none, and the app says so" until a custom build is signed with a Developer ID, since an unsigned app can't replace itself.
- **Publishing.** `scripts/publish-bundle.mjs` (`publishRelease` in `src/bundlepack.ts`) packs the marketplace as the build does and writes the archive, then the manifest, into the folder the feed serves. Nothing is written unless the whole release can be; the sequence must be higher than the folder's; another marketplace is refused; `--min-app` names the oldest app that can use it.
- **In the app.** `src/bundlefeed.ts`: the manifest is read from the feed's address, and a newer release of the same marketplace is downloaded (exactly the bytes the manifest lists), then put in use by the same route as the build's own release: checked, unpacked aside, read as a marketplace, swapped in, inside the app's queue. `src/main.ts` looks five seconds after the app opens, every four hours after, fifteen minutes after a look that failed, and on **Check now**. Every failure leaves the plugins in use and gives About its words.
- **A plugin no longer offered.** Tried with the real Claude Code 2.1 in a throwaway home: an installed plugin whose entry leaves its folder marketplace fails to load ("not found in marketplace"), though its files and a cache copy are there. So a release (from the feed, or carried by a newer build) keeps any plugin it no longer packs that a tool in this Mac's home has installed: its files go to `_kept/<plugin>/` and its entry, as it was, is pointed there (`carryOver` in `src/bundle.ts`); the manifest in use names them (`kept`). The page marks such a plugin No longer offered and installs it nowhere else. The release after it is uninstalled leaves it out.

**Validation.**
- 480 unit tests; `tests/bundlefeed.test.ts` covers the feed, publishing and kept plugins with a stand-in for the network.
- Mac run 42933624333 on the branch with `next` merged in (after plugin auto-update and OpenCode landed): end-to-end 670 passed; `scripts/bundled-check.mjs` 70 of 70 against the packaged custom app. It serves a feed folder on this computer and publishes into it with the documented command: nothing published says so and changes nothing; a release is taken on Check now and the Plugins tab shows the new version; a plugin it no longer offers stays for the tool that has it; a publish cut short leaves the last good plugins and says why.
- Reviews, Opus 5.5 and Fable 5.2: code 7, then 8.5; interface 8, then 8.5. Fixed on the way: a kept plugin's entry written into the wrong manifest; a download left behind when the app quit; the manifest read from the app's web cache; a broken release downloaded again every fifteen minutes; a stalled download that could hold the feed open for good.

**Not done or not proven.**
- No feed on a real web server or over https: the check's feed is a folder served on this computer over http.
- A release that needs a newer app (`--min-app`) is covered by unit tests only, since a custom build has no updates of its own to become newer by.
- A plugin that is the marketplace's own root (`"source": "./"`), once kept, is read by the tools as an ordinary plugin folder, so they may also find skills in it that its entry never listed.
- Installed copies in a tool that keeps its own copy (Codex) are not updated by the feed itself; the Plugins page offers Update, and plugin auto-update (PR #76) applies to this marketplace as to any other.

## Suggested marketplaces, November 11, 2026

Second step of the "more tools" thread (plan 11a; MKT-03, D-27): marketplaces offered without the person having to find and add them.

- **What it does.** Under the marketplace list (and under the add box on the empty page, in place of the two examples there), a "Suggested" group offers a marketplace from the maker of each plugin tool that is installed: Anthropic's `claude-plugins-official` for Claude Code and Codex, GitHub's `copilot-plugins` for Copilot CLI. One is offered only where a tool it is for is here and nothing lists it yet (not added here, not registered by a tool, matched by repository however it is spelled). Nothing is fetched to offer it. **Add** is the page's ordinary Add: it lists the marketplace and installs nothing (D-27). The × stops it being offered for good, says so, and has Undo. A custom build that carries its own marketplace suggests none. The list is `src/suggested.ts`; the view carries `suggested`, and `marketplaces-declined.json` in the app's data folder holds what was declined.
- **How the two were chosen.** Facts on eight candidates (catalog file, plugin count, last push, licence) were gathered, and two judges (Opus 5.5 and Fable 5.2) ranked them. Both put Anthropic's official marketplace and GitHub's `awesome-copilot` first, and neither would offer a single-maintainer catalog under the app's name. Claude Code registers the official one itself after a session; Copilot CLI has `awesome-copilot` built in (`copilot plugin marketplace list` in a fresh home, 1.0.109: "Included with GitHub Copilot: awesome-copilot").
- **What review changed.** `awesome-copilot` keeps its list only in `.github/plugin/marketplace.json`, which Central Knot doesn't read, so its Add always failed; both judges found this by running the app's reader on the real repository. The Copilot CLI suggestion is GitHub's `copilot-plugins` instead (its `.claude-plugin/marketplace.json` links to the same file). Also from review: each suggestion is named as its catalog names it, so it reads the same after Add; no sentence says what a tool "comes with"; declining has a note and Undo and draws at once on the empty page.
- **Also fixed.** A toolbar that isn't drawn (one holding only a title, in narrow content) was measured as too wide (`overflows` in `src/dom.ts`).

**Validation.** The app's own Add run against both real sources: `claude-plugins-official` 317 plugins, `copilot-plugins` 18, neither offered afterwards. Unit test "A tool's own marketplace is suggested…" in `tests/marketplaces.test.ts` (folder stand-ins, no network). End-to-end flow `suggestedFlow`: offered per installed tool, declined on the empty page with Undo, under the list beside a marketplace, nothing cut off at 860×560, still declined after a restart. Two review rounds (Opus 5.5 and Fable 5.2): 7 and 6.5 on interface, 7 and 7 on code, then 8.5 and 6.5, 8.5 and 6.5, the lower pair for a decline that didn't redraw on the empty page, fixed after it with the check that would have caught it.

**Not done, for Nathan.** Which marketplaces are offered is his choice: this is the recommendation. Offering `awesome-copilot` needs the app to read Copilot's own catalog location and to know Copilot CLI already has that marketplace built in, with one install proven on the Mac. The flow never clicks Add (it would reach the network). In a narrow window the strip of marketplaces grows a row while suggestions show.

## The other desktop apps and T3 Code, November 11, 2026

Fourth step of the "more tools" thread (plan 11d; DET-01, DIS-02, D-24), done before the third, which builds on the automatic plugin updates then still in review.

- **pi-gui** (a third-party desktop app for Pi; no official one is established) is Pi's desktop app: found in Applications, named "pi-gui (third-party)" with its version, and it alone makes Pi a tool here, since it uses Pi's own files. It carries no copy of Pi to name, so an app candidate may now have nothing it carries (`carried` in `src/platform.ts`).
- **T3 Code and VS Code** are no tool of their own. When installed they are named under the Harnesses cards, "Also on this Mac", each with its version (a nightly build's shortened, as on the cards) and one sentence: T3 Code runs the tools, and one it starts with this computer's home uses what is set up here (D-24: never "every T3 session"); VS Code's built-in Copilot lists skills from some of the tools' folders (seen listed in a signed-out editor, capability-data Appendix A), and its own settings are not changed. They are looked for on this computer's home only, never run, and nothing is said anywhere when they are not installed (`otherAppCandidates`, `findOtherApps`, `otherApps` in `src/harnesspage.ts`).
- OpenCode desktop was done with OpenCode. The names on the Mac were checked: `pi-gui.app`, `T3 Code (Nightly).app`, `Visual Studio Code.app`.
- End-to-end runs look for these apps only inside their throwaway home, like OpenCode (`CK_TEST_HOME_ONLY`), since the Mac they run on has them.

**Validation.** Unit test "pi-gui is found as Pi's desktop app, and T3 Code as an app that runs the tools". End-to-end flow `otherAppsFlow`: nothing said with none installed; both named with versions once installed; pi-gui alone makes Pi a tool with "no CLI found"; nothing cut off at 860×560. Two review rounds (Opus 5.5 and Fable 5.2), both "merge as it is" each time; their polish (the shortened version, plainer sentences) is in.

**Not done.** Windows and Linux locations. Cursor and other editors are not named. What a T3 Code session or VS Code's Copilot really loads was not measured here (V-14): the sentences claim only what was seen.

## Bundled build, step 4: one build syncs a home, and Take over syncing, November 11, 2026

Last of four steps (plan 12b; SPEC ORG-08 and D-31's outcomes).

- **What was there.** A home's sync record (`.central-knot/sync.json`) already named the build that made it, and any other build stopped with "belongs to another build". The record, what is managed, every choice and History live in the home, not in either build, so there is one copy of the state to hand over.
- **Naming the owner.** The record now also keeps its owner's own name (`ownerName`), and `syncGate` gives the page who it is (`owner`). A record written before this, by the standard app, reads as Central Knot. Whether that build is open now is asked of macOS for an installed app (`lsappinfo`, by bundle id). The pages say "Central Knot is open and syncs this home, so nothing is changed from here" or "…synced this home last and isn't open, so nothing is syncing here now": on Overview, Skills, MCP servers and Agents, and the status bar's sync switch reads "By Central Knot". The status bar no longer says writing is stopped in that case, since plugins and instruction files are still written by either build.
- **Take over syncing** (`takeOverSync` in `src/share.ts`): the record's owner becomes this build, nothing else in it changes, and this build remembers the record as its own. It carries on from the same items, baselines and choices. The other build finds another owner at its next look, stops, and offers the same button. Ownership never moves any other way; a record that can't be read is taken over by nobody.
- **Not in this step.** "Start fresh from current files" for a record that is lost for good (the app still stops and says to put the record back). The spec's list of single actions a non-owner may still do is narrower here: an instruction file save works, a Disable or Enable in one tool does not, since it goes through the same Apply all as sharing. The two builds do not lock each other's writes to one file beyond what every write already does (it checks the file first and never overwrites a save made meanwhile). A skills pass the old owner had under way when it was taken over stops before its next item and at its next save of the record (`stillOwned` in `src/share.ts`: the record on disk is under another owner), so it can't take the home back by finishing; a write to a tool's file it had already begun completes. An MCP or agents pass under way runs to its end (those passes don't save the sync record); it can't move ownership, and the build stops at its next pass.

**Validation.**
- 483 unit tests; the cycle between two builds on one home (owned, refused, taken over, refused the other way, taken back, an unnamed record, a damaged record, a stale save refused) is in `tests/manage.test.ts`.
- Two real apps on the Mac, both opened through macOS on one throwaway home (`owner.sh`): the standard build managed a skill; the custom build reported Central Knot as the owner and as open, took over with the skill still managed and the same record, and an edit then spread to the Copilot and Codex copies; the standard build, still open, reported Acme Knot as the owner, and took it back. The real `Application Support/central-knot` was untouched.
- Mac run 42935285308 on the branch: end-to-end 668 passed; `scripts/bundled-check.mjs` 82 of 82 against the packaged custom app (the standard app's record made with its own code, the line and the button on Skills and Overview, the takeover, the record under the new owner, the standard app's view of it afterwards). `next` moved once more after that run (suggested marketplaces, other desktop apps): merged in with only this file in conflict, 483 unit tests and the check as a development run passing; the packaged run on that exact merge is `next`'s own.
- Reviews, Opus 5.5 and Fable 5.2: code 8, then 8.5; interface 7, then 9. Fixed on the way: a pass the old owner had under way could take ownership back by finishing; a home that can't be written could be taken over; Overview said "All in sync" of a home another build syncs; the status bar said writing was stopped.

**Not done or not proven.**
- "Start fresh from current files"; a non-owner's Disable or Enable in one tool; any lock between the two builds beyond the checks every write already makes.
- An older build (before this step) that is taken over shows its old "belongs to another build" message and has no button to take the home back until it is updated.

## Bundled build: all four steps on next, November 11, 2026

PRs #74 (a custom build that carries a marketplace), #75 (the marketplace in each tool's own plugin list), #78 (publishing and the feed) and #80 (one build syncs a home, Take over syncing) are merged. No release was cut.

- **The run with everything together.** Mac run 42936925058 on `next` at 0277e6f: 483 unit tests, end-to-end 693 passed, `scripts/bundled-check.mjs` 82 of 82 against a packaged custom build made with the documented command.
- **Real clicks.** Three Computer Use tries on the Mac against a custom build named "Acme Knot", opened by me in a throwaway home. The first was spoiled by me: `scripts/bundled-check.mjs` always uses the app id `ck-bundled-check` and clears that id's data folder, and I ran it while the tester's app, built with the same id, was open. The tester's app now gets an id of its own. The second ended as cancelled after its first line, with no click. The third reached Computer Use, which listed Acme Knot as running and could not attach to it (`Computer Use server error -10005: timeoutReached`). So no step of the bundled build has been clicked through in a real window by a tester; the packaged app was driven over its debug port, opened through macOS beside the standard app, and run with the real Claude Code, Copilot CLI and Codex.
- **Seen on the way, with the real tools.** That last test app, opened through macOS with the real CLIs on the Mac and a throwaway home, added its marketplace to Claude Code's and Codex's own plugin lists by their own commands at first open (Claude Code's `known_marketplaces.json` named the folder in the build's own data folder), and left Copilot CLI alone because the fixture marketplace lists an npm plugin.
- **Choices still Nathan's to confirm.** Built as the judges and I recommended, each easy to change: every installed plugin tool gets the marketplace automatically (or ask once); a publish holds on a fetch failure and leaves out, by name, a plugin that can never be packed; the feed is any http or https address; a custom build has no app updates of its own until one is signed with a Developer ID.

## Selections that wait: a tool installed later gets the plugins the others have, November 11, 2026

Third step of the "more tools" thread (plan 11b; PLG-06, D-28b), built last, on the automatic plugin updates that had just landed.

- **The choice.** The plan's wording is "a plugin chosen for a tool that isn't installed yet goes in when that tool appears", with install policies, an expansion switch and lapse rules behind it. A tool that isn't installed shows nowhere, so nobody can choose a plugin for it by name. Two judges (Opus 5.5 and Fable 5.2) ranked three ways to keep the meaning: install by itself, offer it with one click, or a tick per plugin. Both put "by itself" first, with the list fixed at the moment the tool is first seen, and the tick last (the old plan in small).
- **The rule.** When a tool that plugins go into is first seen in a home, the plugins that every other tool there has at that moment, and it lacks, wait to go into it: an install where it takes the plugin, its parts where it takes parts (Pi, OpenCode). "Every other tool" means the tools that take plugins whole and can hold this one; a tool with no way to install here neither counts nor gets anything, and a plugin turned off in a tool that has it is not one every tool has, so it goes nowhere by itself. They go in at the next check, which a change in the home's tools now brings at once, through the same calls Apply all makes, and each is a line of the updates' note: "installed in Codex (new here; your other tools have this plugin)".
- **What keeps it from surprising.** The tools present when this first runs are only noted. So is a tool first seen while the Update plugins automatically switch or Automatic sync is off: each read of the home notes the tools there, so one installed in such a time is never taken for new when they are turned on again. The list of tools seen only grows, so a tool missed by one read and found by the next is not new. The list of plugins is fixed once: what went in leaves it for good, so a plugin taken out of the new tool later stays out, and one put in by hand, or no longer in every other tool, leaves it too. An install that fails says nothing and is tried again as a failed update is, three times in all, then given up with a line in the log. It follows the Update plugins automatically switch and pauses with Automatic sync; nothing is ever uninstalled.
- **Where.** `waitingNow` and `keepJoined` in `src/pluginupdates.ts` (the record gains `seenTools` and `waiting`); `joins` in `marketplaces.pendingUpdates`; `toolsChanged` from `src/main.ts`.

**Review.** One round on the design (above) and one on the code, Opus 5.5 and Fable 5.2: behaviour 7 and 7, code 8 and 7.5, both "merge after" a short list, done here: a plugin turned off elsewhere no longer arrives switched on in the new tool; a tool that arrived while updates were off or paused is not treated as new later; parts already there are not installed again; an update and a waiting install of the same parts run once; the log says "not tried again" at the last try only. Both accept that with one other tool, everything it has goes into the new one.

**Validation.** Unit tests: two scenario tests in `tests/pluginupdates.test.ts` (first run, new tools, retries and giving up, a tool missed by one read, by-hand installs, the switch and Automatic sync off) and the `joins` assertions in `tests/marketplaces.test.ts`. The end-to-end flows hold plugin checks still, so no flow or real tool has yet run a waiting install: what is proven is the rule and the calls it makes, which are the ones Apply all makes.

**Not done.** No Undo in the note: the plugin's page uninstalls it. A tool first seen while it can't take plugins yet (a desktop app whose copy of the tool isn't on disk), or while a marketplace can't be read, is noted and gets nothing later. A first check that misses a tool makes it new at the next. With one other tool, everything that tool has goes into the new one (one judge would require two tools to agree; the other accepts it; Nathan's to say). The plan's other D-16 rows (policies, an expansion switch, exclusions that survive, adopting plugins installed before) are not built: the fixed list covers what they were for.

## One item of a plugin, switched in one tool, November 11, 2026

Nathan, with two pictures of the Skills page: "Just because something is installed through a plug-in doesn't mean we shouldn't be able to disable it or enable it" and "This is a management tool. Let me manage." The **Through a plugin** box only opened the plugin's page, and a "From plugins" row's box did nothing.

- **Measured first** on the Mac, real programs, throwaway homes, a stub model that records what each tool sends (Claude Code 2.1.311 and 2.1.322, Copilot CLI 1.0.109, Codex 0.142.3 and 0.167.1; `docs/capability-data.md`, Appendix B and section 7). One **MCP server** of a plugin has a real off-switch in all three tools, and one **agent** in Claude Code; one **skill** in Copilot CLI and Codex (known). **Claude Code has no switch for one skill of a plugin**: `skillOverrides` leaves plugin skills alone (run, and read in its source), and a deny rule only stops Claude's own call while the skill stays listed and typing its name still runs it. Every switch stayed off through a plugin update from 1.0.0 to 2.0.0.
- **The box is the switch.** On Skills, MCP servers and Agents, on a person's own row and on a "From plugins" row, a click on the plugin box turns that item off or on in that tool on Apply all; it draws with the dashed edge while it waits and the off mark once off. The opened row has the same Enabled/Disabled switch where a person's own copy has it, with **Plugin's page** beside it. Apply all says what changed and offers Undo.
- **Engine.** `src/partswitch.ts` (text in, text out) and `plugins.setPart`: Claude Code `deniedMcpServers` by `plugin:<plugin>:<server>` and `permissions.deny` `Agent(<plugin>:<agent>)`; Copilot CLI `disabledMcpServers`; Codex `[plugins."p@m".mcp_servers.<server>] enabled = false`, added and removed to the same bytes, a table with the person's own keys kept, and a file that sets the servers as a value read but never edited. `plugins.setWhole` turns a whole plugin on or off (each tool's `plugin enable`/`disable`; Codex's `enabled`). One checked write each, read back. The plan (`pluginplan.ts`) gained `part-off`/`part-on` and `plugin-off`/`plugin-on`; the page logic is `src/pluginswitch.ts`.
- **Where a tool has no switch for one item** (a skill in Claude Code, an agent in Copilot CLI) the box turns the whole plugin off or on there. Its tooltip says so and names what goes with it, every row of that plugin shows the change before Apply all, and the change bar names the plugin. Two judges ranked the honest options for Claude Code's skills: Opus 5.5 put the whole plugin first and a deny rule ("Blocked") second; Fable 5.2 the other way round; both put "no switch" and "take the plugin apart" last. The whole plugin is what is built; the choice between the two is with Nathan.
- **A plugin that is off as a whole**: turning on one of its items turns the plugin on with its other switchable items held off, so of the items that can be switched only that box changes (what has no switch of its own there comes on with the plugin, and the tooltip says so first); turning it off again puts everything back.
- **One draft for the three pages.** A whole plugin chosen to go off on Skills shows as waiting on its MCP servers and Agents rows too. One Apply all with copies' changes and plugin switches both chosen writes the copies first, then the switches; one result says both, and its Undo takes back the switches and then whatever the copies' own Undo covers (where the copies' changes have none, the button says "Undo plugin switches"); a copies' run that is stopped as a whole stops it there, with the switches still chosen.
- **Kept off.** Codex's own uninstall takes a plugin's server switches out with the plugin's table, so an update that reinstalls turns them off again (`plugins.update`). A Codex file that sets a plugin's servers as a value is read (the box shows what it turns off) and its box says why it can't be switched. Copilot CLI's whole-plugin switch isn't offered for a plugin it loads live from a folder, where off is the same as uninstalled.
- Started from the other thread's branch `fix/plugin-skill-off-cell` (the box as a switch, `setWhole`, the page's plugin draft), which this replaces.

**Validation.**
- Mac runs 42947138709 on 9a0835e and 42948494949 on aeda1fe (the commit before the last line of words): each 512 unit tests, end-to-end 706 passed and 0 failed, bundled check 82 of 82.
- The packaged app on the Mac, opened over SSH on a throwaway home where the real Claude Code 2.1.311, Copilot CLI 1.0.109 and Codex 0.142.3 had each installed a probe plugin from a Git marketplace, driven through its debug port (kit and steps in `~/work/ck-next/plugin-skill-switch/kit`). After the app's switches, one turn in each real tool against a stub model: the server turned off was gone from all three requests, the skill from Copilot CLI's and Codex's, the agent from Claude Code's, and everything else was still there. The same after the app updated the plugin to 2.0.0 in all three. Run three times: on the first build, on the build with the first round's fixes, and on 9a0835e, the last two with switches chosen on all three pages and one Apply all. A skill's box under Claude Code turned the whole plugin off (nothing of it in Claude Code's request); one server's box then turned the plugin on with only that server on; Undo and the opened row's switch did what they said.
- Two judges, Opus 5.5 and Fable 5.2, five rounds. Interface: 8 and 7, then 8 and 8.5, then 8.5 and 8.5, then 8 and 8.5, then 8.5 and 9. Code: 7.5 and 6.5, then 8 and 8, then 8.5 and 8, then 8 and 8.5, then 8.5 and 9. In the last round Fable found nothing above a nit, and Opus one line of words that named too little (fixed after it). What they found is fixed, each with a test where it is logic: an Apply all that could repeat without end when a run was stopped; a lost Undo when both kinds applied together; a waiting box drawn like one that is on; a held-off item left chosen unseen; an agent's off state not said in words; Codex switches written as a dotted key or a value read as on; a Codex update that reinstalls dropping a server's switch; a person's own Codex subtable deleted when the switch's table was added; a second click that dropped the first choice where some items have no switch; item switches left written when the plugin then failed to come on; a second click on a box that did not take the first back.

**Not done or not proven.** The plugin's own page has no switch for one MCP server or agent yet (only for skills, as before). A person's own agents still have no Disable. Copilot CLI's bare-name server switch also turns off a person's own server of the same name. These switches are not listed on the History page (like the Plugins page's own), only undone from the result. Copilot CLI's skill switch still needs its CLI.

## One switch per item on Skills, MCP servers and Agents, November 11, 2026

Nathan, the same day: the per-tool matrix was too complicated; turning an item on or off should apply in every managed tool, with per-tool control secondary. Steps 1 to 3 (PRs #86, #87, #88) and the judges' follow-ups (3b) are on `next`. What this changes in the entries above, for these three pages (the Plugins page keeps **Apply all**):

- **No Managed switch, no Apply all, no drafts.** Each row has one switch at its start: On syncs the item to every managed tool and turns it on there; Off turns it off everywhere (each tool's own switch for skills and MCP servers, the copies kept; an agent leaves every tool and stays in Central Knot: the library section below); halfway is Not synced (an agent: found). Each click applies at once, with one result and Undo at the top of the page. "Managed" in the entries above means synced.
- **The per-tool boxes are status marks.** Each tool's own control (its switch, Sync here, Remove, Write to Claude Code, a plugin item's switch there) is on its line in the opened row. "The box is the switch" in the entry above is now that line's switch; the row's own switch turns a plugin's item off or on in every tool with a switch for one item, never a whole plugin.
- **Copy choices** apply at once, and their Undo puts things back as they were before the choice: each replaced copy in its own tool, the copies the choice added out, and the record as it was (a tool that held a copy of its own waits for a choice again; Claude Code's MCP record included). An agent's copy choice is the library's: the copies not chosen become versions. An Undo that stops part-way is finished from History's row (**Finish undo**). A copy an Undo puts back keeps its earlier edit time, so the copy question's "most recent" mark stays on the same copy.
- **Write to Claude Code** that replaces an entry History doesn't hold (Claude Code's own, say) logs its own History entry, with that entry kept. Its Undo there is Undo write, the same as the result's, and only one of the two can be used.

**Validation (3b).** 637 unit tests; each engine fix's test replays the judge's probe and the next pass and click, and fails with the fix taken out. The Mac run is on the pull request.

## The update control at the bottom left, and checks every 15 minutes, November 11, 2026

Nathan: "If you look at T3 Code there's basically a little recycle icon or something at the bottom left. And then that icon changes to a download icon whenever there's a new release. I would like ours to be something like that so that the user is automatically notified of a new release and doesn't have to go into the settings and click check now." Then: build it on the published preview 8, without the redesign, so it can go out as preview 9 as quickly as possible.

- **Why he had to click Check now.** The published preview 7, in a throwaway folder on the Mac with real GitHub, offered preview 8 by itself about 12 s after launch: the first check works. But the app then checked only every four hours, and it runs all day in the menu bar (and starts at sign-in), so a release published after launch stayed hidden for up to four hours; and the offer was a small pill at the far right of the status bar. T3 Code (pingdotgg/t3code, `SidebarUpdatePill.tsx`) checks every four minutes and keeps its control in the sidebar's footer.
- **The control.** The end of the sidebar (`#sidebar-end`, `updateview.ts sidebarEnd`, its looks in `updates.ts updateIndicator`) always has it: **Check for updates** with quiet circular arrows (a click checks now, they spin while it checks); a newer release makes it the sidebar's one filled button, **Update available**, and one click downloads (a progress ring round the arrow), prepares and restarts. Held for something unsaved, it is an outlined **Restart to update…** with a warning mark that never restarts on a click: it opens Settings › Updates, which says what restarting would lose beside its own Restart button. A failed download offers **Try the update again**; a release this copy can't install shows outlined and opens Settings; a build that never checks has a faint **Updates**. In the rail it is its icon alone, named in full for screen readers and in its tooltip; a newly found release is also said to screen readers. The status bar keeps only the version. Settings' Updates row (Update, Check now) and the app menu's Check for Updates… stay.
- **When it checks.** Shortly after launch, then every 15 minutes (a failed check too), and when the person comes back to the window after five minutes or more (`updateflow.ts checkIfStale`). A check that finds nothing new redraws only the control, never the page under someone typing.
- **Fit.** Windows 680 px tall or less tighten the sidebar's rows so its pages, homes and the control fit without scrolling at 860×560 (about 5 px to spare with the Practice copy's three homes).

**Validation.**
- Unit tests: 563 pass (worked examples for every look; the schedule and the return-to-window check). Linux end-to-end `updateFlow` 57 of 57.
- The real update on the Mac (`scripts/update-proof.mjs`, two Developer ID signed builds of this branch tagged `.98` and `.99` and an ad hoc `.100`, throwaway home baked into each build): 19 of 19 passed. The older copy's sidebar offered the newer release by itself 10 s after launch, one click downloaded it with progress, macOS restarted it into the newer build on the throwaway home, same team, settings and data kept; an interrupted download, a quiet one and the ad hoc zip were refused with the app unchanged. No stray process, ShipIt cache or launchd entry was left.
- Mac run 43038365220 on 58b4924: 563 unit, end-to-end 760 passed and 2 failed (focus after a check; fixed in 79819ec). The run on the final commit is named in the pull request.
- One judge round, Opus 5.5 and Fable 5.2, code and interface. Code 8 and 8; interface 8 (9 once its blocker was fixed) and 9. Opus's one blocker, a held restart one click from losing changes waiting for Apply all on the sidebar's loudest button, is fixed as above; so are the caret jump a background check caused in a draft, a second failed restart leaving "Restarting…" stuck, and "Up to date" words that claimed more than a check knows.

**Not done or not proven.** No light-theme pictures yet, and none of the `off`, `elsewhere` or `checking` looks: the light tour shows `off` on every page. The real smallest window on a Mac is 560 tall with its title bar, so its page is shorter than the 560 the checks use; a released build (two homes) still fits, a development build with the Practice copy may scroll its pages a little. The judges' remaining polish (one place for the "this copy checks" rule and the download words, a quieter clock check) goes into the follow-up that brings this into `next`.

## The copy question is a short list, and uses a wide window, November 11, 2026

Two interface judges had called the copy question's cards "very wide for one short quote each" on a large display (about 900 px each at 2560×1440), and Nathan's resizing rule rules out a cap that stops growing. Three designers each built an option in the real app; both judges (Opus 5.5 and Fable 5.2) picked this one.

- **Rows, not cards.** At every size the choices are the rows of one list: whose copy it is, its quote with what choosing it does under it, then **Use this copy** at the right end, as the table's rows end in their chevron. A row is still one button; the pointer over it lights only Use this copy, and keyboard focus rings that same button once, so it doesn't read as a table row that opens. In a home that can't be written the rows show no pointer and light nothing. Copies that are the same are one row, named "Claude Code and Copilot CLI (same copy)".
- **The line under a name has one form**: the copy's size and when it was edited ("7 lines · edited 2 days ago"), or an MCP entry's file. It shows on every row or on none, only where it tells the copies apart; the copy edited most recently adds "· most recent" with a pencil, the line's one emphasis.
- **The words' rules are `src/copywords.ts`**, one function each, with worked examples in `tests/copywords.test.ts`:
  - `shortQuote`: a skill's first line (sent whole now; it used to be cut at 140 characters, mid-word, with no sign) or an agent's line is quoted whole up to 140 characters; a longer one is cut after a whole word and ends with "…" inside the quotation marks. An agent's long line is quoted where it parts from the other copy's line most like it: at the words only it has or, having none, where the other's would go. The word at that place is never the part left out: the quote starts at the earliest of the line's beginning, a few words before that word, and the word itself from which the word ends within the limit. Both rows then quote the same stretch, and the copy that stops sooner is seen to stop. An MCP command or address is never shortened: its row is the only place the question shows it.
  - `nearestLine`: the words only one copy has are marked against the other copies' line that shares the most words with it. It used to be the line with the most separate runs in common, which a line sharing only "the" and "and" could win over one that was the same but for a few words.
  - `choiceEffect`: "Replaces Codex’s copy; adds it to Claude Code." More than two replaced copies are counted: "Replaces the other 4 copies."
  - `cantUse`: a copy that can't be chosen keeps its row, with "Can’t be used: Copilot CLI will not load a skill with no YAML frontmatter." in place of its quote and no button. The cause comes from `manage.ts blocksFor` alone and names the tool as the page does; a choice sent anyway answers "Claude Code’s copy can’t be used: …".
- **An MCP entry looks like a command**: its kind in words ("Command ·"), then the command upright in the monospace font, whole, a line breaking only at a space or after a "/", the words only this entry has tinted as an agent's are (`matrix.ts entryWords`). Neighbouring tinted words are one tinted piece, the spaces between them included, in a command and in an agent's line (`matrix.ts markedWords`).
- **Three layouts, by the width of the question's own box** (`style.css`, "The copy question", which owns all of it; the DOM is `matrix.ts compareChoices`). In a box under 560 px, as the Files view's pane is on most windows, a row has its name and Use this copy on one line and what it says under both. From 1280 px (under a table row, a window of about 1530 px with the sidebar open) the question, its note and Read both copies sit in a column beside the list, the first row level with the question. Between the two they stack. The list grows with the window at every size; only the words keep to a column.
- **An agent's copies in full** open under the list and are as wide as it, in equal shares: all side by side where every one gets 480 px or more, otherwise all one under the other, each as wide as the list. Three never sit two over one, so each copy breaks its lines as the others do. A box wider than a file's reading measure keeps its lines to that measure inside.
- **The close button.** What shares its line ends `--close-room` short of the details' edge: the question when stacked, the list and the copies under it when wide. It is named once, on `.details`, and is zero where the details have no close button (the dock, the Files view).
- **The Files view on a very wide window.** The file's column stops at the width a file's box can use (864 px) and the details beside it take the rest, so the question's rows are no longer squeezed beside blank space at 2560 px. Below that the columns are as they were.

**Validation.** `scripts/e2e.mjs copyQuestionFits` at 860×560, 1280×800, 1728×1117 and 2560×1440: the list under or beside the question as above and as wide as its box (less the close button's room when beside), the first row level with the question when beside it, every row's columns starting at one edge, the close button over neither, no row's words spilling out, nothing cut off; then the narrow rows in the Files view's pane at 1728, and at 2560 the file's column ending with the file's box. `blockedCopyKeepsItsRow` puts a copy that can't be chosen in a question of three rows and checks its row, disabled, in the others' columns; `agentCopiesUnderTheList` opens an agent's three copies in full and checks they sit under the list, as wide as it, one under the other at 1280 and 1728 and beside each other at 2560. The same three checks read each row's words against their own fixtures (`copyQuestionWords`): the quote in its quotation marks, a skill's long first line cut after a word with "…", three copies of one long agent line quoted through the same stretch with each copy's own sentence tinted as one piece, the line under each name with times the check sets ("3 lines · edited 9 days ago", the latest "· most recent"), and what choosing each does. Each of these, switched off in the running app, makes them fail with a sentence naming it: the wide list's margin, the question's offset, the narrow layout, the rows' shared columns (at every size), a cap on the list or on the whole question, the copies moved under both columns or losing their margin, three copies wrapping two over one, a copy's box capped at a reading width, a blocked row's reason on a line of its own, and the file's column given the free width back. Looked at in the real app, not kept in the tour: Skills, MCP servers and Agents at the four sizes, light at 2560, three and five copies, a copy that can't be chosen, a 300-character MCP command, an agent's long line in two and in three copies, Read every copy open with two and three different copies, the Files view's pane, the pointer over a row and keyboard focus on one. The Mac run is on the pull request.

**Follow-ups for this change.**
- **One name for a tool in every message.** The rule is the page's name, `words.ts toolNames` ("Copilot CLI"). The copy question and its sentences follow it, and in `manage.ts` so do the sentences about a copy left as it is (`untouched`, which every such sentence now goes through), a choice refused (`choiceProblem`) and a skills folder that can't be written (`rootProblem`). Other result messages still say "GitHub Copilot" through `harnesses[x].name`: 23 places in `manage.ts`, 16 in `agents.ts` and 10 in `mcp.ts`, so one Apply all can still say both. Applying the rule to them is one pass of its own, later.
- **The line under a name** (both interface judges, round 2): three rows that all say "edited just now" with one also "most recent" reads oddly, an MCP entry's "MCP entry" says nothing, and at 860 px the "· most recent" line sets the name column's width. Finer dates, or the line only where the rows' own words differ, would settle it.
- **Tint in the opened copies.** The rows tint the words only one copy has; the copies in full under them do not.

## Items live in Central Knot: the library, and agents on it, November 12, 2026

Nathan, November 11: items are installed into Central Knot itself and the harness is what is managed; an item can be in Central Knot and in no harness, "not actually applied until you care enough to apply them". An edit made by hand in a harness flows back by itself; Central Knot keeps a version history and says which harness made each version, and every version is kept until the item is deleted; Off always removes the copy and On puts the same file back; a copy deleted by hand in one harness turns the item Off everywhere, and a copy Central Knot can't read is never treated as deleted. The orchestrator took, on both auditors' advice, that there are no one-way agents: an agent's name, description and prompt sync both ways, and each harness's own fields stay with that harness.

This is the first step of that change: the model, and agents moved onto it end to end as its proof. Skills and MCP servers keep their engines until their own steps; for agents the Git repo reads and writes the library's current version (below), and the plan's step 7 does the rest.

**Map of the code as this step left it**, replaced by the map in “Items live in Central Knot, step 2a: the pass belongs to the library, November 12, 2026” (it moved the pass out of `agents.ts` into `librarypass.ts`), which was replaced in turn; the current map is `MAP.md`, at the repository's root.
- **The model:** `src/library.ts`. Its header is the whole model: item, harness, apply, version, found; the one rule as a table (`decide`, one line per row; `plan`, the table over every managed harness of one item); the order a plan is carried out in (`carryOut`, which every kind's adapter calls with its `Hands`); and the two promises (a copy that can't be seen is never a copy that is gone; a content is a version before any file changes: `keepVersion`, `setCurrent`). Pure, written for all three kinds; what is still shaped for agents is said at the end of its header.
- **Agents, the adapter:** `src/agents.ts`. One pass in order: `lookAt` (`readDisk`), `deletionsTold`, `pull` and `click`, then the guards on the items as the clicks left them (`guardFolders`), `syncItem` (`copiesOf`, `plan`, `carryOut`, which tells History first through `logItem`), `keepFolders`. It decides what can be seen of an agent in each tool (H, `copiesOf`: the one place, read by a pass and by the page), which copy a found agent is taken in from (`foundCopies`), and what Pull brings (`pull`); the rule for an item in the library is the library's.
- **Where agents are kept:** `src/agentstore.ts` (its header lists every file under `.central-knot/`), and the migration from the earlier record, `src/agentmigrate.ts` (its header has the rule for each earlier state).
- **The harnesses' file formats:** `src/agentfiles.ts` (the shared part, which a version is, and each harness's own part). **Convert to skill:** `src/agentskill.ts`.
- **The Agents page:** `agents.ts agentsView` reads what a pass reads (`lookAt`, `copiesOf`) and gives each library agent its `plan` (types.ts SkillFacts), each version's change (`versionChanges`) and, for a found agent, whether its copies differ (`differs`). `src/agentrow.ts` has an agent's place (on, off, found), each harness's mark (read from that plan), the clicks its controls send and every sentence the page says about an agent; `src/versionlist.ts` draws the versions (current first, one row per content: `library.ts listed`; each time in the list's one form: `model.ts timesApart`; Read is headed by what differs from the current one and marks it: `diff.ts wordDiff`); `src/matrix.ts` draws the rest (`agentSwitch`, `agentMark`, `agentHarnessSwitch`, `agentVersions`, `agentDelete`).
- **The Git repo for agents:** Push writes every agent in the library, On or Off, from its current version (`agents.ts agentsForRepo`, `gitrepo.ts writeAgents`); Pull makes the repo's content the current version inside a pass (`agents.ts pull`, `gitrepo.ts pullAgent`), then Claude Code takes the repo's settings as written (`pullClaudeSettings`).
- **History for agents:** `src/historyactions.ts`, one table: what each entry says, the action it offers, and when. Every action is a click the page could send, decided from the entry and the agent as it is now, so it is always safe and nothing has to be worked out about what happened since.
- **A click from the page to the engine:** `agentrow.ts agentClicks` builds a `Change` (`managed` is On, `off` the harnesses kept out, `version`, `deleted`); `main.ts` copies each field through its `changes` sanitizer (a new field must be added there); `agents.ts click` records it.
- **Worked examples:** `tests/library.test.ts` (the table, row by row), `tests/agents.test.ts` (on real files), `tests/agentmigrate.test.ts` (a home for every earlier record state), `tests/historyactions.test.ts`, `tests/agentrow.test.ts`, and `tests/agentswalk.test.ts`, a seeded random walk (`CK_WALKS=<n>` runs more; `CK_ONLY=<seed>[,own] CK_TRACE=1` replays one).

**What this changes in the entries above, for agents.**
- **No one-way agents, no With limits, no copy that stopped updating.** "Agents (9b)" and "One switch per item" above describe an origin, receive-only copies and a Stopped switch: all gone. An edit in any harness becomes the current version and reaches the others; each harness's other fields never leave its file.
- **Off removes; the agent stays.** Off takes the agent out of every managed harness and keeps it in Central Knot, with a row under Off ("in Central Knot only"). An edit made in a tool and not taken in yet becomes the current version first (the table's Off rows, below). On writes each harness's file back byte for byte (each tool's file is kept as a pass last saw or wrote it), also after the shared part moved on meanwhile, and after a copy was deleted by hand. The opened row's switch for one harness keeps the agent out of that harness alone (`except`), and the closed row says so ("not in Codex").
- **Found.** An agent a managed harness has that the library doesn't is found: halfway switch, "not in Central Knot" (since step 2c's fix round 1, an Add button in the switch's place). Its switch takes it in and applies it everywhere. Only here is there a copy question: where the found copies differ, the chosen one is taken in and the others become versions. An agent in the library never waits for a choice.
- **Edits and deletions by hand.** One edit: the new current version, from that harness (also when its file's time is older than the current version's). Two: the latest wins (by the files' times; equal times, the first harness), and the other is a version History can make current. A copy really deleted in one harness turns the agent Off everywhere after the settle window. An unreadable file, a half-written save, a folder moved or made again, and a harness no longer managed (uninstalled, or left out by the tool choice) change nothing. What was applied in a harness no longer managed is kept; when it is managed again, an agent wanted there is written afresh, and one that isn't (Off, or kept out of it) has the copy Central Knot put there removed, its file kept first as that tool's own part. A folder that is gone is unseen inside the settle window and then written afresh; a removal it owes waits for it. A tool that can't take the agent (a name it can't store, a plugin that brings it, a folder that can't be written) is a held copy with its reason on its line.
- **Versions.** Every content an agent has had is kept until the agent is deleted, with when it was made and where it came from. They are listed in the order Central Knot took them, the current one first, whatever a file's own time says, one row per content: an entry whose content a newer one has is folded into it (the record keeps both). Make current is a new version, applied like any other; its row says what it went back to ("back to: found in Claude Code, 7:21 AM"). Each row's note says what it is compared with: what it changed from the version current before it ("prompt changed"); for a copy that gave way, what it differs in from the version written over it ("prompt differs"); "first version" only for a first version taken alone (the copy chosen among several has none). Every time in the list, and in History, is in one form (`model.ts timesApart`). Nothing prunes them (History's days prune History only; a deleted agent's Restore is one of History's entries, so its armed note gives those days).
- **Delete from Central Knot** is the one real delete: out of every harness and off the page, with a tombstone, so a stale copy that turns up is found and never taken in by itself. History's Restore brings the agent back as it was.
- **History** logs each click and each edit taken in. For each agent it is told first, before the record is saved and before any file changes (`carryOut`), so a crash at any later point still leaves the entry; an entry whose change never happened offers nothing, since actions are worked out from the agent as it is. A pass saves the whole record, so another agent's save in the same pass can carry a Delete to disk before its entry is told: each pass therefore gives an agent deleted within History's days that has no standing `deleted` entry that entry, dated when it was deleted (`agents.ts deletionsTold`), and a deleted agent always has its Restore. Restore over a newer agent of that name made since keeps that one as a version, and its result and tooltip say so. A version is named in History and in a Make current's result by its clock time, to the second where two of the agent's versions share a minute (`agentrow.ts versionClock`); an entry that undid another (that one's `undoneBy` names it) reads "Undone: the version from 9:57:12 AM is current again". An entry says what made it in one field (`cause`: switch, found, pulled, deleted-by-hand); Pull's entries carry `pulled` themselves. An edit no pass took in, written over by Pull or Make current, has its own line (`kept-edit`). Its actions for agents are state-derived (the table in `historyactions.ts`): Undo makes the version from before a change current (on an older entry: "Go back before this", the full sentence its tooltip); Turn on, Turn off and Restore are the agent's own switches. A click's Undo in its result is the action of the entry the click made. Taking a found agent in has no Undo (nothing puts three harnesses back as they were); its entry offers Turn off.

**Decisions made in this step.**
- *The record's shape.* `LibraryItem`: `kind`, `key`, `name`, `on`, `hash`, `versions[{hash, at, from}]`, `except`, `applied{harness: hash}`, `own{harness: file}`, `deleted{at}`. `from` is `{how, harness?, replacedBy?}`, said by `sourceWords`; `replacedBy` is on a copy that gave way (`was-in`), the version written over it. `own` is beside the plan's fields: each harness's whole file, by its hash, as a pass last saw or wrote it. `versions` is in the order taken (`listed` shows the current one first, one row per content). A deleted item keeps `on` as it was, so Restore is only the tombstone lifted.
- *Where the guards live.* The settle window and the folder guards are the adapter's (`agents.ts guardFolders`, run after a pass's clicks; `keepFolders`; `copiesOf`); the library only knows `unknown` and `held`, each with its reason. A harness's agents folder is remembered once per record (`folders`), not per copy. The page reads the same guards with the settle window taken as passed, so a mark says what a pass will do once it has.
- *A version's time* is the harness file's own time for a copy taken in, the click's time otherwise; "latest" compares those. The list's order doesn't.
- *A harness that can't hold the agent* (a name it can't store, a plugin that brings it, a folder that can't be written) is a held copy: nothing is done there, and its line says why and what to do. Nothing is stored about it.
- *The Git repo* exchanges versions with the library (owner's rule, fix round 1): Pull's content becomes the current version through `setCurrent` ("pulled from the Git repo") and the pass applies it; whether the agent is On or Off here doesn't change, and one new here comes in On, each copy found here kept first as a copy that gave way to it. Push sends every agent in the library at its current version; only Delete from Central Knot takes one out of the repo, and a removal in the repo is Delete from Central Knot here. Claude Code's own settings travel as before: Push sends Claude Code's file (or its kept own part with the current version), and Pull writes the repo's file into Claude Code where it holds the agent, with that write's own History entry and Undo.

**States the model's table did not explain, and what was done** (each keeps every content as a version and writes nothing else):
- *An edit in one harness and a deletion in another, in the same pass.* The edit becomes the current version, and the agent turns Off. Proposed row: "On · H changed in one harness, gone in another · the edit is the current version; the item turns Off everywhere".
- *Off, or a harness kept out, while its copy holds an edit no pass has taken in* (Automatic sync off, or inside the settle window). The owner's rule (fix round 1): the edit wins. These are now the table's Off rows: "Off, or kept out · H changed, L = A · H becomes the current version, then it is removed" and "Off, or kept out · H changed and L moved on · the latest wins, the other is kept as a version; then removed".
- *On, clicked where a tool had a copy the agent never had* (a hand-made copy while it was Off). On keeps that copy as a version and writes the current one over it. Since step 2c's fix round 1 the click's Undo gives that copy back as the tool's own file, unapplied (the one give-back rule for skills and agents; that round's section below); the walk's Undo check covers such clicks.
- *An Off item, or a harness kept out, with a copy Central Knot never applied.* It is a found copy and left alone; turning the agent on there keeps it as a version, then writes the current one (the On row for "a copy, no A").
- *A found agent that had been deleted from Central Knot.* Taking it in lifts the tombstone on the same item, its earlier versions with it.
- *Migration: an agent not synced that never had a synced content* (copies kept separate). It becomes an Off item whose current version is its latest copy; every copy stays as a found copy.

**Migration** (`agentmigrate.ts`; `agentstore.ts openLibrary` runs it). A record in the earlier format is migrated the first time a pass may write; a reader in between (or a home that can't be written) sees the migrated agents, their descriptions and every version without anything written. The old record's folder identities and `away` marks become the library's `folders`, so a folder reset or away before the library is written again, never read as a deletion by hand. The new contents are written first (new names only), then the earlier record is copied to `agents.v2.json`, then the new record takes its place: a crash at either step leaves the earlier record and its kept files as they were. Synced agents come out On at the same content. A copy the earlier engine left alone on purpose (stopped, receive-only with its own edit, differing and never on record) makes its harness `except` with nothing applied, so the copy stays. Not synced comes out Off with every copy found. Deleted comes out a tombstone, and its earlier History entry restores it. Every kept file is a version or a harness's own part.

**Deleted with this step.** From the agents' record and engine: `origin`, `oneWay`, `stopped`, `separate`, `displaced`, the `removing` status, the `state` field, `sourceOfChoice`, `withMostFields`, `pickSource`, `originOnApply`, `losses`, `undoAddedAgent`, `undoChoiceAgent`, `deleteAgainAgent`, `finishPendingRemovals`, `keepAgentVersion`, `decideNow`. From the page: `resumeIn` on a click, `resumeOneWay`, `stoppedActions`, `stoppedLine`, `oneWayNote`, `oneWayTag`, `limitedFields`, `keptEditFlag` and its marks, the "Stop syncing this agent" button, the stopped-copy notice and the toolbar's count of stopped and kept copies. From the facts a page reads: `limits`, `oneWay`, `kept`, `stopped`. Nothing of step 4's kept copies, put-backs or Rules A and B was brought in.

**Validation.**
- `npm test`: 683 tests, about 27 s. The suite's own walk (8 seeds of 16 steps, a plain agent and one with Claude Code fields and Codex tables) takes about 11 s of that.
- The walk at 300 seeds on three ranges (`CK_SEED` 10000, 20000 and 30000; each range run as two halves of 150 seeds, 600 walks a range): 1,800 walks, clean. What it checks after every step is at the top of `tests/agentswalk.test.ts`: nothing Central Knot wrote over or removed is lost, passes settle, every action the page and History offer does something, Off then On is byte for byte, a tool Central Knot doesn't manage is never touched, and a copy that can't be seen turns nothing Off.
- Each new rule switched off, 64 in all (the table's rows, the plan, the two ways a version is added, the adapter's guards and order, the store, the migration, History's table, the row): 60 failed a named test at once. Of the 4 that survived, one was a redundant line, now deleted, and three got tests that fail without them (a version pulled from the Git repo says so; a stopped copy that was deleted in its tool before the migration stays its tool's own; an edit no pass had taken in is a version before Pull writes over it).
- Crashes: `before-remove` during Off, `before-rename` during On and while an edit is taken in, and both steps of the migration; after each, every content is a version and the next pass settles.
- Two mistakes the tests found on the way, both fixed: a click's On was saved only after the first file was written (the crash test), and a tool whose folder moved to a place that didn't exist yet was never written again (the moved-folder test).
- End to end (`scripts/e2e.mjs`, the dev build on Linux): 689 passed, 0 failed. The agents' part reads what the page shows: a found agent and its halfway switch, taking it in, Off and its Undo byte for byte, an edit made in one tool reaching the others, Read and Make current with nothing cut off at 860×560, 1280×800, 1728×1117 and 2560×1440, a tool kept out, Delete and History's Restore. Make current and Delete go through `main.ts`, so a sanitizer that drops `version` or `deleted` fails it.
- Pictures: `node scripts/ui-tour.mjs <out> --electron --only agents` takes 74, every new state at the four sizes; each was looked at.
- The Mac run is named in the pull request.

**Fix round 1 (November 12; four reviews: two of the code, two of the page).** What changed is said in place above. Its checks:
- `npm test`: 714 tests, about 29 s; the suite's own walk about 13 s.
- The walk on three fresh ranges (`CK_SEED` 110000, 120000 and 130000, each as two halves of 150 seeds: 1,848 walks with the suite's own), clean. It now also checks that every click makes a History entry (a crashed one too) and that its Undo puts every file back where every copy was the agent's, each tool's own part after every step, a second agent nothing is done to, and steps with a settle window of 2 s on a clock of their own (a copy deleted by hand; a folder away across three passes). What it found on the way was its own model (what a background pass sees; a copy On adopts), fixed in the walk.
- Each rule this round added or that no test held before, switched off, 51 in all: 43 failed a named test at once; the 8 that survived (a losing edit removed where the agent isn't wanted, a locked folder with no copy, a write keeping what it wrote, Pull's Claude Code settings for an Off agent, a clock that went back, a removal in the repo deleting an Off agent, a record without `own`, what a version changed) each got a test that fails without it.
- End to end (`scripts/e2e.mjs`, the dev build on Linux): 693 passed, 0 failed. It reads the new words: the Found line, each version's note, Read's marks and upright prompt, the made-current line, the whole description, Delete's line and its armed note with History's days, kept out on the closed row.
- Pictures: the agents tour takes 105, the new states included (hover and keyboard focus, a found row opened, a long name and a 40-line prompt read, three differing copies, Off while kept out and then On, Make current while kept out and while Off, many versions, many agents, the copy question and the armed Delete in the light theme); each was looked at.

**Fix round 2 (November 12; the same four reviews again).** What changed is said in place above. Besides:
- *The order a plan is carried out in* (`library.ts carryOut`): History is told first, then the versions are kept and the record saved, then each write, then each removal, the record saved after every removal. A removal Central Knot made is on record at once, so after a crash it is never read as a deletion by hand. `Hands` says that `write` and `remove` only answer whether the harness has the agent now; `carryOut` alone notes what is applied.
- *An Off agent is in no tool, also after a tool comes back* (Fable 2). The brief asked for a row in `decide`: a copy with nothing applied whose content is a version the library holds is the library's own and is removed. Not done that way: that row removes copies the migration leaves alone on purpose (a stopped or receive-only copy whose content is a version gets its harness in `except` with nothing applied; 8 migration tests fail). The cause was closed where it starts instead: what was applied in a harness is kept while it isn't managed (`keepFolders` lets go only its folder identity), and `guardFolders` forgets it, when the harness is managed again, only for an agent wanted there. The table is unchanged, so its header is too. The guards now run after the clicks (Opus C4: Off clicked while a folder had been gone past the settle window).
- *Push with an edit no pass took in* (Opus C2, Automatic sync off). Push sends what a click's own pass would take in: `agentsForRepo` plans each agent and sends the copy `plan.takeIn` names (with Claude Code's file for it). Marking the edit as waiting instead held Pull's incoming change on that row.
- *Pull of a new agent over copies found here*: each is kept as a copy that gave way (`was-in`, `replacedBy` the pulled version), as the copy question keeps the copies not chosen.
- *The page* (both page reviews): History's short "Go back before this", its actions column as wide as its widest actions (an agent entry's links stacked) and a name column that grows with the window; one time form per list; one row per content in the versions list, "back to:" on a version made current again, and notes that say what they compare with; Read headed "Differs from current in: …", its struck words legible, its box up to 60% of the window's height; the open agent's panel takes 60% of the width; a tool that can't take the agent (and has no copy) is named on the closed row ("Claude Code only"); a name longer than half its row is cut before every description steps aside; the armed Delete stays a button; Make current while Off says no tool was changed; the copy question leaves out a line count every copy shares, and the pencil.
- Checks: `npm test`, 725 tests, about 30 s. The walk on one fresh range (`CK_SEED` 170000, as two halves of 150 seeds: 600 walks with the suite's own), clean. Each rule this round added, switched off, 31 in all: 30 failed a named test at once; the one that survived (History's sentence reading `cause`) got a test that fails without it. End to end (`scripts/e2e.mjs`, the dev build on Linux): 696 passed, 0 failed; it reads the new words (History's short label and its tooltip, its times in one form, the folded versions list and "back to:", Read's header, the copy question without a shared line count). Pictures: the agents tour takes 135, the new states at the end so the earlier numbers stay (two copies with "Newer", thirty versions, Read on a version that adds text, Undo after Make current while kept out, a folder that can't be written, a version pulled from the Git repo, Restore when a new agent of that name exists, no agents at all, the long name in the opened panel); each was looked at.

**Last pass (November 12; three reviews of round 3).** What changed is said in place above. Besides:
- *A tool managed again* (both code reviews: a tool left out or uninstalled, a copy there gone meanwhile, the tool back, a click on another agent first, then a full pass turned that agent Off everywhere). `guardFolders` now lets go what was applied there for every agent in the library wanted there, not only the pass's own, since a click's pass notes the folder and the next pass can't tell. A worked example covers both ways a tool leaves.
- *A tool whose folder can't be written*: an edit's entry and notice name only the tools it reaches, so they no longer say "in Copilot CLI and Codex too" or "Undo edit in all 3 tools" above Codex's line. That line no longer offers to keep the agent out of Codex (that would need a write there too; the row has no switch).
- History at 860: a name takes the line it is on, and an agent entry's links sit side by side; they read "Use Claude Code's copy". At wider sizes an entry with copies to choose from has those links on a line of their own under its sentence, so the longer labels never widen the actions column every row shares (which wrapped every sentence at 1280); a name's room there starts at 150px.
- Checks: `npm test`, 727 tests. End to end (`scripts/e2e.mjs`, the dev build on Linux): 696 passed, 0 failed. Pictures of the changed states only: `tour-l1-r4/agents/` (History at 860 to 2560, a folder that can't be written, Restore over a newer agent, Make current's result, Undo while kept out), each looked at.

**Not this round** (for the start of the skills step, which lifts the pass out of `agents.ts`; the next section says which were done):
- Lifting `logItem` and the clicks (`click`, `turn`, `takeIn`, `makeCurrent`) out of `agents.ts` the way `carryOut` was, with the pass skeleton and the guards.
- "Has it another way" as a second reason a tool is held; a time for kinds whose copies have none.
- One durable rule for a tool managed again, kept with the record rather than worked out from which pass sees the folder first (the fix above covers the sequence found; the rule should not depend on it).
- An Off agent whose tool comes back with a different hand-made file of that name reads it as an edit and takes it in as the current version, then removes it from that tool (kept as a version; the folder's identity is let go while unmanaged, so the guard can't tell a remade folder).
- A crash right after History is told and before the record is saved leaves the entry, and the retried pass writes it again: two identical entries with two Undos (a pass could skip one identical to the agent's last un-undone entry).
- A Restore's own Undo ("Delete again" on the newest Restore).
- Thirty versions made within one second still read alike; the tooltip has the full time.
- A switch action (Turn on, Turn off) offered only on an agent's newest switch entry.
- A History action's result reads "reviewer: undone: the version from …" (the entry's sentence after the agent's name).
- With Automatic sync off, a deletion stranded by a crash gets its entry only at the next pass that runs (any click's).

**Not done, or open.**
- Skills and MCP servers are not on the library yet; profiles, first setup, "synchronize everything" (a found item taken in by itself) and plugins as references are later steps.
- `docs/SPEC.md` keeps its earlier rules for agents; each row that states them (the shared item, CON-01, DEL-02, TRN-02, AGT-01, D-26, D-32) now carries a dated pointer to `src/library.ts`.
- For when all three kinds are on the library: the names borrowed at the boundary (an agents view is an `McpView` whose `servers` are `SkillFacts`; a click's `Change.managed` is On), and `matrix.ts`'s `kind === 'agents'` branches.
- A deletion pulled from the Git repo still waits while Automatic sync is off, as before, though Delete from Central Knot no longer needs sync.
- Claude Code's own settings from the repo, where it has the agent and only they differ, are still written by Pull into Claude Code's file outside a pass (with their own Undo): no version tells them apart. The plan's step 7 decides how a repo's harness settings travel.
- The copy question's note for other kinds still says "Replaced copies are kept in History"; for agents it says they become versions.

## Items live in Central Knot, step 2a: the pass belongs to the library, November 12, 2026

The first half of the plan's step 2: what was not about agents leaves `src/agents.ts`, so the next kind (skills) is written against a contract that is complete. Nothing a person sees changes, except one rule settled on purpose: a tool managed again (below).

**Map of the code as this step left it**, replaced by the map in “Items live in Central Knot, step 2b: general names, one row for a library item, and "has it another way" told where it is wanted, November 12, 2026” (it renamed where the library meets the app's types and made the page's row one for every library kind); the current map is `MAP.md`, at the repository's root.
- **The model:** `src/library.ts`. Its header is the whole model: item, harness, apply, version, found; the one rule as a table (`decide`, one line per row, now with `forget` and both reasons a harness is held); copies with no time of their own; a harness managed again, as a second table (`managedAgain`); and the two promises (`keepVersion`, `setCurrent`). `carryOut` carries one item's plan out in the model's order; `Hands` is what it is given, built by the pass, never by a kind.
- **The pass:** `src/librarypass.ts`, the same for every kind. Its header lists a pass in the order it runs: `lookAt` (through the kind's `read`), `deletionsTold`, `pull` and `click` (`turn`, `takeIn`, `makeCurrent`), `guardFolders` (with `cameBack`, a harness managed again), `syncItem` (`copiesOf`, `plan`, `carryOut`; History first through `logItem`; `writeCopy` and `removeCopy` through the kind), `keepFolders`. Also there: `lookFor`, the page's and Push's reading (the guards applied in memory, nothing saved); `restore`, a History entry's action, which is always one of the clicks; `forgetFolders`, for the tool choice; the settle window (`stillSettling`, `seenAgain`).
- **What a kind implements:** `librarypass.ts Kind`, one interface: its words and History prefix, which tools hold it, a harness's folder and one copy's path, its record (`open`, `save`), its versions (`store`, `readVersion`, `hashOf`), `recover` (a write a crash interrupted), `read` (a `Disk`: each harness's copies by key, what can't be seen, folders that can't be written, and `held`, the kind's own reasons a harness with no copy can't be given one or has it another way; a folder that can't be written the pass adds itself), a copy's content and own part (`contentOf`, `ownOf`, `keepOwn`; a kind with none answers undefined), `write`, `remove`, and `historyAction`. The whole recipe for a new kind is the last paragraph of `librarypass.ts`'s header: its name in `ItemKind`, the `Kind` object, its callers (`runPass` with a plain `Change` as a click, `restore`, `lookFor`, and `forgetFolders` from `toolchoice.ts chooseTools`), and, one line each, what it touches outside the contract (its page's rows, History's sentences and actions, the app's wiring in `main.ts`, `preload.ts`, `types.ts` and `app.ts`). The header's first lines are a glossary of the module's words (`Kind`, `Disk`, `Look`, `Shelf`, `Hands`, `unseen`, `held`). A copy that can't be seen for sure is `unseen` in the model too now (step 1 called it `unknown`), one word with `Disk.unseen` and the page's mark.
- **Agents, the adapter:** `src/agents.ts`. `agentKind` (one file per agent in each harness's agents folder; `readDisk`; `cannotTake`, the one place that says why a harness can't take an agent; `writeAgent`); around the pass, `applyAgents` (Pull's repo file becomes Claude Code's own part), `restoreAgent`, `agentsView` and `rowFacts` (the page), `changesOf` (each version's note), `agentsForRepo` (Push), `agentsOn`, `forgetAgentFolders`.
- Unchanged and as described in the section above: `agentstore.ts` (now `saveLibrary` writes the format version itself, and `keepOwn` answers whether the part changed), `agentmigrate.ts`, `agentfiles.ts`, `agentskill.ts`, `agentrow.ts`, `versionlist.ts`, `historyactions.ts`, `matrix.ts`.
- **A click from the page to the engine:** `agentrow.ts agentClicks` builds a `Change`; `main.ts` copies each field through its `changes` sanitizer; `librarypass.ts click` records it.
- **Worked examples:** `tests/library.test.ts` (the table row by row, now with a harness that has the item another way, copies with no time of their own, and a harness managed again), `tests/agents.test.ts` (on real files), `tests/agentswalk.test.ts` (the seeded walk; `CK_WALKS=<n> CK_SEED=<n>` runs more).

**A tool managed again: one rule** (the plan's: the library wins; a copy Central Knot doesn't hold is kept as a version before it is written over or removed; nothing turns Off because a tool was away). In `library.ts`'s header as its second table:

| item there | the copy went meanwhile | edited meanwhile, or another item of that name |
|---|---|---|
| On | the current version is written | kept as a version ("was in Codex"), then the current version is written |
| Off, or kept out | nothing | kept as a version, then removed |
| deleted | nothing | a found copy, left alone |

It is one step before the table: for every item that had something applied there, A becomes what the harness holds now (no copy: nothing), its content kept as a version first (`managedAgain`); the table then does the rest, and later edits and deletions there count as any other. A copy as Central Knot left it (a content the item holds) is written over or removed as any other, a deleted item's too; but a deleted item keeps no new content, so a copy it never had is left with nothing applied, and the table calls it found: a file a person made under a deleted agent's name while its tool was out is theirs, never removed without a word (the break-it pass of this step found it removed silently, its content only in the tombstone). The pass takes the step for every item in the record at once, deleted ones too, the first time any pass sees the harness back with its folder there (`guardFolders` finds no folder identity for it, which the tool choice and every pass without it let go: `keepFolders`), so it no longer depends on which pass comes first. A tool back before its agents folder is there stays unsettled (no identity is noted) while anything was applied there, so the folder's arrival takes the step; a tool where nothing was applied has its missing folder noted as away, as any, so a brand-new tool's first write is no tool managed again (the reviewers of this step found an Off agent's hand-made file taken in when the folder came later). A missing copy is read without the settle window there: it went while the harness was away.

A copy that gives way when its tool comes back is never silent. Before the pass, its tool's line in the opened row says it is kept as a version first ("…then removed" for an agent that is Off or kept out); the page's look notes what `cameBack` would keep (`Look.givingWay`). The pass tells History first, then keeps it: a `kept-edit` entry with `cause: 'tool-back'` ("Codex's copy changed while Central Knot didn't manage Codex; it gave way to the current version and is kept as a version."), whose "Use Codex's" makes it current (both reviewers found the edit kept with no line). `cameBack` tells it, not `logItem`, for one reason: it settles every item in the record, and with Automatic sync off an item outside the pass is written over or removed only by a later pass, whose `logItem` would no longer know.

This replaces step 1's rule (a harness managed again forgot what was applied there for the agents wanted there, in `guardFolders`; fix round 2 and the last pass above), and changes two sequences on purpose:
- an Off agent whose copy went while its tool was away, with a click's pass on another agent first (Sync off), then turned On: it stayed On only until that pass, which read the copy as deleted by hand and turned it Off everywhere again. Now it stays On, and the tool gets it.
- an Off or kept-out agent whose tool comes back with another file of its name: that file became the current version (an edit taken in) and was removed. Now it is kept as a version ("was in Codex") and removed; the current version stays. For a deleted agent, that file is now a found agent, left where it is.

**Has it another way, and copies with no time of their own** (rows of the model, with tests in `tests/library.test.ts`; agents use neither yet).
- A held copy has a second reason, `anotherWay`: the harness has the item through a plugin, or (for skills) OpenCode reading Claude Code's folder, a link, a copy in `~/.agents/skills` that Central Knot doesn't own. Nothing of Central Knot's goes there, as for one that can't be given the item, and what was applied there is let go (`forget`), so when the other way ends the item is written there afresh instead of being read as deleted by hand. A harness that can't be given the item keeps what was applied there.
- A copy with no time of its own (`at` absent: an MCP entry, whose time is its whole file's): an edit on one counts only when made on the current version, and of several such the first harness wins, as equal times do; one made where the current version had moved on as well loses to it and is kept as a version. A version taken from such a copy is dated when it is taken (`versionAt`).
- Agents' "a plugin brings it" is "has it another way" in the model's terms, but agents still hold it as can't-take (`agents.ts cannotTake` says so), as the brief asked: moving it changes one sequence (a Claude Code copy deleted by hand while a plugin brings the agent, then the plugin uninstalled: today the agent turns Off everywhere; with the new reason it would be written afresh).

**Decisions made in this step, beyond the brief.**
- *Pull and Restore moved too.* Pull is a step of the pass, the same for every kind; the agents' Claude Code file is `Pulled.own`, one harness's own part (`agents.ts applyAgents` maps the Git repo's shape, `PulledAgent`, onto it). Restore runs the kind's `historyAction` and is the same for every kind. Checked by the Git repo's Pull tests and History's Restore tests, as before.
- *`Disk.held` is the kind's answer, worked out at each look* (a function over what the kind read), so the pass never knows about plugins or names. Agents keep `cannotTake` as the one place for their reasons; the page reads it for a harness that has a copy too.
- *`Kind.keepOwn` answers whether the own part changed* (Pull's entry for Claude Code's settings alone reads it), and the pass calls it for every copy present; the store keeps each part once, so a part already kept costs one look.
- *A kind's fault points stay in its own write and remove* (`before-rename`, `before-remove`): they are where its files change.
- *`writeCopy` no longer restarts the settle clock itself*: switched off, it failed no test, since a pass only writes a copy its reading (`copyIn`) has just found absent with nothing owed there, which clears that clock. A test holds `copyIn`'s clearing now.
- *A folder that isn't there when its tool comes back* is noted as away only where nothing was applied there (a brand-new tool: its first write makes the folder, and treating that as a tool managed again wrote over the first edit there, which the OpenCode test found). A tool managed again stays unsettled until its folder is there (above).

**States the brief did not explain** (each keeps every content as a version and writes nothing else):
- *A copy that can't be read when its tool comes back* keeps what was applied there; once it reads, the table goes on from that (an edit made while the tool was away is then taken in).

**Validation.**
- `npm test`: 747 tests, about 32 s. The tests that were there pass as they were; the new ones are the model's rows (`tests/library.test.ts`) and, on real files, a tool managed again in each state, a removal held when the copy changed, a copy just written getting the whole settle window, an Off agent's lines, and Pi.
- The walk on three fresh ranges (`CK_SEED` 210000, 220000 and 230000, each as two halves of 150 seeds: 1,848 walks with the suite's own), clean.
- Each rule this step added, and a sample of the moved ones (to prove the wiring through `Kind` still reaches them), switched off: 35 in all. 30 failed a named test at once. One was no rule (a line set twice). Of the 4 that survived, one was a redundant line, now deleted (`writeCopy`'s settle clock), and three got tests that fail without them (a removal that finds the copy changed is held, not failed; held only where the agent is wanted; Pi has no agents).
- End to end (`scripts/e2e.mjs`, the dev build on Linux): 698 passed, 0 failed. New: a tool uninstalled and back (its folder taken away and put back) with an Off agent edited there meanwhile, read on the Agents page; with step 1's rule in its place it fails (the edit became the current version, and On spread it).
- The Mac run is named in the pull request.

**Last pass** (five readers: two code reviews, a break-it pass, a small model answering from the repository alone, and a mid-sized model that added a toy second kind without touching `src/`; what changed is said in place above).
- A file a person made under a deleted agent's name, in a tool that comes back, is a found agent, left alone (it was removed with no word).
- A tool that comes back before its agents folder is there stays unsettled until the folder appears, so the same rule holds.
- A copy that gives way when its tool comes back has its History line, and the page says so before the pass.
- `librarypass.ts`'s header has the whole recipe for a new kind and a glossary; `unseen` is one word for a copy that can't be seen; a kind's `Disk.held` gives only its own reasons; `guardFolders`' comment is one line per branch.
- Checks: `npm test`, 753 tests. Each rule this pass added switched off, 9 in all: each failed a named test. The walk on one fresh range (`CK_SEED` 250000, as two halves of 150 seeds: 616 walks), clean. End to end (the dev build on Linux): 698 passed, 0 failed. The toy second kind's fixture type-checks and passes against this head. The Mac run is named in the pull request.

**Follow-ups** (from step 1's list; done here: lifting `logItem` and the clicks with the pass skeleton and the guards; "has it another way" and a time for kinds whose copies have none; one durable rule for a tool managed again; an Off agent whose tool comes back with a different hand-made file of its name).
- A crash right after History is told and before the record is saved leaves the entry, and the retried pass writes it again: two identical entries with two Undos.
- A Restore's own Undo ("Delete again" on the newest Restore).
- Thirty versions made within one second still read alike; the tooltip has the full time.
- A switch action (Turn on, Turn off) offered only on an agent's newest switch entry.
- A History action's result reads "reviewer: undone: the version from …" (the entry's sentence after the agent's name).
- With Automatic sync off, a deletion stranded by a crash gets its entry only at the next pass that runs (any click's).
- Agents' plugin case as "has it another way" (above), and the state above (a copy that can't be read when its tool comes back).
- For when all three kinds are on the library (step 2b): the names borrowed at the boundary, now in the general pass's own signatures (`runPass` and `restore` return `McpResult`; `Change.managed` is On; `McpView.servers` are `SkillFacts`), a pass's result with `outcome: 'held'` (types.ts DestinationResult's word for an action not done this time, a second meaning beside a held copy), and `matrix.ts`'s `kind === 'agents'` branches.
- An Off agent whose tool comes back with no agents folder reads "Its copy is removed once the folder is back" for a copy that may no longer exist anywhere; it clears once the folder appears or the agent is turned On (step 2b).

## An alpha release line: its own app, its own updates, November 12, 2026

Nathan will test the work landing on `next` on his laptop while it is still moving, apart from the preview he has installed: "I would like it if the release was sort of separate from the current preview build. Maybe a beta or something. Alpha." He chose its own app, installed beside the preview, and: "Alphas should auto update on top of each other just like the preview." This step builds the support; no alpha is cut.

- **A line is named by its tag** (`src/updates.ts releaseLine`), by the pre-release part exactly: `v0.6.0-alpha.1` is an alpha, `v0.5.0-preview.9` a preview, no pre-release part a final. Everything that differs between the lines reads it there. Packaging refuses any other pre-release part (`whyNoLine`, `scripts/release-tag.mjs`); the app, meeting one in a release list, reads it as a preview, as before there were alphas.
- **An alpha is its own app** (`lineApp`): "Central Knot Alpha", bundle id `com.centralknot.alpha`, settings and log in `~/Library/Application Support/com.centralknot.alpha/`, downloads `Central-Knot-Alpha-<version>-mac-arm64.dmg` and `.zip`. Previews, finals and untagged builds are the standard app, unchanged. The app reads its tag (`updater.ts buildTag`: the one recorded at packaging, or the update stub's in tests) at start, before anything else, as a custom build reads its identity file (`main.ts own`).
- **Packaging takes it all from the tag** (`CK_RELEASE_TAG` or the commit's): `scripts/package-mac.mjs` builds the code again under the alpha's name (`scripts/build.mjs CK_APP_NAME`, the custom builds' renaming), packages it under its own bundle id and names its downloads (`macDownload`). The alpha's name is made from `PRODUCT`, so the renaming can't double it. dist/ goes back to the standard app afterwards.
- **Each app has its own disk image window.** The window's layout (`DS_Store`) names the disk's contents by volume and file name, and its background alias names the volume, so the alpha needed its own: `assets/dmg/<download name>/` holds each app's picture and layout (the standard one moved there unchanged), `scripts/mac-dmg-layout.sh "<app name>"` makes either. Remade under the standard name it gives the same records as the committed file; the alpha's picture was rendered from its SVG the same way, which reproduces the standard PNGs within 5 levels.
- **Updates stay inside a line** (`newerRelease`): an alpha is offered only newer alphas carrying the alpha's zip; a preview previews and finals carrying the standard zip, never an alpha; a final finals only, as before. Squirrel would refuse the other app anyway (its designated requirement names the bundle id), but neither is ever offered it.
- **Previews already installed run their own code.** Preview 9's `newerRelease` (`git show v0.5.0-preview.9:src/updates.ts`, run against releases shaped like GitHub's) offers nothing from an alpha release carrying only `Central-Knot-Alpha-*` files, nor from two alphas, and still finds a later preview past one. A control with an alpha tag carrying `Central-Knot-0.6.0-mac-arm64.zip` is offered: the zip's name is all that keeps installed previews off an alpha, so an alpha's release must carry only the alpha's two files (README says so).
- **Two apps, one home.** The existing one-owner rule applies: each names the other as the person knows it ("Central Knot syncs this home… Take over syncing to have Central Knot Alpha sync it instead", and the other way), from the names the record and each build carry; no new words were needed.
- **Decision beyond the brief:** a custom build can't be named "Central Knot Alpha" either (its file would take the alpha's place in Applications), as it already couldn't take "Central Knot". Checked in `tests/bundle.test.ts`.

**Validation.**
- `npm test`: worked examples for the line of each tag, what each line is offered from a list holding previews, alphas and finals, the alpha's names, downloads and version words, a preview's unchanged names, and the preview and the alpha naming each other on one home. Each new rule switched off (7): each failed a named test (one mutation first missed, redone).
- `scripts/alpha-check.mjs`, in the Mac run after the standard package: packages an alpha from `v0.6.0-alpha.98` (about 33 s), checks the bundle's name and id, the code's name in the menu bar menu, the recorded tag, the downloads' names, the zip's app, the disk image's volume, app and window, and that the standard downloads are untouched; then opens both packaged apps side by side in one throwaway home (`HOME` and `CFFIXED_USER_HOME`, so their settings folders are in it too): the window, sidebar and status bar names, the alpha offered `0.6.0 alpha 99` and not a newer preview, the standard app offered a newer preview and not the alpha, and Take over syncing both ways with each app's words. 27 of 27 by hand on the Mac; with the alpha's own settings folder switched off in `main.ts`, its named check failed.

**Not done or not proven.**
- The real update from one alpha to the next (`scripts/update-proof.mjs` takes either line's zips now and names each release's zip by the app it holds), which needs two Developer ID signed alpha builds: the keychain is locked over SSH, so it waits for release time on the Mac's T3.
- The alpha's disk image window as Finder draws it (its layout was read back from the file, not seen); the label "Central Knot Alpha" may wrap under the icon.
- The alpha has the standard app's icon.

**Last pass** (two reviews, Opus 5.5 and Fable 5.2; each behaviour first reproduced as a failing test).
- *A mistyped alpha tag is refused, not packaged as a preview* (both reviewers reproduced it). `v0.6.0-alpha1`, `v0.6.0-Alpha.1` and `v0.6.0-a.1` were line "preview": packaged as the standard app under its download names, offered to every installed preview. A pre-release part now names its line exactly, `alpha.<n>` or `preview.<n>`; `scripts/release-tag.mjs` stops packaging at anything else with one sentence naming the tag and the two forms (`tests/releasetag.test.ts`; on the Mac run, `scripts/alpha-check.mjs` sees the packaging command refuse `v0.6.0-alpha1` before building anything).
- *A test holds preview 9's download pattern* as a literal against the alpha's download name: builds already installed run that pattern and can't be changed.
- *Packaging leaves `release/` holding only its own two downloads.* A release line's package removes every other Mac download there first (chosen over stopping: the folder is packaging's own output, and the Mac run packages several apps into it in turn), says which, and ends with "Upload exactly these:" and its two files (`otherDownloads`). A custom build's package removes nothing.
- *The release list is read 100 at a time* (GitHub's most, one page): alphas share the list with previews, and at 30 a newer preview behind 30 alphas went unseen.
- Small: packaging tells the alpha by its bundle id (as `main.ts` does); the custom build's disk image comment says why it has none; `main.ts` and the updater read one tag (`buildTag`, the update stub's too); `isMacZip` reads the version with `tagVersion`; `PRODUCT`'s header says it is also the standard app's name inside an alpha.

## Items live in Central Knot, step 2b: general names, one row for a library item, and "has it another way" told where it is wanted, November 12, 2026

A design check of the skills step found three things that are not about skills and would otherwise be done in the middle of it. This step does them first, so that step has one concern. Nothing a person sees changes: the Agents page and History read and look as on `next`.

**Map of the code as this step left it**, kept here as history. The current map is `MAP.md`, at the repository's root (its first area is the library's, in short); README's “Where things are” points there, and no LEDGER section is a current map any more.
- **The model:** `src/library.ts`, as step 2a left it. New in it: `VersionChange`, a listed version's note, its parts named in the kind's words ("prompt changed"); and its header's line on "has it another way" says the kind answers it, told where the item is wanted.
- **The pass:** `src/librarypass.ts`, as step 2a left it, with three changes. `runPass` and `restore` answer a `types.ts PassResult`. The pass takes its own click, `ItemClick` (`on`, `except`, `seenOn`, `use`, `useHash`, `version`, `deleted`). `Disk.held(item, harness)` is told the item as the pass's clicks left it (`Wanted`: its name, On, the tools it is kept out of, deleted), so a kind can ask `library.ts wantedIn` whether the tool a reader reads from has it; what the other tools hold is the kind's own `Disk`. Its header has the glossary and **the one recipe for putting a kind on the library: every place a kind is wired in** (`librarypages.ts`, `libraryrow.ts` and README point to it).
- **Where the library meets the app's types, one place each.** A click: a row sends the app's `types.ts Change`, which the skills and MCP engines share (`managed` is On for a library item), and so does a History entry's action; `librarypass.ts itemClick` makes either an `ItemClick` (`restore` calls it for History's). A view: a library kind's page view is a `types.ts LibraryView` (`items`: `LibraryFacts`, with `on` and `except`; `library`: every item as the library holds it), kept in `types.ts HomeView` under the page's name for the kind and found there by `itemrow.ts libraryView`. Its rows reach the pages through `itemrow.ts kindSource`, which turns them into the rows the skills and MCP engines still give (`SkillFacts`, `managed` and `off`), once per read: the tables, the Harnesses page, the plugin rows, a part's status, the Overview's cards, `anyManaged` and the records `app.ts` keeps for a click's Undo. Counts of a kind's items (the sidebar, a read's sentence, the Overview's "nothing found"), History's Restore and `app.ts`'s sentence after a History action read the view's `items` and `library` directly: they need no conversion; `main.ts` counts `items` by `on`. A result: `McpResult` extends `PassResult` with Write to Claude Code's part, and `app.ts lastResult` is where every page's last result is read, beside `kindPages`, which keeps it.
- **Agents, the adapter:** `src/agents.ts`. `applyAgents` takes the page's `Change`s and runs the pass on their `ItemClick`s; `agentsView` gives a `LibraryView`, `rowFacts` a `LibraryFacts` (a copy's `body` is its prompt, its `ownPart` the names of the harness's own settings). Its `Kind`'s words take "agent" and "file" from `libraryrow.ts libraryWords`. `historyactions.ts agentAction` gives its action as a `Change`, made from `libraryrow.ts asItIs` as a row's clicks are.
- **A library item's row on the page, the same for every kind:** `src/libraryrow.ts` (pure): where an item stands, each harness's mark (`harnessIs`), the item as it is (`asItIs`) and the clicks a row sends (`rowClicks`), the versions' words, `statusLine` and `switchLabel`; and the sentences that name the item or its copies, made in one kind's words (`sentences(words)`: `harnessLine`, `placeTag`, `said`, `noticeWords`). A kind's words are `RowWords` (`item`, `an`, `copy`, `shared`, `own`, `body`), each kind's in `libraryWords`, keyed by the page's name for it, the one place they are written. `src/librarypages.ts` has what else a kind supplies to its page (`LibraryPage`: how Read gets a version, what else its opened row shows; for agents, Convert to a Pi skill), in `libraryPages`, keyed by `app.ts PageKind` (the page's name for a kind: `'agents'`), not `library.ts ItemKind` (`'agent'`). `src/versionlist.ts` draws the versions; Read shows a version as the kind's named parts (`VersionPart`: a line, or a block). `src/matrix.ts` draws every row of a kind in `libraryPages` as a library row (`library()`; `librarySwitch`, `libraryMark`, `libraryTag`, `libraryHarnessSwitch`, `libraryVersions`, `libraryDelete`, `libraryNotice`, and the help band's, sections' and copy question's words from the kind; the copy question compares each copy's `body`, under the kind's word for it). Its bands and notices ask whether the table has a library or MCP view (`listView`), never which kind it is.
- **Worked examples:** `tests/library.test.ts` (the model), `tests/librarypass.test.ts` (the contract on a toy kind: a tool that reads another's folder), `tests/agents.test.ts` (on real files), `tests/libraryrow.test.ts` (the row, in agents' words and in a toy kind's; moved from `agentrow.test.ts`, with `kindSource`), `tests/historyactions.test.ts`, `tests/agentswalk.test.ts` (the seeded walk).

**What a skills kind supplies to get its rows** (the skills step): every place is in `librarypass.ts`'s recipe. On the page, that is its words in `libraryrow.ts libraryWords` and its entry in `librarypages.ts libraryPages`; its view under `skills` in `types.ts HomeView`, which `itemrow.ts libraryView` returns; and its copies' `body`. `matrix.ts` needs no new branch for its rows, bands or notices; its other `kind === 'skills'` checks are the skills engine's own controls (follow-ups).

**Names changed.** `agentrow.ts` → `libraryrow.ts` (`AgentRow` → `LibraryRow`, `agentClicks` → `rowClicks`); `matrix.ts`'s `agentSwitch`, `agentMark`, `agentMarks`, `agentTag`, `agentHarnessSwitch`, `agentVersions`, `agentDelete`, `agentNotice` → `library…`; `mcpNotices` → `listNotices`; `kindSource` moved from `matrix.ts` to `itemrow.ts`; `app.ts Kind` → `PageKind`; `types.ts McpView.library` → `LibraryView.library`; an agents view's `servers` → `items`; `ToolCopy.prompt` and `ownFields` → `body` and `ownPart` (and on `ItemRow`); the copy question's blocks' id `prompt-…` → `body-…`; `.version-read-about` and `.version-read-prompt` → `.version-read-line` and `.version-read-block`. `matrix.ts` asked `kind === 'agents'` 34 times before this step and asks it nowhere now; it is 2,140 lines (2,144 before).

**Decisions made in this step, beyond the brief.**
- *Rows go through `kindSource`, and what only counts or looks an item up reads the view*: the pages that listed agents' rows each had their own switch on the kind, and each would have needed the conversion; a count or the library's items need none. Checked by a test (On is `managed`, kept out is `off`, the same rows for the same read, an item On counts as managed).
- *`librarypages.ts` is a new module*: the per-kind table and agents' Convert block moved out of `matrix.ts`, which would otherwise have grown by 23 lines; Convert draws its button as `matrix.ts smallAction` does. Checked by the pictures (below).
- *A click carrying `use: 'separate'`* (the skills engine's "keep both") is refused for an item in the library, and a found item's answer is "the copy you chose changed", as on `next`: `itemClick` carries `use` as it is, and the pass refuses it. No page sends it.
- *History's actions are the app's `Change`, as on `next`*, made from the same `asItIs` as a row's clicks; `restore` makes one the library's with `itemClick`, so a click is converted in one place.
- *A found agent's `held` is asked as taking it in would leave it* (On everywhere), since `held` now needs where the item is wanted.
- *The versions read on a page are kept by home, kind, item and version*, so two kinds' items of one name never share a text.
- *The app-wide result outcome `'held'` stays as it is* (the orchestrator's note): the glossary says it is not a held copy.

**States the brief did not explain.**
- *A reader with a copy of its own while it has the item another way.* `Disk.held` is asked only where a harness has no copy, so the contract cannot say "has it another way" over a copy Central Knot applied there; the table would need a row for it. Two ways in, both shown on the toy kind: the reader's source let back in after the worked example (OpenCode keeps its own copy and reads Claude Code's too), and an item found only in the reader's own folder and turned On (it is written into Claude Code's folder as well, so OpenCode has it twice). Left for the skills step; nothing is written or removed for it here, and agents have no reader.

**Validation.**
- `npm test`: 758 tests, about 33 s. The tests that were there pass as they were, renamed where a name changed (`McpResult`, `servers`, `managed` in an agents view, `agentrow.ts`); five tests are new (the toy kind, `kindSource`, an action keeping `except`, the kind's words, the Agents page's `on` and `except`).
- The walk on one fresh range (`CK_SEED` 310000, as two halves of 150 seeds), clean.
- Each rule this step moved or added, switched off: 23 in all (`itemClick`'s six fields, History's action (`on` and `except`), `kindSource`'s conversion, once-per-read and `anyManaged`, the seven sentences in a kind's words, the agents view's `on` and `except`, `held` told where the item is wanted, Read's parts matched by name). 17 failed a named test at once (Read's in the end-to-end checks: three checks of Read failed); the 6 that survived got the new tests above, and each now fails.
- End to end (`scripts/e2e.mjs`, the dev build on Linux): 698 passed, 0 failed, as on `next`.
- Pictures: the agents tour (`node scripts/ui-tour.mjs <out> --electron --no-sandbox --only agents`, which takes the Agents page and History's agent rows at 860×560, 1280×800, 1728×1117 and 2560×1440), on `next` and on this branch, compared pixel by pixel: 69 of 135 identical; the 66 others differ only where a clock time is shown (the tours ran minutes apart), and their page text is the same once the times are masked. Two pairs looked at side by side (a versions list after an Undo, and Read).
- The Mac run is named in the pull request.

**Last pass** (two code reviews and a break-it pass; nothing a person sees was found wrong; what changed is said in place above). `origin/next` (the alpha line) merged in first.
- Both reviewers formed wrong ideas about how a second kind gets its rows: "Kind" named three things (`app.ts`'s page name, now `PageKind`; `librarykinds.ts`'s table, now `librarypages.ts` `LibraryPage`); the recipe was shorter in one module than in another (now one, in `librarypass.ts`); `matrix.ts`'s bands asked `kind === 'skills'` for "the old engine" (now `listView`); the copy question read an agent's `prompt` (now `body`). A kind's words are written once; where its last result is kept is one function (`app.ts lastResult`); the two `asItIs` are one.
- README named the map as LEDGER's last section, which stopped being true once the alpha line's section landed after this one: it now names this section by its title, the map here says it is the current one (the only one marked “start here”), and the two earlier maps name the section that replaced each.
- The break-it pass found `use: 'separate'` carried out as a switch for an agent in the library, where `next` refused it; reproduced first as a failing test, now refused as on `next`.
- Checks: `npm test`, 769 tests (the alpha line's with this step's; two new: the refused "keep both", and the sentences in a second kind's words, which fails with "agent" or "file" written into a sentence). End to end (the dev build on Linux): 698 passed, 0 failed. Pictures: the agents tour on `next` (with the alpha line) and on this head, compared as before: 69 of 135 identical; the same 66 as before differ only where a clock time is shown, with the same page text once times are masked; the copy question's and an opened row's pictures are identical, and the copies side by side are read by the end-to-end checks. The Mac run is named in the pull request.

**Follow-ups** (from step 2a's list; done here: the names borrowed at the boundary and `matrix.ts`'s `kind === 'agents'` branches; `outcome: 'held'` kept on purpose, above).
- A crash right after History is told and before the record is saved leaves the entry, and the retried pass writes it again: two identical entries with two Undos.
- A Restore's own Undo ("Delete again" on the newest Restore).
- Thirty versions made within one second still read alike; the tooltip has the full time.
- A switch action (Turn on, Turn off) offered only on an agent's newest switch entry.
- A History action's result reads "reviewer: undone: the version from …" (the entry's sentence after the agent's name).
- With Automatic sync off, a deletion stranded by a crash gets its entry only at the next pass that runs (any click's).
- Agents' plugin case as "has it another way", and a copy that can't be read when its tool comes back.
- An Off agent whose tool comes back with no agents folder reads "Its copy is removed once the folder is back" for a copy that may no longer exist anywhere; it clears once the folder appears or the agent is turned On. Step 2a named it for this step; this step's brief did not take it.
- A reader with a copy of its own while it has the item another way (above: both ways in).
- History's sentences and actions are still agents' own (`historyactions.ts`); the skills step decides whether they become the library's.
- `matrix.ts`'s other `kind === 'skills'` checks are the skills engine's own controls (the Files view and its Read every copy, Remove, Delete everywhere, copies outside Central Knot and their take-over): the skills step decides which a library row keeps.

## A map of the code at the door: `MAP.md`, November 12, 2026

The current map lived in the library steps' LEDGER sections, covered the library alone, and README found it by the section's title. `MAP.md`, at the repository's root, is now the one current map of the whole app: README's “Where things are” and `AGENTS.md`'s “Checking a change” point to it, and the library steps' maps above are history. Nothing the app does changed.

- **What it holds.** What the app is and the two ideas to hold first; then thirteen areas, grouped by what a person changes (the library and agents on it; skills and MCP servers on their own engines; the tools in a home; the item pages; History; plugins and marketplaces; profiles; the Git repo; instructions; updates, packaging and custom builds; the app's shell and Settings; the store and safe writes; the test and tour scripts), each with one entry per file, where to start reading and its tests; then five paths that cross areas, names that mean two things, and pointers to the recipes. 125 lines.
- **Kept true by `tests/map.test.ts`** (in `npm test`, no build): every file under `src/` and `scripts/` has exactly one entry; every file the map names exists; every name it gives a file (`file.ts name`, or a name inside that file's entry) is one the file declares. A failure names the file or the map's line and what to add, remove or rename. Its header says how the map is read.
- **Headers that said something untrue, fixed:** `trayicon.ts` (the menu bar icon is the text in that file: changing `assets/` does not replace it, and a custom build keeps it), `historypage.ts` (History lists clicks, profile switches and Pulls too, not only what sync did on its own), `words.ts` (the engines use it as well as the pages, and it spells each kind's words), `scripts/ui-tour.mjs` (its list of sections named 12 of 23).
- **Read as a reader would**, five changes from the map, each in one hop: a new field on an MCP server (`mcp.ts NeutralServer`); a new section in Settings (`settingspage.ts settingsPage`; corrected: the value is stored as `main.ts AppSettings` and the page is sent `types.ts AppPreferences`); a sentence on the History page (`historypage.ts describe`, or `historyactions.ts` for agents); how a plugin's update is checked (corrected to name `pluginstatus.ts updateTools`, which the Plugins page and the background check both ask, and `pluginupdates.ts` as that check); where a skill's folder is copied (`share.ts placeCopy`; corrected to name `manage.ts replaceCopy` for a copy replaced).

**Decisions beyond the brief.**
- *An entry is a reference that starts a list line or a part of one after " · "*, so 110 files fit in 43 lines and "each file appears once" is checked: a file named only in passing (in a path or a recipe) has no entry and fails.
- *A name is checked as declared* (a function, value, type, class or re-export), not as merely present, so a function renamed while a comment still says its old name fails.
- *125 lines*, a little over the brief's 80 to 120: the names that mean two things were kept, as what a cold reader is most often misled by.

**Found in the code, not changed.** `toolchoice.ts chooseTools` has no caller in the app (no page changes which tools are managed; tests call it). History's file is kept for every kind by `manage.ts`, a skills module. Names declared in two modules with two meanings: `ItemKind`, `Outcome`, `standing`, `toggle`, `updateButton`, `Waiting`, `CHECK_EVERY_MS`, `PassOptions`, `pluginTools`; and `fileName` is one function written twice (`model.ts`, `words.ts`). The map says each. `share.ts`, `discovery.ts`, `harnesses.ts`, `platform.ts`, `model.ts`, `types.ts`, `main.ts`, `app.ts`, `preload.ts`, `renderer.ts`, `pages.ts` and `dom.ts` have no header; their entry in the map is their one-line description.

**Validation.** `npm test`: 772 tests (769 and the map's 3). With `versionlist.ts`'s entry taken out of the map, 771 pass and the map's first test fails, naming `src/versionlist.ts` and what to add. Each rule failed on a map broken for it: an entry removed; a file added and another renamed; a stale `file.ts name` pair and a stale name in an entry; a file with two entries. The Mac run is named in the pull request.

## Items live in Central Knot, step 2c: skills on the library, November 12, 2026

Skills are the second kind on the library, by implementing `librarypass.ts Kind` and nothing beside it. A skill lives in Central Knot with its versions (its whole folder), as an agent does; the Skills page uses the same rows as Agents. The skills engine (`manage.ts`) is gone. `MAP.md` is the current map: its first area, "The library: skills and agents on it", names every file below.

**What a person sees change.**
- A skill a tool has that Central Knot doesn't is **Found**; its switch, halfway (Add since fix round 1), takes it in and puts it in every tool (a copy question where copies differ; the others become versions). **Off** takes the folder out of every tool and Central Knot keeps it; **On** puts the same folder back, byte for byte. **Delete from Central Knot…** is the one delete; History restores it.
- A tool's own switch for a skill is read, never written by Off or On: the folder stays, the mark is off, the row says "switched off in Codex", the status line too, and **Clear the switch** on that tool's line clears it (a History `switched` entry, which a profile's Undo reads). Fix round 1 renamed it "Let Codex load it" and gave it an Undo.
- **Has it another way** (a plugin, a link, a copy in `~/.agents/skills`, a reader of another managed tool's folder): nothing of Central Knot's goes there, its line says why, and the status line names those tools. **Take over…** is the one action that writes such a place: a link is replaced at once; the shared copy is removed once confirmed, kept as a version first, and each tool that read it gets Central Knot's copy. A found skill is taken in first (no Take over is offered for it).
- **Partial**: kept out of a tool in the opened row, the closed row says "in 2 of 3 tools · not in Codex" ("kept out of Codex" since fix round 1) and the switch is drawn striped; the main switch stays all or nothing.
- A found skill whose only copy can't be copied as it is (a link inside, an unreadable file) is a row that says why; its switch waits and it has no Files and contents.
- Removed: per-tool **Remove**, **Delete everywhere**, **Replace with managed copies**, the per-tool Disable on the Skills page (a skill's switch in the opened row now keeps it out of that tool: its folder goes).

**Map of this step** (the current map is `MAP.md`).
- **The kind:** `src/skills.ts` (`skillKind`; the ways a tool has a skill that aren't Central Knot's, `anotherWay`, and what it can't take, `cannotTake`; `applySkills`, `restoreSkill`, `skillsView` and its `rowFacts`; the kind's own two actions `clearSwitch` and `takeOver`; `skillsOn`, `skillsForRepo` for plugin parts and the Git repo). Header: what it owns and the order it reads a disk.
- **A skill's folder on disk:** `src/skillfiles.ts` (each tool's skills folder read as copies, links and unseen ones; a folder's time; checked swap, place and remove, each parked beside the skills folder with a note so a crash is put back by `recoverFolders`).
- **The store and record:** `src/skillstore.ts` (`skills.json`, versions under `items/skills/<folder>/versions/<hash>/`, the migration's steps, pruning a deleted skill's versions after History's days, `converted.json`).
- **The migration:** `src/skillmigrate.ts` (the table of every old state and where it lands, in its header; `migrateItem` per skill).
- **History's file:** `src/history.ts` (out of `manage.ts`; kept for every kind).
- **The model** gained one row (`library.ts wantedHere`): a copy of its own in a tool that also has the item another way is "not wanted there": Central Knot's own copy is removed (never loaded twice) and one it didn't put is left alone. **The pass** asks `Disk.held` for a present copy too, tells it `applied` (`Wanted`), and finds a found item's copies outside a tool's own folder (`Disk.outside`).
- **The page:** skills' words in `libraryrow.ts libraryWords.skills` and its entry in `librarypages.ts libraryPages` (Files view, Clear the switch, Take over…); `matrix.ts` draws skills as library rows. `RowWords.body` is now only for a kind whose copies are compared side by side (agents); skills' question quotes each copy's first line of text and Read both copies opens the Files view, as on `next`.
- **Worked examples:** `tests/skills.test.ts` (real folders), `tests/skillmigrate.test.ts`, `tests/skillsafety.test.ts` (the safety gates carried over), `tests/librarywalk.test.ts` (the seeded walk, a skill and an agent in one home), `tests/skillclicks.ts` (the clicks the page and History send, a folder-aware `trial`).

**Migration, state by state** (`skillmigrate.ts`'s header; `tests/skillmigrate.test.ts` holds one fixture home with every state: after migration and one pass every folder is byte-identical, every content is a version, a second pass writes nothing, and a crash at each step leaves the old files as they were).

| On the old record | In the library |
| --- | --- |
| synced | On at its synced content; applied where it was synced |
| a tool left out (`off`) | kept out there, nothing applied; a copy there stays |
| a differing copy never synced (`keptOwn`, a collision waiting for a choice) | kept out there, nothing applied; its content a version |
| a choice not carried out (`use`) | On at the chosen content; every tool holding another copy kept out, so nothing is written over |
| a tool that has it another way (reader, `~/.agents/skills`, a link, a plugin) | nothing applied there; its own copy stays, its line says both ways |
| an edit not spread yet, or a copy behind | applied at what was last synced there: the first pass takes the edit in or catches up |
| a copy on record gone from its folder | applied: the first pass reads it as deleted by hand (Off), unless the folder was made again |
| deleted everywhere | a tombstone at its content; History's Restore puts it back |
| `separate`, never synced, or turned off since | not in the library: found, every folder as it is |
| `displaced` content and every revision kept | a version of its skill |
| a switch in any tool, a profile's hold | left exactly as it is: read at each look |

`sync.json` keeps who syncs the home, its generation and its tools (format 2, no `items`); `sync.v1.json` is the record as it was. The old store folders `items/<folder>/<hash>/` stay where they are.

**Sequences that behave differently from `next` on purpose.**
- Off removes a skill's folder from every tool (on `next` it flipped each tool's own switch and the copies stayed). A tool's switch set before this step is left as it is and shown.
- A skill switched off in every tool by a profile stays under On (Central Knot still has it in every tool), its marks off and its row "switched off in all 3 tools" (on `next` it moved under Off).
- Keeping a skill out of one tool removes its folder there (on `next` the opened row's Disable flipped that tool's switch, and Remove took the copy out).
- A link in a tool's folder and a copy in `~/.agents/skills` are never written or removed but by Take over… (on `next` turning the skill on took them over, and Delete everywhere removed them). A link to a copy the tool also reads in `~/.agents/skills` is said and taken over as that copy.
- A copy deleted by hand turns the skill Off everywhere, kept in Central Knot (on `next` the deletion spread and History's Restore put it back).
- Two edits: the latest wins by the folder's time, any file inside counting (on `next`, `SKILL.md`'s time, or the fixed tool order when the order couldn't be proved).
- OpenCode, reading Claude Code's folder: it has the skill another way while the skill is in Claude Code; kept out of OpenCode, Claude Code's folder stays and OpenCode's line says it still has it (on `next` its own deny rule was written).
- Git repo: Pull makes the repo's content the current version and leaves On or Off alone; Push sends every skill in the library, On or Off (on `next`, managed skills). An Undo of a Pull is Make current of the version before.
- Profiles: unchanged (each tool's own switch), reading skills through `profileplan.ts profileSkills`.
- A found skill whose only copy can't be copied as it is is a row (on `next` too, as "Can’t sync"), but one whose SKILL.md can't be parsed or that has none is no row, as on `next`.
- A click that takes several skills in at once (only a script sends one: the page's switch takes one) is carried out skill by skill, each on record once it is: killed part-way, the ones carried out are caught up on the next opening and the rest are still found (on `next`, Apply all saved every choice before copying). Nothing is half-written either way.

**Decisions made in this step, beyond the brief.**
- *Found rows with nothing to take in* show (`canTakeIn`), their switch waiting, so a skill the person has is never invisible; one with no SKILL.md or an unparsable one stays no row, as on `next`.
- *A tool kept out that still reads another tool's copy* says so ("Kept out of this tool, but it still has it another way") rather than writing that tool's own switch, which this step never writes.
- *The shared copy is the way, over a link to it*: Take over of the link alone would give the tool a copy that is one too many while it still reads the shared copy, and the pass would remove it again.
- *Take over is offered only for a skill in Central Knot*; the brief says a found skill is taken in first.
- *A version named in a sentence* is "the version that was in Codex" (`library.ts theVersion`), for agents too.
- *Paths in sentences* are said as the page shows them (from `~`, or "…" inside another home).
- *A record that stops every write* (damaged, newer, another generation) is said in the item pages' bands, once (the skills engine's own bands said it; the bands every item page shares now do, so MCP servers and Agents say it too).

**Deleted.** `src/manage.ts`, `src/outsidewords.ts`; `tests/manage.test.ts`, `tests/outsidewords.test.ts`, `tests/sharedcopies.test.ts`, `tests/twoway-recovery.test.ts` (their cases carried to `skills.test.ts`, `skillsafety.test.ts` and `skillmigrate.test.ts` where the library keeps them); the IPC `manage:apply` and `manage:delete-everywhere` and `preload.ts` `apply`, `deleteEverywhere`; `types.ts Change`'s `remove`, `everywhere` and `takeOver`; `words.ts REPLACE_ACTION`; `skillswitch.ts unverifiedBuild`; `matrix.ts`'s skills-engine branches (Remove, Delete everywhere, Sync here for skills, the outside-copies note and its take-over, `confirmTakeOver`); the tour's `disable` section; `sync.json`'s skills (`items`, `roots`, carried only until the migration runs).

**States the brief did not explain** (each takes the choice that keeps every content and writes nothing else).
- A copy recorded as `removing` (a deletion still owed a removal) is left as it is: found.
- A found skill's old History entries offer no action on their own contents beyond what the library can say; their contents are versions.

**Validation.**
- `npm test`: 673 tests, about 45 s (the new walk's four seeds are most of the growth; more seeds run with `CK_WALKS`). The profile and Git repo tests were run against the new engine before they were changed; the sequences that changed on purpose are above.
- The walk (`tests/librarywalk.test.ts`, a skill and an agent in one home, 16 steps): seeds 10000–10099 found two things, both fixed: Take over was offered on a found skill, and a tool holding its own copy beside the shared one (both ways) was not expected by the walk. Then three fresh ranges, each as two halves of 50 seeds: 20000–20099 (its first run found that the walk's "does nothing" check didn't count a tool's switch file, which Clear the switch changes; fixed in the walk), 30000–30099 and 40000–40099, all clean.
- Each new rule switched off: 31 in all. 23 failed a named test at once; the 8 that survived got a worked example each, and each now fails: a reader of a copy that isn't Central Knot's, a tool whose skills folder is a link, a name a tool reserves, a file edited inside a folder making its time, a deleted skill's versions going when History is saved, a migrated tool left out with no copy, a kept own copy that is also a kept revision, a found row marking a tool that can't take it.
- End to end (`scripts/e2e.mjs`, the dev build on Linux): 679 passed, 1 failed: "Show log file opens the log’s folder", a Linux-only check in Settings this step doesn't touch (the file manager stand-in isn't called on this machine).
- Pictures: `node scripts/ui-tour.mjs <out> --electron --no-sandbox --only skills`, 96 pictures, every state of a skill's row at 860×560, 1280×800, 1728×1117 and 2560×1440 and in light, each looked at.
- One check loosened, said here: the safety test of a repeat pass runs one settling pass first, since the first pass after a take-in notes the skills folders' identity once.
- The first Mac run (43305709354) failed two Mac-only end-to-end checks, both fixed: a damaged `sync.json` had no band (above), and the crash flow assumed every choice of a bulk take-in was on record before copying (above); a check of the damaged record's band now runs in the practice flow on Linux too. The Mac run on the head is named in the pull request.

**Follow-ups.**
- A tool kept out while it still reads another tool's copy can't be made not to load it from the Skills page (only its own switch could, which only profiles write now).
- The old store folders `items/<folder>/<hash>/` stay after migration; a clean-up once no build reads them.
- The Linux-only end-to-end check "Show log file opens the log’s folder" fails on this machine (its file manager stand-in isn't called); macOS is the platform checked.

### Step 2c, fix round 1

What the first review round found (two page reviewers, two code reviewers, a break-it pass, a small model's cold read and a fresh agent's small change, and the orchestrator's migration on a copy of the owner's Mac home), and what was done. Each behaviour item was a failing test first; the test named is the one that fails with the fix switched off.

**One rule for an Undo: every folder as it was before the click.** A click's History entry records the copies it took over from a tool (`HistoryEvent.tookFrom`: a tool's own copy it wrote over, or one it counted as the item's because it was the same). Its Undo carries them (`Change.giveBack`, copied by `main.ts`'s sanitizer), and the pass gives each back as that tool's own, unapplied (`librarypass.ts giveBackCopy`), instead of removing what is there; the entry records which (`gaveBack`). This is one rule for skills and agents, so it changes an agents rule on purpose: turning an agent on over a hand-made file used to have an Undo that removed it (the file one Make current away); now the Undo gives that file back (the agents line above says so). Both walks now check every click's Undo, these included.
- 15a. *Undo right after taking a found skill in* removed every folder, the original included. Its Undo is now Delete plus give-back: the copies Central Knot made go, each tool it was found in keeps its folder, and the skill is found again; History says "Undone: taken out of Central Knot again …; Claude Code keeps its own copy, as before." `app.ts` asks `itemrow.ts onLibrary(kind)` where it asked `kind === 'agents'`, so a library kind's strip Undo is its entries' own actions alone. Tests: `tests/undo.test.ts` "Undo right after taking in a found skill …" and "… whose copies differed …".
- 23. *Undo of letting a skill into a tool that held its own copy* left the folder gone. The copy is back as it was and the tool kept out again. Test: "Undo of letting a skill into a tool that held its own copy …".
- 24. *Undo of keeping a skill out of Claude Code where OpenCode has it both ways* removed OpenCode's own folder. Same cause, same fix. Test: "Undo of keeping a skill out of Claude Code, where OpenCode has it both ways …".

**A version a tool won't load is never written there** (16). `Disk.refuses` (skills: `cannotTake`) holds the write where the tool has a copy too, not only for a fresh take-in: its copy stays as it was and its line says why, in the fresh take-in's sentence. The pass holds it (the brief's first choice), not only the row. Test: `skills.test.ts` "An edit Codex won't load is never written over Codex's copy …".

**History.**
- 17. Take over's `took-over` entry is appended once the take-over happened. Test: "A take-over that couldn't happen leaves no History entry saying it did".
- 18. Turning on over a different hand-made copy says so ("Codex's own copy was written over and kept as a version.") and offers it ("Use Codex's copy", as other entries with a kept version do). Test: "Turned on over a different copy made by hand in one tool …".
- 1. Clear the switch (now "Let Codex load it") has a real Undo: History's entry and the strip offer it, and it sets that tool's own switch again (`skills.ts restoreSkill`, `switchBack`). It is offered only while some tool still loads the skill: once the person switched it off again by hand there is nothing to undo (walk seeds 60074 and 60077 found the Undo offered then). Take over says "This has no Undo." on its armed line, in the strip and in History. Test: "A switch set in a tool is left exactly as it is …".

**What the page says.**
- 2. Take over's armed line says which folder is removed, which tools get Central Knot's copy, that other apps reading that folder won't find it, and that it has no Undo.
- 3. A tool switched off in its own settings is not counted as on: the closed row's switch is partial and its status says "switched off in Claude Code"; the tool's line has its own word ("Switched off") and mark; the action is "Let Claude Code load it". Test: the same switch test (the partial row).
- 4. A found row says "every tool" only when true: the tools it goes to and those that can't take it; one that can't be taken in yet (a link inside) has a switch that looks unavailable, "can't be taken in yet", and its line gives the next step (replace the link with the file, then Refresh); a skill some tools have another way says "Another way" on their lines with no switch, and the strip names them. Test: "A found row says "every tool" only when it is true …".
- 5. One mark per meaning: kept out (circle-minus), can't take it (circle-slash), switched off in the tool's own settings or by a profile (circle-off); the legend uses the lines' words.
- 6. Read shows a line that mostly changed whole, the current one struck and then this one (`diff.ts readAgainst`). Test: `libraryrow.test.ts` "Read marks the words a line changed a little …".
- 7. The status bar says "Nothing changed" only when nothing did (the end-to-end status-bar check).
- 8. At 860×560 the opened row stays at the top of the table while its lines and Delete are used (`style.css .ov-switched .ov-row.open`); the Files view shows the file first.
- 9. "kept out of Codex" everywhere; the legend's words; "← Skills"; one sentence for one frontmatter reason.
- 10. The folder note is shown only where it is true, as "Every tool it is on in gets the same folder: every file as it is, and its scripts still runnable."; version times are "just now", then minutes; History's "Use Claude Code's copy" sits with the actions; the deleted-by-hand strip keeps its full stop; a library page's strip offers "Undo" or says it has none.
- 11. A found skill only Codex has: OpenCode's line says "OpenCode reads Claude Code's skills folder, so it gets the skill from there once it is on in Claude Code." Test: "A found skill only Codex has: OpenCode's line says what is true before it is turned on …".
- 18a. A copy in `~/.agents/skills` edited after it was taken in: the lines of the tools that read it add "That copy differs from the current version, and isn't one of its versions." beside Take over…. Test: "A copy in ~/.agents/skills edited after it was taken in …".
- 25. Take over carries a tool's own switch (a profile's hold or the person's) to Central Knot's new copy. Test: "Take over carries a tool's own switch …".

**Add in place of the halfway switch** (the owner, after this round's pictures: "Why are they in the middle? Are they on or off?"). On Skills and Agents a found row has a small **Add** button where the switch was, as wide as the switch so the name starts where an On row's does (`matrix.ts addButton`, `style.css .add-item`); a click does what the halfway switch did (takes it in and turns it on, or opens the copy question; a second click closes it). Its tooltip is `libraryrow.ts addLabel` ("Add notes to Central Knot and put it in every tool", true in the edge states through `whereAdded`). The switch of an item in Central Knot is On, Off or partial only; the halfway look stays for MCP servers' Not synced, which this round leaves alone. The words follow: the page's tip loses the halfway sentence; the Found line says "Add one to keep it in Central Knot and turn it on." (not "…and put it in every tool", which item 4 says a row may only say when it is true); the opened found row says "Add it to keep it in Central Knot and put it in …" and a tool with no copy "No copy. Adding it puts it here." The end-to-end checks and the tour click `#add-<key>` on found rows (`#switch-<key>` is only ever a switch now), and one check measures Add at the switch's 32 px.

**Easier to find your way** (12–15, 19–21): every `file.ts name` in a comment now names something that exists (checked by a script over every source file); `harnesses.ts HarnessDefinition.reservedSkills` and `share.ts ShareContext settleMs` say who reads them; `MAP.md` has the reserved-name row, says a row's sentences are in `libraryrow.ts`, and that History's actions are `historyactions.ts` for every library kind; `librarypass.ts`'s header names agents.ts and skills.ts; `skills.ts readDisk` and `rowFacts` are in named parts; `tests/skillclicks.ts roots` knows Pi.

**Last pass (a confirming read and its probes).**
- History's Turn off on a take-in edited since gave Claude Code its old copy back. Copies are given back only by an action labelled Undo, and only while the item is as its click left it (`historyactions.ts asTheClickLeftIt`: at the version it left, no tool it took a copy from kept out since); a switch's `on` / `off` entry records that version (`HistoryEvent.version`). Otherwise the entry offers the plain Turn off or Turn on. Tests: `undo.test.ts` "History's Turn off on a take-in edited since…", "A take-in's Undo is not offered once a tool it was found in is kept out…".
- The write-time refusal stopped a give-back of a copy the tool itself won't load. `skills.ts wontLoad` is the one answer to "will this tool load this content": the plan asks it (cannotTake, through `Disk.refuses`), the pass asks it before writing the current version (`librarypass.ts writeCopy`, through `Kind.refusesToLoad`), and a give-back doesn't. Test: "Undo of letting a skill into Codex, whose own copy Codex itself won't load…".
- Headers: `library.ts`'s table and `Hands.remove` say the Undo exception; `historyactions.ts`'s table is true again; `skills.ts`'s header names the three actions that write a tool's switch; `isClearedSwitch` is the one test for a cleared switch.
- The Found line says what Add does: "Add one to keep it in Central Knot and turn it on."

**Not done.**
- 22. `main.ts pass` still reports skills apart from `mcpAndAgents`. Folding them changes what the Caught up band shows (today it lists skills' catch-ups only), which is more than a small change; left.
- 26. Two folders with one `name:` can't be switched separately in Copilot CLI: for the record, not from this change.

**Validation.**
- `npm test`: 686 tests, about 52 s.
- Each new rule switched off: 13, every one failing a named test (give-back, the copies a click took over, a version a tool won't load, take over told once it happened, take over carrying a switch, History's written-over sentence, an outside copy that moved on, the take-in's Undo, Clear's Undo only while a tool loads it, Read's whole lines, a switched tool making the row partial, a found row naming the tools that can't take it, a reader of a tool with no copy yet).
- The walk on 60000–60099 in two halves: 60000–60049 clean; 60050–60099 found two things, both fixed and then clean: the walk's own rule that no History action writes a tool's switch (Clear's Undo now does, on purpose), and Clear's Undo offered when it would change nothing.
- End to end (`scripts/e2e.mjs`, the dev build on Linux): 683 passed, 1 failed: "Show log file opens the log's folder", the Linux-only check this step doesn't touch.
- Pictures: `tour-l2c-r2/` (the skills section at four sizes and light, and the agents section for the rows they share), each looked at.

## Items live in Central Knot, step 3a: MCP servers on the library, November 13, 2026

MCP servers are the third kind on the library, by implementing `librarypass.ts Kind` (`servers.ts serverKind`), with two members added to the contract for a kind whose copies are entries in one shared file (said in `librarypass.ts`'s header). The MCP engine (`mcp.ts`'s sync, Restore and Undo, `choiceundo.ts`) is gone; `mcp.ts` keeps only each tool's format. Profiles are unchanged: they still flip each tool's own switch for servers (step 3b makes them sets of On items). `MAP.md`'s first area names every file.

**What a person sees change.**
- A server a tool has that Central Knot doesn't is **Found**, with **Add** (a copy question where copies differ; the others become versions). **Off** takes the entry out of every managed tool's settings file and Central Knot keeps it with each tool's own fields; **On** puts each back: the same values, and each tool's own part (its own fields, its name as that tool spells it, where OpenCode keeps it, and the comment lines of a Codex table), after the file's other servers, every other byte of the file as it was. A comment at the end of a shared value's line (`command = "npx" # pinned`) is not kept: that line is Central Knot's to write. The opened row keeps a server out of one tool (in place of the per-tool Enabled box). Versions with Read and Make current, Delete from Central Knot and its Restore, as for skills and agents.
- **Claude Code's file is written only by Write to Claude Code**, with Claude closed, as before. Until then a row whose entry there is behind, still to be added or still to be removed says so (a clock mark, Claude Code's line, the status), and one band above the table offers the write for all of them and writes only what those rows owe (with Automatic sync off too). Off and then Delete before the write: the row is a found one tagged "deleted", "Claude Code still has it until you click Write to Claude Code". Undo write is not carried: its way back is Make current, then Write.
- **A tool's own switch** (Claude Code's and Copilot's settings list, the `enabled`/`disabled` field in Codex's, Pi's and OpenCode's entries) is read and left as it is; its mark, its line and the row say it. Off then On brings the server back switched off where it was, and the line says so.
- **Left alone, never taken in**, each said on its tool's line: a server that belongs to an app (ChatGPT desktop's), an entry in a form Central Knot doesn't edit, two names in one file that differ only by case, an entry Central Knot put in as a plugin's part. A tool that can't hold the server (SSE in Codex, Pi, OpenCode) says so; one that has it through a plugin gets no entry, as before.
- **Hand edits and deletions** follow the model's table. An entry has no time of its own: an edit made on the current version counts; of two, the first tool's (in the page's order) wins and the other is a version. A change to a tool's own fields alone is no edit. An entry deleted by hand, in any format and also when it was the file's last (`codex mcp remove` of the only server), turns the server Off everywhere; Turn on puts each entry back.
- **A settings file that can't be seen is no set of deletions**: unreadable or unparseable, the whole tool is left alone; missing, it is away, and written afresh once the settle window has passed. Today's "two or more gone at once is a reset" guess is gone: a tool that rewrites its file without its servers turns them Off, nothing is lost, and each is one click back on.

**Map of this step.**
- **The kind:** `src/servers.ts` (`serverKind`, and `kindFor` for the kind Write to Claude Code runs; `readDisk`: entries, what is never taken in, Claude Code's waiting writes; `applyServers`, `writeToClaude`, `restoreServer`, `serversView` and its `rowFacts`, `serversForRepo`, `serversOn`).
- **The formats:** `src/mcp.ts` (lines 1–268 of before; `editEntry` now answers `{ stopped, changed }`, a Codex removal takes its blank line with it, and `recoverSettings` is exported). `src/mcpswitch.ts` keeps the reading side and `withMcpSwitch` for profiles and plugin parts; `setMcpDisabled` and `mcpSwitchFacts` went with the per-tool box.
- **The store and record:** `src/serverstore.ts` (`mcp.json` format 2, `mcp.v1.json` the old record, versions and each tool's own fields under `items/mcp/<key>/`).
- **The migration:** `src/servermigrate.ts` (the table below, in its header; `migrateItem` per server).
- **The contract** (`librarypass.ts`): `Kind.folderSeen` answers the guard's look in place of a directory's `stat` (a missing file is away; one that is there keeps one fixed identity; a file the pass itself made is noted as there at its end), and `Disk.locked` carries `waits` (the pass leaves each write and removal there undone, answers it held with `waits`, and plans the harness as any other, so an entry deleted by hand in Claude Code still turns the server Off). Skills and agents leave the first out and never set the second; their walks on 100 fresh seeds each are clean.
- **The page:** servers' words in `libraryrow.ts libraryWords.mcp` (with `switchedOff`, the line after a tool's own switch), `HarnessIs 'waits'` and its sentences; `librarypages.ts libraryPages.mcp` (Read shows what a version runs, part by part); `matrix.ts` lost every non-library branch (each kind is a library row now) and `writeStepBand` reads the rows' `waits`; `itemrow.ts kindSource` reads every kind's view the same way; `app.ts applyClick` lost its record-change and put-back paths and says a write that waits ("Claude Code waits for Write to Claude Code."), never counting that tool as done.
- **History:** `historyactions.ts libraryEntry` knows `mcp:` (an entry from before the library names the server as written; `library.ts itemKey` makes its key, and `librarypass.ts restore` reads it the same way). `historypage.ts` keeps profiles' and the base instructions' entries, and the sentences of entries from before the library.
- **Elsewhere:** `gitrepo.ts` (Push from `serversForRepo`, Pull through `PassOptions.pulled`), `profileplan.ts profileServers`, `parts.ts` (its own store for a server part's content, falling back to the old MCP store for parts put in before; a server On in the library is the person's), `toolchoice.ts` (`forgetServerFolders`), `pluginrows.ts` and `pluginstatus.ts` (a server's part is the row's though it is no copy of it).

**Migration, state by state** (`servermigrate.ts`'s header; `tests/servermigrate.test.ts` holds a settled fixture home with every state: after migration and one pass every settings file is byte-identical, every distinct content is a version, a second pass writes nothing, and a crash at each step of writing the record leaves the old files as they were).

| On the old record | In the library |
| --- | --- |
| synced | On at its synced content; each recorded copy applied |
| a copy whose file was missing at the last look (`away`) | nothing applied there: written afresh, never read as deleted by hand |
| a tool left out (`off`) | kept out there, nothing applied; an entry there stays |
| a differing entry never on record (a collision waiting for a choice) | kept out there, nothing applied; its content a version |
| Claude Code behind (waiting for Write now) | applied at what was last recorded there: still owed the write |
| an edit not spread yet | applied at what was last synced: the first pass takes it in, as the earlier engine would have |
| a copy recorded in a settings file no longer used | nothing applied there |
| deleted, a removal still owed (`removing`) | a tombstone; the removal applied while the entry is as it was, else left alone |
| `separate`, never synced, or turned off since | not in the library: found, every entry as it is |
| every `<hash>.json` kept, `displaced` contents | versions |
| `<hash>/<tool>.json` for the current content | that tool's own part |
| `<hash>/<tool>-<ref>.json`, `missingSince` | not carried (the old folder stays as the backup) |
| each tool's settings file | the library's `folders`: away where it is missing |

**Sequences that behave differently from `next` on purpose.**
- Off removes the entry from every tool (on `next` it flipped each tool's own switch and the entries stayed); On, or its Undo, puts it back after the file's other servers. The opened row's per-tool switch keeps a server out of that tool (on `next` it was the tool's own Enabled switch).
- A server is found until it is added; Add takes it in (on `next` the halfway switch synced it).
- An entry deleted by hand turns the server Off everywhere, kept in Central Knot (on `next` the deletion spread and History's Restore put it back). A file rewritten without its servers is no "reset" any more: each server turns Off (on `next` two or more gone at once were written back).
- Two tools edited: the first in the page's order wins (on `next` the fixed order Copilot, Claude Code, Codex, Pi, OpenCode). An edit in Claude Code while it waits for Write loses to the newer current version and is kept as a version (on `next` it was a conflict notice).
- A copy with no record where a server is turned On is kept as a version, then written over (on `next` Restore of an old deletion refused over a server set up again with other settings).
- Write to Claude Code has no Undo of its own (on `next` Undo write); its way back is Make current, then Write.
- A plugin's MCP part is the plugin's: never found or taken in, and a profile no longer flips its switch (on `next` a part could be managed as an ordinary server, and profiles flipped it).
- Git repo: Pull makes the repo's content the current version through the pass (on `next` it wrote one tool and let sync spread it, and with only Claude Code here it couldn't come in). A server deleted by hand stays in the repo until Delete from Central Knot; Pull's removal deletes it from Central Knot at once, also with Automatic sync off (agents' still waits). Push sends every server in the library, On or Off, with Claude Code's own fields for it where Central Knot has them (on `next`, managed servers, Claude Code's fields only when its entry was the one sent).
- History: an old entry's own actions (Undo add, Undo write, Finish undo, Undo of a switch) are gone; each offers what the library can still do (a content change: Make current; a deletion: Restore).
- A tool's own switch set on an Off server's entry inside it (Codex, Pi, OpenCode) comes back with the entry; Claude Code's and Copilot's stay in their settings.

**Decisions made in this step, beyond the brief.**
- *A waiting harness is planned as any other* (`copyIn` doesn't hold it): only then does an entry deleted by hand in Claude Code turn the server Off, as in every other tool.
- *The pass notes a file it made as there* (end of `runPass`, for `folderSeen` kinds): otherwise a hand deletion right after Central Knot created a missing settings file (Copilot's, before its first server) read as a file made again and was written back.
- *Names that differ only by case across tools are one server* (the library's key); each tool's entry keeps its own name when it is written over.
- *A tool's own fields are kept by the pass before any removal*, not by the write itself (`Kind.write`'s note says so).
- *An empty JSON object gets one step of the file's own indentation* (`textedit.ts indentOf`), and *a Codex table taken from the file's end takes its blank line* (`mcp.ts writeEntry`), so Off then On is byte for byte for an entry Central Knot wrote itself.
- *"Can't be read" in the key under the table is now "Left as it is (its line says why)"*, true for every reason a copy is left alone.
- *The found-row sentence for a row that can't be taken in* is "Not in Central Knot · it can’t be taken in now (see below)." and its tag "can’t be taken in", for skills too (a server that belongs to an app never can).
- *A server whose entry is still in Claude Code after Delete from Central Knot is a found row tagged "deleted"* whose Add takes it in again (as an agent's in a folder that can't be written).

**Deleted.** `src/mcp.ts` lines 270–1043 (the record, kept versions, view, `applyMcp`, switch flips and their Undo, the six Undo and Restore functions, `goneFacts`, `forgetMcpCopies`, `undoClaudeWrite`), `src/choiceundo.ts`, `src/syncrules.ts`, `src/roworder.ts`; `clickplan.ts`'s off plan, record change, inverse and Undo order; `matrix.ts`'s non-library halves (`cellOf` marks, Not synced, Sync here, the per-tool Enabled box, put-back of a gone item, the MCP definition block and notices with Write inline); `itemrow.ts cellOf`, `needsCopyChoice`, `onLibrary`, `libraryView` and `KindSource`'s `waiting` and `gone`; `app.ts unwriteClaudeNow`, `putBack`, `restoreAll` and the record-change Undo; `historypage.ts`'s MCP actions (Finish undo, Undo add, Undo write, the choices list); the IPC `mcp:apply` and `mcp:unwrite-claude` and preload's `applyMcp` and `unwriteClaude`; `types.ts McpView`, `McpResult`, `ClaudeWrite`, `GoneItem`, `ChoiceBefore`, `ALREADY_AS_IT_WAS`, `Change.disable`/`enable` and `use: 'separate'`, `SkillFacts.held`/`separate`/`gone`, and the History fields only the engine wrote (`restoredTools`, `stoppedSync`, `unmanaged`, `wasSynced`, `addedId`, `before`, losers' `kept`, `folder`, `synced`, `editedAt`); `gitrepo.ts`'s Pull route through one tool, `sourceTool`, `standingEntries`, `holdUnseen`, `noServerTaker` and their words; `mcpswitch.ts setMcpDisabled`, `mcpSwitchFacts`; `profiles.ts switchedByHand`'s MCP arm and the three `releaseProfileHolds` calls for servers; the CSS only those used. Tests: `tests/mcp.test.ts`, `tests/choiceundo.test.ts`, `tests/roworder.test.ts`, three of `clickplan.test.ts`'s four, and the check files' MCP cases that tested the engine's own mechanisms (N5, R5).

**States the brief did not explain** (each takes the choice that keeps every content and writes nothing else).
- A removal owed in Claude Code for an entry edited since: nothing applied, the entry left alone.
- Two old record items whose names differ only by case: the first keeps its place, the other's kept contents become its versions.

**Validation.**
- `npm test`: the type check and 655 tests. The profile, Git repo and plugin tests ran against the new kind before they were changed; the sequences that changed on purpose are above.
- The walk (`tests/serverswalk.test.ts`, a server with a skill and an agent in one home, 16 steps): seeds 7000–7099 found the walk's own two faults (its "hand edit" renamed Codex's table, and its "settled" ignored the record), both fixed; then 8000–8099 and 7000–7099 again, each as two halves, clean. `tests/librarywalk.test.ts` on 9000–9099 and `tests/agentswalk.test.ts` on 9000–9099, each in halves: clean (the contract's two members change nothing for skills and agents).
- Each new rule switched off: 37. 32 failed a named test at once; the 5 that survived got a worked example each, and each now fails: the settle clock per entry, a removal owed for an entry changed since, a copy recorded in a settings file no longer used, the migrated folders (an edit not spread yet), Claude Code's own fields in Push.
- Pictures: `node scripts/ui-tour.mjs <out> --electron --no-sandbox --only mcp` under `xvfb-run`, 88 pictures of every new state of the MCP servers page at 860×560, 1280×800, 1728×1117 and 2560×1440 and in light, each looked at (`/home/picoder/work/ck-one-switch-plan/tour-l3a/`).
- No Linux end-to-end run (the brief); the end-to-end checks for servers are updated and run on the Mac.

**Follow-ups.**
- The old store folders `items/mcp/<name>/<hash>…` stay after migration; a clean-up once no build reads them.
- Profiles (step 3b) still flip each tool's own switch for servers; a server Off in the library is in no tool, so a profile doesn't see it.
- Pull doesn't read Claude Code's own fields for a server from the repo (Push sends them); step 7 replaces that route.

**Fix round 1** (nine reviewers of 57dcc9f, and a real-window check on the Mac; `FIX-L3A-R1.md`). Each behaviour item was reproduced by its probe, made a test that failed first, and fixed the cheapest way named.
- *Off then On gives a tool back its own entry.* A tool's own part (`mcp.ts OwnPart`) is the entry's name as that tool spells it, where OpenCode keeps it, and its own fields, which in Codex now count each comment line among the table's own lines (`#1`, `#2`…, kept in order with the other own lines, and written after the shared values). An entry written afresh takes its name, place and own fields from it (`servers.ts writeServer`); one written over keeps its comments too. Tests: the comment-line, casing and switch examples in `tests/servers.test.ts`.
- *An Undo that would give Claude Code its MCP entry back is not offered* (`historyactions.ts givesBackLater`), since that write would wait and the write after would remove the entry: an Add of a server Claude Code had has no Undo (Off is the way out), and a switch's Undo that gave Claude Code a copy back is the plain switch. The result's band offers Undo only when every entry the click made still has its action (`app.ts allUndoable`). Which tools wait is said once, `libraryrow.ts writesWait`, read by servers.ts, historyactions.ts and the page.
- *Migration*: a copy the old record had as away is not applied, so a settings file back (empty) before the upgrade gets its entries written afresh; a still-missing one is written at the first pass.
- *Make current with Automatic sync off asks after the click what each tool can hold*: the shapes are kept by hash for every version (`servers.ts cannotTake`, `librarypass.ts Wanted` with the clicked `hash`).
- *Write to Claude Code writes Claude Code alone*: its pass holds every other tool's writes for the next pass (`readDisk`, the kind built the other way round) and says only what it did in Claude Code.
- *A write that waits is never said done*: an Off row still in Claude Code says "still in Claude Code until Write" (its tag, its status, the Off heading's note), Claude Code's switch in the opened row says "Waits for Write" in place of On, the copy question says Claude Code's part happens at Write, and a deletion's notice names the tools it was taken out of ("so it is off and was taken out of Copilot CLI and Codex"). "Turns off everywhere" is "turns off" in the sentences that can't tell.
- *A deleted server Claude Code still has* has no Add (`libraryrow.ts canTakeIn`), and its line and status say History can restore it.
- *After a click each row is under the heading true for it*: rows were held in place while the pointer or focus was on them, under a heading that no longer fit. Of regrouping at once and a heading that claims nothing while held, regrouping at once is the smaller: the hold (`matrix.ts pinRows`, `regroupIfLeft`, the pointer and focus tracking, `state.reads`) is deleted, for Skills and Agents too. End-to-end checks: "after a click each row is under the heading true for it, from the keyboard too, and the headings count their rows", "after a click with the pointer over the list too, each row is under the heading true for it", "after a click each agent is under the heading true for it, from the keyboard too", and the skills check "and its row is under On at once, the pointer over the list too".
- *A row's line is shortened only when it has no room*: an opened item's dock takes half the width (was 60%), so a server's URL beside its name and tag shows whole at full screen. End-to-end check: "docked at full screen, a row's line is shortened only when it has no room".
- *Next reader*: `readTool`'s `section`, the `reset` notice kind and README's "was reset" line are gone; the "same bytes back" promise says what holds for an MCP entry; one name for a shared file's fixed identity (`librarypass.ts sharedFileSeen`); MAP names `mcp.ts cannotHold`; stale pointers fixed.

## Items live in Central Knot, step 3b: profiles are sets of On items, November 13, 2026

A profile is a named set of library items (skills, MCP servers and agents). Switching to it turns each item it names On and every other library item Off, by the library's own clicks, in one pass per kind; nothing in a profile flips a tool's own switch any more. Which profile is in use is worked out from what is On, never stored. The rules are `profileplan.ts`'s, pure, read by the switch, the page, History and the menus alike.

**What a person sees change.**
- **The Profiles page** lists every library item under Skills, MCP servers and Agents, each with its box and one column that says what a switch does to it ("Turns on", "Turns off", "Stays on", "Stays off"; "On" or "Off" for the profile in use). The header counts it ("Switching turns 2 items on and 5 off") and says an MCP server's change in Claude Code waits for Write to Claude Code. The per-tool columns, "off by hand", the "by a profile" mark, No profile, "Apply to tools" and the drift dot are gone. A profile with nothing in it offers no switch (it would turn everything off); its first step is "Start from what's on now". Any profile can be deleted, the one in use too: no item changes, and Undo makes it again.
- **A switch** writes one History row ("Switched to Incident: 2 items turned on and 5 turned off."), and the items' own On and Off rows are not written for it. Its result band offers Undo switch and, when an MCP server's part waits for Claude Code, Write to Claude Code (never said done). Switching to the profile in use changes nothing and writes nothing.
- **Undo switch** turns back each item still as the switch left it (one it turned On that is On, one it turned Off that is Off), by each item's own Turn on or Turn off, each with its own row; an item changed since stays. No copies are given back. Its band offers no Undo of the Undo: each item's row has its own action.
- **The profile in use** is the one whose items are exactly the On items, ids naming no live item skipped. It shows in the list ("In use"), the header, the status bar and beside the menu bar icon, and follows a hand click, an item taken in or pulled, a copy deleted by hand, a Delete. None matching: No profile. Two with the same items: both, "Development and On call". An empty profile is in use while nothing is On.
- **The menus**: each profile is a checkbox item ticked while it is in use; the No profile item and "Apply … to tools" are gone.

**Map of this step.**
- `src/profileplan.ts` (rewritten, pure): `liveItems`, `homeItems`, `switchPlan`, `inUse`, `inUseName`, `undoPlan`, `turnsWords`.
- `src/profiles.ts` (rewritten): profiles.json format 2 (`readProfileFile` also reads format 1 for the page), `saveProfile`, `deleteProfile`, `whyNotNow` (the one gate every kind's pass shares, asked first), `switchProfile` (the entry first, then `turnTogether`: the clicks with `PassOptions.told`, and what each item became read back), `undoSwitch`, `liveNow` for the menus.
- `src/profilemigrate.ts` (new): format 1 moved once (its header has the steps and their order).
- `src/librarypass.ts`: `PassOptions.told` (a profile switch's clicks are told in its own entry; `logItem` leaves their On and Off entries out). `src/servers.ts`: `releaseKeptDenies` after every servers pass; `src/serverstore.ts`: `keptDenies`, `claude-denies.json`.
- The page: `src/profilespage.ts` (rewritten), the status bar's menu in it; `src/main.ts` (`profileMenu`, `followProfiles` from the library's items, `migrateProfiles` first in every pass); `src/app.ts` (`switchToProfile`, `turnedOutcome`); `src/historypage.ts` (`profileSwitch`); `src/harnesspage.ts` (the name in use).
- `MAP.md`'s Profiles area, a path for a profile switch, and the names that meant two things.

**Migration of profiles.json, format 1 to 2** (`profilemigrate.ts`; `tests/profiles.test.ts` holds the fixture home). It runs first in every pass main makes, with Sync on or off, where a pass may write (`whyNotNow`: preview-only, another build's home or one waiting for Resume wait).

| In format 1 | In format 2 |
| --- | --- |
| `profiles[].items`: `skill:<key>` | the same |
| `profiles[].items`: `mcp:<name as written>` | `mcp:<key>` |
| (no agents) | every agent On at migration joins every profile |
| `offByProfile`: every listed switch, whether or not the item's copy is there now | released where it is (skills: `skillswitch.ts setDisabled`, Claude Code's override put back as kept, by the item's name where the copy is gone; servers: `mcpswitch.ts withMcpSwitch`, one checked write per file), or, for a server's switch inside an entry that is out of the tool (Codex, Pi, OpenCode), in the own part Central Knot keeps for it (`mcpswitch.ts ownWithoutSwitch`), every other own field kept |
| a library item held off by listed switches in every tool that has it (every tool whose copy loads it now, all read) | Off, on record before any switch is cleared; its copies taken out by a pass after the clearing, so Codex's, Pi's and OpenCode's own part is kept with the switch cleared |
| a listed switch turned back on by hand, an item one tool still loads, a tool that can't be read | the item stays as it is |
| Claude Code's deny of a server in the library not wanted there afterwards (turned Off, kept out, deleted) while Claude Code still has its entry | kept, listed in `claude-denies.json`; cleared by the first servers pass that finds the server wanted in Claude Code. With the entry gone, nothing can start: released at once |
| a switch set by hand (not listed) | left, shown with its mark |
| `active` | dropped |
| the file | kept as `profiles.v1.json` |

When it turns something Off, one History row says what ("Profiles are sets of items now: …"), with Undo (each item's Turn on). Its closing pass touches only the held items that are Off (turned Off now, or by a run that stopped part-way); an item that stays On is left to the ordinary sync rule, with Sync off too. After it, one pass writes nothing.

*Claude Code's order, the smaller way:* keep the deny and clear it once the server is wanted in Claude Code again. The other way, clearing it when Write to Claude Code takes the entry out, also needs the list, and still leaves the deny when the server is turned On before Write (its entry never went, so Write has nothing to do for it). Wanted-again covers both cases with one rule.

**Sequences that behave differently from `next` on purpose.**
- A switch turns what a profile leaves out Off in the library, which takes its copies out of every tool (on `next` it flipped each tool's own switch and the copies stayed); it turns On what the profile names, also where a switch set by hand had it off (on `next` a hand switch stayed off: such switches are now tools' own marks, which no switch touches).
- Agents are in profiles (on `next` none).
- No profile is no action (on `next` it turned back on everything profiles had turned off); the status bar says No profile when none matches.
- The profile in use follows the library by itself (on `next` it was stored, and drift counted what no longer matched, with "Apply to tools").
- Undo switch is each item's own Turn on or Turn off, each with its own row, and has no Redo (on `next` the Undo was a switch of its own, with Redo; it refused when the profile switched from was deleted).
- The profile in use can be deleted (on `next` it couldn't).
- A tool's own switch an earlier profile set reads as that tool's own (on `next`, "switched off by the profile Incident"); the migration clears those it can.
- A switch in a home waiting for Resume is refused before anything is written (on `next` profiles flipped switches there).

**Decisions made in this step, beyond the brief.**
- *A switch asks the passes' one gate first* (`profiles.ts whyNotNow`) and refuses in plain words, so no switch is ever refused part-way by a pass and no entry has to say a part was not done. Every kind's pass shares that gate (write access, the sync owner, Resume), so per kind there is nothing left to refuse in ordinary use.
- *What each item became is read back after the passes.* The walk found one way an item is not as the switch asked: a server whose Claude Code entry was lost (Claude Code rewrote its file) while its removal waited turns Off again in the same pass that turns it On (the library's deleted-by-hand rule). The band lists only what is as asked and says the rest "is not as it asked: History says why"; History keeps the switch's row, then the item's own deleted-by-hand row. Test: "A server whose entry Claude Code lost while its removal waited …".
- *Two profiles with the same items are both in use* and named together, since the name is worked out and neither is truer.
- *An empty profile is offered nowhere* (page, status bar, menu bar), as before.
- *Undo of a switch writes no profile row of its own*; it marks the switch's row undone by the first item row it made.
- *The migration writes one History row* when it turns anything Off, so what it changed is said, with Undo.
- *Format 1 is read for the page* (its ids translated) where the migration waits; editing such a file is refused until it is moved, so its holds are never lost.
- *Every plugin Apply all reads the home again* (`pluginstate.ts applyPluginOps`; before, only a change of parts did). The Mac run found it: the Skills page showed a plugin's skill still on in Codex after Apply all turned it off, because the page had followed only through the profiles' watch of the switch files, which this step deletes, and only while a profile existed. End-to-end check: "on the Skills page its Codex box shows it off, the plugin’s other skill on".

**Deleted.** `profileplan.ts`'s `planSwitch`, `driftOf`, `offAfterFlips`, `offAfterFailures`, `releaseHolds`, `holdsOnWhatIsHere`, `offByHand`, `standing`, `changedSince`, `choseProfileInUse`, `changedProfile`, `redoneSwitch`, `profileSkills`, `profileServers`, `switchItems`, `presentItems`, `profilesInUse`, `activeProfile`, `flipCounts`, `flipWords`, `flipSummary`, `SwitchItem`, its `ItemKind`; `profiles.ts`'s flipping (`switchOf`, `editText`, `writeFlips`, `whyNotTaken`, `flipAll`), `undoProfileSwitch`, `whatGoesBack`, `switchFilesStamp`, `driftNow`, `releaseProfileHolds`, `switchedByHand`, `offByProfile`, `active`; `main.ts`'s drift, `lastStamp`, `lookAtSwitchFiles`, the No profile and Apply items, and `releaseProfileHolds`'s last caller (Clear the switch; step 3a removed the two for servers); the page's per-tool columns, legend, notes, "off by hand", No profile view and Stop using profiles; `itemrow.ts profileItemOf`, `matrix.ts turnedOffByProfile` and the key's "Off by a profile"; `skills.ts`'s read of a profile's flips; `skillswitch.ts switchState` and `switchedText` (only profiles called them); `types.ts ProfileFlip`, `ApplyResult.flips`, `SkillFacts.disabled`, `ProfilesView.active`/`offByProfile`; the CSS only those used. Tests: the old `tests/profiles.test.ts`, `skillmigrate.test.ts`'s profile-hold test; `servers.test.ts`'s switch test now sets the switches by hand.

**States the brief did not explain** (each takes the choice that keeps every content and writes nothing else).
- A listed switch whose file can't be read or changed at migration: left as it is, a tool's own switch from then on.
- A listed switch for an item only found (not in the library): cleared; nothing else.
- A crash inside the migration between clearing the switches and moving the file: the next pass runs it again; the items already Off stay Off (they are on record first), so it reaches the same end. One more History row may be written.

**Validation.**
- `npm test`: the type check and 656 tests.
- The walk (`tests/serverswalk.test.ts`: a server, a skill and an agent, now with three profiles, switches and their Undo among the steps; (h) lets a profile's actions touch the skill and the agent, (c) counts a record change as doing something): seeds 11000–11049 found one class (the band claiming an item turned on that the same pass turned Off again, above), fixed; then 11000–11049 and 11050–11099, each half, clean.
- Each new rule switched off: 24, every one failing a named test (one, "a switch off now counts", survived at first and got the `back` skill in the migration's fixture).
- End-to-end checks (`scripts/e2e.mjs`) rewritten for profiles: the page's preview row by row, the switch's folders and the name in use everywhere, an empty profile offering no switch, Undo switch byte for byte, the status bar's switch on Skills, a hand click changing the name, and History's Undo leaving what changed since. Run on the Mac (no Linux run, per the brief).
- Pictures: `node scripts/ui-tour.mjs <out> --electron --no-sandbox --only profiles` under `xvfb-run`, 68 pictures of every state of the Profiles page at 860×560, 1280×800, 1728×1117 and 2560×1440 and in light, each with its `.txt` (`/home/picoder/work/ck-one-switch-plan/tour-l3b/`).

**Follow-ups.**
- Found items joining a profile, the Harnesses page, first setup, plugins and Git links are later steps.
- `profiles.v1.json` and `claude-denies.json` stay until a later clean-up.

**Fix round 1** (eight reviewers of afc6cfe; `FIX-L3B-R1.md`). Each behaviour item was reproduced as a test that failed first.
- *Every switch format 1 lists is released, copy or not* (`profilemigrate.ts releaseAt`, `onRecord`, `releaseSkills`, `releaseInFiles`; `mcpswitch.ts ownWithoutSwitch`): a server's switch inside an entry that is out of the tool is cleared in its kept own part; Claude Code's deny is released at once where Claude Code no longer has the entry (nothing can start), and kept only while it has it; a skill's rule goes by the item's name where its copy is gone. Test: "Migration releases a profile’s switch on a copy that is not there now …".
- *The migration's closing pass touches only held items that are Off*, so with Sync off a waiting hand edit of an item that stays On is not copied. Test: "Migration with Automatic sync off leaves an item that stays On to the ordinary sync rule …".
- *A settings file's change reaches the open page*, whether or not the pass wrote (`main.ts backgroundPass`, `settingsTouched`), and each tool's switch file is watched as the MCP settings files are (`main.ts startWatching`): Claude Code's settings.json was not watched, and the profiles' stamp of switch files, which made the page follow, is gone. A folder's event tells the page only with Sync off, as before: telling it after every event re-read the page after each of Central Knot's own copies, and the Mac run's crash check took 107 s longer. End-to-end check: "a switch set in Claude Code’s settings reaches the open page …" (no Refresh).
- *A migration stopped part-way writes one History entry*: the entry is written only when something turns Off (its `cleared` count is gone), so the run that finishes it writes none. Test: "A migration stopped part-way is finished by the next pass, with one History entry". A stop between writing the entry and saving the items Off would still write a second one.
- *The page*: the header wraps whole and says Claude Code's MCP servers change at Write to Claude Code only when one does (a server turning On that Claude Code lacks, or turning Off that it has); "In use · 2 items on, the other 5 off"; an empty profile says "Tick at least one item to switch to it"; whether a profile is offered is one rule (`profileplan.ts switchable`) for the page and both menus; stacked at 860×560 the page scrolls as one, every profile and then the items (with eight profiles the inner box showed two item rows). End-to-end check: "the status bar, the list and the header say Incident is in use".
- *Next reader*: MAP says sources are under `src/`, names `main.ts switchFromMenu` and `historypage.ts profileSwitch`; `profilespage.ts` names a list `inUseNow` and a yes/no `isInUse`; Undo's wording is "whose On or Off differs now"; `skills.ts` names the migration among the writers of a skill's switch; `.pf-menu-note` is gone.
- Pictures of the states changed: `/home/picoder/work/ck-one-switch-plan/tour-l3b-r2/`, at 860×560 and 1280×800, with `tour.md`.


## Items live in Central Knot, step 4: "Synchronize everything" as a standing rule, November 13, 2026

The owner's rule (plan, section 1): once "synchronize everything" is chosen, a new skill, agent or MCP server that turns up in a managed tool is taken into Central Knot and turned On everywhere by itself. This step adds that rule and its one setting per home. First setup's question, which chooses it for a new home, is step 5; with the rule off, found rows and Add are as they were.

**What a person sees change.**
- **Settings › This home › Synchronize everything** (a switch). Off where it was never chosen. Its line says what it does; while it is off, how many found items turning it on would add now; either way, how many found items wait for a choice of copy, with See Skills (or the page that has the first). Unchangeable, with the reason, where a pass may not write. There is no Add all anywhere: switching the rule on is the one way to add everything.
- **Turned on**, the pass right after (Automatic sync on; with it off, Sync once) takes in everything found then that the rule may take, each as Add would (On everywhere, from the one content; Claude Code's MCP part waits for Write to Claude Code, in the one band). Each gets Add's History entry, "Found in Claude Code and taken into Central Knot by Synchronize everything; put in Codex.", with Add's Undo and its limits (none where the give-back would go to Claude Code's MCP file). One notice per pass of a kind: "Synchronize everything took in 3 skills, found in Claude Code and Copilot CLI: notes, release-notes and standup. History can undo each." A take-in's row reads "Undone" once its Undo is used.
- **What it leaves found**, each row saying why while the rule is on: copies that differ (the row's question, as before; the Found heading and Settings count them), an item deleted from Central Knot or whose take-in was undone ("only Add brings it back"), a plugin's part, a copy that can't be read (quietly), and a skill or agent copy still being saved (taken at the next pass: 2.5 s later with Automatic sync on, at the next Sync once with it off). The Found heading says which rule is in force; so do Overview's sync line and the status bar's idle tooltip.

**The take-in table** (`library.ts takeInAnswer`, in its header as FOUND, one column for a click on Add and one for the rule). Told a found key's readable copies (each a plugin's part or not), whether the record holds it deleted, and whether a deleted item's copy still waits to leave a harness at Write to Claude Code (`librarypass.ts foundKey`, the one place a click, the rule and each kind's view learn it), it answers take it (from which copy), wait for a choice, or leave it with a reason. The click's column is the behaviour before this step; it replaces `librarypass.ts takeIn`'s inline branches and `libraryrow.ts canTakeIn` and `needsChoice` (the row reads the answers as `LibraryFacts takeInAnswers`, through `asksWhichCopy` and `canAdd`).

**Map of this step.**
- `src/library.ts`: FOUND in the header; `FoundCopy`, `FoundKey`, `TakenBy`, `LeftFound`, `TakeInAnswer`, `takeInAnswer`.
- `src/librarypass.ts`: `Disk.parts`; `foundKey`, `takeInAnswers`; `PassOptions.background` (main.ts's pass of the whole home, the only one the rule runs in); `passGate` (was `refusal`, now also hands back the sync record); `addClicked`, `takeInByRule`, `takeIn` (one take-in for both), `takenInNotice`; `logItem` keeps the rule's entries out of a pass's `made`.
- `src/share.ts`: `SyncRecord.syncEverything` (checked as a boolean by `readRecord`), `setSyncEverything`, `partsIn` (what `skills.ts` and `agents.ts` reads put in `Disk.parts`).
- `src/types.ts`: `SyncNotice` is `ItemNotice | TakenInNotice`; `HistoryEvent cause 'sync-everything'`; `SyncView.syncEverything`; `LibraryFacts.takeInAnswers` (was `differs`); `DesktopApi.setSyncEverything`.
- The page: `settingspage.ts syncEverythingRow`, `app.ts setSyncEverything` and `keepUnshown`, `matrix.ts foundNote` and `takenInNotice`, `libraryrow.ts ruleSays` and `takenInWords`, `historyactions.ts` (the rule's sentence, its Undo, "Undone"), `pages.ts`, `renderer.ts`; `main.ts` (`sync:everything`, `{ background: true }` in `pass`, `lookAgainSoon`).
- Tests: `tests/library.test.ts` (the table, row by row), `tests/synceverything.test.ts` (every way the brief named on real files), `tests/serverswalk.test.ts` (the rule on in odd seeds, new copies among the steps, checks (i) and (j)), `scripts/e2e.mjs syncEverythingFlow`, `scripts/ui-tour.mjs --only sync-everything`.

**Sequences that behave differently from `next` on purpose.**
- An agent row whose only copy can't be read (two files whose names differ only by case) has no Add; on `next` its Add was live and answered "No tool has a copy of it to take in any more." Test: "An agent whose only copy is two files differing by case gets no Add, and the rule leaves it".
- An undone take-in's History row says "Undone" (on `next`, "Turned off since").
- A sync notice its page hasn't shown yet stays in the next read until it is shown or dismissed (on `next` the next read dropped it; a pass's own writes to an MCP settings file bring such a read a second later, so turning the rule on from Settings lost every notice).
- Every pass of the whole home that leaves something inside the settle window looks again 2.5 s later, a Refresh's or Sync once's too (on `next` only the background pass did).
- A notice's sentence too long for its line wraps beside its mark, not under it.
- A sync record whose `syncEverything` is not true or false reads as damaged.

**Decisions made in this step, beyond the brief.**
- *Where the rule runs* is said by the caller (`PassOptions.background`, main.ts's pass of the whole home), not worked out from `only`: with Automatic sync on a click's pass has no `only`, and the rule stays out of it too; the background pass right after takes in.
- *The rule's take-ins are no click's*: they are not in a pass's `made`, so a click's Undo never undoes them; each has its own entry.
- *The settle window is either side of the pass's clock* (`|clock − at| < window`): a copy written while the pass reads (its time just after the clock) waits; one dated far ahead is taken at once, so a future-dated file never holds the rule open.
- *A plugin's part* is learnt by the kind's read from `plugin-parts.json` (`share.ts partsIn`); the page's "from <plugin>" tag still reads `home.parts` (`matrix.ts fromPlugins`), which also names parts in tools not managed.
- *The Settings row* is in a section of its own, This home, since it is kept in the home's sync record, not the app's settings.

**States the brief did not explain** (each leaves the item found, its reason on the row).
- A key with a plugin's part in one tool and a copy of the person's own in another: left (a part).
- Two tools gaining one name, one copy still inside the settle window: all of it waits until it has settled.

**Validation.**
- `npm test`: the type check and 681 tests.
- The walk (`tests/serverswalk.test.ts`) on 100 fresh seeds, `CK_SEED` 14000 and 14050, 50 each: clean. The rule was on in 50; it took in 78 items in 39 of them, 246 new copies turned up, 2 take-ins were undone (`CK_TALLY=1`).
- Each new rule switched off, 41 in all (the table's rows, `foundKey`, where the rule runs, the notice, `partsIn`, the setting, History, the row, the page's words and counts, main.ts's wiring): every one fails a named test or end-to-end check. Five survived at first and got one each: a tool named once in the notice, both `partsIn` filters, the record's boolean, and the quick look again.
- End to end, `syncEverythingFlow` on Linux (`--electron`): 30 checks pass, three runs in a row; the "no Add all" checks stay. The Mac run is named in the pull request.
- Pictures: `node scripts/ui-tour.mjs <out> --electron --no-sandbox --only sync-everything` under `xvfb-run`, 56 with their `.txt`, at 860×560, 1280×800, 1728×1117 and 2560×1440 and in light (`/home/picoder/work/ck-one-switch-plan/tour-l4/sync-everything/`).

**Follow-ups.** First setup's question and its walk through differing copies; the Manage switch per tool; a taken-in item joining a profile; plugins; Git links.
