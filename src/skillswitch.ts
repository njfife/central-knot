// Disabling a standalone skill in one tool with that tool's own switch (capability data, Appendix B; ENB-01, ENB-02).
// The copy stays where it is and keeps receiving updates; the tool just doesn't load it. Each tool keeps its switch in its own
// user-wide settings file, which is edited in place: only the switch changes, every other byte stays as it was.
//   Claude Code  settings.json   "skillOverrides": { "<folder>": "off" }   (keyed by folder: Claude names a skill after it)
//   Copilot CLI  settings.json   "disabledSkills": ["<name>"]              (what `copilot skill disable` writes; by name)
//   Codex        config.toml     [[skills.config]] path = "<…/SKILL.md>" enabled = false   (by path: a name rule would hit every same-name skill)
//   Pi           settings.json   "skills": ["-skills/<folder>/SKILL.md"]   (the exact exclusion `pi config` writes)
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { configRoot, harnesses } from './harnesses.ts';
import { errorCode, writeFileChecked, type ShareContext } from './share.ts';
import { readTomlTables, setJsonMember, tableEnd, tomlValue } from './textedit.ts';
import type { HarnessId, SkillFacts } from './types.ts';

/** One tool's copy of a skill, as its switch names it. */
export interface SwitchTarget { folder: string; name: string; /** Absolute path to the copy's SKILL.md (where it is, or where it will be written). */ skillFile: string }

/**
 * How a tool's switch names its copy of a skill: the copy's folder, the skill's name as the tool reads it (its own `name`, else the
 * folder), and its SKILL.md.
 */
export const targetOf = (copy: { folder: string; directory: string; name?: string }): SwitchTarget => ({ folder: copy.folder, name: copy.name ?? copy.folder, skillFile: join(copy.directory, 'SKILL.md') });

/** Why a switch failed when its file, read back, doesn't say what was written. */
export const notTaken = (tool: HarnessId) => `${harnesses[tool].name}’s settings did not take the change.`;

/** One tool's switch file as read: its text ('' when there is none yet), or why it can't be used. */
export interface SwitchFile { path: string; text: string; exists: boolean; problem?: string }

/**
 * What an item's facts say about its tools' switches, from each tool's switch file as read: the tools that have it off, and the
 * tools whose file can't be used (why, and which file). Skills and MCP servers both use it, each with its own `isOff`.
 */
export function switchFacts(tools: HarnessId[], switches: Map<HarnessId, SwitchFile>, isOff: (tool: HarnessId, file: SwitchFile) => boolean): Pick<SkillFacts, 'disabled' | 'switchProblem' | 'switchFile'> {
  const facts: Pick<SkillFacts, 'disabled' | 'switchProblem' | 'switchFile'> = {};
  for (const tool of tools) {
    const file = switches.get(tool);
    if (!file) continue;
    if (file.problem) { (facts.switchProblem ??= {})[tool] = file.problem; (facts.switchFile ??= {})[tool] = file.path; }
    else if (isOff(tool, file)) (facts.disabled ??= []).push(tool);
  }
  return facts;
}

const rootOf = (context: ShareContext, tool: HarnessId) => configRoot(harnesses[tool], context.home, context.overrides?.[tool]);

/** The file that holds a tool's skill switches. */
export const switchPath = (context: ShareContext, tool: HarnessId) => join(rootOf(context, tool), tool === 'codex-cli' ? 'config.toml' : 'settings.json');

/** Reads a tool's switch file. A file that can't be read, or isn't the JSON or TOML expected, is reported and never written. */
export async function readSwitchFile(context: ShareContext, tool: HarnessId): Promise<SwitchFile> {
  return readSettingsFile(switchPath(context, tool), text => switchState(context, tool, text, { folder: '', name: '', skillFile: '' }), `Disable can’t be used in ${harnesses[tool].name}`);
}

/**
 * Reads a settings file a switch lives in (skills' here, MCP servers' in mcpswitch.ts): '' when there is none yet. A file that
 * can't be read, or that `check` throws on (not the tool's format), comes with a problem ending in `consequence`, and is never written.
 * Only the skill check throws CK_FORM (skill rules in a form not edited here); the MCP check fails only on a file that doesn't parse.
 */
export async function readSettingsFile(path: string, check: (text: string) => void, consequence: string): Promise<SwitchFile> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { path, text: '', exists: false } : { path, text: '', exists: true, problem: `${path} could not be read, so ${consequence}.` };
  }
  try { check(text); }
  catch (error) {
    const why = errorCode(error) === 'CK_FORM' ? 'lists skill rules in a form Central Knot doesn’t edit' : `could not be read as ${path.endsWith('.toml') ? 'TOML' : 'JSON'}`;
    return { path, text, exists: true, problem: `${path} ${why}, so ${consequence}.` };
  }
  return { path, text, exists: true };
}

/** Whether a tool's switch file turns this copy off. Throws when the file can't be read as the tool's format. */
export function isDisabled(context: ShareContext, tool: HarnessId, file: SwitchFile, target: SwitchTarget): boolean {
  return !file.problem && switchState(context, tool, file.text, target);
}

/**
 * Turns one tool's copy of a skill on or off, then reads the file back to confirm the tool will see it that way. Writes only
 * over the text it read (a save made meanwhile is never overwritten) and only when something changes. Throws with a plain reason.
 */
export async function setDisabled(context: ShareContext, tool: HarnessId, target: SwitchTarget, disabled: boolean): Promise<void> {
  const file = await readSwitchFile(context, tool);
  if (file.problem) throw new Error(file.problem);
  if (switchState(context, tool, file.text, target) === disabled) return;
  await writeFileChecked(file.path, withSwitch(context, tool, file.text, target, disabled), file.exists ? file.text : undefined);
  if (switchState(context, tool, await readFile(file.path, 'utf8'), target) !== disabled) throw new Error(notTaken(tool));
}

// ---------- Each tool's form ----------

/** A settings file's JSON object ({} for an empty file). Throws when it is not one. */
export const parseJson = (text: string): Record<string, unknown> => {
  if (!text.trim()) return {};
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not a JSON object.');
  return value as Record<string, unknown>;
};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Pi's exact forms for a copy: relative to its agent folder (how `pi config` writes it) and absolute, for the file and its folder. */
function piForms(target: SwitchTarget, config: string): { written: string; all: Set<string> } {
  const posix = (path: string) => path.split(sep).join('/');
  const inside = !relative(config, target.skillFile).startsWith('..') && !isAbsolute(relative(config, target.skillFile));
  const file = posix(target.skillFile);
  const folder = file.replace(/\/SKILL\.md$/, '');
  const rel = posix(relative(config, target.skillFile));
  const forms = [file, folder, ...(inside ? [rel, rel.replace(/\/SKILL\.md$/, '')] : [])];
  return { written: inside ? rel : file, all: new Set(forms) };
}
/** Whether a Pi `skills` entry is a +, - or ! pattern naming exactly this copy (`./` and `~/` resolved as Pi resolves them). */
const piNames = (entry: unknown, forms: Set<string>, home: string, signs = /^[+!-]/) => typeof entry === 'string' && signs.test(entry) && forms.has(piPath(entry, home));
const piPath = (entry: string, home: string) => {
  const path = entry.replace(/^[+!-]/, '').replace(/^\.\//, '');
  return path.startsWith('~/') ? join(home, path.slice(2)).split(sep).join('/') : isAbsolute(path) ? path.split(sep).join('/') : path;
};

const formError = () => Object.assign(new Error('Skill rules in a form not edited here.'), { code: 'CK_FORM' });

/** The Codex `[[skills.config]]` entries in order, last winning. Throws on a skills list Central Knot doesn't edit. */
function codexRules(text: string) {
  const tables = readTomlTables(text);
  for (const table of tables) {
    const nested = table.path[0] === 'skills' && table.path[1] === 'config' && table.path.length === 2;
    if (nested && !table.array) throw formError();
    for (const entry of table.entries) {
      const path = [...table.path, ...entry.keys];
      if (path[0] === 'skills' && (path.length === 1 || path[1] === 'config') && !(nested && table.array)) throw formError();
    }
  }
  return tables.filter(table => table.array && table.path.length === 2 && table.path[0] === 'skills' && table.path[1] === 'config').map(table => {
    const value = (key: string) => table.entries.find(entry => entry.key === key)?.value;
    return { table, path: value('path'), name: value('name'), enabled: value('enabled') };
  });
}

/** Whether the text turns this copy off. Throws when the text isn't the tool's format. */
export function switchState(context: ShareContext, tool: HarnessId, text: string, target: SwitchTarget): boolean {
  switch (tool) {
    case 'claude-cli': { const overrides = parseJson(text).skillOverrides; return !!overrides && typeof overrides === 'object' && (overrides as Record<string, unknown>)[target.folder] === 'off'; }
    case 'copilot-cli': return list(parseJson(text).disabledSkills).includes(target.name);
    case 'codex-cli': {
      const rules = codexRules(text).filter(rule => rule.path === target.skillFile || rule.name === target.name);
      return rules.at(-1)?.enabled === false;
    }
    case 'pi-cli': {
      const forms = piForms(target, rootOf(context, tool)).all;
      return list(parseJson(text).skills).some(entry => piNames(entry, forms, context.home, /^[-!]/));
    }
  }
}

/** The text with this copy turned on or off. Only the switch changes. */
export function withSwitch(context: ShareContext, tool: HarnessId, text: string, target: SwitchTarget, disabled: boolean): string {
  switch (tool) {
    case 'claude-cli': return setJsonMember(text, ['skillOverrides', target.folder], disabled ? 'off' : undefined);
    case 'copilot-cli': {
      const others = list(parseJson(text).disabledSkills).filter(name => name !== target.name);
      return setJsonMember(text, ['disabledSkills'], disabled ? [...others, target.name] : others);
    }
    case 'codex-cli': {
      // This copy's own path rules go; one new rule at the end decides, since the last matching rule wins.
      const mine = codexRules(text).filter(rule => rule.path === target.skillFile);
      let out = '';
      let cursor = 0;
      // The blank line that separated a removed rule goes with it.
      for (const rule of mine) { out += text.slice(cursor, rule.table.start).replace(/\n\n$/, '\n'); cursor = tableEnd(text, rule.table); }
      out += text.slice(cursor);
      // Turning on needs a rule only while a name rule still turns it off.
      if (!disabled && !switchState(context, tool, out, target)) return out;
      return `${out}${out && !out.endsWith('\n') ? '\n' : ''}${out.trim() ? '\n' : ''}[[skills.config]]\npath = ${tomlValue(target.skillFile)}\nenabled = ${!disabled}\n`;
    }
    case 'pi-cli': {
      const { written, all } = piForms(target, rootOf(context, tool));
      const kept = list(parseJson(text).skills).filter(entry => !piNames(entry, all, context.home));
      return setJsonMember(text, ['skills'], disabled ? [...kept, `-${written}`] : kept);
    }
  }
}
