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
