// Runner for .github/workflows/windows.yml: packages the Windows preview and runs its --smoke-test (--smoke), runs the
// named set of unit test files that must pass on Windows (--strict, reading tests/windows-strict.txt), and runs the whole
// `npm test` to produce the advisory artifact (--advisory <outDir>: summary with counts, failing tests' names and first error
// lines, skipped tests with reasons, plus full raw log). Does not decide pass/fail of the workflow job: windows.yml omits
// continue-on-error on the strict steps and sets continue-on-error: true on the advisory step.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lineApp } from '../src/updates.ts';
import { packageFolder, plainly } from './package-app.mjs';

const root = join(import.meta.dirname, '..');
const STRICT_LIST = 'tests/windows-strict.txt';
const ANSI = /\x1b\[[0-9;]*m/g;

/** Reads the strict Windows test list: one `tests/*.test.ts` path per line, ignoring comments and blank lines. */
function strictFiles() {
  const lines = readFileSync(join(root, STRICT_LIST), 'utf8').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!lines.length) plainly(`${STRICT_LIST} lists no test files.`);
  for (const file of lines) if (!existsSync(join(root, file))) plainly(`${STRICT_LIST} names missing file: ${file}`);
  return lines;
}

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

/** Runs the named strict Windows unit test files; fails on any failure. */
function runStrict() {
  const files = strictFiles();
  console.log(`Running ${files.length} strict unit test files from ${STRICT_LIST}`);
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  if (result.error) plainly(`Could not run strict unit tests: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

/** Parses `npm test` (tsc + node --test spec reporter) output into a concise summary report. */
export function parseUnitLog(raw, exitCode) {
  const clean = raw.replace(ANSI, '').replace(/\r/g, '');
  const lines = clean.split('\n');
  const totals = lines.filter(line => /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line));
  const skipped = [];
  for (const line of lines) {
    const match = /^\s*﹣ (.+?)(?: \([\d.]+m?s\))? # (.+)$/.exec(line);
    if (match) skipped.push({ name: match[1].trim(), reason: match[2].trim() });
  }
  const failIndex = lines.findIndex(line => line.trim() === '✖ failing tests:');
  const failed = [], cancelled = [];
  if (failIndex !== -1) {
    for (let i = failIndex + 1; i < lines.length; i++) {
      const at = /^test at (.+)$/.exec(lines[i].trim());
      if (!at) continue;
      const loc = at[1].replace(/\\/g, '/');
      const file = loc.replace(/:\d+:\d+$/, '');
      const nameLine = (lines[i + 1] ?? '').trim();
      const name = nameLine.replace(/^✖ /, '').replace(/ \([\d.]+m?s\)$/, '');
      let error = '';
      for (let j = i + 2; j < lines.length; j++) {
        if (/^test at /.test(lines[j].trim())) break;
        const text = lines[j].trim();
        if (!text) continue;
        if (!error) { error = text; if (!text.endsWith(':')) break; }
        else { error = `${error} ${text}`; break; }
      }
      const entry = { file, loc, name, error };
      if (error.includes('was cancelled')) cancelled.push(entry);
      else failed.push(entry);
    }
  }
  const byFile = new Map();
  for (const entry of failed) { const rec = byFile.get(entry.file) ?? { fail: 0, cancel: 0 }; rec.fail++; byFile.set(entry.file, rec); }
  for (const entry of cancelled) { const rec = byFile.get(entry.file) ?? { fail: 0, cancel: 0 }; rec.cancel++; byFile.set(entry.file, rec); }
  const allFiles = readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.ts')).sort().map(f => `tests/${f}`);
  const cleanFiles = totals.length ? allFiles.filter(f => !byFile.has(f)) : [];

  const out = [`Advisory npm test exit: ${exitCode}`];
  if (totals.length) out.push('', '## Totals', ...totals);
  else out.push('', '## Output (before node --test summary)', ...lines.filter(Boolean).slice(0, 30));
  if (byFile.size) {
    out.push('', `## Files with failures (${byFile.size} of ${allFiles.length})`);
    for (const [file, rec] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`- ${file}: ${rec.fail} failed${rec.cancel ? `, ${rec.cancel} cancelled` : ''}`);
    }
  }
  if (cleanFiles.length) {
    out.push('', `## Clean files (${cleanFiles.length} of ${allFiles.length})`, cleanFiles.join('\n'));
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

/** Runs `npm test` whole, writes full.log and summary.txt into `outDir`, and exits with `npm test`'s exit code. */
function runAdvisory(outDir) {
  if (!outDir) plainly('Usage: node scripts/windows-check.mjs --advisory <outDir>');
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm test'] : ['test'];
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => chunks.push(chunk));
  child.on('close', code => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const exitCode = code ?? 1;
    const summary = parseUnitLog(raw, exitCode);
    writeFileSync(join(dir, 'full.log'), raw);
    writeFileSync(join(dir, 'summary.txt'), summary);
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${summary}\`\`\`\n`);
    process.exit(exitCode);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === '--smoke') await runSmoke();
  else if (mode === '--strict') runStrict();
  else if (mode === '--advisory') runAdvisory(arg);
  else plainly('Usage: node scripts/windows-check.mjs <--smoke|--strict|--advisory <outDir>>');
}
