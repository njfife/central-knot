# Central Knot agent instructions

## Non-negotiable product boundary

Central Knot is a configuration mover, not a secret manager or security product. Managing secrets is the user's responsibility.

- This applies to MCP configurations, skills, agent definitions, instructions and all other managed content.
- Do not search for or classify secrets, scan content, redact or filter values, omit content because it contains a secret, introduce vault integration, or add secret-specific warnings or approval prompts.
- Preserve content and values as-is through supported format translation, synchronization, local storage, history and restoration. Embedded credentials are ordinary configuration values for this product.
- Do not propose secret-management features as requirements, implementation work, acceptance criteria or review findings. Validate configuration syntax and supported formats without inspecting content for secrets.

## Merging and releases

- Merge finished, checked work into `next` without waiting to be asked. Nathan basically always wants changes merged; hold back only for a real reason (unfinished, checks failing, or he said to wait). A subagent working under an orchestrator hands its branch to the orchestrator, which merges.
- Never tag, build or publish a release unless Nathan asks for one in the current conversation. An earlier request does not carry over to the next release.

## Platform focus

macOS is the released platform. Linux is being built, one step of the Linux plan at a time (Nathan, 2026-11-16: "Linux first"); no Linux work changes what the Mac build does. Windows comes after Linux and is not started: do not make a Windows run a required check, and do not spend time on Windows-only failures or features, unless Nathan asks.

## Checking a change

Keep the loop short. These are the checks; nothing else is required.

1. `npm test`: the type check and the unit tests, about 20 seconds.
2. The Mac run: a builder does not start one; the orchestrator runs one for a batch of finished pull requests, `gh workflow run mac.yml -R njfife/central-knot --ref <branch>`, then `gh run watch <id> -R njfife/central-knot`. It runs `scripts/mac-run.mjs`: the unit tests, the packaging, the light tour, the bundled and alpha checks, then the end-to-end checks against the packaged app, and prints each part's result and how long it took. It also runs by itself on every push to `next`, unless a green run already tested that tree.
3. If you changed what a page looks like, look at the pictures: `gh run download <id> -R njfife/central-knot -n light-tour` gives one picture of each page. For a state the light tour doesn't show, run only your own feature's section: `node scripts/ui-tour.mjs <outDir> --electron --only <section>`.

- The Mac is its owner's own computer. The Mac run waits while it is short of memory, swap or disk (`scripts/mac-guard.ts`), keeps its temporary files under `/private/tmp/ck-ci-<run>-<attempt>/` and, however it ends, removes them, empties `release/` and stops what it left running. A task that touches the Mac removes what it made there before it ends.
- The full tour (`--full`, hundreds of pictures, about ten minutes) runs for a new release only. Do not run it, repair it or extend it for an ordinary change; a section outside your feature is not yours to fix.
- The end-to-end checks already open every page, fail on a page error and check that nothing is cut off at each window size. Add a check there, not a tour section, when behaviour needs covering.
- A Linux run (`.github/workflows/linux.yml`: every push to `next`, or `gh workflow run linux.yml -R njfife/central-knot --ref <branch>`) is for the Linux plan's steps, never a required check for a Mac change.
- A Windows run (`.github/workflows/windows.yml`, started by hand with `gh workflow run windows.yml -R njfife/central-knot --ref <branch>`) exists for Windows work and is never required for a Mac or Linux change. A Windows step's brief says when to run it.
- A change that adds, renames or removes a file under `src/` or `scripts/` changes its entry in `MAP.md`; `tests/map.test.ts` (in `npm test`) fails until it does and says what to change.
- `docs/SPEC.md` is history, as `LEDGER.md` is: written before the library and not kept true, so read `MAP.md` and the module headers for how the code works now. Its ids cited in comments (`SYN-03`, `MCP-02`, `D-36`) are historical.

## Mandatory subagent briefing

Every delegated task must include the following paragraph directly in its task brief, whether it concerns research, specification writing, implementation, builds, testing or review. Do not rely on inherited conversation context or the child discovering this file.

> Central Knot is a configuration mover, not a secret manager. Managing secrets is the USER's responsibility. Do not look for secrets in MCP configurations, skills, agents, instructions or other content. Do not add secret scanning, classification, redaction, filtering, omission, vaults, or secret-specific warnings/approvals. Preserve configuration content and values as-is, including embedded secrets, through supported translation, sync, storage, history and restoration. Do not treat the absence of secret-management features as a defect.

If a subagent is authorized to delegate further, it must include the same paragraph in every downstream task brief. This instruction does not itself authorize delegation.
