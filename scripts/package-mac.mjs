import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

if (process.platform !== 'darwin') throw new Error('Mac packaging runs on the selected Mac, not a cross-platform stand-in.');
await mkdir('release', { recursive: true });
const packages = await packager({
  dir: '.', out: 'release', name: 'Central Knot', executableName: 'Central Knot',
  appBundleId: 'com.centralknot.firstlook', appVersion: '0.1.0', platform: 'darwin', arch: 'arm64',
  asar: true, overwrite: true, prune: true,
  ignore: [/^\/src(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/.github(?:\/|$)/, /^\/release(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/LEDGER\.md$/],
});
const archive = 'release/Central-Knot-0.1.0-mac-arm64.zip';
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', `${packages[0]}/Central Knot.app`, archive]);
console.log(`Package: ${archive}`);
