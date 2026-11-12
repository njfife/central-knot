import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALPHA_BUILD, buildWords, checkFailure, lineApp, macDownload, newerRelease, releaseLine, tagVersion, tagWords, updateButton, updateFailure, updateIndicator, updatesShown, updateStatus, whyNoUpdate, type UpdateFacts } from '../src/updates.ts';
import { STANDARD_BUILD } from '../src/values.ts';
import type { UpdateReason, UpdateView } from '../src/types.ts';

/** A Mac zip as a release lists it: `app` names whose download it is (the standard app's unless given). */
const zip = (tag: string, app = 'Central-Knot') => ({ name: `${app}-${tag.replace(/^v|-.*$/g, '')}-mac-arm64.zip`, browser_download_url: `https://github.com/njfife/central-knot/releases/download/${tag}/zip`, size: 1000 });
/** A release as GitHub's API lists it, with its line's Mac zip (an alpha's is Central Knot Alpha's) unless `assets` says otherwise. */
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, draft: false, prerelease: tag.includes('-'), html_url: `https://github.com/njfife/central-knot/releases/tag/${tag}`,
  assets: [zip(tag, tag.includes('-alpha') ? 'Central-Knot-Alpha' : 'Central-Knot')],
  ...extra,
});

test('a tag reads as a version, and as people say it', () => {
  assert.equal(tagVersion('v0.5.0-preview.5'), '0.5.0-preview.5');
  assert.equal(tagVersion('0.6.0'), '0.6.0');
  assert.equal(tagVersion('checkpoint-ui-2026-11-09'), undefined);
  assert.equal(tagWords('v0.5.0-preview.5'), '0.5.0 preview 5');
  assert.equal(tagWords('v1.0.0'), '1.0.0');
  assert.equal(tagWords('v1.0.0-rc.2'), '1.0.0 rc 2');
  assert.equal(buildWords({ tag: 'v0.5.0-preview.4', version: '0.5.0' }), '0.5.0 preview 4');
  assert.equal(buildWords({ version: '0.5.0' }), '0.5.0');
});

test('the newest newer release with the Mac zip is chosen; a preview build takes previews and finals, a final build finals only', () => {
  const list = [release('v0.6.0-preview.1'), release('v0.5.0'), release('v0.5.0-preview.5'), release('v0.5.0-preview.4'), release('v0.4.0')];
  assert.equal(newerRelease(list, 'v0.5.0-preview.4')?.tag, 'v0.6.0-preview.1');
  assert.equal(newerRelease(list, 'v0.5.0')?.tag, undefined, 'a final build is not offered a newer preview');
  assert.equal(newerRelease([...list, release('v0.5.1')], 'v0.5.0')?.tag, 'v0.5.1');
  assert.equal(newerRelease(list, 'v0.6.0-preview.1'), undefined, 'nothing newer');
  // Order in the list doesn't matter: tags compare as versions (preview.10 is after preview.9).
  assert.equal(newerRelease([release('v0.5.0-preview.9'), release('v0.5.0-preview.10')], 'v0.5.0-preview.4')?.tag, 'v0.5.0-preview.10');
  // A final-looking tag GitHub marks as a pre-release is still a pre-release for a final build.
  assert.equal(newerRelease([release('v0.5.1', { prerelease: true })], 'v0.5.0'), undefined);
  const chosen = newerRelease([release('v0.5.0-preview.5')], 'v0.5.0-preview.4');
  assert.deepEqual(chosen, { tag: 'v0.5.0-preview.5', zip: 'https://github.com/njfife/central-knot/releases/download/v0.5.0-preview.5/zip', size: 1000, page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.5' });
});

test('drafts, releases without the Mac zip and malformed entries are passed over', () => {
  const current = 'v0.5.0-preview.4';
  assert.equal(newerRelease([release('v0.5.0-preview.6', { draft: true }), release('v0.5.0-preview.5')], current)?.tag, 'v0.5.0-preview.5');
  assert.equal(newerRelease([release('v0.5.0-preview.6', { assets: [{ name: 'Central-Knot-0.5.0-win-x64.zip', browser_download_url: 'https://x/y', size: 9 }] }), release('v0.5.0-preview.5')], current)?.tag, 'v0.5.0-preview.5');
  assert.equal(newerRelease([release('v0.5.0-preview.6', { assets: [{ name: 'Central-Knot-0.5.0-mac-arm64.zip', browser_download_url: 'https://x/y' }] })], current), undefined, 'no size');
  assert.equal(newerRelease([release('nightly'), null, 'text', { tag_name: 5 }], current), undefined);
  assert.equal(newerRelease({ message: 'API rate limit exceeded' }, current), undefined);
  assert.equal(newerRelease([release('v0.5.0-preview.5')], 'not-a-tag'), undefined, 'a build with no version tag is never offered one');
});

test('a tag’s pre-release part names its release line', () => {
  assert.equal(releaseLine('v0.6.0-alpha.1'), 'alpha');
  assert.equal(releaseLine('v0.6.0-alpha'), 'alpha');
  assert.equal(releaseLine('v0.6.0-alpha-2'), 'alpha', 'the part’s first word, as tagWords reads it');
  assert.equal(releaseLine('0.6.0-alpha.1'), 'alpha', 'with or without the v');
  assert.equal(releaseLine('v0.5.0-preview.9'), 'preview');
  assert.equal(releaseLine('v1.0.0-rc.1'), 'preview', 'any other pre-release is a preview, as before there were alphas');
  assert.equal(releaseLine('v0.6.0-alphabet.1'), 'preview', 'only the word alpha itself');
  assert.equal(releaseLine('v0.6.0-Alpha.1'), 'preview', 'written in lower case, as every tag is');
  assert.equal(releaseLine('v0.5.0'), 'final');
  assert.equal(releaseLine('checkpoint-ui-2026-11-09'), undefined);
  assert.equal(releaseLine(undefined), undefined, 'a build with no tag');
});

test('an alpha is its own app, with its own name, bundle id and downloads; it reads its version like a preview', () => {
  const alpha = lineApp(releaseLine('v0.6.0-alpha.1'));
  assert.deepEqual(alpha, { name: 'Central Knot Alpha', bundleId: 'com.centralknot.alpha' });
  assert.equal(alpha.bundleId, ALPHA_BUILD);
  assert.equal(macDownload(alpha.name, '0.6.0', 'dmg'), 'Central-Knot-Alpha-0.6.0-mac-arm64.dmg');
  assert.equal(macDownload(alpha.name, '0.6.0', 'zip'), 'Central-Knot-Alpha-0.6.0-mac-arm64.zip');
  assert.equal(tagWords('v0.6.0-alpha.1'), '0.6.0 alpha 1');
  assert.equal(buildWords({ tag: 'v0.6.0-alpha.1', version: '0.6.0' }), '0.6.0 alpha 1');
});

test('a preview, a final and an untagged build are the standard app, under the names they always had', () => {
  for (const tag of ['v0.5.0-preview.9', 'v0.5.0', undefined]) assert.deepEqual(lineApp(releaseLine(tag)), { name: 'Central Knot', bundleId: STANDARD_BUILD }, String(tag));
  assert.equal(macDownload(lineApp('preview').name, '0.5.0', 'dmg'), 'Central-Knot-0.5.0-mac-arm64.dmg');
  assert.equal(macDownload(lineApp('preview').name, '0.5.0', 'zip'), 'Central-Knot-0.5.0-mac-arm64.zip', 'preview 9’s own zip name');
  assert.equal(tagWords('v0.5.0-preview.9'), '0.5.0 preview 9');
});

test('updates stay inside a line: from previews, alphas and finals, each line is offered only what it takes', () => {
  // Every line's newest is newer than every other line's current build: only the line rule keeps them apart.
  const list = [release('v0.7.0-alpha.2'), release('v0.7.0-alpha.1'), release('v0.6.0-preview.3'), release('v0.5.1'), release('v0.5.0-preview.9'), release('v0.5.0')];
  assert.equal(newerRelease(list, 'v0.6.0-alpha.1')?.tag, 'v0.7.0-alpha.2', 'an alpha: the newest alpha');
  assert.equal(newerRelease(list, 'v0.7.0-alpha.1')?.tag, 'v0.7.0-alpha.2', 'an alpha just behind');
  assert.equal(newerRelease(list, 'v0.7.0-alpha.2'), undefined, 'the newest alpha: nothing, never the previews or finals');
  assert.equal(newerRelease(list, 'v0.5.0-preview.9')?.tag, 'v0.6.0-preview.3', 'a preview: newer previews and finals, never the newer alphas');
  assert.equal(newerRelease([release('v0.7.0-alpha.2'), release('v0.6.0')], 'v0.5.0-preview.9')?.tag, 'v0.6.0', 'and a final, as before');
  assert.equal(newerRelease(list, 'v0.6.0-preview.3'), undefined, 'the newest preview: no alpha, however new');
  assert.equal(newerRelease(list, 'v0.5.0')?.tag, 'v0.5.1', 'a final: finals only');
  // Each line takes only its own app's zip: an alpha release that carried the standard app's zip (or a release whose only
  // zip is the alpha's under a preview tag) is passed over, so neither app ever installs the other.
  assert.equal(newerRelease([release('v0.7.0-alpha.3', { assets: [zip('v0.7.0-alpha.3')] })], 'v0.6.0-alpha.1'), undefined, 'an alpha passes over the standard app’s zip');
  assert.equal(newerRelease([release('v0.6.0-preview.4', { assets: [zip('v0.6.0-preview.4', 'Central-Knot-Alpha')] })], 'v0.5.0-preview.9'), undefined, 'a preview passes over the alpha’s zip');
  assert.equal(newerRelease([release('v0.8.0-preview.1', { assets: [zip('v0.8.0-preview.1', 'Central-Knot-Alpha')] })], 'v0.6.0-alpha.1'), undefined, 'an alpha passes over a preview tag, whatever its zip');
  // A release carrying both zips gives each line its own.
  const both = release('v0.7.0-alpha.4', { assets: [zip('v0.7.0-alpha.4'), { ...zip('v0.7.0-alpha.4', 'Central-Knot-Alpha'), browser_download_url: 'https://github.com/njfife/central-knot/releases/download/v0.7.0-alpha.4/alpha-zip' }] });
  assert.equal(newerRelease([both], 'v0.6.0-alpha.1')?.zip, 'https://github.com/njfife/central-knot/releases/download/v0.7.0-alpha.4/alpha-zip');
  assert.equal(newerRelease([both], 'v0.5.0-preview.9'), undefined, 'and a preview still passes over the alpha tag');
});

test('why a copy can’t update itself, in the order that decides it', () => {
  const mac: UpdateFacts = { platform: 'darwin', packaged: true, tag: 'v0.5.0-preview.4', bundle: '/Applications/Central Knot.app', home: '/Users/a', team: '4K96M39DLN', writable: true };
  const cases: [string, Partial<UpdateFacts>, UpdateReason | undefined][] = [
    ['installed in /Applications', {}, undefined],
    ['installed in ~/Applications', { bundle: '/Users/a/Applications/Central Knot.app' }, undefined],
    ['dev build', { packaged: false, tag: undefined, team: undefined }, 'dev'],
    ['no release tag (ad hoc build)', { tag: undefined }, 'untagged'],
    ['signed ad hoc', { team: undefined }, 'unsigned'],
    ['run from Downloads', { bundle: '/Users/a/Downloads/Central Knot.app' }, 'applications'],
    ['translocated', { bundle: '/private/var/folders/x/T/AppTranslocation/1234/d/Central Knot.app' }, 'applications'],
    ['from a disk image', { bundle: '/Volumes/Central Knot/Central Knot.app' }, 'applications'],
    ['Applications not writable', { writable: false }, 'readonly'],
  ];
  for (const [name, change, expected] of cases) assert.equal(whyNoUpdate({ ...mac, ...change })?.key, expected, name);
  assert.equal(whyNoUpdate({ ...mac, bundle: '/Users/a/Downloads/Central Knot.app' })?.text, 'Move Central Knot to the Applications folder first.', 'the words Start at sign-in uses');
  assert.equal(updatesShown('darwin'), true);
  assert.equal(updatesShown('win32'), false, 'no Windows releases yet: nothing is shown');
  assert.equal(updatesShown('linux'), false);
});

test('what the Update button says at each step', () => {
  const available = { tag: 'v0.5.0-preview.5', zip: 'https://x/z', size: 10, page: 'https://x/p' };
  const base: UpdateView = { shown: true, version: '0.5.0', tag: 'v0.5.0-preview.4', checking: false, available };
  const label = (view: Partial<UpdateView>, options?: Parameters<typeof updateButton>[1]) => updateButton({ ...base, ...view }, options)?.label;
  assert.equal(label({ available: undefined }), undefined, 'nothing newer: the version shows as text');
  assert.equal(label({ reason: { key: 'applications', text: '' } }), undefined, 'can’t install: no button (Settings says why)');
  assert.equal(label({ shown: false }), undefined);
  assert.equal(label({}), 'Update to 0.5.0 preview 5');
  assert.equal(label({ step: 'downloading', progress: 0.427 }), 'Downloading… 42%');
  assert.equal(label({ step: 'installing' }), 'Preparing update…');
  assert.equal(label({ step: 'ready' }), 'Restart to update');
  assert.equal(label({ step: 'ready' }, { restarting: true }), 'Restarting…');
  const held = updateButton({ ...base, step: 'ready' }, { held: 'Restarting now loses your unsaved instructions draft.' })!;
  assert.deepEqual([held.label, held.busy], ['Restart to update', false]);
  assert.match(held.title, /loses your unsaved instructions draft\. Click to restart anyway\.$/, 'the button says what restarting loses');
  assert.equal(updateButton({ ...base, step: 'downloading' })!.busy, true);
  // While it downloads the button says whether it will restart by itself: not with something unsaved open.
  assert.equal(updateButton({ ...base, step: 'downloading' })!.title, 'Downloading 0.5.0 preview 5. Central Knot restarts into it when it’s ready.');
  assert.equal(updateButton({ ...base, step: 'downloading' }, { held: 'Restarting now loses 1 change waiting for Apply all.' })!.title, 'Downloading 0.5.0 preview 5. Something here isn’t saved yet, so Central Knot will wait for you to restart.');
  assert.equal(label({ failed: 'The download didn’t finish.' }), 'Update to 0.5.0 preview 5', 'after a failure it can be tried again');
});

test('what the sidebar’s update control shows, from the quiet arrows to the button that stands out', () => {
  const preview5 = { tag: 'v0.5.0-preview.5', zip: 'https://x/z', size: 10, page: 'https://x/p' };
  const base: UpdateView = { shown: true, version: '0.5.0', tag: 'v0.5.0-preview.4', checking: false };
  const shown = (view: Partial<UpdateView>, options?: Parameters<typeof updateIndicator>[1]) => {
    const it = updateIndicator({ ...base, ...view }, options);
    return it && { look: it.look, label: it.label, does: it.does, busy: it.busy };
  };
  assert.equal(updateIndicator({ ...base, shown: false }), undefined, 'where there are no releases (off a Mac) there is no control');
  // Nothing newer: the circular arrows, and a click checks. The tooltip says what the last check found.
  assert.deepEqual(shown({}), { look: 'check', label: 'Check for updates', does: 'check', busy: false });
  assert.equal(updateIndicator(base)!.title, 'Central Knot checks for a newer release by itself. Click to check now.', 'before the first check');
  assert.equal(updateIndicator({ ...base, checked: { at: 1 } })!.title, 'Up to date. Click to check now.');
  assert.equal(updateIndicator({ ...base, checked: { at: 1, failed: 'Couldn’t check for updates: GitHub couldn’t be reached. Central Knot tries again later.' } })!.title,
    'Couldn’t check for updates: GitHub couldn’t be reached. Central Knot tries again later. Click to check now.', 'a failed check gets no mark of its own: it is tried again by itself');
  // A check under way spins the arrows, whether main's clock started it or the page did.
  assert.deepEqual(shown({ checking: true }), { look: 'checking', label: 'Checking…', does: 'check', busy: true });
  assert.equal(shown({}, { checking: true })!.look, 'checking');
  // A newer release: the control stands out, and a click updates.
  assert.deepEqual(shown({ available: preview5 }), { look: 'available', label: 'Update available', does: 'update', busy: false });
  assert.equal(updateIndicator({ ...base, available: preview5 })!.name, 'Update to 0.5.0 preview 5', 'its full name, for a screen reader and the folded sidebar');
  assert.equal(shown({ available: preview5, checking: true })!.look, 'available', 'a later check doesn’t take the offer away while it runs');
  // Downloading and preparing: the Update button's words, busy, with the download's progress for the ring.
  const downloading = updateIndicator({ ...base, available: preview5, step: 'downloading', progress: 0.427 })!;
  assert.deepEqual([downloading.look, downloading.label, downloading.busy, downloading.progress], ['working', 'Downloading… 42%', true, 0.427]);
  assert.deepEqual(shown({ available: preview5, step: 'installing' }), { look: 'working', label: 'Preparing update…', does: 'update', busy: true });
  // Ready: a click restarts into it.
  assert.deepEqual(shown({ available: preview5, step: 'ready' }), { look: 'ready', label: 'Restart to update', does: 'restart', busy: false });
  // Something unsaved holds it: the control never restarts on a click, it opens Settings, whose row says what would be lost
  // beside its own Restart button. Its name says the loss too.
  const loses = 'Restarting now loses 3 changes waiting for Apply all.';
  assert.deepEqual(shown({ available: preview5, step: 'ready' }, { held: loses }), { look: 'held', label: 'Restart to update…', does: 'settings', busy: false });
  const held = updateIndicator({ ...base, available: preview5, step: 'ready' }, { held: loses })!;
  assert.deepEqual([held.glyph, held.name, held.title], ['triangle-alert', 'Restart to update: Restarting now loses 3 changes waiting for Apply all. Opens Settings',
    '0.5.0 preview 5 is ready. Restarting now loses 3 changes waiting for Apply all. Click to open Settings, where you can restart anyway.']);
  // Restarting anyway from Settings: the control shows it, busy.
  assert.deepEqual(shown({ available: preview5, step: 'ready' }, { held: loses, restarting: true }), { look: 'ready', label: 'Restarting…', does: 'restart', busy: true });
  // A download that failed: the release is still offered, and the click tries again.
  const failed = updateIndicator({ ...base, available: preview5, failed: 'The download didn’t finish. Central Knot wasn’t changed. Try again.' })!;
  assert.deepEqual([failed.look, failed.label, failed.does, failed.title], ['available', 'Try the update again', 'update', 'The download didn’t finish. Central Knot wasn’t changed. Try again.']);
  // A newer release this copy can't install itself: Settings says why and links the release.
  const elsewhere = updateIndicator({ ...base, available: preview5, reason: { key: 'applications', text: 'Move Central Knot to the Applications folder first.' } })!;
  assert.deepEqual([elsewhere.look, elsewhere.label, elsewhere.does], ['elsewhere', 'Update available', 'settings']);
  assert.equal(elsewhere.title, '0.5.0 preview 5 is available. Move Central Knot to the Applications folder first. Open Settings for the release page.');
  // A copy that never checks (a development build, or one not made from a release) has a faint control that opens Settings.
  assert.deepEqual(shown({ tag: undefined, reason: { key: 'untagged', text: 'This build wasn’t made from a release, so it doesn’t update itself.' } }), { look: 'off', label: 'Updates', does: 'settings', busy: false });
  assert.equal(shown({ reason: { key: 'dev', text: 'This is a development build. It doesn’t update itself.' } })!.look, 'off');
  assert.equal(shown({ reason: { key: 'unsigned', text: 'This build isn’t signed by its developer, so it can’t update itself.' } })!.look, 'check', 'an unsigned release still checks, and offers what it finds through Settings');
});

test('what the Settings row says about the last check or update', () => {
  const base: UpdateView = { shown: true, version: '0.5.0', tag: 'v0.5.0-preview.4', checking: false };
  assert.equal(updateStatus(base), undefined, 'before the first check');
  assert.equal(updateStatus({ ...base, checking: true })?.text, 'Checking for updates…');
  assert.equal(updateStatus({ ...base, checked: { at: 1 } })?.text, 'Up to date.');
  assert.equal(updateStatus({ ...base, checked: { at: 1 }, available: { tag: 'v0.5.0-preview.5', zip: '', size: 1, page: '' } })?.text, '0.5.0 preview 5 is available. Updating downloads it and restarts Central Knot.');
  assert.equal(updateStatus({ ...base, checked: { at: 1, failed: 'Couldn’t check.' } })?.tone, 'failure');
  assert.equal(updateStatus({ ...base, checked: { at: 2, failed: 'Couldn’t check.' }, available: { tag: 'v0.5.0-preview.5', zip: '', size: 1, page: '' } })?.text, 'Couldn’t check.', 'the newest check failing is said');
  assert.equal(updateStatus({ ...base, failed: 'The download didn’t finish.', checked: { at: 1 } })?.text, 'The download didn’t finish.');
  // The launch after an update says so all launch, with that release's notes, until a newer release takes the line.
  const updated = { tag: 'v0.5.0-preview.4', page: 'https://example.test/4' };
  assert.deepEqual(updateStatus({ ...base, updated }), { text: 'Updated to 0.5.0 preview 4.', tone: 'done', page: 'https://example.test/4' });
  assert.deepEqual(updateStatus({ ...base, updated, checked: { at: 1 } }), { text: 'Updated to 0.5.0 preview 4, the newest release.', tone: 'done', page: 'https://example.test/4' });
  assert.deepEqual(updateStatus({ ...base, updated, checked: { at: 1 }, available: { tag: 'v0.5.0-preview.5', zip: '', size: 1, page: 'https://example.test/5' } })?.page, 'https://example.test/5');
  assert.equal(updateStatus({ ...base, checked: { at: 1 } })?.page, undefined);
  assert.match(checkFailure({ limited: true, status: 403 }), /limiting/);
  assert.match(checkFailure({ offline: true }), /couldn’t be reached/);
  assert.match(checkFailure({ status: 500 }), /answered 500/);
  for (const stage of ['download', 'install'] as const) assert.match(updateFailure(stage, 'x'), /Central Knot wasn’t changed/);
  assert.match(updateFailure('install', 'Code signature at URL file:///… did not pass validation: code failed to satisfy specified code requirement(s)'), /isn’t signed by Central Knot’s developer/);
});
