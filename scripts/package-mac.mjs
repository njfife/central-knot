import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

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

await mkdir('release', { recursive: true });
const packages = await packager({
  dir: '.', out: 'release', name: 'Central Knot', executableName: 'Central Knot',
  appBundleId: 'com.centralknot.firstlook', appVersion: version, platform: 'darwin', arch: 'arm64',
  asar: true, overwrite: true, prune: true,
  // Optional: a folder already holding the Electron zip, for when GitHub's downloads are failing (CK_ELECTRON_ZIP_DIR).
  ...(process.env.CK_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.CK_ELECTRON_ZIP_DIR } : {}),
  // @electron/osx-sign's defaults: hardened runtime and the entitlements Electron needs (JIT and its helpers).
  ...(identity ? { osxSign: { identity } } : {}),
  // notarytool with a stored keychain profile; the app is stapled, so it opens offline on first launch.
  ...(notarize ? { osxNotarize: { keychainProfile: notaryProfile } } : {}),
  ignore: [/^\/src(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/.github(?:\/|$)/, /^\/release(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/LEDGER\.md$/, /^\/README\.md$/],
});
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
console.log(`Package: ${archive} (${identity ? `${identity}${notarize ? ', notarized and stapled' : ', not notarized'}` : 'signed ad hoc'})`);
