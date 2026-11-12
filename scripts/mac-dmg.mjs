// The Mac download people open by hand: a disk image whose window shows the app (Central Knot, or Central Knot Alpha) beside
// a shortcut to the Applications folder, to drag one onto the other. (The zip beside it stays: scripts and updates take the
// app from there.)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadName } from '../src/updates.ts';
// A folder's Finder flags with "has a custom icon" set, so the mounted disk shows the app's icon (.VolumeIcon.icns).
const customIconFlag = '0000000000000000040000000000000000000000000000000000000000000000';

const run = (command, args, options) => execFileSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
// macOS can still be holding an image it was just handed ("Resource busy"); a moment later it mounts.
const attach = (image, mount, ...flags) => {
  for (let tries = 1; ; tries++) {
    try { return run('/usr/bin/hdiutil', ['attach', image, '-nobrowse', '-noautoopen', '-mountpoint', mount, ...flags]); }
    catch (error) { if (tries === 3) throw error; run('/bin/sleep', ['2']); }
  }
};
// A disk that Spotlight or Finder has just looked at can refuse to eject once.
const detach = mount => { try { run('/usr/bin/hdiutil', ['detach', mount]); } catch { run('/usr/bin/hdiutil', ['detach', mount, '-force']); } };

// Each app's window is its own folder, assets/dmg/<its download name>/ (Central-Knot, Central-Knot-Alpha): the picture,
// background.svg, kept as PNGs at both sizes (it says the app's name), and DS_Store, the file Finder keeps a folder's view
// in (the window's size and icon places). DS_Store names the disk's contents by volume name and file name, so those are the
// app's: "<name>" for the volume, "<name>.app", "Applications" and ".background.tiff". scripts/mac-dmg-layout.sh "<name>"
// makes it again when the layout changes. `name`: the app's name, as packaged.
export function buildDmg({ bundle, dmg, name, identity, notaryProfile }) {
  const volumeName = name, appName = `${name}.app`, look = join('assets/dmg', downloadName(name));
  if (!existsSync(join(look, 'DS_Store'))) throw new Error(`No disk image window for ${name} in ${look}: make it with scripts/mac-dmg-layout.sh "${name}".`);
  const work = mkdtempSync(join(tmpdir(), 'ck-dmg-'));
  try {
    const stage = join(work, 'stage');
    mkdirSync(stage);
    run('/usr/bin/ditto', [bundle, join(stage, appName)]);
    symlinkSync('/Applications', join(stage, 'Applications'));
    // One TIFF holding the picture at both sizes, so the window is sharp on a Retina display.
    run('/usr/bin/tiffutil', ['-cathidpicheck', join(look, 'background.png'), join(look, 'background@2x.png'), '-out', join(stage, '.background.tiff')]);
    copyFileSync(join(look, 'DS_Store'), join(stage, '.DS_Store'));
    copyFileSync('assets/icon.icns', join(stage, '.VolumeIcon.icns'));

    // Built writable first: the disk's own icon flag can only be set on the mounted volume.
    const writable = join(work, 'writable.dmg');
    const mount = join(work, 'volume');
    run('/usr/bin/hdiutil', ['create', '-volname', volumeName, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDRW', writable]);
    attach(writable, mount);
    try {
      run('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', customIconFlag, mount]);
      rmSync(join(mount, '.fseventsd'), { recursive: true, force: true });
    } finally { detach(mount); }
    rmSync(dmg, { force: true });
    run('/usr/bin/hdiutil', ['convert', writable, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', dmg]);

    // Signed and notarized in its own right, so the download itself opens with no warning, also offline.
    if (identity) run('/usr/bin/codesign', ['--sign', identity, '--timestamp', dmg]);
    if (notaryProfile) {
      run('/usr/bin/xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', notaryProfile, '--wait'], { stdio: 'inherit' });
      run('/usr/bin/xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
      run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose', dmg], { stdio: 'inherit' });
    }

    // What someone who opens it gets: the app, intact, and a shortcut that leads to Applications.
    attach(dmg, mount, '-readonly');
    try {
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(mount, appName)]);
      if (readlinkSync(join(mount, 'Applications')) !== '/Applications') throw new Error('The disk image’s Applications shortcut doesn’t lead to /Applications.');
      for (const name of ['.DS_Store', '.background.tiff', '.VolumeIcon.icns']) lstatSync(join(mount, name));
    } finally { detach(mount); }
  } finally { rmSync(work, { recursive: true, force: true }); }
}
