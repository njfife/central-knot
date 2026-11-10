import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { buildDmg } from './mac-dmg.mjs';

if (process.platform !== 'darwin') throw new Error('Mac packaging runs on the selected Mac, not a cross-platform stand-in.');

// Signing: a Developer ID Application certificate in this Mac's keychain signs the app with the hardened runtime, and a
// notarytool keychain profile notarizes and staples it. Without them the app is signed ad hoc, as before (CI, local tries).
// `--release` refuses to fall back: a release must be Developer ID signed and notarized.
const release = process.argv.includes('--release');
const findIdentity = () => {
  try {
    const listed = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    return /"(Developer ID Application: [^"]+)"/.exec(listed)?.[1];
  } catch { return undefined; }
};
// CK_SIGN=0: a local ad hoc build even where a Developer ID is installed (over SSH its keychain is locked).
const identity = process.env.CK_SIGN === '0' ? undefined : process.env.CK_SIGN_IDENTITY || findIdentity();
const notaryProfile = process.env.CK_NOTARY_PROFILE || (identity ? 'central-knot-notary' : undefined);
const notarize = !!identity && process.env.CK_NOTARIZE !== '0';
if (release && !identity) throw new Error('No “Developer ID Application” certificate in this Mac’s keychain (or CK_SIGN=0), so a release can’t be signed.');
if (release && !notarize) throw new Error('A release must be notarized; CK_NOTARIZE=0 is only for local tries.');

// The version is package.json's: a release bumps it there and nowhere else.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// The release tag this build is made from, recorded inside the app so it can tell a newer release (updates.ts): CK_RELEASE_TAG,
// or the highest version tag on the commit being built (other tags, such as checkpoints, don't count). A build with neither never offers
// updates. A release must have one.
const versionTag = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const tagOf = () => { try { return execFileSync('git', ['-c', 'versionsort.suffix=-', 'tag', '--points-at', 'HEAD', '--sort=-version:refname'], { encoding: 'utf8' }).split('\n').find(name => versionTag.test(name)) ?? ''; } catch { return ''; } };
const tag = process.env.CK_RELEASE_TAG ?? tagOf();
if (tag && !versionTag.test(tag)) throw new Error(`CK_RELEASE_TAG ${tag} isn’t a version tag like v0.5.0-preview.5.`);
if (release && !tag) throw new Error('A release is built from its tag: tag the commit (or set CK_RELEASE_TAG), so the app can tell a newer release.');
// Written for this package only, then removed, so a dev run or a later untagged build never claims the tag.
await rm('dist/build-info.json', { force: true });
if (tag) await writeFile('dist/build-info.json', `${JSON.stringify({ tag })}\n`);

await mkdir('release', { recursive: true });
const packages = await packager({
  dir: '.', out: 'release', name: 'Central Knot', executableName: 'Central Knot',
  appBundleId: 'com.centralknot.firstlook', appVersion: version, platform: 'darwin', arch: 'arm64',
  asar: true, overwrite: true, prune: true,
  // The default app icon; a branded build replaces the files in assets/.
  icon: 'assets/icon.icns',
  // Optional: a folder already holding the Electron zip, for when GitHub's downloads are failing (CK_ELECTRON_ZIP_DIR).
  ...(process.env.CK_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.CK_ELECTRON_ZIP_DIR } : {}),
  // Tests only: environment the app is always opened with (LSEnvironment), so an update's restart stays in a test's throwaway
  // folders (scripts/update-proof.mjs). A JSON object of variables; never set for a release.
  ...(process.env.CK_TEST_ENVIRONMENT && !release ? { extendInfo: { LSEnvironment: JSON.parse(process.env.CK_TEST_ENVIRONMENT) } } : {}),
  // @electron/osx-sign's defaults: hardened runtime and the entitlements Electron needs (JIT and its helpers).
  ...(identity ? { osxSign: { identity } } : {}),
  // notarytool with a stored keychain profile; the app is stapled, so it opens offline on first launch.
  ...(notarize ? { osxNotarize: { keychainProfile: notaryProfile } } : {}),
  ignore: [/^\/src(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/.github(?:\/|$)/, /^\/release(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/LEDGER\.md$/, /^\/README\.md$/],
}).finally(() => rm('dist/build-info.json', { force: true }));
const bundle = `${packages[0]}/Central Knot.app`;
// Unsigned builds: packager leaves Electron's stock signature, whose seal no longer matches the renamed bundle.
if (!identity) execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
if (notarize) {
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose', bundle], { stdio: 'inherit' });
}
const archive = `release/Central-Knot-${version}-mac-arm64.zip`;
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive]);
// The download for people: a disk image to drag the app out of into Applications. The zip stays: it is what the app's
// own updater downloads (src/updates.ts looks for it by this name).
const dmg = `release/Central-Knot-${version}-mac-arm64.dmg`;
buildDmg({ bundle, dmg, identity, notaryProfile: notarize ? notaryProfile : undefined });
console.log(`Package: ${archive} and ${dmg}, ${tag ? `release ${tag}` : 'no release tag'} (${identity ? `${identity}${notarize ? ', notarized and stapled' : ', not notarized'}` : 'signed ad hoc'})`);
