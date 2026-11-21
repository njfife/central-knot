// The Mac download people open by hand: a disk image whose window shows the app (Central Knot, or Central Knot Alpha) beside
// a shortcut to the Applications folder, to drag one onto the other. (The zip beside it stays: scripts and updates take the
// app from there.) Also how an image is attached for a while and detached after (whileAttached), here and in the alpha check
// (scripts/mac-dmg-layout.sh, run by hand, has its own).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadName } from '../src/updates.ts';
// A folder's Finder flags with "has a custom icon" set, so the mounted disk shows the app's icon (.VolumeIcon.icns).
const customIconFlag = '0000000000000000040000000000000000000000000000000000000000000000';

const run = (command, args, options) => execFileSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
// hdiutil is taken from PATH (/usr/bin on every Mac), so a test can stand one in (tests/macdmg.test.ts). macOS can still be
// holding a disk it was just handed, or one that Spotlight or a scan has just looked at ("Resource busy"); a few seconds later
// it is free (hosted macOS 15 under load held a writable image past 4 s). So a call that meets one is tried again after `waitMs`
// (default 2 s), twelve tries in all (`again`: the arguments of each later try), and says so in the log; any other failure throws.
// Synchronously pauses between busy retries inside execFileSync's loop without spawning a child sleep process.
const HDIUTIL_TRIES = 12, pause = new Int32Array(new SharedArrayBuffer(4));
const hdiutil = (args, { again = args, stdout = 'ignore', waitMs = 2000 } = {}) => {
  for (let tries = 1; ; tries++) {
    try { return run('hdiutil', tries === 1 ? args : again, { stdio: ['ignore', stdout, 'pipe'], encoding: 'utf8' }); }
    catch (error) {
      if (tries === HDIUTIL_TRIES || !/Resource busy/.test(String(error.stderr ?? ''))) throw error;
      process.stderr.write(error.stderr);
      if (waitMs > 0) Atomics.wait(pause, 0, 0, waitMs);
    }
  }
};
// Returns the device the image is attached as: the whole disk, which hdiutil names first ("/dev/disk5  GUID_partition_scheme").
const attach = (image, mount, flags, waitMs) => {
  const said = hdiutil(['attach', image, '-nobrowse', '-noautoopen', '-mountpoint', mount, ...flags], { stdout: 'pipe', waitMs });
  const device = /^\/dev\/disk\d+(?=\s)/m.exec(said)?.[0];
  if (!device) {
    detach(mount, waitMs, image, mount);
    throw new Error(`hdiutil attached ${image} and named no disk:\n${said}`);
  }
  return device;
};
// Detached by its device, not its mount: a first try can unmount the volume and still be refused the eject, and by the next
// try the mount's path is gone. A later try is forced; a disk no longer there ("No such file or directory") is detached.
const detach = (target, waitMs, image, mount) => {
  try { hdiutil(['detach', target], { again: ['detach', target, '-force'], waitMs }); }
  catch (error) {
    if (/No such file or directory/.test(String(error.stderr ?? ''))) return;
    throw Object.assign(
      new Error(`Could not detach ${image} (${target} at ${mount}): ${String(error.stderr || error.message).trim()}`, { cause: error }),
      { leftMounted: true },
    );
  }
};
/** Attaches `image` at `mount` for `use`, and detaches it after, however `use` ends. Returns what `use` returns. */
export function whileAttached(image, mount, flags, use, waitMs = 2000) {
  const device = attach(image, mount, flags, waitMs);
  let failed, result;
  try { result = use(); } catch (error) { failed = error; }
  try { detach(device, waitMs, image, mount); }
  catch (error) {
    if (!failed) throw error;
    throw Object.assign(new Error(`${failed.message ?? failed} (${error.message})`, { cause: failed }), { leftMounted: true });
  }
  if (failed) throw failed;
  return result;
}

// Each app's window is its own folder, assets/dmg/<its download name>/ (Central-Knot, Central-Knot-Alpha): the picture,
// background.svg, kept as PNGs at both sizes (it says the app's name), and DS_Store, the file Finder keeps a folder's view
// in (the window's size and icon places). DS_Store names the disk's contents by volume name and file name, so those are the
// app's: "<name>" for the volume, "<name>.app", "Applications" and ".background.tiff". scripts/mac-dmg-layout.sh "<name>"
// makes it again when the layout changes. `name`: the app's name, as packaged.
export function buildDmg({ bundle, dmg, name, identity, notaryProfile }) {
  const volumeName = name, appName = `${name}.app`, look = join('assets/dmg', downloadName(name));
  if (!existsSync(join(look, 'DS_Store'))) throw new Error(`No disk image window for ${name} in ${look}: make it with scripts/mac-dmg-layout.sh "${name}".`);
  const work = mkdtempSync(join(tmpdir(), 'ck-dmg-'));
  let leftMounted = false;
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
    hdiutil(['create', '-volname', volumeName, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDRW', writable]);
    whileAttached(writable, mount, [], () => {
      run('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', customIconFlag, mount]);
      rmSync(join(mount, '.fseventsd'), { recursive: true, force: true });
    });
    rmSync(dmg, { force: true });
    hdiutil(['convert', writable, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', dmg]);

    // Signed and notarized in its own right, so the download itself opens with no warning, also offline.
    if (identity) run('/usr/bin/codesign', ['--sign', identity, '--timestamp', dmg]);
    if (notaryProfile) {
      run('/usr/bin/xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', notaryProfile, '--wait'], { stdio: 'inherit' });
      run('/usr/bin/xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
      run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose', dmg], { stdio: 'inherit' });
    }

    // What someone who opens it gets: the app, intact, and a shortcut that leads to Applications.
    whileAttached(dmg, mount, ['-readonly'], () => {
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(mount, appName)]);
      if (readlinkSync(join(mount, 'Applications')) !== '/Applications') throw new Error('The disk image’s Applications shortcut doesn’t lead to /Applications.');
      for (const name of ['.DS_Store', '.background.tiff', '.VolumeIcon.icns']) lstatSync(join(mount, name));
    });
  } catch (error) {
    leftMounted = Boolean(error?.leftMounted);
    throw error;
  } finally { if (!leftMounted) rmSync(work, { recursive: true, force: true }); }
}
