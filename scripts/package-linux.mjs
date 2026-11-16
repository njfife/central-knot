// The Linux package (npm run package:linux): Central-Knot[-Alpha]-<version>-linux-x86_64.AppImage under release/, one file
// that runs on x86_64 Linux desktops. The app is made as the Mac's is (scripts/package-app.mjs: the same version, release tag
// and line); the packager's folder is the AppImage's inside, with AppRun, a .desktop file and the icon added beside the app,
// squashed with mksquashfs (squashfs-tools) and put after the AppImage type-2 runtime, which mounts it through FUSE and starts
// AppRun. Not here yet: custom builds (refused in words), signing, a release upload, and updates.
//
// The runtime is the static one, which needs no libfuse2 (CachyOS has none): runtime-x86_64 of the AppImage project's
// type2-runtime release 20251108, https://github.com/AppImage/type2-runtime/releases/tag/20251108. It is downloaded once into
// node_modules/.cache/ and checked against RUNTIME.sha256 at every use, so a file that changed upstream stops the package.
// To move to a newer runtime: choose a dated release there (never `continuous`, which is republished in place), and put its
// tag in RUNTIME.tag and its runtime-x86_64's SHA-256 (GitHub lists it beside the file) in RUNTIME.sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildInputs, isCustom } from '../src/bundlepack.ts';
import { lineApp, linuxDownload, releaseLine } from '../src/updates.ts';
import { packageFolder, plainly, tagHere, version } from './package-app.mjs';

const RUNTIME = { tag: '20251108', sha256: '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d' };

if (process.platform !== 'linux') plainly('The Linux package is made on Linux: it takes Linux’s Electron and mksquashfs.');
let inputs, rest;
try { ({ inputs, rest } = buildInputs(process.argv.slice(2))); } catch (error) { plainly(error.message); }
if (isCustom(inputs)) plainly('A custom build is packaged on a Mac for now (npm run package:mac, with the same inputs); on Linux only the standard app and the alpha are.');
if (rest.length) plainly(`Not an input here: ${rest.join(' ')}. The Linux package takes none.`);

/** The runtime's bytes, downloaded once and checked against the pin each time. */
async function runtime() {
  const file = join('node_modules/.cache/central-knot', `appimage-runtime-x86_64-${RUNTIME.tag}`);
  if (!existsSync(file)) {
    const response = await fetch(`https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME.tag}/runtime-x86_64`);
    if (!response.ok) plainly(`The AppImage runtime couldn’t be downloaded (HTTP ${response.status}). Nothing was packaged.`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== RUNTIME.sha256) { rmSync(file); plainly(`The AppImage runtime ${RUNTIME.tag} isn’t the one pinned in this script (its SHA-256 is ${sha256}). Nothing was packaged.`); }
  return bytes;
}

const tag = tagHere(false);
// The app this package is (src/updates.ts lineApp): an alpha tag makes "Central Knot Alpha"; any other tag, or none, the standard app.
const own = lineApp(releaseLine(tag));
const head = await runtime();
const folder = await packageFolder({ own, tag, platform: 'linux', arch: 'x64' });
// AppRun replaces itself with the app (exec), so the process the AppImage starts is the app: a signal to it reaches the app.
writeFileSync(join(folder, 'AppRun'), `#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/${own.name}" "$@"\n`, { mode: 0o755 });
writeFileSync(join(folder, `${own.bundleId}.desktop`), `[Desktop Entry]\nType=Application\nName=${own.name}\nExec=AppRun\nIcon=${own.bundleId}\nCategories=Development;\nTerminal=false\n`);
copyFileSync('assets/icon.png', join(folder, `${own.bundleId}.png`));
const download = join('release', linuxDownload(own.name, version)), squashed = `${download}.squashfs`;
execFileSync('mksquashfs', [folder, squashed, '-noappend', '-all-root', '-comp', 'zstd', '-no-progress'], { stdio: ['ignore', 'ignore', 'inherit'] });
writeFileSync(download, Buffer.concat([head, readFileSync(squashed)]));
rmSync(squashed);
chmodSync(download, 0o755);
console.log(`Package: ${own.name} (${own.bundleId}), ${tag ? `release ${tag}` : 'no release tag'}: ${download}`);
