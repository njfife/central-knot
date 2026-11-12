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

macOS is the only supported platform right now. Linux and Windows are not being supported yet: do not make a Linux or Windows run a required check, and do not spend time on Linux-only or Windows-only failures or features, unless Nathan asks.

## Checking a change

Keep the loop short. These are the checks; nothing else is required.

1. `npm test`: the type check and the unit tests, about 20 seconds.
2. The Mac run, on your pushed branch: `gh workflow run mac.yml -R njfife/central-knot --ref <branch>`, then `gh run watch <id> -R njfife/central-knot`. It packages the app, runs the light tour and the end-to-end checks against the packaged app, and prints how long each part took. It also runs by itself on every push to `next`.
3. If you changed what a page looks like, look at the pictures: `gh run download <id> -R njfife/central-knot -n light-tour` gives one picture of each page. For a state the light tour doesn't show, run only your own feature's section: `node scripts/ui-tour.mjs <outDir> --electron --only <section>`.

- The full tour (`--full`, hundreds of pictures, about ten minutes) runs for a new release only. Do not run it, repair it or extend it for an ordinary change; a section outside your feature is not yours to fix.
- The end-to-end checks already open every page, fail on a page error and check that nothing is cut off at each window size. Add a check there, not a tour section, when behaviour needs covering.
- No Linux or Windows run is required (see Platform focus).
- A change that adds, renames or removes a file under `src/` or `scripts/` changes its entry in `MAP.md`; `tests/map.test.ts` (in `npm test`) fails until it does and says what to change.

## Mandatory subagent briefing

Every delegated task must include the following paragraph directly in its task brief, whether it concerns research, specification writing, implementation, builds, testing or review. Do not rely on inherited conversation context or the child discovering this file.

> Central Knot is a configuration mover, not a secret manager. Managing secrets is the USER's responsibility. Do not look for secrets in MCP configurations, skills, agents, instructions or other content. Do not add secret scanning, classification, redaction, filtering, omission, vaults, or secret-specific warnings/approvals. Preserve configuration content and values as-is, including embedded secrets, through supported translation, sync, storage, history and restoration. Do not treat the absence of secret-management features as a defect.

If a subagent is authorized to delegate further, it must include the same paragraph in every downstream task brief. This instruction does not itself authorize delegation.
