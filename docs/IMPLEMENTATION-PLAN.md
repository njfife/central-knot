# Central Knot implementation plan

**Status: planning only.** This plan authorizes no code, release, real-machine operation or agent, and accepting it authorizes nothing. Commands and planning choices are proposals; every proof gate (`V-nn`) is open. [SPEC.md](SPEC.md) and [capability-data.md](capability-data.md) (CD) win over this plan, except for section 1's later confirmed Tools clarification, section 3's labelled alternative to the D-08 and D-31 mechanisms and, on Nathan's named acceptance, section 6's per-action exception.

## 1. Execution contract

**The product.** A file-copy tool: discover, read, minimally translate and write preservingly, with only the bookkeeping history, restoration, selections and sync need. Procedure counts as complexity; confirmed outcomes stay.

**Every slice.** User-wide configuration only (I-31); instruction sync off initially; values as-is (I-11), with no added auth or signing policy. All five families and three OSes stay in scope, macOS first, prioritizing optional bundles needing no recipient step beyond a normal first opening (REC-01, ORG-03) and the actual Claude, Copilot and Codex desktops and CLIs (Codex CLI and ChatGPT desktop joined Priority 1 on November 8, 2026), with no substitutes and no Iru integration in v1 (ORG-09). Organization update delivery is best effort (ORG-05: local HTTP accepted, HTTPS not required). A card includes its surface's detector or reader if absent, observed-state verification and an honest status. Capability data is a plain file of the CD rows consumed.

**Tools (confirmed November 5, 2026).** CK syncs what the person selects, even with both detected: Cowork alone, Claude Code alone, or both, neither requiring the other, with no duplicates or conflicting writes from shared configuration. With nothing managed, D-28a's proposed ticks are editable defaults. No mode prompt, entitlement detection, account role or restricted-account proof (retired test parts: section 7): CK claims nothing about account access and reports a selected tool's native failure. Each surface owes its own route, preservation, load and update evidence; a shared reader stays disclosed (OWN-04). A tool neither selected nor ticked gets no new plugin install (PLG-06's expansion aside) or standalone sharing; plugins already there keep updating after deselection (PLG-09, D-18, AT-26), and uninstall and exclusion hold.

**Host (confirmed November 5, 2026; do not ask again).** Nathan's Apple Silicon Mac over Tailscale (SSH alias `mac`) builds and runs tries; the old build's GitHub Actions runner `ck-mac-ci` (`ck-ci` user) runs CI, keeping none of that build's architecture, policies or jobs, with no runner repair project.

**Authorization.** Nathan approves a few usable outcomes (section 2), not each slice. Nothing is blanket-authorized: one message names a batch or part of one and its allowed live changes; the settled Mac is the default host, disposable-home scripts included. Beyond Nathan's own tries, sign-in, a live app, account or real home needs build, account, permitted change and revert named once for the batch; name a different host then too. A prerequisite outside the message is reported, not pulled in.

**Inside a batch.** Engineers work the listed steps in Needs order, choose and record ordinary mechanics, and make in-scope fixes and reruns, without asking after any card, checkpoint or evidence cell. Passing fixtures and recorded prerequisite facts open the next listed step and widen nothing the message names. At the batch's end Nathan says continue, rework or change plan; authorizing the next batch can be the same message.

**Stops.** Out-of-scope or impossible work, an unresolved product tradeoff or an unsafe live operation stops the affected work and goes to Nathan with state and reason, with no workaround layer. Missing setup records Unproven with its limit and halts nothing else; no unauthorized live change creates one or replays a historical destructive probe. Unbuilt is only Unmet, and a red test during in-scope repair is ordinary work, with no repair count. A **shipped correctness failure** stops dependent work until repaired or reverted, going to Nathan at once if it reached a real home: failed side-effect gate, lost or changed unrelated byte outside FIL-03’s disclosed native effects, overwrite with no diff, deletion inferred from an unreachable root, false Installed or report, update re-enabling or reinstalling, refresh counted as an update, work outliving Quit or stopping with the window, one build replacing another, content rolled back. After a failed route proof or acceptance check, engineers adapt within scope or try the next unused candidate; with neither left, Nathan chooses to ship that outcome Unmet, change plan or stop. A failed install, load or update cell keeps that route's updater closed, and shipping Unmet never excuses a shipped correctness failure.

**First writes.** ACT-01–03, FIL-01, 02, OWN-02 and history, collision and exclusion protection apply from the first harness write (native install, settings, instructions or 8a). Before its first real-home write on an OS, a self-writing slice passes interrupted-write, unrelated-byte and symlinked-target fixtures for that shape (a link stays a link; caches and native registries untouched), with section 3's prior bytes and byte-exact undo. A native command owes FIL-03's disclosure and text diff plus native recovery. The first slice letting two CK-triggered writers reach one physical file adds ORG-08's minimal per-user lock around those writes, claiming nothing about other apps.

**Recovery.** Undo or History Restore for CK edits (section 3's prior bytes before 8a); native uninstall for plugins, or unavailable with the reason; removing the app leaves its data and harness files (PLT-02). Each Try notes leftovers and the harness's own cleanup step.

**Task brief.** Short plain text: the root `AGENTS.md` paragraph and Nathan's scoped authorization, both verbatim, plus a pointer to the card, proof row or batch. The agent reads the applicable rules, Needs and cited SPEC and CD rows, derives the due section 7 parts (including the interaction tests) and keeps that one list in the ledger. No generator, tracker or second schedule. Agents report gaps instead of building them and spawn no agent the authorization does not name.

**Working rules.** One code slice at a time (proposed), unless Nathan names a parallel pair and who owns shared modules; proofs overlap only on isolated setups. No new product prompts. A local service, bridge or UI automation required by a recorded passing route is covered by authorization of that route’s slice; record its proved need in the ledger’s persistent-state cell. Otherwise a framework, daemon, service, database, bridge, marketplace server, UI automation of other apps, multi-instance infrastructure, bundled Git library, per-build working store, carried history, event log or migration first needs an approved plan edit naming the proved need.

## 2. Batches and releases

Batches are Nathan's try and approval points, in this proposed order; slices and checkpoints stay engineering tasks and test owners. Nathan may authorize part of a batch, regroup it or name a Phase 2 row early, and Needs still hold. Due section 6 answers come with the batch.

| Batch | Steps | Nathan tries at its end |
| --- | --- | --- |
| **Read-only package** | 1a, then 1b checkpoints named | Opens from Finder; rows match what you know |
| **First safe copy** | 8a Preview, First copy | Preview, copy a skill between the CLIs, use it, Undo |
| **Codex skills** (added November 8, 2026) | 11c Codex skills checkpoint: detection (CLI and ChatGPT desktop's bundled `codex`), reading `$CODEX_HOME/skills` and `~/.agents/skills`, measured load rules, writes to `$CODEX_HOME/skills` only | Codex appears as a third column; manage a skill into Codex and use it in a new Codex session and in ChatGPT desktop |
| **CLI plugins** | 3a–3c, plus Codex CLI's native `codex plugin` route; CLI V-16 tries | Pick, install, use in each CLI's new session (Claude Code, Copilot, Codex); uninstall |
| **Desktop plugins** | Phase 2 D and S rows; Phase 4; 5a; desktop V-16 tries; ChatGPT desktop through the shared `~/.codex` | Use on Code tab, Copilot app, Cowork and ChatGPT desktop; both-selected try |
| **Bundled recipient** | AP; Phase 2 B rows; 6a; 5b; 6b | Custom build beside standard, source stopped: browse, install, use |
| **Updates** | 7a; direct and bundle Update Passes; 6c, 6d; 7b; 12a; try the first proven destination before expanding to remaining routes | App and content update independently, window closed; disabled, uninstalled and dropped plugins hold |
| **Two-way skills** | 8a Continuation; 8b | Sharing, deletion, Restore; Code tab and Copilot app AT-68 sessions |
| **Other kinds and handover** | Phases 9–10; 11a, 11b; 12b; Nathan tries MCP on a real home before work depending on 9a, with no extra approval | MCP and agents, including desktop AT-68 sessions; turning off, instructions, defaults, expansion, Take over syncing |
| **Other families** | 11c Pi and OpenCode, the rest of 11c Codex (MCP, agents, instructions), 11d; Codex bundled route, its Update Pass and 7b updater | Skills and plugins on the remaining families and desktops |
| **Release** | 12c; then 13-Win and 13-Linux, each its own batch | Compatibility page and release decision; each OS's journeys |

Every runnable card or checkpoint is also an optional **Try**, owing no decision and holding up no work. Evidence needing Nathan's hands stays owed or Unproven: proof sessions later steps need can be their own sitting, and the rest gather into the batch's one sitting.

- **Development fixture release:** disposable homes and fixture marketplaces, claiming nothing about real harnesses; every slice with app code ships one first.
- **User alpha:** a package Nathan installs and opens normally, after any section 6 answer it needs, doing only what its authorization lists and naming what is Unmet; no Compatibility UI before 12c. A macOS refusal to open is V-10 evidence, with no signing, HTTPS or OS-bypass mandate. From the first harness write it uses the actual home; the fixture build is a flag on the same source, and automation never follows a remembered selector. Fixture packages never write actual harness homes, even when selected manually.
- **Interim holds (proposed):** a custom build's standalone sharing and instruction sync wait for 12b. A collision shows Needs a decision; a deliberate hold, Not known yet with the reason; an ownership hold, its UX-04 row; only an actual update error, Couldn't update.
- **Complete v1 (macOS):** every confirmed outcome except I-12 passes on macOS, or is named Unmet with Nathan's explicit release choice.
- **People.** Novice tests and coworker tries use people Nathan names, otherwise Not run.

## 3. Provisional architecture

One Electron (proposed, proved by 1a's package) and TypeScript app of plain modules, with OS-specific code in thin platform modules and pure Linux fixture tests from 1a.

**Bookkeeping (proposed alternative to D-08's Git store and D-31's per-installation stores plus carried copy; section 6).** One plain file format from the first persistent write, growing in place, with 12b adding only what AT-62 needs and no conversion step. A first writer creates only what it uses.

- **One location.** Each user has one sync and history location, independent of build identity (on a fixture build, under the selected home): plain version folders for imported current revisions (STO-03) and prior bytes, a small hash, baseline and history record only the sync owner writes, and sharing choices as separate metadata. Nothing removes it silently, and losing a build's settings leaves it.
- **Per build.** Settings, plugin selections, content releases, and the diffs and prior bytes of its native operations, plugin-route settings edits and targeted instruction saves. These neither initialize nor replace sync ownership and remain usable with sharing off or its record unreadable, using the same physical-write lock where needed.
- **Stops from the first persistent write.** An unknown or newer metadata format version stops writes to that file. Only standalone or instruction-sync setup establishes sync ownership. On genuine first setup with no record, durably create the sync record naming this build as owner and a random generation ID, then remember both in this build’s settings before its first sharing import or write (per selected home on a fixture build). An existing record follows the ownership and recovery rules, never initialization. Sharing writes stop with the reason and Retry, deleting nothing, if metadata is damaged, a seen record is missing, its generation differs from the remembered one, or a record exists with none remembered. None of these becomes first setup or silently adopts a stale record; restoring the remembered generation then Retry resumes where that record is recoverable. From First copy, settings lost or not yet saved can explicitly resume an intact record naming this build as owner, inventing no baseline or deletion; a different owner remains held.
- **No second copy** unless Nathan chooses redundancy (section 6). Harness files survive regardless, and version-folder bytes stay readable by hand after metadata damage, but CK cannot rebuild exclusions, conversion choices, baselines or Restore from them; a lost location loses those bytes too. Restoring an old record together with its matching old-owner settings cannot be detected as rollback; AT-62(g)’s overwritten-current-record case stays Unmet unless the chosen recovery design proves it.
- **Recovery.** First copy has the explicit resume above; Start fresh and the rest of recovery remain Unmet until 8a’s Continuation. **Start fresh** (ORG-08's explanation, zero-write preview and explicit Start) restores nothing and mints a new generation ID, leaving old state stale. It is offered (proposed reading of D-31) only when Retry finds no usable record, this build is the last owner or that owner's installation is gone, no owner runs elsewhere, overlap is ruled out and section 6's chosen recovery design is in place. A mismatch or failed Retry alone starts nothing fresh.

## 4. Evidence, proofs and dependencies

Evidence words are CD §1's and apply only to the source, route, surface, CK and harness builds, and OS recorded for the run. Harness build changes follow DET-03. A proof stops only what depends on it; that destination stays Not known yet, with its SPEC §8 outcome Unmet by name. A blocked or failed CW-D waives no destination's own bundle or update record, and no S result closes a no-CLI journey.

**Surface proofs:** a CLI, V-02; Code tab, V-01; Copilot app, V-05; Cowork, V-15 and V-04; a direct private source also V-16, a bundle also V-17.

Tests use disposable homes unless the authorization names a real one: pure fixtures (`npm test`, also on Linux), fixture executables in 1a, and actual CLI binaries (`npm run test:harness`) only where the card or authorization names them.

- **Side-effect gate.** Only CK's own process and bounded read-only probes (CD §3); an unexpected session, service, server or sign-in, an initialized cache or registry, or a changed fixture byte fails it.
- **Session pass,** owed wherever a slice installs or shares: an item used in a new session or turn on that surface, captured by transcript or screenshot with surface, build, item, version and the sessions and restarts loading took. A synthetic marker carries a never-used **token** per route candidate and version; a copied user skill needs its captured identity and invocation instead, with no marker added inside it. Nathan's authorized session can make it Exercised Real; a bare "worked" stays User-reported.
- **Lifecycle record,** per surface, source route and OS: SPEC §9's plugin lifecycle as cells (install, load, update v1→v2, disabled through an update, uninstalled stays out, catalog removal keeps content), each Pass, Fail or Unproven with its label, plus content as supplied by read-back where exposed, otherwise Unproven. A token alone proves no whole-content preservation. A listing, file check or, for a desktop, sibling CLI result never counts as load or update.
- **Source reach versus local mechanism.** A direct record (source fetched remotely at use) names source, reach and the credential mode already in use, collecting nothing new. A bundle record also covers no source connection, credentials or system Git. A B row records copy or live-link at its named candidate location; before its Try, 5b or 6b repeats this at 6a's location and checks what quitting or removing CK does. A local, public or test-key pass, a local-source row or a 6a script is mechanism evidence, never a private-source pass or recipient provenance.
- **Install Pass.** Install and load in an actual session with no recipient setup. The record names each applied step, which CK must be able to perform itself, apart from sign-in, native consent and session turns. Hand-configuring the target app makes a lead, not a Pass. A Pass ends a row's candidate search and opens that route's install slice, or supplies a CLI direct slice's owed session evidence, without a separate build gate. A later CK version may build on it but claims no current result until its own Try, with no blanket rerun.
- **No-CLI or no-Git claims.** Distinguish strict evidence from a usable but limited setup:
  - A strict claim needs a named installation on that OS with the disallowed binaries absent or unavailable, only the target surfaces installed, and its inventory and relevant paths documented. `PATH` or usual locations alone do not establish absence; a second macOS user isolates only per-user state. Nathan need not provision a VM or account now, and nothing assumes Cowork works in one.
  - Without that setup, the strict claim stays Unproven. An **Install Pass with a setup limit** can still open building that slice: use the actual desktop's own session, with only that tool selected, on a route not calling an installed CLI. Label each available binary visibly used or unknown. A bundle candidate visibly using system Git earns no limited Pass; continue its candidate search.
  - This limited Pass pauses that row's search. Its real Try uses that desktop under section 6's same acceptances and reports PLG-03's observed status with the limit in existing detail. Add no status or prompt and claim no isolated recipient. The strict rerun is due on the first suitable setup Nathan authorizes, not postponed to 12c. Without that setup, keep the journey Unmet and reconcile it at 12c.
- **Update Pass.** v1→v2 used in a new actual session on that surface and route, with install's isolation labels, never a Stub, and the record's other cells recorded. It opens that destination's plugin updater and any replacement of content a native installation uses; 7b Feed's staged content and catalog fixtures do not need it.
- **Stub session** (CD §1, disposable home, marker token in what it sends). An optional way to open building a CLI's 6b when no real bundle Install Pass exists: no Install Pass, real result, sibling evidence or closed journey.

**AP, App-update proof (V-10; disposable, not a release).** Scripts take a bare custom-identity test build from version 1 to 2 from a fixture location with no recipient action, beside an untouched standard app, keeping identity, settings, store and content; a failed update keeps version 1. At most three candidate routes (proposed). Once, Nathan opens that package after an ordinary download, recorded separately from the update result. A macOS refusal uses no update candidate and does not erase update evidence: normal installation on that arrival path stays Unmet (V-10), and Nathan decides the next step, with no bypass instruction. Before 6a chooses an identity or content location, AP passes or Nathan decides on no Pass, which stays Unmet.

**Needs** give technical order; required human inputs are named in their entries. A named slice means its due fixtures pass with no shipped correctness failure open; a named proof means its recorded result. Checkpoints inside 1b, 7b, 8a and 8b run in order on the same terms.

- **1a, each Phase 2 row:** nothing.
- **Update Pass:** that route's recorded install/load setup and v2 content; no CK updater or feed implementation is required.
- **1b, 3a, 7a background, AP:** 1a.
- **3b, 3c:** 3a.
- **6a:** 3a AND AP's result.
- **4a-D, 4b-D, 5a:** 3a AND that row's Install Pass (CT-D, CA-D or CW-D).
- **4a-S:** 3b AND CT-S Install Pass. **4b-S:** 3c AND CA-S Install Pass.
- **5b:** 6a AND CW-B Install Pass.
- **6b, per desktop:** 6a AND its bundle Install Pass (CT-B or CA-B). **Per CLI:** 6a AND (its Stub session OR that CLI's bundle Install Pass).
- **6c, 6d:** 6a. 6d's CI half: 6c.
- **7a updater, per destination:** 7a background AND its install slice AND its Update Pass.
- **7b Feed:** 6a AND Nathan's publish choice (section 6). **Updater, per destination:** Feed AND its 5b, 6b or Codex bundled route AND its bundle Update Pass.
- **8a:** 1a AND a Copilot CLI skill reader (1b's first checkpoint, or built here).
- **8b:** 8a. **9a, 9b:** 8b. **10b:** 9b.
- **10a:** skills, 8b; MCP, 9a; whole-plugin Disable, that destination's install slice.
- **10c:** 1a AND those files' reader. **10d:** 10c.
- **11a:** 3a. **11b:** any install slice.
- **11c, per family and kind:** skills, 8b; MCP, 9a; agents, 9b; Disable, 10a; instructions, 10c, 10d; plugin routes, 3a AND that route's record. **Codex bundled route:** 11c Codex AND 6a, in either order.
- **11d:** product rows, 1a; each kind's observations, that kind's sharing slice AND named authorization.
- **V-16 try:** that destination's install slice AND named authorization.
- **12a:** 6a AND AP Pass, not sharing. **12b:** 6a AND 8b.
- **12c:** 12a, 12b AND every other macOS slice, per section 2's Complete v1.
- **13-Win, 13-Linux:** 12c, unless Nathan moves an OS earlier.

## 5. Phases

Cards list only what differs from section 1 and this lead, and spell out a Try only where the card doesn't make it obvious. **Install slices** (3b, 3c, Phases 4 and 5, 6b) carry the applicable minimum of PLG-02, 03, 05, 07, ENB-07, FIL-03, MKT-07 and D-16's same-name stop, with no updater, expansion or Disable control. The first adds one plain selection file holding only what it uses, with D-28a's editable ticks. Until 11b, a destination with no proven route shows Not known yet, naming the proof, and remembers no selection. Each plugin Try installs from CK and uses the marker.

### Phase 1: See what I have (read-only)

**1a First look.** A package that opens normally from Finder, with an in-app development home selector (bundled fixture, another folder, this Mac's home), opening on the fixture. Executables: short candidate list, timeout, `--version` only; system candidates run only in Nathan's try of this Mac's home. Proposed default: Claude Code CLI standalone skills, as a row list and Item detail showing Not shared, no toggle. **IDs.** Those parts of DET-01, 02, DIS-01, 02, 04, 05, UX-02, 04, PLT-01. **Try.** From Finder, check the fixture's rows; on this Mac's home, compare with skills you know; confirm the rows and stack, or reject the approach.

**1b Every Priority 1 surface, in checkpoints.** **IDs.** DET-01–03, DIS-01–05, UX-01–04, D-15, for those surfaces, in Harness view and Item detail. **Try.** Compare each checkpoint's rows with what you know. An authorization may stop after any; the rest stay named Unmet.

1. Copilot CLI skills (opens 8a).
2. Claude Code CLI: MCP, agents, instructions, plugins.
3. Copilot CLI: the same.
4. Code tab: its own detection and rows, no CLI assumed.
5. Copilot app: its own row, no sibling standing in.
6. Cowork and Chat "Managed in your Claude account" rows; GitHub Desktop and `gh` as not harnesses.

### Phase 2: Desktop route proofs (records, not a release)

- **Rows.** **CW-D, CW-B** Cowork, direct and bundle-style (local source), no Claude Code. **CT-D, CT-B** Code tab, same, no `claude`. **CA-D, CA-B** Copilot app, same, no CLI. **CT-S, CA-S** that desktop with its CLI present, from a CLI-route install. V-15 first, capturing the user-reported local Git lead's missing details. Before 1a, an authorized row may create the tiny marker and a disposable candidate Git fixture only in a named scratch location.
- **Setup.** Each record names who applies and cleans up candidates, account state included, and the binaries found. An absent setup uses up no candidate.
- **Candidates (proposed).** At most three per row, from CD §7 or proposed leads (CT-D: V-01's two, settings route first); stop at the first Install Pass. A CT-D private-copy Pass is evidence only until Nathan accepts shipping or downloading that copy; its slice waits for that answer. When setup permits, publish marker v2 in that sitting and record its update cell; a failed update resumes the search before building on that route. None passing goes to Nathan with the evidence; SPEC's [E] rules stand and no required journey is declared impossible. Copilot's lead: CD §7's user-scope declaration, then new sessions in the actual app; for CA-B, also its non-bare local path. A private Copilot CLI copy stays unapproved (REC-02).
- **CW-D reach.** Its record names source and fetch origin and tests machine- or network-only reach with a loopback or LAN-only fixture. A candidate failing this test earns no CW-D Install Pass; continue the search. Passing is mechanism evidence only, with real private-source reach still owed by name.
- **IDs.** V-01, 04–06, 15, 17; REC-02, COW-01, 02, PLG-04. Each record names readers reached and what CK can observe or read back, even nothing (PLG-03).
- **Try.** With a marker plugin first shown valid on a CLI: sign in, take the turns, capture each token. No session pass means Unproven.

### Phase 3: Marketplace to the CLIs

**3a Marketplace spine (no harness write).** Marketplaces with no setup; MKT-05's access check only for actual Git sources, non-Git catalogs and bundles never requiring Git (V-17); per-destination component report and route labels. **IDs.** MKT-01, 02, 04–06; PLG-01; PLG-02's report; D-16's list removal; D-30.

**3b Claude Code CLI, 3c Copilot CLI.** That CLI's native install and uninstall with exclusion; shared-store readers disclosed. A disposable-home script runs native commands against the marker for its direct record. Uninstall leaves the marketplace registration (CD Appendix C), which CK reports. **IDs.** OWN-04; surface proofs, V-12. **Try.** Uninstall from one and check the other.

### Phase 4: Code tab and Copilot app, each alone

**4a-D Code tab, 4b-D Copilot app (no CLI).** A plugin chosen in CK works in a real Code tab session and, separately, a Copilot app chat turn. **4a-S, 4b-S (CLI present).** The same from a CLI-route install. A settings undo keeps other bytes and names what stays. **IDs.** PLG-04, D-23, OWN-04; surface proofs, V-06. **Try.** On the Copilot app, use it after restart.

### Phase 5: Cowork

**5a Direct, 5b Bundle.** With Cowork as the only destination, a plugin picked in CK installs and loads in a Cowork session with no recipient step, each source route alone. **IDs.** COW-01, 02, REC-01–03, OWN-04; surface proofs. **Try.** Confirm no terminal, upload or use of Claude Code.

### Phase 6: Bundled build

**6a Local bundle.** ORG-01's marketplace and branding rows and whole snapshot, locally; separate identity and settings; catalog browsable in CK; build report and snapshot label state app-update and feed Unmet. Each CLI's disposable-home local-route script ends in a Stub session or a real bundle Install Pass, starting its bundle record. A snapshot missing a plugin names it and still builds (proposed, ORG-01), never as a complete-bundle Pass: rework it, unless Nathan accepts an incomplete alpha with that content named Unmet. **IDs.** ORG-01, 02, 06, 07; V-17. **Try.** Build from a fixture, install beside standard, stop the source, open the recipient package and browse. Repeat AP's ordinary-download check only if packaging or arrival facts changed.

**6b Bundled install, per destination.** Native registration on that installed surface, at open and, once 7a background exists, by T-07's check for a later-detected one; the bundled install route; D-16's registration rows. After a replaced app binary the registration must still resolve and the plugin load. **IDs.** ORG-03, 04; REC-01; surface proofs. **Try.** With the source stopped, open once and see the marketplace natively with nothing installed; inspect what registered on an unselected surface, per section 6's answer. A CLI's sibling desktop session is collected where authorized, otherwise Unmet by name.

**6c Bundle CI parity.** The same documented bundle build in the Mac CI; a CI-only step is reworked.

**6d Real-source build.** On the real source the authorization names, locally then in CI; Unmet by source until run.

### Phase 7: Updates arrive by themselves

**7a background (no plugin).** Tray or menu bar, Quit, sign-in start and its off control, driving a bounded fixture scheduled action. The sign-in preference is set only on a named host. **IDs.** PLT-03, 04, D-36; V-10.

**7a updater, per destination.** Native update, Deprecated on a complete refresh, T-07 check, D-16's adoption, external uninstall and relisting. **IDs.** PLG-08, 09; surface proofs. **Try.** Window closed, v2 on the fixture source, trigger the check, see it in a new session; repeat after disabling it natively in that harness (CK's Disable is 10a) and after uninstalling at one destination; drop it from the catalog; one unattended run.

**7b Publisher, feed, activation.** Two checkpoints. **IDs.** ORG-01's feed rows, ORG-05, PLG-08, 09, D-35; V-17.

- **Feed (no native writes).** A minimal documented local or CI publish command and report (proposed); feed input and client; staged activation in CK's own content. Activation never changes, removes or redirects content an installed plugin uses through a live link: if the route couples them, stage here and activate only in the updater checkpoint. **Try.** Publish an added plugin, a broken release (last content kept), v2 and a catalog removal (retained v1 unchanged on a fixture).
- **Updater, per destination.** Bundled installs updated, each on its own record; 7a updater's T-07 and D-16 parts if this is the first updater.

### Phase 8: Share skills

**8a Identity and explicit sharing.** Three checkpoints, starting with Claude Code CLI and Copilot CLI skills. Sharing runs only at Start and Sync now. An initially absent copy is no deletion. Until 8b's Resolving, only unresolved collisions, competing changes and the uncertain loss of an established copy are held, with nothing written or dropped. **IDs.** SYN-01, 02, 04's Sync now, 05–08; STO-01–03; OWN-01–04; SKL-01–03; CON-03; D-01, 05, 13, 18, 25, 34; V-05, 06 (Continuation).

- **Preview (zero harness writes).** Setup preview with exclusions and Don't share (D-01; proposed, a detail view with no extra approval) and identity and same-name matches. **Try.** On a machine you choose, read it against the skills and collisions you know; a wrong match ends the try with zero writes.
- **First copy.** Start imports selected skills and copies non-colliding ones between the two CLIs, taking an identical copy over with zero writes and keeping section 3's record, stops and Retry. **Undo (proposed),** per item or whole Start, removes only copies that Start created and that still match their recorded hash; a changed copy stays, with the reason, as do the source and imported bytes. The item becomes Don't share until an explicit Share (D-34), so nothing recopies and no deletion is inferred. **Try.** Exclude one item, Start, use a copied skill in a new session of the receiving tool, Undo, read what went and stayed. A second Start is the zero-write repeat; an undone item stays Don't share until Continuation offers explicit Share.
- **Continuation.** Same-name choices; the rest of history and Restore; section 3’s single-build Start fresh. Setup also offers a detected Code tab and Copilot app, assuming no CLI, grouped per D-18; selecting Cowork is plugin-only (D-28a). **Try.** Edit both sides and delete one, then read the holds.

**8b Two-way.** Two checkpoints. **Spreading:** watching, polling (suppressed events without Sync now exercise it, T-08) and the Sync switch carry background adds and one-sided edits, 8a's hold standing. **Resolving** ends the hold, except same-name collisions, which still need a decision: newest wins and unknown-order fallback; deletion, Restore, retention; rename and case-only rename get explicit behaviour and Restore, with no case-only split inferred at one physical path. **Try.** Edit both sides before a sync and read the notice. **IDs.** SYN-03, 04; CON-01, 02, 04; DEL-01–03; STO-04; D-04, 37; V-05, 06, 10.

### Phase 9: Share MCP and agents

- **9a MCP** (MCP-01, 02; TRN-01; D-11; V-05, 06, 09). Neutral record, targeted edits, MCP-02's Write now and close-Claude step, which open V-09 keeps, blocking nothing else. 9a owns V-09's attempt, on a named setup with Claude running; untried is recorded as untried.
- **9b Agents** (TRN-01, 02; AGT-01; D-26, 32; V-05, 06, 07). By class and direction; a lossy destination stays one-way.

### Phase 10: Turn off, convert, edit instructions

- **10a Disable and Delete** (ENB-01–07, UX-05, D-12). Each supported kind, surface and build's V-20 record comes before offering that Disable, otherwise Disable unavailable.
- **10b Convert to skill** (AGT-02, 03, D-33).
- **10c Instruction editor** (INS-01, 02).
- **10d Shared base** (INS-03–05, D-29; V-19 per file). First, per selected file on disposable fixtures, before any composed write: that file's actual reader uses base plus additions, preserved as composed (V-19); no proof leaves it editor-only. Prior instruction content stays in section 3's version folders under STO-04's retention, even before 8b.

### Phase 11: The other families

- **11a Defaults** (MKT-03, D-27; V-18).
- **11b Expansion, waiting selections and Settings** (PLG-06, D-16's remaining policy rows, D-28b's waiting, resume and lapse).
- **11c Codex, 11c Pi, 11c OpenCode** (OC-01–04, V-08). That family's detection and reading, then kinds and plugin routes. **Codex goes first (Priority 1 since November 8, 2026):** its skills checkpoint runs right after the managed engine, as the Codex skills batch, and its plugin route joins the CLI plugins batch; Claude plugins on Codex with named failures. **Try.** Add a skill in Claude and find it there; in Codex add MCP and find it in Claude Code, by Write now until V-09 passes. **Codex bundled route,** an 11c Codex checkpoint once 6a exists: its own disposable-home local-route script and Stub session or real bundle Install Pass, then 6b's route with registration allowed at Install (AT-44), on its own V-17 record and its own 7b Updater, otherwise Unmet by name.
- **11d Desktops and T3 Code** (DET-01, DIS-02, D-24; V-05, 14). Detection, Harness view rows, then observations for the remaining SPEC §5.1 desktops; T3 evidence stays distinct, and none stands in for a Priority 1 proof.

### Phase 12: Side-by-side builds, v1 candidate

**12a App update.** Each build updates itself by AP's route (section 4): organization app update and its T-07 check; standard's install on confirmation (proposed, D-19); ORG-06's reports; identity and content stay, registrations resolve and plugins load. **IDs.** ORG-06, 07, PLT-02, D-19; V-10, 17.

**12b Sync owner.** One named owner across builds, skills first, on section 3's one location: custom-build sharing with Take over syncing. Start fresh, basic since 8a's Continuation, gains only its cross-build conditions. **IDs.** ORG-08, D-31's outcomes; V-10, 17.

**12c v1 candidate.** UI polish bounded by UX-01–05 and Nathan's named list, the Compatibility view and page, novice tests, D-21 and T targets, then section 7's reconciliation and judging macOS v1 per section 2. **IDs.** REL-01.

### Phase 13: Windows and Linux

**13-Win, 13-Linux.** The same journeys on each OS's own evidence, in Nathan's OS order, with no macOS result carried over: platform modules, detection and packaging, pure tests and preservation fixtures before writes, then each desktop proof, including the real Code tab, as bounded tasks rather than one OS-sized one. The setup must meet the target apps’ upstream requirements in CD §2. CI uses a runner named in that OS's authorization; otherwise its CI parts stay Unmet. **IDs.** PLT-01; V-01, 05, 06, 10, 15, 17.

## 6. Open choices

Phase 1 needs only the source and CI destination answer. A slice's proposed positions apply when authorized unless Nathan changes them, recorded as provisional. An entry naming when to ask, or any named acceptance, needs Nathan's named answer; silence or a blanket default accepts nothing.

- **Install-only alpha and its per-action exception (proposed; asked, unanswered).** D-23, PLG-04, COW-01 and the matching V-05 and ORG-04 interims hold a route at Not known yet until its whole proof passes. Under the exception, a recorded Pass permits only that action and its status; other cells stay Not known yet or unavailable, and the V stays named Unmet. Ask before the first install-and-use-only user alpha, including CLI plugins, on an Install Pass with or without a setup limit. Accepted: it ships. Install-only declined, exception kept: install slices stop at fixtures, and the first real alpha combines install and that destination's updater (with 7a background) once its Update Pass exists. Exception rejected: a route covered by the listed interims waits for its whole V. CLI direct routes need only the install-only answer. Proof sessions and fixture releases need neither answer.
- **Recovery without redundancy (section 3; unanswered tradeoff).** Ask before the first user alpha writing sync state (8a's First copy), even though Start fresh and Restore arrive at Continuation. That alpha waits for the answer; fixture work does not. Nathan either accepts one location's limits, with AT-62(f)’s owner-restore and AT-62(g)’s overwritten-record rollback case named Unmet, or chooses redundancy, built and tested only then.
- **Strict no-CLI/no-Git setup.** At the end of Bundled recipient, ask Nathan for a suitable setup for section 4’s strict rerun, before the 7b Updater. Without one, limited evidence still permits work and the required journeys stay Unmet.
- **Source and CI destination (section 8; unconfirmed).** Nathan confirms or changes it when authorizing 1a.
- **Registration on unselected surfaces (unconfirmed build-level interpretation).** ORG-03's first-open registration reaches each detected Copilot and Claude Code surface with a supported route, whatever is selected, installing and enrolling nothing, with each failure scoped to its surface; Cowork follows COW-01. Ask before the first real 6b alpha.
- **Publish-time plugin that cannot be packaged (7b, AT-43).** SPEC leaves this unresolved (ORG-05). Proposed: name it and hold the release. Nathan chooses hold or partial release before the publisher is built.
- **Standard public release location.** Ask in Updates, before 12a uses a public update source, for the public GitHub home of standard packages and REL-01’s page; this is separate from the source/CI destination.
- **Contingent choices, only if they arise.** Phase 2 asks before building on a CT-D private copy or after exhausting its candidates; AP asks if no candidate passes (section 4); 6a asks before an incomplete alpha. These answers widen nothing else.
- **SPEC §12's items** stay open, as do two proposals: D-04's unknown-order tie-break, and D-16's rule that a plugin Disabled at every current destination still expands.

## 7. Test assignments

This is the only test schedule; a rule, cited ID or test counts only for the parts its entry or scope names. Assignments follow the default batch order; entries before 11c mean Priority 1. Phase 2 rows and AP are V records; T-01–08 follow their tests; Phase 13 repeats all per OS. Each part is due with its card, owing no human decision. If work is reordered, a part needing an absent feature runs when the last required feature lands, staying pending in the same ledger until then; never build an unauthorized prerequisite. A prerequisite accepted Unmet leaves that part Unmet with a named follow-up authorization.

**Retired by the November 5 clarification, so neither scheduled nor Unmet:** AT-04(b), AT-24(b); AT-04's and AT-24's no-access fixture conditions, now meaning that tool alone selected; AT-56's marked-mode repeat; DET-01's and AT-01's Access unknown and AT-02's mode-statement parts; V-01's and V-15's restricted-account parts; PLG-04's private-copy hold on those results; D-28c and, as proposals serving the same gates, D-28d and UX-05's mode statement.

- **1a:** section 8's AT-01, 02, 67 fixture cases and Linux run.
- **1b, per checkpoint:** AT-01, 02, 67: its rows and kinds, remaining results, relocated roots. AT-02's "inherited items" means files read through another harness's root (OWN-04).
- **3a:** AT-06 at Add; AT-40, 41 on local fixtures.
- **First install slice:** AT-46(c).
- **Install slice using a CK-run local service:** quit and remove CK; record effects on native registration, retained content and session loading; no CK work continues after Quit (PLT-04).
- **First write, per shape:** section 1's fixtures; a fixture package pointed manually at a stand-in for an actual home refuses writes with byte-identical contents. Native install, registration, plugin-route settings edit and targeted instruction save neither create a sync record nor change an existing owner; repeat with unreadable sync metadata, using only per-build history. Metadata, tiny fixture: section 3's format stop, changing nothing. Sync record, from its first write, not 12b: each of section 3's generation stops; Retry resumes when the remembered record is restored, otherwise it stays stopped. Test interruption between the initial record and settings writes, then explicit resume, including settings lost later; no baseline or deletion is invented. Crash between a harness write and its record update in each order: infer no deletion and overwrite no newer content.
- **Lock added (first shared file):** minimal fixture race on that file, two native writers included: both changes survive, a blocked one retries and reports. Full AT-62: 12b.
- **3b, 3c:** AT-03 (3b), AT-05 and AT-56 CLI-only (3c): install, uninstall; AT-06 at Install; AT-16 plugin; AT-58 through Install again; AT-67 plugin settings.
- **V-16 try, per destination:** real GitLab and network parts of AT-03 (Claude Code CLI), AT-04 (Code tab), AT-24 direct (Cowork) or AT-56 (Copilot app, Copilot CLI), with AT-40, 41.
- **Phase 4, install, load, uninstall:** AT-04(a) on 4a-D, with nothing managed and Cowork unticked at Install, which then gets no write; AT-56 app-only (4b-D); with `claude`, Claude shared store (4a-S); both, Copilot shared store (4b-S).
- **5a, 5b:** AT-24(a) for that source route, with nothing managed and Claude Code unticked at Install, getting no install write (bundled registration only as explicitly accepted in section 6): install, load, `bin/`, uninstall or observing one; AT-44 Cowork fixture, no lifecycle (5b); AT-56 Cowork reader.
- **Both tools selected (confirmed pair): Cowork with the Code tab, and with Claude Code CLI.** The later of 5a and that Code surface's direct slice (Code tab: 4a-D or 4a-S; CLI: 3b), or of 5b and its 6b (bundled), owns this Try: each actual surface uses the marker in its own session, none standing in for another, and a shared physical install or config unit is written once, with no duplicates, conflicting changes or standalone Cowork skills (AT-56's Cowork-plus-Code-reader part; AT-44's combined record for this pair).
- **6a, 6c:** AT-43 build half; AT-59 marketplace, branding, identity, snapshot-only rows on fixtures.
- **6d:** AT-59 real GitLab and GitHub inputs.
- **6b, per destination:** AT-44 that surface's isolated fixture, same name, native removal, later-surface registration at next open, no lifecycle.
- **7a background:** AT-60 launch, close, Quit, start-off on the fixture action; a scheduled action never uses a remembered home selector or writes the stand-in actual home.
- **7a updater:** fixture: a harness build moves outside its tested range; DET-03 governs the route, the existing deployment and Disabled state stay, and a held update names why. Direct lifecycle of AT-03, 04, 05, 24, 56; AT-58 next release; AT-60 with plugin updates; AT-63 direct.
- **7b:** feed checkpoint: AT-43 publish half; AT-59 feed rows; AT-64 content half; AT-63's retained-content fixture; retained-plugin sessions are assigned below. Updater checkpoint: bundle lifecycle of AT-24, 44, isolated; AT-45 except P; AT-63 bundle.
- **8a Preview:** side-effect gate; AT-48 collision shown with its diff.
- **8a First copy:** a skill containing an internal symlink is provisionally held with a named reason and zero writes, creating no link and dereferencing none; on a case-insensitive Mac volume, `Review/` versus unrelated `review/` is a same-name preview match, with zero target writes; AT-07's bytes, modes, `.git` and zero-write repeat for non-colliding skills between the two CLIs; AT-34's one selected harness, skills; AT-27 for these two CLIs, skipping non-loading metadata forms and recording key-loss limits or untested effects, including shared roots. Undo's card rules, tiny fixture, including a taken-over identical copy, which stays.
- **8a Continuation, skills:** AT-02 managed rows; AT-07 through Sync now; AT-26 exclusions, Share, new harness; AT-27's remaining destinations; AT-34 symlink edit; AT-47 with the two Priority 1 CLIs, skills only, a third Priority 1 surface and a project folder untouched; AT-48 two harnesses; AT-62(g)'s unreadable-own-state repeat, skill parts; AT-67. Tiny fixture: a mismatch or failed Retry alone starts nothing fresh. Continuation also tests AT-26 deselecting a harness with a plugin; AT-34 plugin record, hook.
- **8b,** skills. Spreading: AT-07 file events; AT-26 Sync off; AT-68's parts already run, now by background spread. AT-60 with skill changes. Resolving: AT-11; AT-50; AT-51 except prior-Disabled Restore (10a, any kind); AT-65. AT-50 window closed; AT-65 content retained installs use.
- **9a, 9b:** that kind's parts of AT-26, 34, 47, 48, 50, 51, 65, 67. 9a also AT-08 supported Priority 1 format analogues; AT-11's MCP part; AT-13; AT-16 MCP; AT-18; AT-49. 9b also AT-14.
- **AT-68, per kind in 8a's Continuation through Sync now (skills), 9a (MCP), 9b (agents):** each part (Code tab; Copilot app; both) runs once a session on that actual desktop is authorized: use the item in a new session or turn there and edit it back. Lacking a strict setup, its no-CLI condition stays Unmet with section 4's labels; with no session, it stays named Unmet (V-06 Code tab, V-05 Copilot app), stopping no CLI path.
- **10a, per kind:** AT-05 Copilot CLI Disable; AT-09, 52; AT-51 prior-Disabled Restore; AT-67 project-override part. AT-53; AT-56 one-reader Disable.
- **10b:** AT-14 Convert eligibility; AT-54, including its plugin-owned original.
- **10c:** AT-15.
- **10d:** V-19's record per selected file first; AT-34's instruction file: bytes, path, scope; AT-55, including global Sync independence.
- **11a:** AT-42 through Install; AT-59 provider-default rows.
- **11b:** AT-46(a), (d), (e), including managed, update and Deprecated parts; AT-57; AT-58 new harness; AT-44 bundled later-surface expansion.
- **11c, per family:** remainders of AT-01, 02, 05, 07, 09, 13, 14, 15, 16, 27, 34, 47, 48, 52, 55, 67; AT-63 for that family’s direct plugin route. Codex: AT-08 `config.toml`. Codex bundled route: AT-44's Codex fixture, no lifecycle. OpenCode: AT-21. Pi: AT-38.
- **11d:** AT-01, 02 rows for those desktops; AT-32; AT-68 lower-priority desktops.
- **12a:** AT-59 update rows; AT-61; AT-64 app-update half. AT-61 window closed; AT-64 feed interaction.
- **12b:** skill parts of AT-62(a)–(h): (f)’s owner-restore and (g)’s overwritten-record rollback depend on section 6’s recovery design. Run (g) with its removed last owner returning while the current record stays intact, and separately with old state replacing that record; record each result, never treating the first as proof of the second.
  - Tiny fixture: a pre-12b standard record reads as that build's, and unknown state is not adopted.
  - AT-44 another-owner register, install; AT-62 marketplace parts, and (d) with an existing one-harness selection, "nothing managed" after a transfer meaning this build's plugin selection (D-31, proposed).
  - AT-13 handoff; AT-62 MCP, allow list, one-way.
  - AT-62 Disabled, converted skill, Skill only, instructions, a non-owner's save keeping its prior bytes per build.
  - AT-44 non-owner expansion.
  - AT-62(a) sign-in; AT-62 plugin update; AT-44 another-owner update.
- **12c:** for every Pass with a setup limit, check its strict no-CLI/no-Git rerun result; if still missing, keep that journey named Unmet. AT-19, 20; AT-66, whose authorization names the Windows and Linux hosts, otherwise that part stays Unmet; AT-22 plus a novice Restore task (proposed). Last, one check before the release decision: each due part of this section against the ledger's existing checks, marked with its evidence or a named Unmet, with no new tracker, artifact or generator.


**Interaction tests.** This is part of the same schedule, not another tracker. Run each row when its named features or destination set are ready, wherever that falls in the authorized order. Keep the evidence in the existing batch row.

| Features ready | Checks |
| --- | --- |
| 8a Continuation + Phase 4 install | AT-04(a) with its managed set |
| 8a Continuation + 5a or 5b | AT-24(a), only Cowork selected, on that source route |
| 8a Continuation + each both-selected pair | Repeat that pair's setup Try |
| Both selected tools' updaters | Repeat that pair's update Try on each actual surface |
| 8a Continuation + 7a updater | AT-04(a), AT-24(a) managed-set lifecycle runs for that destination |
| 8a Continuation + 7b updater | AT-24(a) managed-set run |
| 6b + 7a background | AT-44 later-surface registration within T-07 while CK runs |
| 7b Feed + destination's install slice | AT-63 actual retained-plugin session |
| 7b updater + 7a background | Window-closed repeat and unattended run |
| First 7a or 7b updater | AT-46(b), (f) |
| 5b and 6b across all five Priority 1 surfaces | AT-44 combined fixture, no lifecycle |
| 7b updaters for two installed destinations, with one destination excluded | AT-45's P |
| 7b updaters across all five Priority 1 surfaces | AT-44 combined lifecycle |
| 11c Codex bundled route + its own 7b updater | AT-44 Codex lifecycle |
| 12b + 11c Codex + 6b | AT-62(a) `config.toml` race |
| 12b + combined AT-44 install or update run | Repeat that combined run with another owner |

## 8. First implementation task (ready to authorize, not authorized here)

**Task.** Slice 1a only, the start of the read-only batch, providing `npm start`, `npm test`, `npm run package:mac`. Due tests, for this harness and kind only: AT-01, 02 and 67 fixtures with missing binary, hung probe, empty and malformed results, minus their retired parts; the side-effect gate under a Finder-like `PATH`; one Linux `npm test` from a copy of the same source, no Linux CI job (otherwise named Unmet, blocking no Mac Try).

Each agent works from this project unless its authorization says otherwise, reading this plan, `docs/SPEC.md`, `docs/capability-data.md` and `AGENTS.md` here, and drives the new Mac source over `ssh mac`; no second planning-document copy is needed.

**Source and CI route (proposed, unapproved, not yet existing).**

- **Source.** New `~/code/central-knot-next` on the Mac; the abandoned `~/code/central-knot` checkout stays untouched.
- **Destination.** Branch `next` in the abandoned repository `njfife/central-knot`, with its own root commit and no old-build files, the smallest route to the runner if registered there. Nathan confirms that branch and push access, or names another, such as a new private repository with the runner.
- **Workflow.** `.github/workflows/mac.yml` there: on push, `runs-on: [self-hosted, macOS, ARM64, ck-mac]`, running `npm ci`, `npm test`, `npm run package:mac`. Its first run is 1a's CI evidence; a failure or a run still queued at handoff stays CI Unmet with its reason, blocking no Finder try, and no later slice cites CI parity until a run passes.

**At its end** Nathan tries it and says what comes next. Proposed: 1b's first checkpoint and First safe copy, alongside a CW-D and CW-B proof sitting with no product code; Nathan may choose either alone.

## 9. Ledger

`LEDGER.md` at the source root (the named scratch location until a source exists) holds one plain row per batch or user alpha, updated in place: fixture packages are hashes in their batch's evidence list, not extra rows. No row per card or sub-check and no repeated reports. Detailed evidence can be a plain list under that row or a linked record; real-home or account captures stay outside pushed source, linked by local path. Engineers fill all but Decision and recommend the next batch with a reason and draft authorization text for Nathan to accept or edit. Rework or revert affects only the relevant changes against a known source revision, preserving unrelated progress and user work.

| Batch or release | Package hash and arrival with source commit, or record path | Evidence list or record path: due section 7 parts and lifecycle cells, each result, setup limit and commit or package hash; side-effect diff, sessions, CI | Decision | Provisional choices; new persistent state and reason | Unmet named |
| --- | --- | --- | --- | --- | --- |
