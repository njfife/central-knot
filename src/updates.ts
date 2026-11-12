// Updates (PLT-02): the release lines (alpha, preview, final) and the app each line's builds are, which GitHub release this
// build would update to, whether this copy can replace itself, and what the sidebar's update control and Settings say about
// it. No Node imports: the main process (updater.ts, updateflow.ts) checks and installs, the page (updateview.ts) shows these
// words, and packaging (scripts/package-mac.mjs, scripts/mac-dmg.mjs) names the app and its downloads from the same rules.
import { PRODUCT, STANDARD_BUILD, compareVersions, isHttps, record, text } from './values.ts';
import type { UpdateReason, UpdateRelease, UpdateView } from './types.ts';

/** Where releases come from: the project's GitHub repository. An organisation build will point elsewhere (ORG-06). */
export const RELEASE_REPO = 'njfife/central-knot';
export const releasesPage = `https://github.com/${RELEASE_REPO}/releases`;
/** GitHub's public list of the repository's releases, newest first: asked with no token and nothing about the person. */
export const releasesApi = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`;

/** A release tag's version: "v0.5.0-preview.5" is "0.5.0-preview.5". Undefined for a tag that isn't a version. */
export const tagVersion = (tag: string): string | undefined => /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1];

/** A tag as people read it: "v0.5.0-preview.5" is "0.5.0 preview 5". */
export function tagWords(tag: string): string {
  const version = tagVersion(tag);
  if (!version) return tag;
  const [core, ...pre] = version.split('-');
  return pre.length ? `${core} ${pre.join('-').split(/[.-]/).join(' ')}` : core!;
}

/**
 * The release line a tag is in, named by the tag's pre-release part: `v0.6.0-alpha.1` is an alpha (the part's first word is
 * "alpha"), `v0.5.0-preview.9` a preview (so is any other pre-release, `v1.0.0-rc.1` too), and `v0.5.0` a final release.
 * Undefined for no tag, or one that isn't a version. Everything that differs between the lines reads it from here: the app a
 * build is (lineApp), the releases it is offered (newerRelease), and what packaging names the app and its downloads.
 */
export type ReleaseLine = 'alpha' | 'preview' | 'final';
export function releaseLine(tag: string | undefined): ReleaseLine | undefined {
  const version = tag === undefined ? undefined : tagVersion(tag);
  if (!version) return undefined;
  const pre = version.split('-').slice(1).join('-');
  if (!pre) return 'final';
  return pre.split(/[.-]/)[0] === 'alpha' ? 'alpha' : 'preview';
}

/** The lines a build of each line is offered: an alpha only newer alphas, a preview newer previews and finals, a final only finals. */
const OFFERED: Record<ReleaseLine, readonly ReleaseLine[]> = { alpha: ['alpha'], preview: ['preview', 'final'], final: ['final'] };

/** The alpha's bundle id: the system's name for it, its settings folder's name, and its name as a home's sync owner. */
export const ALPHA_BUILD = 'com.centralknot.alpha';

/**
 * The app a line's builds are: its name, wherever the app shows it, and its bundle id. An alpha is its own app, "Central Knot
 * Alpha", installed beside the standard app with its own settings folder, log and downloads; previews and finals (and a build
 * with no tag) are the standard app. A custom build has a name and id of its own instead (bundle.ts custom-build.json).
 * The alpha's name is put together from PRODUCT, so the build's renaming of the plain name (scripts/build.mjs) leaves it whole.
 */
export interface BuildApp { name: string; bundleId: string }
export const lineApp = (line: ReleaseLine | undefined): BuildApp =>
  (line === 'alpha' ? { name: `${PRODUCT} Alpha`, bundleId: ALPHA_BUILD } : { name: PRODUCT, bundleId: STANDARD_BUILD });

/** An app's name in a download's file name: "Central Knot Alpha" is "Central-Knot-Alpha". */
export const downloadName = (name: string) => name.trim().replace(/\s+/g, '-');
/**
 * An app's Mac download for one version: "Central-Knot-0.5.0-mac-arm64.zip", "Central-Knot-Alpha-0.6.0-mac-arm64.dmg". The zip
 * is the one the app's own updater downloads; the disk image is for people.
 */
export const macDownload = (appName: string, version: string, kind: 'zip' | 'dmg') => `${downloadName(appName)}-${version}-mac-arm64.${kind}`;
/** Whether a release's file is the named app's Mac zip, of any version: another app's download (the alpha's, for the standard app) is not. */
function isMacZip(file: string, appName: string): boolean {
  const before = `${downloadName(appName)}-`, after = '-mac-arm64.zip';
  return file.startsWith(before) && file.endsWith(after) && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(file.slice(before.length, -after.length));
}

/**
 * The newest release newer than the tag this build was made from, in a line this build's line is offered (OFFERED), that has
 * this build's own Mac zip (lineApp's name), from GitHub's list of releases. Tags compare as versions, pre-releases by semver's
 * rules. A final build also passes over anything GitHub marks as a pre-release. Drafts and anything malformed are passed over.
 */
export function newerRelease(list: unknown, current: string): UpdateRelease | undefined {
  const mine = tagVersion(current), line = releaseLine(current);
  if (!mine || !line || !Array.isArray(list)) return undefined;
  const app = lineApp(line);
  let best: UpdateRelease | undefined;
  for (const entry of list.map(record)) {
    const tag = text(entry?.tag_name), version = tagVersion(tag), page = text(entry?.html_url);
    if (!entry || !version || entry.draft === true || !isHttps(page)) continue;
    if (!OFFERED[line].includes(releaseLine(tag)!) || (line === 'final' && entry.prerelease === true)) continue;
    if (compareVersions(version, mine) <= 0 || (best && compareVersions(version, tagVersion(best.tag)!) <= 0)) continue;
    const zip = (Array.isArray(entry.assets) ? entry.assets : []).map(record).find(asset => isMacZip(text(asset?.name), app.name));
    const url = text(zip?.browser_download_url), size = zip?.size;
    if (!/^https?:\/\/\S+$/.test(url) || typeof size !== 'number' || size <= 0) continue;
    best = { tag, zip: url, size, page };
  }
  return best;
}

/** What decides whether this copy can replace itself, as the main process finds it. */
export interface UpdateFacts {
  platform: string;
  /** An installed app, not a development run. */
  packaged: boolean;
  /** The release tag the build was made from, when it was made from one. */
  tag?: string;
  /** Where the app bundle is (…/Central Knot.app) and the person's home. */
  bundle: string;
  home: string;
  /** The Developer ID team the running app is signed by; undefined for an ad hoc or unsigned build. */
  team?: string;
  /** The folder holding the app can be written by this account. */
  writable: boolean;
}

const reasons: Record<UpdateReason, string> = {
  dev: 'This is a development build. It doesn’t update itself.',
  untagged: 'This build wasn’t made from a release, so it doesn’t update itself.',
  unsigned: 'This build isn’t signed by its developer, so it can’t update itself.',
  // The same words as Start at sign-in (signin.ts): a copy run from Downloads, a disk image or a translocated folder.
  applications: 'Move Central Knot to the Applications folder first.',
  readonly: 'Your account can’t change apps in this Applications folder. Download the new release and replace Central Knot by hand.',
};

/** Whether updates show at all: there are only Mac releases, so elsewhere nothing about them is shown. */
export const updatesShown = (platform: string) => platform === 'darwin';

/**
 * Why this copy can't update itself, or nothing when it can. An app replaces itself only where it was installed: the
 * Applications folder, or the one in the person's home, never a translocated copy or a disk image.
 */
export function whyNoUpdate({ packaged, tag, bundle, home, team, writable }: UpdateFacts): UpdateView['reason'] {
  const because = (key: UpdateReason) => ({ key, text: reasons[key] });
  if (!packaged) return because('dev');
  if (!tag || !tagVersion(tag)) return because('untagged');
  if (!team) return because('unsigned');
  const inApplications = bundle.startsWith('/Applications/') || bundle.startsWith(`${home.replace(/\/$/, '')}/Applications/`);
  if (!inApplications || bundle.includes('/AppTranslocation/')) return because('applications');
  if (!writable) return because('readonly');
  return undefined;
}

/** Said while an update downloads with something unsaved open: it won't restart by itself, as it otherwise would. */
export const restartWaits = 'Something here isn’t saved yet, so Central Knot will wait for you to restart.';

/** A build's name where its version shows: "0.5.0 preview 4" for a release, the package version otherwise. */
export const buildWords = (view: Pick<UpdateView, 'tag' | 'version'>) => (view.tag && tagVersion(view.tag) ? tagWords(view.tag) : view.version);

/**
 * The Update button's words while there is an update this copy can install (Settings' button, and the sidebar control in
 * those steps), or nothing otherwise. `held`: why the page won't restart by itself once the update is ready (something typed
 * and not saved); `restarting`: the page has asked main to restart.
 */
export function updateButton(view: UpdateView, { held, restarting = false }: { held?: string; restarting?: boolean } = {}): { label: string; title: string; busy: boolean; held?: boolean } | undefined {
  const next = view.available;
  if (!view.shown || !next || view.reason) return undefined;
  const words = tagWords(next.tag);
  if (view.step === 'downloading') {
    const percent = Math.floor((view.progress ?? 0) * 100);
    return { label: `Downloading… ${percent}%`, title: `Downloading ${words}. ${held ? restartWaits : 'Central Knot restarts into it when it’s ready.'}`, busy: true };
  }
  if (view.step === 'installing') return { label: 'Preparing update…', title: `Checking and unpacking ${words}.`, busy: true };
  if (view.step === 'ready') {
    if (restarting) return { label: 'Restarting…', title: `Restarting into ${words}.`, busy: true };
    return { label: 'Restart to update', title: held ? `${words} is ready. ${held} Click to restart anyway.` : `${words} is ready. Click to restart into it.`, busy: false, held: !!held };
  }
  return { label: `Update to ${words}`, title: `Downloads ${words}, then restarts Central Knot. Your settings and data stay as they are.`, busy: false };
}

/**
 * What the sidebar's update control shows (updateview.ts sidebarEnd draws it), one look per state:
 * - `off`: this copy never checks (a development build, or one not made from a release). It opens Settings, which says why.
 * - `check`: the quiet circular arrows. A click is Check now; the tooltip says what the last check found.
 * - `checking`: the arrows spin while a check runs, whoever asked for it.
 * - `available`: a newer release this copy can install. It stands out; a click downloads it, prepares it and restarts.
 * - `working`: downloading (with its progress) or preparing it.
 * - `ready`: prepared; a click restarts into it.
 * - `held`: prepared, but something unsaved keeps it from restarting by itself. It never restarts on a click: it opens Settings'
 *   Updates row, which says what restarting would lose, beside its own Restart button.
 * - `elsewhere`: a newer release this copy can't install itself (Settings says why and links the release). It opens Settings.
 * `does` is what a click does; `name` is the control's full name for a screen reader and the folded sidebar, whose control
 * shows only its icon; `title` is the tooltip.
 */
export type IndicatorLook = 'off' | 'check' | 'checking' | 'available' | 'working' | 'ready' | 'held' | 'elsewhere';
export interface Indicator {
  look: IndicatorLook; glyph: 'refresh-cw' | 'circle-arrow-down' | 'arrow-down' | 'circle-alert' | 'circle-check' | 'triangle-alert' | 'clock';
  label: string; name: string; title: string; busy: boolean;
  does: 'check' | 'update' | 'restart' | 'settings';
  /** While downloading: how much has arrived, 0 to 1. */
  progress?: number;
}
export function updateIndicator(view: UpdateView, { held, restarting = false, checking = false }: { held?: string; restarting?: boolean; checking?: boolean } = {}): Indicator | undefined {
  if (!view.shown) return undefined;
  const button = updateButton(view, { held, restarting });
  if (button) {
    const words = tagWords(view.available!.tag);
    if (view.step === 'downloading' || view.step === 'installing') return { look: 'working', glyph: view.step === 'installing' ? 'clock' : 'arrow-down', label: button.label, name: button.label, title: button.title, busy: true, does: 'update', progress: view.step === 'downloading' ? view.progress ?? 0 : undefined };
    if (view.step === 'ready' && held && !restarting) return { look: 'held', glyph: 'triangle-alert', label: 'Restart to update…', name: `Restart to update: ${held} Opens Settings`, title: `${words} is ready. ${held} Click to open Settings, where you can restart anyway.`, busy: false, does: 'settings' };
    if (view.step === 'ready') return { look: 'ready', glyph: 'circle-check', label: button.label, name: button.busy ? button.label : `Restart to update to ${words}`, title: button.title, busy: button.busy, does: 'restart' };
    // After a failed download or prepare the release is still offered: the control says so (the failure's own words already
    // say what to do) and the click tries again.
    if (view.failed) return { look: 'available', glyph: 'circle-alert', label: 'Try the update again', name: `Try the update to ${words} again`, title: view.failed, busy: false, does: 'update' };
    return { look: 'available', glyph: 'circle-arrow-down', label: 'Update available', name: button.label, title: `${words} is available. Click to download it and restart Central Knot. Your settings and data stay as they are.`, busy: false, does: 'update' };
  }
  if (view.available && view.reason) {
    const words = tagWords(view.available.tag);
    return { look: 'elsewhere', glyph: 'circle-arrow-down', label: 'Update available', name: `${words} is available. Open Settings`, title: `${words} is available. ${view.reason.text} Open Settings for the release page.`, busy: false, does: 'settings' };
  }
  if (!view.tag || view.reason?.key === 'dev' || view.reason?.key === 'untagged') {
    return { look: 'off', glyph: 'refresh-cw', label: 'Updates', name: 'Updates: open Settings', title: `${view.reason?.text ?? 'This build doesn’t update itself.'} Open Settings for the releases page.`, busy: false, does: 'settings' };
  }
  if (checking || view.checking) return { look: 'checking', glyph: 'refresh-cw', label: 'Checking…', name: 'Checking for updates', title: 'Checking GitHub for a newer release…', busy: true, does: 'check' };
  // What the last check found, said in the tooltip: nothing here is worth a mark of its own (Central Knot tries again by itself).
  const found = view.failed ?? view.checked?.failed ?? (view.checked ? 'Up to date.' : 'Central Knot checks for a newer release by itself.');
  return { look: 'check', glyph: 'refresh-cw', label: 'Check for updates', name: 'Check for updates', title: `${found} Click to check now.`, busy: false, does: 'check' };
}

/**
 * The Settings row's line about the last check or update, or nothing before the first check. `page`: the release the line is
 * about, for its link. For the whole launch that follows an update the line says so, with that release's notes: the status
 * bar says it only until the first page switch.
 */
export function updateStatus(view: UpdateView): { text: string; tone: 'done' | 'info' | 'failure' | 'progress'; page?: string } | undefined {
  const page = view.available?.page;
  if (view.failed) return { text: view.failed, tone: 'failure', page };
  if (view.checking) return { text: 'Checking for updates…', tone: 'progress', page };
  // The newest check failing is said even when an earlier one found a release: it is still offered.
  if (view.checked?.failed && !view.step) return { text: view.checked.failed, tone: 'failure', page };
  if (view.available) {
    const words = tagWords(view.available.tag);
    if (view.step === 'downloading') return { text: `Downloading ${words}… ${Math.floor((view.progress ?? 0) * 100)}%`, tone: 'progress', page };
    if (view.step === 'installing') return { text: `Preparing ${words}…`, tone: 'progress', page };
    if (view.step === 'ready') return { text: `${words} is ready. It’s installed when Central Knot restarts.`, tone: 'info', page };
    return { text: view.reason ? `${words} is available.` : `${words} is available. Updating downloads it and restarts Central Knot.`, tone: 'info', page };
  }
  if (view.updated) return { text: `Updated to ${tagWords(view.updated.tag)}${view.checked ? ', the newest release' : ''}.`, tone: 'done', page: view.updated.page };
  if (view.checked) return { text: 'Up to date.', tone: 'done' };
  return undefined;
}

/** A check that failed, in plain words: the person can do nothing about GitHub's limit but wait; Central Knot tries again. */
export function checkFailure(failure: { status?: number; limited?: boolean; offline?: boolean }): string {
  if (failure.limited) return 'Couldn’t check for updates: GitHub is limiting requests for now. Central Knot tries again later.';
  if (failure.offline || !failure.status) return 'Couldn’t check for updates: GitHub couldn’t be reached. Central Knot tries again later.';
  return `Couldn’t check for updates: GitHub answered ${failure.status}. Central Knot tries again later.`;
}

/** Why an update stopped, in plain words. The installed app is untouched in every case: the old copy is replaced only at the restart. */
export function updateFailure(stage: 'download' | 'install', error: string): string {
  const kept = 'Central Knot wasn’t changed.';
  if (stage === 'download') return `The download didn’t finish. ${kept} Try again.`;
  if (/code ?sign|signature|requirement/i.test(error)) return `The download isn’t signed by Central Knot’s developer, so it wasn’t installed. ${kept}`;
  return `The update couldn’t be prepared. ${kept} Try again, or download it from the release page.`;
}

/**
 * The wait for the update to be prepared ran out. Nothing has changed, but the preparing can't be called off: if it still
 * finishes, the update is offered as ready then, and whichever way it went, the next launch says.
 */
export const prepareUnfinished = 'Preparing the update is taking too long. Central Knot hasn’t changed. If it still finishes, Central Knot offers the restart then; otherwise try again later.';
