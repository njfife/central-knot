import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

if (process.platform !== 'darwin') throw new Error('Mac packaging runs on the selected Mac, not a cross-platform stand-in.');
await mkdir('release', { recursive: true });
const packages = await packager({
  dir: '.', out: 'release', name: 'Central Knot', executableName: 'Central Knot',
  appBundleId: 'com.centralknot.firstlook', appVersion: '0.3.0', platform: 'darwin', arch: 'arm64',
  asar: true, overwrite: true, prune: true,
  // Optional: a folder already holding the Electron zip, for when GitHub's downloads are failing (CK_ELECTRON_ZIP_DIR).
  ...(process.env.CK_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.CK_ELECTRON_ZIP_DIR } : {}),
  ignore: [/^\/src(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/.github(?:\/|$)/, /^\/release(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/LEDGER\.md$/, /^\/README\.md$/],
});
const bundle = `${packages[0]}/Central Knot.app`;
// Packager leaves Electron's stock signature, whose seal no longer matches the renamed bundle.
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
const archive = 'release/Central-Knot-0.3.0-mac-arm64.zip';
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive]);
console.log(`Package: ${archive}`);
