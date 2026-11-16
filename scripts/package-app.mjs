// What the Mac and the Linux packages share (scripts/package-mac.mjs, scripts/package-linux.mjs): the version, the release tag
// a build records (tagHere), dist/ built as the app being packaged and the packager's folder of it (packageFolder), and where
// the checks find the packaged standard app (packagedApp: scripts/e2e.mjs, scripts/ui-tour.mjs). Each platform's script owns
// the rest: the Mac's custom builds, signing and downloads; Linux's AppImage. The app a tag's line is: src/updates.ts lineApp.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { linuxDownload } from '../src/updates.ts';
import { PRODUCT, STANDARD_BUILD } from '../src/values.ts';
import { releaseTagHere } from './release-tag.mjs';

const root = join(import.meta.dirname, '..');

/** Says why packaging stops, in plain words, and stops. */
export const plainly = message => { console.error(message); process.exit(2); };

/** The version is package.json's: a release bumps it there and nowhere else. */
export const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/**
 * The release tag this build is made from, recorded inside the app so it can tell a newer release (updates.ts): CK_RELEASE_TAG,
 * or the highest version tag on the commit being built. A checkout with changes of its own doesn't take the commit's tag, and
 * can't be a release (release-tag.mjs), nor can a tag whose pre-release part names no line (v0.6.0-alpha1: said plainly, and
 * nothing is built). A build with no tag never offers updates.
 */
export const tagHere = release => { try { return releaseTagHere(release); } catch (error) { return plainly(error.message); } };

/** dist/ as the plain standard app: no custom build's files, the standard name. */
const plainBuild = () => execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit', env: { ...process.env, CK_CUSTOM_BUILD: '', CK_APP_NAME: '' } });

/**
 * The packager's folder of `own` (the app a line's tag makes, or with `custom` a custom build's, whose dist/ the caller built)
 * for `platform` and `arch`, under release/, with `tag` recorded in it (dist/build-info.json, for this package only). An alpha
 * is the standard app's code under the alpha's name (scripts/build.mjs CK_APP_NAME); a standard package is never a custom
 * build or an alpha by accident: dist/ left as one is built again without it. Afterwards dist/ is the plain standard app
 * again, so a later run or package of this checkout never claims the tag or the other name. `options`: the platform's own
 * packager options. Returns the folder.
 */
export async function packageFolder({ own, tag, custom, platform, arch, options = {} }) {
  const { packager } = await import('@electron/packager');
  const renamed = !custom && own.bundleId !== STANDARD_BUILD;
  if (renamed) execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit', env: { ...process.env, CK_CUSTOM_BUILD: '', CK_APP_NAME: own.name } });
  else if (!custom && (existsSync('dist/custom-build.json') || process.env.CK_APP_NAME)) plainBuild();
  await rm('dist/build-info.json', { force: true });
  if (tag) await writeFile('dist/build-info.json', `${JSON.stringify({ tag })}\n`);
  const [folder] = await packager({
    dir: '.', out: 'release', name: own.name, executableName: own.name,
    // Its own bundle id (an alpha's, a custom build's) is what lets it sit beside the standard app, with its own settings and login item.
    appBundleId: own.bundleId, appVersion: version, platform, arch,
    asar: true, overwrite: true, prune: true,
    // Optional: a folder already holding the Electron zip, for when GitHub's downloads are failing (CK_ELECTRON_ZIP_DIR).
    ...(process.env.CK_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.CK_ELECTRON_ZIP_DIR } : {}),
    ignore: [/^\/src(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/.github(?:\/|$)/, /^\/release(?:\/|$)/, /^\/build(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/LEDGER\.md$/, /^\/README\.md$/],
    ...options,
  }).finally(async () => {
    await rm('dist/build-info.json', { force: true });
    if (custom || renamed) plainBuild();
  });
  return folder;
}

/** The packaged standard app, as `npm run package:mac` or `npm run package:linux` leaves it here (an alpha's is beside it, by its own name): what the checks open. */
export const packagedApp = (platform = process.platform) => (platform === 'darwin'
  ? join(root, `release/${PRODUCT}-darwin-arm64/${PRODUCT}.app/Contents/MacOS/${PRODUCT}`)
  : join(root, 'release', linuxDownload(PRODUCT, version)));
