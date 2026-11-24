// Worked examples of finding tools and desktop apps by platform (Windows, macOS, Linux), with the platform and environment
// given explicitly so Windows rules run and are proved on Linux too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover, findBinary, findCli, findOtherApps } from '../src/discovery.ts';
import { appCandidates, executableCandidates, otherAppCandidates } from '../src/platform.ts';
import { isPresent, presentTools } from '../src/presence.ts';

const WIN_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL';

/** A disposable home and Windows-style APPDATA / LOCALAPPDATA pointing inside it, isolated from real /Applications. */
async function winBox() {
  const dir = await mkdtemp(join(tmpdir(), 'ck-win-find-'));
  const home = join(dir, 'home');
  const appData = join(home, 'AppData', 'Roaming');
  const local = join(home, 'AppData', 'Local');
  await mkdir(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { APPDATA: appData, LOCALAPPDATA: local, PATHEXT: WIN_PATHEXT, CK_TEST_APPS: join(dir, 'no-mac-apps') };
  return { dir, home, appData, local, env, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** An Electron app's app.asar holding only a package.json with this version. */
async function asar(path: string, version: string) {
  const body = Buffer.from(JSON.stringify({ name: 'app', version }));
  const header = Buffer.from(JSON.stringify({ files: { 'package.json': { size: body.length, offset: '0' } } }));
  const padded = Math.ceil(header.length / 4) * 4;
  const head = Buffer.alloc(16 + padded);
  [4, 8 + padded, 4 + padded, header.length].forEach((value, index) => head.writeUInt32LE(value, index * 4));
  header.copy(head, 16);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, Buffer.concat([head, body]));
}

test('Windows PATH is split on semicolons and tried with PATHEXT endings, .exe before .cmd, finding claude.exe and codex.cmd', async () => {
  const winEnv: NodeJS.ProcessEnv = {
    APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
    PATHEXT: WIN_PATHEXT,
  };
  const winPath = 'C:\\Users\\x\\.local\\bin;C:\\Program Files\\nodejs';
  const claude = executableCandidates('C:\\Users\\x', winPath, 'claude', 'win32', winEnv);
  assert.ok(claude.includes('C:\\Users\\x\\.local\\bin\\claude.exe'));
  assert.ok(claude.includes('C:\\Program Files\\nodejs\\claude.cmd'));
  assert.ok(claude.indexOf('C:\\Users\\x\\.local\\bin\\claude.exe') < claude.indexOf('C:\\Users\\x\\.local\\bin\\claude.cmd'));
  // Non-CLI script-host/UI endings from PATHEXT and bare extensionless names are never candidates on Windows.
  assert.ok(!claude.some(path => path.endsWith('\\claude') || path.endsWith('.js') || path.endsWith('.vbs')));
  // Even when PATHEXT puts .CMD before .EXE, or is unset, .exe is tried before .cmd.
  const reversed = executableCandidates('C:\\Users\\x', winPath, 'claude', 'win32', { ...winEnv, PATHEXT: '.CMD;.EXE' });
  assert.ok(reversed.indexOf('C:\\Users\\x\\.local\\bin\\claude.exe') < reversed.indexOf('C:\\Users\\x\\.local\\bin\\claude.cmd'));
  const unset = executableCandidates('C:\\Users\\x', winPath, 'claude', 'win32', { APPDATA: winEnv.APPDATA, LOCALAPPDATA: winEnv.LOCALAPPDATA });
  assert.ok(unset.indexOf('C:\\Users\\x\\.local\\bin\\claude.exe') < unset.indexOf('C:\\Users\\x\\.local\\bin\\claude.cmd'));

  const box = await winBox();
  try {
    const bin = join(box.dir, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude.exe'), '#!/bin/sh\necho "2.1.329 (Claude Code)"\n', { mode: 0o755 });
    // Beside codex.cmd, put an extensionless npm bash shim and a .js file: only codex.cmd is chosen.
    await writeFile(join(bin, 'codex'), '#!/bin/sh\necho bash-shim\n', { mode: 0o755 });
    await writeFile(join(bin, 'codex.js'), 'console.log("not a cli");\n');
    await writeFile(join(bin, 'codex.cmd'), '@echo codex-cli 0.165.0\r\n');
    const searchPath = `${bin};C:\\Program Files\\nodejs`;
    assert.equal((await findBinary('claude-cli', box.home, searchPath, 'win32', box.env))?.binary, join(bin, 'claude.exe'));
    assert.equal(await findCli('claude-cli', box.home, searchPath, 'win32', box.env), join(bin, 'claude.exe'));
    assert.equal((await findBinary('codex-cli', box.home, searchPath, 'win32', box.env))?.binary, join(bin, 'codex.cmd'));
    assert.equal(await findCli('codex-cli', box.home, searchPath, 'win32', box.env), join(bin, 'codex.cmd'));
    // When both .exe and .cmd sit in the same folder, .exe wins.
    await writeFile(join(bin, 'claude.cmd'), '@echo 2.1.0\r\n');
    assert.equal((await findBinary('claude-cli', box.home, searchPath, 'win32', box.env))?.binary, join(bin, 'claude.exe'));
    // A directory named claude.exe is not a runnable file: a file claude.cmd beside it is picked instead.
    const dirBin = join(box.dir, 'dir-clash');
    await mkdir(join(dirBin, 'claude.exe'), { recursive: true });
    await writeFile(join(dirBin, 'claude.cmd'), '@echo 2.1.0\r\n');
    assert.equal((await findBinary('claude-cli', box.home, dirBin, 'win32', box.env))?.binary, join(dirBin, 'claude.cmd'));
    // CK_TEST_HOME_ONLY on Windows keeps only candidates under home, case-insensitively.
    const homeOnly = executableCandidates('C:\\Users\\x', 'C:\\Users\\x\\extra;C:\\Program Files\\nodejs', 'claude', 'win32', {
      ...winEnv, CK_TEST_HOME_ONLY: 'claude',
    });
    assert.ok(homeOnly.includes('C:\\Users\\x\\extra\\claude.exe'));
    assert.ok(!homeOnly.some(path => path.startsWith('C:\\Program Files')));
    // On POSIX hosts where the #!/bin/sh stand-in executes, discover reports Installed and its version too.
    if (process.platform !== 'win32') {
      const snap = await discover({
        home: box.home, mode: 'actual', harness: 'claude-cli', runProbes: true, platform: 'win32',
        binaries: executableCandidates(box.home, searchPath, 'claude', 'win32', box.env),
        apps: appCandidates(box.home, 'claude', 'win32', box.env),
      });
      assert.deepEqual([snap.detection, snap.probe.version, isPresent(snap)], ['Installed', '2.1.329', true]);
    }
  } finally { await box.cleanup(); }
});

test('Windows install places are searched even when absent from PATH: npm global, .local\\bin, WinGet Links and Scoop shims', async () => {
  const box = await winBox();
  try {
    const put = async (path: string, body: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, body); };
    // codex.cmd in %APPDATA%\npm, not on PATH.
    const npmCodex = join(box.appData, 'npm', 'codex.cmd');
    await put(npmCodex, '@echo codex-cli 0.165.0\r\n');
    assert.equal((await findBinary('codex-cli', box.home, '', 'win32', box.env))?.binary, npmCodex);
    // Also found when APPDATA is unset (falls back to home\AppData\Roaming\npm).
    assert.equal((await findBinary('codex-cli', box.home, '', 'win32', { PATHEXT: WIN_PATHEXT }))?.binary, npmCodex);
    // claude.exe in %USERPROFILE%\.local\bin, copilot.exe in WinGet Links, opencode.exe in Scoop shims.
    const localClaude = join(box.home, '.local', 'bin', 'claude.exe');
    const wingetCopilot = join(box.local, 'Microsoft', 'WinGet', 'Links', 'copilot.exe');
    const scoopOpenCode = join(box.home, 'scoop', 'shims', 'opencode.exe');
    await put(localClaude, 'exe');
    await put(wingetCopilot, 'exe');
    await put(scoopOpenCode, 'exe');
    assert.equal((await findBinary('claude-cli', box.home, '', 'win32', box.env))?.binary, localClaude);
    assert.equal((await findBinary('copilot-cli', box.home, '', 'win32', box.env))?.binary, wingetCopilot);
    assert.equal((await findBinary('opencode-cli', box.home, '', 'win32', box.env))?.binary, scoopOpenCode);
    // Antigravity is left to PATH (no measured Windows folder); agy comes before antigravity.
    const agyBin = join(box.dir, 'agy-bin');
    await put(join(agyBin, 'antigravity.exe'), 'exe');
    assert.equal((await findBinary('antigravity-cli', box.home, agyBin, 'win32', box.env))?.binary, join(agyBin, 'antigravity.exe'));
    await put(join(agyBin, 'agy.exe'), 'exe');
    assert.equal((await findBinary('antigravity-cli', box.home, agyBin, 'win32', box.env))?.binary, join(agyBin, 'agy.exe'));
    // A 50-folder machine PATH before a user install folder still reaches the user's folder on Windows, while a 150-folder PATH stays bounded at 120.
    const fiftyMachine = [...Array.from({ length: 50 }, (_, i) => `C:\\Machine\\dir-${i}`), 'C:\\Users\\x\\custom-tools'].join(';');
    const reached = executableCandidates('C:\\Users\\x', fiftyMachine, 'codex', 'win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming', PATHEXT: '.EXE;.CMD' });
    assert.ok(reached.includes('C:\\Users\\x\\custom-tools\\codex.exe'), 'user folder after 50 machine PATH entries must not fall off the Windows bound');
    const hugePath = Array.from({ length: 150 }, (_, i) => `C:\\Tools\\dir-${i}`).join(';');
    const capped = executableCandidates('C:\\Users\\x', hugePath, 'codex', 'win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming', PATHEXT: '.EXE;.CMD' });
    assert.equal(capped.length, 120 * 2);
    assert.ok(capped.includes('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd'));
  } finally { await box.cleanup(); }
});

test('Windows PATH tolerates uppercase PATHEXT, trailing backslashes, quotes, empty entries and skips relative paths', async () => {
  const box = await winBox();
  try {
    const bin = join(box.dir, 'Program Tools');
    await mkdir(bin, { recursive: true });
    // Lower-case file here (Windows' own filesystem matches CLAUDE.EXE to claude.exe); checked uppercase on Windows below.
    await writeFile(join(bin, 'claude.exe'), '#!/bin/sh\necho "2.1.329 (Claude Code)"\n', { mode: 0o755 });
    const messy = `;"" ; ;relative-project-bin;.\\local;C:drive-relative;"${bin}\\" ;C:\\Users\\x\\extra\\;C:\\;`;
    const candidates = executableCandidates(box.home, messy, 'claude', 'win32', box.env);
    assert.ok(!candidates.some(path => path.includes('"') || path.includes('relative-project-bin') || path.includes('drive-relative')));
    assert.ok(candidates.includes('C:\\Users\\x\\extra\\claude.exe'));
    assert.ok(candidates.includes('C:\\claude.exe'));
    // Duplicates differing only by case or trailing backslash are merged.
    const dedup = executableCandidates('C:\\Users\\x', 'C:\\Tools\\bin\\;c:\\tools\\bin;"C:\\Tools\\bin"', 'claude', 'win32', { PATHEXT: '.EXE;.CMD' });
    assert.equal(dedup.filter(path => path.toLowerCase() === 'c:\\tools\\bin\\claude.exe').length, 1);

    const found = await findBinary('claude-cli', box.home, messy, 'win32', box.env);
    assert.equal(found?.binary, join(bin, 'claude.exe'));
    if (process.platform === 'win32') {
      const upper = join(box.dir, 'Upper');
      await mkdir(upper, { recursive: true });
      await writeFile(join(upper, 'CLAUDE.EXE'), 'exe');
      assert.equal((await findBinary('claude-cli', box.home, upper, 'win32', box.env))?.binary, join(upper, 'claude.exe'));
    } else {
      const snap = await discover({
        home: box.home, mode: 'actual', harness: 'claude-cli', runProbes: true, platform: 'win32',
        binaries: candidates, apps: appCandidates(box.home, 'claude', 'win32', box.env),
      });
      assert.deepEqual([snap.detection, snap.probe.version, isPresent(snap)], ['Installed', '2.1.329', true]);
    }
  } finally { await box.cleanup(); }
});

test('Presence rule holds on Windows: only %USERPROFILE%\\.codex (or leftover .config\\opencode) shows no tool', async () => {
  const box = await winBox();
  try {
    await mkdir(join(box.home, '.codex', 'skills', 'demo'), { recursive: true });
    await writeFile(join(box.home, '.codex', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo.\n---\nBody.\n');
    await mkdir(join(box.home, '.config', 'opencode'), { recursive: true });
    await writeFile(join(box.home, '.config', 'opencode', 'opencode.jsonc'), '{}\n');
    await mkdir(join(box.appData, 'ai.opencode.desktop'), { recursive: true });

    const codex = await discover({
      home: box.home, mode: 'actual', harness: 'codex-cli', runProbes: true, platform: 'win32',
      binaries: executableCandidates(box.home, '', 'codex', 'win32', box.env),
      apps: appCandidates(box.home, 'codex', 'win32', box.env),
    });
    const opencode = await discover({
      home: box.home, mode: 'actual', harness: 'opencode-cli', runProbes: true, platform: 'win32',
      binaries: executableCandidates(box.home, '', 'opencode', 'win32', box.env),
      apps: appCandidates(box.home, 'opencode', 'win32', box.env),
    });
    assert.equal(codex.detection, 'Config found but app not detected');
    assert.equal(opencode.detection, 'Config found but app not detected');
    assert.deepEqual([isPresent(codex), isPresent(opencode)], [false, false]);
    assert.deepEqual(presentTools([codex, opencode]), []);
  } finally { await box.cleanup(); }
});

test('Windows desktop apps with no CLI make their tool App only (pi-gui) and appear under Also on this computer (T3 Code)', async () => {
  const box = await winBox();
  try {
    // pi-gui installed under %LOCALAPPDATA%\Programs\@pi-guidesktop (electron-builder NSIS per-user layout), with no Pi CLI.
    const piGui = join(box.local, 'Programs', '@pi-guidesktop');
    await asar(join(piGui, 'resources', 'app.asar'), '0.4.0');
    const pi = await discover({
      home: box.home, mode: 'actual', harness: 'pi-cli', runProbes: true, platform: 'win32',
      binaries: executableCandidates(box.home, '', 'pi', 'win32', box.env),
      apps: appCandidates(box.home, 'pi', 'win32', box.env),
    });
    assert.equal(pi.detection, 'App only');
    assert.equal(isPresent(pi), true);
    assert.equal(pi.probe.state, 'missing');
    assert.deepEqual(pi.app, { name: 'pi-gui (third-party)', version: '0.4.0', carries: 'Pi' });

    // Even a desktop app folder without an app.asar still marks the tool App only.
    await rm(join(piGui, 'resources'), { recursive: true, force: true });
    const piNoAsar = await discover({
      home: box.home, mode: 'actual', harness: 'pi-cli', runProbes: true, platform: 'win32',
      binaries: executableCandidates(box.home, '', 'pi', 'win32', box.env),
      apps: appCandidates(box.home, 'pi', 'win32', box.env),
    });
    assert.equal(piNoAsar.detection, 'App only');
    assert.deepEqual(piNoAsar.app, { name: 'pi-gui (third-party)', carries: 'Pi' });

    // T3 Code under %LOCALAPPDATA%\Programs\t3code shows under Also on this computer with its version; absent when uninstalled.
    const noOthers = await findOtherApps(box.home, 'win32', box.env);
    assert.deepEqual(noOthers, []);
    await asar(join(box.local, 'Programs', 't3code', 'resources', 'app.asar'), '0.1.9-nightly.20261110.4478');
    const others = await findOtherApps(box.home, 'win32', box.env);
    assert.equal(others.length, 1);
    assert.equal(others[0].name, 'T3 Code');
    assert.equal(others[0].version, '0.1.9-nightly.20261110.4478');

    // A relocated LOCALAPPDATA (outside home) is honored for Claude desktop, ChatGPT desktop, pi-gui and T3 Code.
    const relocated = { LOCALAPPDATA: 'D:\\LocalData', ProgramFiles: 'D:\\Programs' };
    assert.equal(appCandidates('C:\\Users\\x', 'claude', 'win32', relocated)[0].app, 'D:\\LocalData\\Microsoft\\WindowsApps\\Claude_pzs8sxrjxfjjc');
    assert.equal(appCandidates('C:\\Users\\x', 'codex', 'win32', relocated)[0].app, 'D:\\LocalData\\Microsoft\\WindowsApps\\OpenAI.Codex_2p2nqsd0c76g0');
    assert.equal(appCandidates('C:\\Users\\x', 'pi', 'win32', relocated)[0].app, 'D:\\LocalData\\Programs\\@pi-guidesktop');
    assert.equal(appCandidates('C:\\Users\\x', 'copilot', 'win32', relocated)[1].app, 'D:\\Programs\\GitHub Copilot');
    assert.equal(otherAppCandidates('C:\\Users\\x', 'win32', relocated)[0].apps[0].app, 'D:\\LocalData\\Programs\\t3code');
    // Windows candidates never include macOS's system /Applications folder, so running on a Mac with ChatGPT.app never leaks it.
    assert.ok(appCandidates(box.home, 'codex', 'win32', {}).every(c => !c.app.startsWith('/Applications')), 'win32 appCandidates must not include /Applications');
    assert.ok(otherAppCandidates(box.home, 'win32', {}).every(o => o.apps.every(a => !a.app.startsWith('/Applications'))), 'win32 otherAppCandidates must not include /Applications');
  } finally { await box.cleanup(); }
});

test('macOS and Linux candidate lists, order and desktop app places are unchanged', { skip: process.platform === 'win32' }, () => {
  const home = '/Users/fixture';
  const path = '/opt/custom/bin:/usr/bin:relative-bin:/Users/fixture/.nvm/bin';
  const env: NodeJS.ProcessEnv = { PATHEXT: WIN_PATHEXT };
  for (const platform of ['darwin', 'linux'] as const) {
    assert.deepEqual(executableCandidates(home, path, 'claude', platform, env), [
      '/Users/fixture/.local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/custom/bin/claude',
      '/Users/fixture/.nvm/bin/claude',
    ], `${platform} claude candidates`);
    assert.deepEqual(executableCandidates(home, '/opt/custom/bin', 'pi', platform, env), [
      '/Users/fixture/.local/bin/pi',
      '/opt/homebrew/bin/pi',
      '/usr/local/bin/pi',
      '/usr/bin/pi',
      '/opt/custom/bin/pi',
      '/Users/fixture/.pi/agent/bin/pi',
    ], `${platform} pi appends .pi/agent/bin/pi`);
    assert.deepEqual(executableCandidates(home, '/opt/custom/bin', 'opencode', platform, env), [
      '/Users/fixture/.opencode/bin/opencode',
      '/Users/fixture/.local/bin/opencode',
      '/opt/homebrew/bin/opencode',
      '/usr/local/bin/opencode',
      '/usr/bin/opencode',
      '/opt/custom/bin/opencode',
    ], `${platform} opencode prepends .opencode/bin/opencode`);
    assert.deepEqual(executableCandidates(home, '', 'agy', platform, env), [
      '/Users/fixture/.local/bin/agy',
      '/opt/homebrew/bin/agy',
      '/usr/local/bin/agy',
      '/usr/bin/agy',
      '/Users/fixture/.local/bin/antigravity',
      '/opt/homebrew/bin/antigravity',
      '/usr/local/bin/antigravity',
      '/usr/bin/antigravity',
    ], `${platform} agy before antigravity`);
    assert.deepEqual(
      executableCandidates(home, path, 'claude', platform, { ...env, CK_TEST_HOME_ONLY: 'claude' }),
      ['/Users/fixture/.local/bin/claude', '/Users/fixture/.nvm/bin/claude'],
      `${platform} CK_TEST_HOME_ONLY`,
    );
    const fiftyPosix = Array.from({ length: 50 }, (_, i) => `/opt/dir-${i}`).join(':');
    assert.equal(executableCandidates(home, fiftyPosix, 'claude', platform, env).length, 40, `${platform} bound unchanged at 40`);
  }
  assert.deepEqual(appCandidates(home, 'pi', 'darwin', env).map(c => c.app), [
    '/Users/fixture/Applications/pi-gui.app',
    '/Applications/pi-gui.app',
  ]);
  assert.deepEqual(appCandidates(home, 'claude', 'linux', env).map(c => c.app), [
    '/usr/lib/claude-desktop',
    '/Users/fixture/Applications/Claude.app',
    '/Applications/Claude.app',
  ]);
  assert.deepEqual(otherAppCandidates(home, 'darwin', env).map(o => [o.name, o.apps.map(a => a.app)]), [
    ['T3 Code', [
      '/Users/fixture/Applications/T3 Code.app',
      '/Users/fixture/Applications/T3 Code (Nightly).app',
      '/Users/fixture/Applications/T3 Code (Alpha).app',
      '/Applications/T3 Code.app',
      '/Applications/T3 Code (Nightly).app',
      '/Applications/T3 Code (Alpha).app',
    ]],
    ['VS Code', [
      '/Users/fixture/Applications/Visual Studio Code.app',
      '/Users/fixture/Applications/Visual Studio Code - Insiders.app',
      '/Applications/Visual Studio Code.app',
      '/Applications/Visual Studio Code - Insiders.app',
    ]],
  ]);
  assert.deepEqual(otherAppCandidates(home, 'linux', env), otherAppCandidates(home, 'darwin', env));
});
