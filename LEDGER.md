# Implementation ledger

Nathan authorized slice 1a, fresh source at `~/code/central-knot-next`, fresh `next` history in `njfife/central-knot`, existing Mac CI, deletion of old GitHub branches/tags, and removal of the old Mac checkout. On November 7, 2026 he said he could not validate 1a, asked for the best validation possible and to move on to the next steps. This was taken as the plan's proposed next step: 1b's first checkpoint and 8a's Preview and First copy. He then accepted one sync location with no second copy, which opened real-home Start on the Mac, and asked for the interface to be rebuilt to match the old design with nothing taken from its code.

| Batch or release | Package hash and arrival with source commit, or record path | Evidence list or record path | Decision | Provisional choices; new persistent state and reason | Unmet named |
| --- | --- | --- | --- | --- | --- |
| Read-only package: 1a | Mac-built `Central-Knot-0.1.0-mac-arm64.zip`, SHA-256 `e94c76341815e22330e2b5a71e1aa691f382d75c51921d2835754bbd90626662`; app source `d36da31c9b5fb7488e08ff7fe5b42f3c2e890d46`; copied directly to T3, not downloaded through a browser | 11/11 fixture tests and TypeScript pass on Mac and Linux at that app source; 11/11 also pass under Finder-like PATH on Linux; Mac packaging and packaged fixture renderer pass under Finder-like PATH, two fixture rows; CI run `42173525787` passes on `ck-mac-ci` at `9d7054156901608eb352dc4fadd32df31c274cf8` (only CI configuration changed from app source) | 1a authorized; Nathan’s Finder try, row/stack acceptance and next decision pending | Electron/TypeScript, Claude Code CLI skills only; no product persistent state; normal Electron app data only | Actual-home comparison and normal Finder/ordinary-download opening not run; all V gates and later outcomes remain open; GitHub artifact hosting unavailable at account quota |
| First safe copy, disposable homes: 1b.1, 8a Preview and First copy | Mac-built `Central-Knot-0.2.0-mac-arm64.zip`, SHA-256 `92c77377aecb090c7b4d84d626c72ec7f798cd3f9a7383fe1f46d71cc5724b4b`; source `7162e7c3ff7b3f848cbb10737b4342b91197cfdb`; copied directly to T3 | 34/34 tests on Mac and Linux; CI run `42326917536` passes; end-to-end list below | Nathan’s recovery answer and his try pending | Sync record and imported revisions in `.central-knot/` inside a disposable home only; app settings file `sharing-settings.json` in normal app data; both needed by section 3 | Any real-home write; session use on either CLI; a normal Finder or ordinary-download opening (V-10); section 7's AT-48 choice parts and everything after First copy |
| User alpha 0.3.0: real-home First copy on macOS; rebuilt interface | Mac-built `Central-Knot-0.3.0-mac-arm64.zip`, SHA-256 `407b81c6e29c7ec5775d249a5ebe7da320b75f406c5d000b30410e227f5074fe`; source `269c2bcd1437c59af19d199a9b3d044236892fb9`; copied directly to T3 | 40/40 tests on Mac and Linux; CI run `42336167703` passes; real-home run below | Recovery: one location, no second copy, accepted by Nathan November 7, 2026. His own try pending | Real sync state at `~/.central-knot`, created only by Start; removed after the agent's test | AT-62(f) owner restore and AT-62(g) overwritten-record rollback, by that decision; a normal Finder or ordinary-download opening (V-10); section 8a's Continuation and everything after |
| Validation pass, 0.3.0 rebuilt | Mac-built `Central-Knot-0.3.0-mac-arm64.zip`, SHA-256 `c56d74d01dec368ce506bfe91b7d0f259c38e1f3dc2e0dc97bb88f1ad37d2bb5`; source `5b2e23c7b075970dd2c4ac05c9fb7620992a0cfe`; replaces the earlier 0.3.0 package | 75/75 tests on Mac and Linux; `scripts/e2e.mjs` 3 Mac runs, 1 Linux run; CI run `42342080955` passes, including the end-to-end test | Nathan said go; his try pending | Stages sit beside the skills folder, or in `.central-knot/staging` if that is read-only | Session use in Claude Code; real windows, Finder double-click, the native file picker and the Gatekeeper dialog; progress during long copies; every later batch |

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
