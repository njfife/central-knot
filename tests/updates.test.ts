import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWords, checkFailure, newerRelease, tagVersion, tagWords, updateButton, updateFailure, updatesShown, updateStatus, whyNoUpdate, type UpdateFacts } from '../src/updates.ts';
import type { UpdateReason, UpdateView } from '../src/types.ts';

/** A release as GitHub's API lists it, with the Mac zip unless `assets` says otherwise. */
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, draft: false, prerelease: tag.includes('-'), html_url: `https://github.com/njfife/central-knot/releases/tag/${tag}`,
  assets: [{ name: `Central-Knot-${tag.replace(/^v|-.*$/g, '')}-mac-arm64.zip`, browser_download_url: `https://github.com/njfife/central-knot/releases/download/${tag}/zip`, size: 1000 }],
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
  assert.equal(label({ failed: 'The download didn’t finish.' }), 'Update to 0.5.0 preview 5', 'after a failure it can be tried again');
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
