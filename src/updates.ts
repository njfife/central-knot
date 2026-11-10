// Updates (PLT-02): which GitHub release this build would update to, whether this copy can replace itself, and what the status
// bar and Settings say about it. No Node imports: the main process (updater.ts) checks and installs, the page shows these words.
import { compareVersions, isHttps, record, text } from './values.ts';
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

/** The Mac download each release carries. */
const MAC_ZIP = /^Central-Knot-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-mac-arm64\.zip$/;


/**
 * The newest release newer than the tag this build was made from that has the Mac zip, from GitHub's list of releases.
 * Tags compare as versions, pre-releases by semver's rules. A build made from a preview (a tag with a pre-release part) is
 * offered newer previews and finals; one made from a final release, finals only. Drafts and anything malformed are passed over.
 */
export function newerRelease(list: unknown, current: string): UpdateRelease | undefined {
  const mine = tagVersion(current);
  if (!mine || !Array.isArray(list)) return undefined;
  const takesPreviews = mine.includes('-');
  let best: UpdateRelease | undefined;
  for (const entry of list.map(record)) {
    const tag = text(entry?.tag_name), version = tagVersion(tag), page = text(entry?.html_url);
    if (!entry || !version || entry.draft === true || !isHttps(page)) continue;
    if (!takesPreviews && (version.includes('-') || entry.prerelease === true)) continue;
    if (compareVersions(version, mine) <= 0 || (best && compareVersions(version, tagVersion(best.tag)!) <= 0)) continue;
    const zip = (Array.isArray(entry.assets) ? entry.assets : []).map(record).find(asset => MAC_ZIP.test(text(asset?.name)));
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
  readonly: 'Your account can’t change apps in this Applications folder.',
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

/** A build's name where its version shows: "0.5.0 preview 4" for a release, the package version otherwise. */
export const buildWords = (view: Pick<UpdateView, 'tag' | 'version'>) => (view.tag && tagVersion(view.tag) ? tagWords(view.tag) : view.version);

/**
 * The status bar's update button, or nothing while there is no update this copy can install (the version shows as text).
 * `held`: why the page didn't restart by itself once the update was ready (something typed and not saved); `restarting`: the
 * page has asked main to restart.
 */
export function updateButton(view: UpdateView, { held, restarting = false }: { held?: string; restarting?: boolean } = {}): { label: string; title: string; busy: boolean } | undefined {
  const next = view.available;
  if (!view.shown || !next || view.reason) return undefined;
  const words = tagWords(next.tag);
  if (view.step === 'downloading') {
    const percent = Math.floor((view.progress ?? 0) * 100);
    return { label: `Downloading… ${percent}%`, title: `Downloading ${words}. Central Knot restarts into it when it’s ready.`, busy: true };
  }
  if (view.step === 'installing') return { label: 'Preparing update…', title: `Checking and unpacking ${words}.`, busy: true };
  if (view.step === 'ready') {
    if (restarting) return { label: 'Restarting…', title: `Restarting into ${words}.`, busy: true };
    return { label: 'Restart to update', title: held ? `${words} is ready. ${held}` : `${words} is ready. Click to restart into it.`, busy: false };
  }
  return { label: `Update to ${words}`, title: `Download ${words} and restart into it. Your settings and data stay as they are.`, busy: false };
}

/** The Settings row's line about the last check or update, or nothing before the first check. */
export function updateStatus(view: UpdateView): { text: string; tone: 'done' | 'info' | 'failure' | 'progress' } | undefined {
  if (view.failed) return { text: view.failed, tone: 'failure' };
  if (view.checking) return { text: 'Checking for updates…', tone: 'progress' };
  // The newest check failing is said even when an earlier one found a release: its Update button stays.
  if (view.checked?.failed && !view.step) return { text: view.checked.failed, tone: 'failure' };
  if (view.available) {
    const words = tagWords(view.available.tag);
    if (view.step === 'downloading') return { text: `Downloading ${words}… ${Math.floor((view.progress ?? 0) * 100)}%`, tone: 'progress' };
    if (view.step === 'installing') return { text: `Preparing ${words}…`, tone: 'progress' };
    if (view.step === 'ready') return { text: `${words} is ready. It’s installed when Central Knot restarts.`, tone: 'info' };
    return { text: `${words} is available.`, tone: 'info' };
  }
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
