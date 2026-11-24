// Helper for .github/workflows/windows.yml: packages the Windows preview and runs its --smoke-test (--smoke), and runs
// the advisory unit test files not yet on tests/windows-strict.txt (--advisory <outDir>), streaming full.log to disk as
// it goes and combining strict.log's counts with the advisory run into summary.txt. Strict unit tests run directly via
// `node --test` in windows.yml (no wrapper here); windows.yml omits continue-on-error on strict steps and sets it here.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lineApp } from '../src/updates.ts';
import { packageFolder, plainly } from './package-app.mjs';

const root = join(import.meta.dirname, '..');
const STRICT_LIST = 'tests/windows-strict.txt';
const ANSI = /\x1b\[[0-9;]*m/g;
const STAT_KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];

const strictSet = () => new Set(
  readFileSync(join(root, STRICT_LIST), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#')),
);

/** Packages the standard Windows x64 preview (no release tag) and proves its --smoke-test passes. */
async function runSmoke() {
  if (process.platform !== 'win32') plainly('The Windows smoke test runs only on Windows.');
  process.chdir(root);
  const t0 = Date.now();
  const own = lineApp(undefined);
  const folder = await packageFolder({ own, tag: undefined, platform: 'win32', arch: 'x64' });
  const exe = resolve(root, folder, `${own.name}.exe`);
  if (!existsSync(exe)) plainly(`Packaged executable missing: ${exe}`);
  console.log(`Packaged ${folder} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const t1 = Date.now();
  const result = spawnSync(exe, ['--smoke-test'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  const out = (result.stdout ?? '').replace(/\r/g, '');
  const passLine = out.split('\n').map(line => line.trim()).find(line => {
    try { return JSON.parse(line)?.smoke === 'pass'; } catch { return false; }
  });
  if (result.error || result.status !== 0 || !passLine) {
    console.error(`Smoke test failed (status=${result.status}, error=${result.error?.message ?? 'none'}).`);
    if (out.trim()) console.error(`stdout:\n${out.trim()}`);
    if (result.stderr?.trim()) console.error(`stderr:\n${result.stderr.trim()}`);
    process.exit(result.status || 1);
  }
  console.log(`Smoke test passed in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${passLine}`);
}

/** Extracts totals, skips, failures, and cancellations from a single `node --test` output log. */
function scanLog(text) {
  const lines = text ? text.replace(ANSI, '').replace(/\r/g, '').split('\n') : [];
  const sums = new Map();
  const skipped = [];
  const failed = [];
  const cancelled = [];
  for (const line of lines) {
    const stat = /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/.exec(line);
    if (stat) sums.set(stat[1], (sums.get(stat[1]) ?? 0) + Number(stat[2]));
    const skip = /^\s*﹣ (.+?)(?: \([\d.]+m?s\))? # (.+)$/.exec(line);
    if (skip) skipped.push({ name: skip[1].trim(), reason: skip[2].trim() });
  }
  const failIndex = lines.findIndex(line => line.trim() === '✖ failing tests:');
  if (failIndex !== -1) {
    for (let i = failIndex + 1; i < lines.length; i++) {
      const at = /^test at (.+)$/.exec(lines[i].trim());
      if (!at) continue;
      const loc = at[1].replace(/\\/g, '/');
      const file = loc.replace(/:\d+:\d+$/, '');
      const name = (lines[i + 1] ?? '').trim().replace(/^✖ /, '').replace(/ \([\d.]+m?s\)$/, '');
      let error = '';
      for (let j = i + 2; j < lines.length; j++) {
        const lineText = lines[j].trim();
        if (/^test at /.test(lineText)) break;
        if (!lineText) continue;
        error = error ? `${error} ${lineText}` : lineText;
        if (!lineText.endsWith(':')) break;
      }
      if (error.includes('was cancelled')) cancelled.push({ file, loc, name, error });
      else failed.push({ file, loc, name, error });
    }
  }
  const hasTotals = (sums.get('tests') ?? 0) > 0;
  return { lines, sums, hasTotals, skipped, failed, cancelled };
}

/** Parses one or two `node --test` logs (strict + advisory) into one combined summary report. */
export function parseUnitLog(raw, exitCode, strictRaw = '', strictFiles = undefined) {
  const strictParsed = scanLog(strictRaw);
  const advisoryParsed = scanLog(raw);
  const sums = new Map();
  for (const parsed of [strictParsed, advisoryParsed]) {
    for (const [key, value] of parsed.sums.entries()) {
      sums.set(key, (sums.get(key) ?? 0) + value);
    }
  }
  const skipped = [...strictParsed.skipped, ...advisoryParsed.skipped];
  const failed = [...strictParsed.failed, ...advisoryParsed.failed];
  const cancelled = [...strictParsed.cancelled, ...advisoryParsed.cancelled];
  const byFile = new Map();
  for (const entry of failed) {
    const rec = byFile.get(entry.file) ?? { fail: 0, cancel: 0 };
    rec.fail++;
    byFile.set(entry.file, rec);
  }
  for (const entry of cancelled) {
    const rec = byFile.get(entry.file) ?? { fail: 0, cancel: 0 };
    rec.cancel++;
    byFile.set(entry.file, rec);
  }
  const allFiles = readdirSync(join(root, 'tests'))
    .filter(file => file.endsWith('.test.ts'))
    .sort()
    .map(file => `tests/${file}`);
  const strictUsed = strictFiles !== undefined
    ? new Set(strictFiles)
    : strictRaw
      ? strictSet()
      : new Set();
  const strictAll = allFiles.filter(file => strictUsed.has(file));
  const advisoryAll = allFiles.filter(file => !strictUsed.has(file));
  // Mark a file clean only when the step that owns it finished and emitted totals; otherwise report it as not run.
  const ran = new Set();
  if (strictParsed.hasTotals) {
    for (const file of strictAll) ran.add(file);
  }
  if (advisoryParsed.hasTotals) {
    for (const file of advisoryAll) ran.add(file);
  }
  const cleanFiles = allFiles.filter(file => ran.has(file) && !byFile.has(file));
  const notRunFiles = allFiles.filter(file => !ran.has(file) && !byFile.has(file));
  const out = [`Advisory unit test exit: ${exitCode}`];
  if (sums.size) {
    out.push('', '## Totals');
    for (const key of STAT_KEYS) {
      if (sums.has(key)) out.push(`ℹ ${key} ${key === 'duration_ms' ? sums.get(key).toFixed(1) : sums.get(key)}`);
    }
  }
  if (!advisoryParsed.hasTotals && advisoryAll.length > 0) {
    const preSummary = advisoryParsed.lines.filter(Boolean).slice(0, 30);
    if (!sums.size) out.push('', '## Output (before node --test summary)', ...preSummary);
    else if (preSummary.length) out.push('', '## Output (advisory, before node --test summary)', ...preSummary);
  }
  if (byFile.size) {
    out.push('', `## Files with failures (${byFile.size} of ${allFiles.length})`);
    for (const [file, rec] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`- ${file}: ${rec.fail} failed${rec.cancel ? `, ${rec.cancel} cancelled` : ''}`);
    }
  }
  if (cleanFiles.length) {
    out.push('', `## Clean files (${cleanFiles.length} of ${allFiles.length})`, cleanFiles.join('\n'));
  }
  if (notRunFiles.length) {
    out.push('', `## Not run (${notRunFiles.length} of ${allFiles.length})`, notRunFiles.join('\n'));
  }
  if (failed.length) {
    out.push('', `## Failing tests (${failed.length})`);
    for (const entry of failed) out.push(`- ${entry.loc} | ${entry.name} :: ${entry.error}`);
  }
  if (cancelled.length) {
    out.push('', `## Cancelled tests (${cancelled.length})`);
    for (const entry of cancelled) out.push(`- ${entry.loc} | ${entry.name}`);
  }
  if (skipped.length) {
    out.push('', `## Skipped tests (${skipped.length})`);
    for (const entry of skipped) out.push(`- ${entry.name} [${entry.reason}]`);
  }
  return `${out.join('\n')}\n`;
}

/** Runs only test files not on tests/windows-strict.txt, streaming full.log to disk, and writes combined summary.txt. */
function runAdvisory(outDir) {
  if (!outDir) plainly('Usage: node scripts/windows-check.mjs --advisory <outDir>');
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const strict = strictSet();
  const strictLog = join(dir, 'strict.log');
  const strictRaw = existsSync(strictLog) ? readFileSync(strictLog, 'utf8') : '';
  const rest = readdirSync(join(root, 'tests'))
    .filter(file => file.endsWith('.test.ts'))
    .sort()
    .map(file => `tests/${file}`)
    .filter(file => !strict.has(file));
  const finish = (raw, code) => {
    const exitCode = code ?? 1;
    const summary = parseUnitLog(raw, exitCode, strictRaw, strict);
    writeFileSync(join(dir, 'summary.txt'), summary);
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${summary}\`\`\`\n`);
    }
    process.exit(exitCode);
  };
  if (!rest.length) {
    writeFileSync(join(dir, 'full.log'), '');
    finish('', 0);
    return;
  }
  const t0 = Date.now();
  const fd = openSync(join(dir, 'full.log'), 'w');
  const chunks = [];
  console.log(`Running ${rest.length} advisory unit test files (excluding ${strict.size} strict files)`);
  const child = spawn(process.execPath, ['--test', ...rest], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = chunk => {
    chunks.push(chunk);
    writeSync(fd, chunk);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  let done = false;
  const end = code => {
    if (done) return;
    done = true;
    closeSync(fd);
    console.log(`Advisory unit tests finished in ${((Date.now() - t0) / 1000).toFixed(1)}s (exit ${code ?? 1})`);
    finish(Buffer.concat(chunks).toString('utf8'), code);
  };
  // Guard against an orphaned grandchild keeping stdout/stderr pipes open after node exits on Windows.
  child.on('exit', code => setTimeout(() => end(code), 3000).unref());
  child.on('close', end);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === '--smoke') await runSmoke();
  else if (mode === '--advisory') runAdvisory(arg);
  else plainly('Usage: node scripts/windows-check.mjs <--smoke|--advisory <outDir>>');
}
