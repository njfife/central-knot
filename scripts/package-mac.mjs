// The Mac package (npm run package:mac): the app and its two downloads under release/, signed, and a custom build's zip. What
// it shares with the Linux package (the version, the release tag, dist/ built as the app and the packager's folder of it) is
// scripts/package-app.mjs.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildInputs, isCustom } from '../src/bundlepack.ts';
import { downloadName, lineApp, macDownload, otherDownloads, releaseLine } from '../src/updates.ts';
import { stage } from './custom-build.mjs';
import { buildDmg } from './mac-dmg.mjs';
import { packageFolder, plainly, tagHere, version } from './package-app.mjs';

if (process.platform !== 'darwin') throw new Error('Mac packaging runs on the selected Mac, not a cross-platform stand-in.');

// Signing: a Developer ID Application certificate in this Mac's keychain signs the app with the hardened runtime, and a
// notarytool keychain profile notarizes and staples it. Without them the app is signed ad hoc, as before (CI, local tries).
// `--release` refuses to fall back: a release must be Developer ID signed and notarized.
// The optional build inputs (ORG-01; listed at the top of scripts/custom-build.mjs). Any one of them makes this a custom
// build: its own name and identity, and with --marketplace, that marketplace packed inside. None: the standard app.
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

// A custom build is staged first (its identity file, the marketplace it carries, its pictures and its report), then the
// app's code is built again around it: it calls itself by its own name and carries the staged files (scripts/build.mjs).
const custom = isCustom(inputs) ? await stage(inputs).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }) : undefined;

// The release tag this build is made from (package-app.mjs tagHere). A custom build records none: the standard app's releases
// are not its own, and it never updates from them (ORG-07).
const tag = custom ? '' : tagHere(release);
// The app this package is: a custom build's own, or the one the tag's release line is (src/updates.ts lineApp). An alpha tag
// (v0.6.0-alpha.1) makes "Central Knot Alpha", with its own bundle id and downloads; any other tag, or none, the standard app.
const own = custom?.build ?? lineApp(releaseLine(tag));
const appName = own.name;
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
await mkdir('release', { recursive: true });
// The two downloads a release line's package writes. Every other Mac download in release/ (the other line's, an earlier
// version's, a custom build's) is removed first and named, so release/ holds exactly the files its release carries: an alpha's
// release that also carried the standard app's zip would be offered to every installed preview (src/updates.ts otherDownloads).
// A custom build's package removes nothing.
const downloads = [macDownload(appName, version, 'zip'), macDownload(appName, version, 'dmg')];
const removed = custom ? [] : otherDownloads(await readdir('release'), downloads);
for (const file of removed) await rm(join('release', file), { force: true });
if (removed.length) console.log(`Removed from release/, as not this package's: ${removed.join(', ')}`);
const folder = await packageFolder({ own, tag, custom, platform: 'darwin', arch: 'arm64', options: {
  // The default app icon, or the one a custom build was given (--app-icon).
  icon,
  // Tests only: environment the app is always opened with (LSEnvironment), so an update's restart stays in a test's throwaway
  // folders (scripts/update-proof.mjs). A JSON object of variables; never set for a release.
  ...(process.env.CK_TEST_ENVIRONMENT && !release ? { extendInfo: { LSEnvironment: JSON.parse(process.env.CK_TEST_ENVIRONMENT) } } : {}),
  // @electron/osx-sign's defaults: hardened runtime and the entitlements Electron needs (JIT and its helpers).
  ...(identity ? { osxSign: { identity } } : {}),
  // notarytool with a stored keychain profile; the app is stapled, so it opens offline on first launch.
  ...(notarize ? { osxNotarize: { keychainProfile: notaryProfile } } : {}),
} });
const bundle = `${folder}/${appName}.app`;
// Unsigned builds: packager leaves Electron's stock signature, whose seal no longer matches the renamed bundle.
if (!identity) execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
if (notarize) {
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose', bundle], { stdio: 'inherit' });
}
const signed = identity ? `${identity}${notarize ? ', notarized and stapled' : ', not notarized'}` : 'signed ad hoc';
const archive = `release/${downloads[0]}`;
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive]);
if (custom) {
  // A custom build's download is its zip, with its report beside it. (It has no disk image yet: a disk image's window is a
  // folder of the app's own in assets/dmg/, scripts/mac-dmg.mjs, and a custom build has none.)
  const report = `release/${downloadName(appName)}-build-report.txt`;
  await copyFile(join(custom.out, 'build-report.txt'), report);
  console.log(`\n${custom.report}\nPackage: ${archive} (${signed}), report in ${report}`);
} else {
  // The download for people: a disk image to drag the app out of into Applications. The zip stays: it is what the app's
  // own updater downloads (src/updates.ts looks for it by this name, its own app's: an alpha never takes the standard app's).
  const dmg = `release/${downloads[1]}`;
  buildDmg({ bundle, dmg, name: appName, identity, notaryProfile: notarize ? notaryProfile : undefined });
  console.log(`Package: ${appName} (${own.bundleId}), ${tag ? `release ${tag}` : 'no release tag'} (${signed}). Upload exactly these: ${dmg} ${archive}`);
}
