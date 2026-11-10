import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildInputs, downloadName, isCustom } from '../src/bundlepack.ts';
import { stage } from './custom-build.mjs';
import { buildDmg } from './mac-dmg.mjs';
import { releaseTagHere } from './release-tag.mjs';

if (process.platform !== 'darwin') throw new Error('Mac packaging runs on the selected Mac, not a cross-platform stand-in.');

// Signing: a Developer ID Application certificate in this Mac's keychain signs the app with the hardened runtime, and a
// notarytool keychain profile notarizes and staples it. Without them the app is signed ad hoc, as before (CI, local tries).
// `--release` refuses to fall back: a release must be Developer ID signed and notarized.
// The optional build inputs (ORG-01; listed at the top of scripts/custom-build.mjs). Any one of them makes this a custom
// build: its own name and identity, and with --marketplace, that marketplace packed inside. None: the standard app.
const plainly = message => { console.error(message); process.exit(2); };
let inputs, rest;
try { ({ inputs, rest } = buildInputs(process.argv.slice(2))); } catch (error) { plainly(error.message); }
const unknown = rest.filter(arg => arg !== '--release');
if (unknown.length) plainly(`Not a build input: ${unknown.join(' ')}. The inputs are listed at the top of scripts/custom-build.mjs.`);
const release = rest.includes('--release');
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

// A custom build is staged first (its identity file, the marketplace it carries, its pictures and its report), then the
// app's code is built again around it: it calls itself by its own name and carries the staged files (scripts/build.mjs).
const custom = isCustom(inputs) ? await stage(inputs).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }) : undefined;
const appName = custom?.build.name ?? 'Central Knot';
let icon = 'assets/icon.icns';
if (custom) {
  const given = custom.icon && join(custom.out, custom.icon);
  // A .png becomes the Mac icon at every size it is shown in; an .icns gives the sidebar's mark as a .png.
  if (given?.endsWith('.png')) {
    const set = join(custom.out, 'icon.iconset');
    mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
      execFileSync('/usr/bin/sips', ['-z', String(size), String(size), given, '--out', join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
      execFileSync('/usr/bin/sips', ['-z', String(size * 2), String(size * 2), given, '--out', join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
    }
    icon = join(custom.out, 'app-icon.icns');
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', icon]);
  } else if (given) {
    icon = given;
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', '256', '256', given, '--out', join(custom.out, 'app-logo.png')], { stdio: 'ignore' });
  }
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit', env: { ...process.env, CK_CUSTOM_BUILD: custom.out, ...(given?.endsWith('.icns') ? { CK_CUSTOM_LOGO: join(custom.out, 'app-logo.png') } : {}) } });
}
// A standard package is never a custom build by accident: one left in dist/ (CK_CUSTOM_BUILD set for the build step) is built again without it.
if (!custom && existsSync('dist/custom-build.json')) execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit', env: { ...process.env, CK_CUSTOM_BUILD: '' } });

// The release tag this build is made from, recorded inside the app so it can tell a newer release (updates.ts): CK_RELEASE_TAG,
// or the highest version tag on the commit being built. A checkout with changes of its own doesn't take the commit's tag, and
// can't be a release (release-tag.mjs). A build with no tag never offers updates. A custom build records none: the standard
// app's releases are not its own, and it never updates from them (ORG-07).
const tag = custom ? '' : releaseTagHere(release);
// Written for this package only, then removed, so a dev run or a later untagged build never claims the tag.
await rm('dist/build-info.json', { force: true });
if (tag) await writeFile('dist/build-info.json', `${JSON.stringify({ tag })}\n`);

await mkdir('release', { recursive: true });
const packages = await packager({
  dir: '.', out: 'release', name: appName, executableName: appName,
  // A custom build's own bundle id is what lets it sit beside the standard app, with its own settings and login item.
  appBundleId: custom?.build.bundleId ?? 'com.centralknot.firstlook', appVersion: version, platform: 'darwin', arch: 'arm64',
  asar: true, overwrite: true, prune: true,
  // The default app icon, or the one a custom build was given (--app-icon).
  icon,
  // Optional: a folder already holding the Electron zip, for when GitHub's downloads are failing (CK_ELECTRON_ZIP_DIR).
  ...(process.env.CK_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.CK_ELECTRON_ZIP_DIR } : {}),
  // Tests only: environment the app is always opened with (LSEnvironment), so an update's restart stays in a test's throwaway
  // folders (scripts/update-proof.mjs). A JSON object of variables; never set for a release.
  ...(process.env.CK_TEST_ENVIRONMENT && !release ? { extendInfo: { LSEnvironment: JSON.parse(process.env.CK_TEST_ENVIRONMENT) } } : {}),
  // @electron/osx-sign's defaults: hardened runtime and the entitlements Electron needs (JIT and its helpers).
  ...(identity ? { osxSign: { identity } } : {}),
  // notarytool with a stored keychain profile; the app is stapled, so it opens offline on first launch.
  ...(notarize ? { osxNotarize: { keychainProfile: notaryProfile } } : {}),
  ignore: [/^\/src(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/.github(?:\/|$)/, /^\/release(?:\/|$)/, /^\/build(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/LEDGER\.md$/, /^\/README\.md$/],
}).finally(async () => {
  await rm('dist/build-info.json', { force: true });
  // dist/ goes back to the standard app, so a later run or package of this checkout is never the custom build by accident.
  if (custom) execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit', env: { ...process.env, CK_CUSTOM_BUILD: '' } });
});
const bundle = `${packages[0]}/${appName}.app`;
// Unsigned builds: packager leaves Electron's stock signature, whose seal no longer matches the renamed bundle.
if (!identity) execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
if (notarize) {
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose', bundle], { stdio: 'inherit' });
}
const signed = identity ? `${identity}${notarize ? ', notarized and stapled' : ', not notarized'}` : 'signed ad hoc';
const archive = `release/${downloadName(appName)}-${version}-mac-arm64.zip`;
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive]);
if (custom) {
  // A custom build's download is its zip, with its report beside it. (The disk image's window is laid out for the standard
  // app's name, so a custom build has none yet.)
  const report = `release/${downloadName(appName)}-build-report.txt`;
  await copyFile(join(custom.out, 'build-report.txt'), report);
  console.log(`\n${custom.report}\nPackage: ${archive} (${signed}), report in ${report}`);
} else {
  // The download for people: a disk image to drag the app out of into Applications. The zip stays: it is what the app's
  // own updater downloads (src/updates.ts looks for it by this name).
  const dmg = `release/Central-Knot-${version}-mac-arm64.dmg`;
  buildDmg({ bundle, dmg, identity, notaryProfile: notarize ? notaryProfile : undefined });
  console.log(`Package: ${archive} and ${dmg}, ${tag ? `release ${tag}` : 'no release tag'} (${signed})`);
}
