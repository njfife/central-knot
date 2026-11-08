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
