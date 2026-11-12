// Real-home two-way trial, for a machine the owner has opened for testing (Nathan's Mac). Run from the checkout:
//   node scripts/real-home-trial.ts
// It backs up the skills folders, runs the skills kind (src/skills.ts) with the app's own identity on a disposable skill
// (ck-trial), checks every other skill, link and the .agents folder stay byte-identical, asks real Codex and Copilot what they
// list, then deletes the skill from Central Knot.
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discovery.ts';
import { applySkills, restoreSkill } from '../src/skills.ts';
import type { Change } from '../src/types.ts';
import type { HarnessId } from '../src/types.ts';

const home = homedir();
const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const context = {
  home, mode: 'actual' as const, build: 'com.centralknot.firstlook', realHome: home, allowActualWrites: true,
  settingsPath: join(home, 'Library/Application Support/central-knot/sharing-settings.json'),
  read: () => Promise.all(tools.map(harness => discover({ home, mode: 'actual', harness }))),
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(home, `ck-real-backup-${stamp}.tgz`);
execFileSync('tar', ['czf', backup, '-C', home, ...['.claude/skills', '.copilot/skills', '.codex/skills', '.agents/skills', '.central-knot'].filter(path => { try { execFileSync('test', ['-e', join(home, path)]); return true; } catch { return false; } })]);
console.log(`backup: ${backup}`);

const roots = ['.claude/skills', '.copilot/skills', '.codex/skills', '.agents/skills'].map(root => join(home, root));
async function fingerprint() {
  const out: Record<string, string> = {};
  async function visit(dir: string) {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      // ck-trial is the disposable skill; .codex/skills/.system is Codex's own, rewritten by Codex itself when its app server starts.
      if (path.includes('/ck-trial') || path.includes('/.codex/skills/.system')) continue;
      const info = await lstat(path);
      if (entry.isSymbolicLink()) out[path] = `link:${await readlink(path)}`;
      else if (entry.isDirectory()) { out[path] = `dir:${info.mode}:${info.mtimeMs}`; await visit(path); }
      else out[path] = `file:${info.mode}:${info.mtimeMs}:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
    }
  }
  for (const root of roots) await visit(root);
  return out;
}
const body = (text: string) => `---\nname: ck-trial\ndescription: Central Knot real-home trial skill.\n---\n\n${text}\n`;
const at = (root: string) => join(home, root, 'ck-trial/SKILL.md');
const line = async (root: string) => readFile(at(root), 'utf8').then(text => text.split('\n').at(-2), () => '(none)');
const state = async () => `claude=${await line('.claude/skills')} | copilot=${await line('.copilot/skills')} | codex=${await line('.codex/skills')}`;
const say = (step: string, result: { writes?: number; notices?: { kind: string; winner: string; losers: string[] }[]; stopped?: string }) =>
  console.log(`${step}: writes=${result.writes ?? 0}${result.stopped ? ` STOPPED ${result.stopped}` : ''} ${JSON.stringify((result.notices ?? []).map(notice => `${notice.kind}:${notice.winner}>${notice.losers.join('+')}`))}`);
const pass = (changes: Change[] = []) => applySkills(context, tools, changes);
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
async function codexLists(): Promise<string> {
  return new Promise(done => {
    const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    child.stdout.on('data', chunk => { buffer += chunk; for (const text of buffer.split('\n')) { try { const message = JSON.parse(text); if (message.id === 2) { done((message.result?.data?.[0]?.skills ?? []).map((entry: { name: string }) => entry.name).filter((name: string) => name.startsWith('ck-trial')).join(',') || '(none)'); child.kill(); } } catch { /* partial */ } } });
    for (const message of [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'ck-trial', version: '0' } } }, { jsonrpc: '2.0', method: 'initialized' }, { jsonrpc: '2.0', id: 2, method: 'skills/list', params: { cwds: [home] } }]) child.stdin.write(`${JSON.stringify(message)}\n`);
    setTimeout(() => { done('(timeout)'); child.kill(); }, 20000);
  });
}

const before = await fingerprint();
say('0 catch-up', await pass());
await mkdir(join(home, '.claude/skills/ck-trial'), { recursive: true });
await writeFile(at('.claude/skills'), body('Version 1, made in Claude Code.'));
say('1 take in, On', await pass([{ key: 'ck-trial', managed: true, off: [] }]));
console.log('   ', await state());
console.log(`   Codex lists: ${await codexLists()}; Copilot lists: ${execFileSync('copilot', ['skill', 'list'], { encoding: 'utf8', timeout: 30000 }).split('\n').filter(text => text.includes('ck-trial')).join(' ').trim() || '(none)'}`);
await writeFile(at('.copilot/skills'), body('Version 2, edited in Copilot.'));
say('2 edit in Copilot', await pass());
console.log('   ', await state());
await writeFile(at('.claude/skills'), body('Version 3a, Claude.'));
await writeFile(at('.codex/skills'), body('Version 3b, Codex.'));
say('3 competing edits', await pass());
console.log('   ', await state());
await rm(join(home, '.codex/skills/ck-trial'), { recursive: true });
say('4a deleted in Codex', await pass());
await wait(2300);
const deleted = await pass();
say('4b after settling: Off everywhere', deleted);
console.log('   ', await state());
const event = deleted.notices?.find(notice => notice.kind === 'deleted') as { history: string } | undefined;
if (event) { say('5 Turn on, from History', await restoreSkill(context, tools, event.history)); console.log('   ', await state()); }
say('6 Delete from Central Knot', await pass([{ key: 'ck-trial', managed: true, off: [], deleted: true }]));
console.log('   ', await state());
say('7 quiet pass', await pass());
const after = await fingerprint();
const changed = Object.keys({ ...before, ...after }).filter(path => before[path] !== after[path]);
console.log(`everything else unchanged: ${changed.length === 0} (${Object.keys(before).length} entries)${changed.length ? ` CHANGED ${changed.slice(0, 8).join(', ')}` : ''}`);
