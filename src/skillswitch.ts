// Disabling a standalone skill in one tool with that tool's own switch (capability data, Appendix B; ENB-01, ENB-02).
// The copy stays where it is and keeps receiving updates; the tool just doesn't load it. Each tool keeps its switch in its own
// user-wide settings file, which is edited in place: only the switch changes. Every other byte stays, apart from these: the JSON
// list holding Copilot's or Pi's switches is written back as a list (same entries, JSON layout); a list or map Enable leaves empty
// goes with its last entry (and a JSON settings file that wasn't there is left as `{}`); a config.toml without a final newline
// gains one when a rule is added; a person's Codex rule with no `enabled` key keeps the `enabled` line a Disable gave it; a JSON
// settings file with Windows line ends gets plain ones in the lines added while a skill is disabled (Enable takes them out again).
//   Claude Code  settings.json   "skillOverrides": { "<folder>": "off" }   (keyed by folder: Claude names a skill after it)
//   Copilot CLI  settings.json   "disabledSkills": ["<name>"]              (what `copilot skill disable` writes; by name)
//   Codex        config.toml     [[skills.config]] path = "<…/SKILL.md>" enabled = false   (by path: a name rule would hit every same-name skill)
//   Pi           settings.json   "skills": ["-skills/<folder>/SKILL.md"]   (the exact exclusion `pi config` writes)
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { toolConfigRoot } from './harnesses.ts';
import { errorCode, plainError, storeDirectory, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { editTomlArray, readTomlTables, setJsonMember, tomlValue, type TomlTable, type TomlValue } from './textedit.ts';
import { SKILL_SWITCH_TESTED_FROM } from './pluginstatus.ts';
import type { HarnessId, SwitchProblem, SwitchTarget } from './types.ts';
export type { SwitchTarget };
import { problemText, toolName } from './words.ts';
import { compareVersions, record, withoutBom } from './values.ts';



/** One tool's switch file, read and parsed once: its text ('' when there is none yet), or why it can't be used. */
export interface SwitchFile { tool: HarnessId; path: string; text: string; exists: boolean; problem?: SwitchProblem; parsed?: ParsedSwitches }

/**
 * The lowest build of each tool where its switch was seen working (Appendix B, V-20). Below it, no new Disable is offered
 * (ENB-01, DET-03), while a copy already disabled shows as disabled and can be enabled again. An unknown build (no CLI found,
 * say only a desktop app) is not held back: the settings file is the tool's documented one either way.
 */
const VERIFIED_FROM: Record<HarnessId, string> = { 'claude-cli': '2.1.311', 'pi-cli': '1.5.0', ...SKILL_SWITCH_TESTED_FROM } as Record<HarnessId, string>;

/** Why a new Disable isn't offered for this build of a tool, if it isn't. */
export function unverifiedBuild(tool: HarnessId, version: string | undefined): string | undefined {
  if (!version) return undefined;
  // Said like a plugin skill's switch (pluginstatus.ts untestedBuild).
  return compareVersions(version, VERIFIED_FROM[tool]) < 0 ? `Not verified on this build of ${toolName(tool)} (${version}): Disable is verified from ${VERIFIED_FROM[tool]}.` : undefined;
}

/** The file that holds a tool's skill switches. */
export const switchPath = (context: ShareContext, tool: HarnessId) => join(toolConfigRoot(context, tool), tool === 'codex-cli' ? 'config.toml' : 'settings.json');

/** Reads a tool's switch file. A file that can't be read, or isn't the JSON or TOML expected, is reported and never written. */
export async function readSwitchFile(context: ShareContext, tool: HarnessId): Promise<SwitchFile> {
  const path = switchPath(context, tool);
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { tool, path, text: '', exists: false, parsed: parse(tool, '') } : { tool, path, text: '', exists: true, problem: { file: path, reason: 'can’t be read.' } };
  }
  try { return { tool, path, text, exists: true, parsed: parse(tool, text) }; }
  catch (error) {
    const reason = errorCode(error) === 'CK_FORM' ? 'writes skills.config as a value, a form Central Knot doesn’t edit.' : `isn’t valid ${tool === 'codex-cli' ? 'TOML' : 'JSON'}.`;
    return { tool, path, text, exists: true, problem: { file: path, reason } };
  }
}

/** Whether a tool's switch file turns this copy off. False for a file with a problem (which is never written). */
export function isDisabled(context: ShareContext, file: SwitchFile, target: SwitchTarget): boolean {
  return !!file.parsed && stateIn(context, file.tool, file.parsed, target).disabled;
}

/**
 * Turns one tool's copy of a skill off or on, then reads the file back to confirm. A caller offering a new Disable checks
 * unverifiedBuild first (this only edits the file; it doesn't know the tool's build). Writes only over the text it read (a save
 * made meanwhile is never overwritten) and only when something changes. `restore`: what Claude Code's override held before a
 * Disable (say "name-only"), put back by Enable instead of no override; without it, Enable puts back the value kept for that
 * folder. Returns whether it changed, and that earlier value. Throws an error whose message says why (see switchFailure).
 */
export async function setDisabled(context: ShareContext, tool: HarnessId, target: SwitchTarget, disabled: boolean, restore?: string): Promise<{ changed: boolean; previous?: string }> {
  const file = await readSwitchFile(context, tool);
  if (!file.parsed) throw failure(problemText(file.problem!));
  const now = stateIn(context, tool, file.parsed, target);
  if (now.disabled === disabled) return { changed: false };
  if (tool === 'claude-cli' && !disabled) restore ??= (await readKeptOverrides(context))[target.folder];
  await writeFileChecked(file.path, withSwitch(context, file, target, disabled, restore), file.exists ? file.text : undefined);
  const after = await readSwitchFile(context, tool);
  if (!after.parsed || stateIn(context, tool, after.parsed, target).disabled !== disabled) throw failure(`${toolName(tool)}’s settings did not take the change.`);
  if (tool === 'claude-cli') await keepOverrides(context, { [target.folder]: disabled ? now.previous : undefined });
  return { changed: true, previous: now.previous };
}

// Claude Code overrides a Disable replaced (say "name-only"), by skill folder. Kept in the store, not only in History (which
// expires), so any later Enable puts the value back: the Skills page's and a profile's alike.
const keptOverridesPath = (context: ShareContext) => join(storeDirectory(context.home), 'skill-overrides.json');
export async function readKeptOverrides(context: ShareContext): Promise<Record<string, string>> {
  try { return (record(JSON.parse(await readFile(keptOverridesPath(context), 'utf8'))) ?? {}) as Record<string, string>; } catch { return {}; }
}
/** Sets (a value) or drops (undefined) the kept override of each folder named. */
export async function keepOverrides(context: ShareContext, changes: Record<string, string | undefined>) {
  const kept = await readKeptOverrides(context);
  const next = { ...kept };
  for (const [folder, value] of Object.entries(changes)) { if (value === undefined) delete next[folder]; else next[folder] = value; }
  if (JSON.stringify(next) !== JSON.stringify(kept)) await writeDurably(keptOverridesPath(context), `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * For a caller that edits several switches in one file with one checked write (profiles.ts): whether `text` turns this copy off,
 * and `text` with it turned off or on (`restore` as for setDisabled), with what Claude Code's override held before. Both throw
 * when the text isn't the tool's format.
 */
export const switchState = (context: ShareContext, tool: HarnessId, text: string, target: SwitchTarget) => stateIn(context, tool, parse(tool, text), target).disabled;
export function switchedText(context: ShareContext, tool: HarnessId, text: string, target: SwitchTarget, disabled: boolean, restore?: string): { text: string; previous?: string } {
  const parsed = parse(tool, text);
  return { text: withSwitch(context, { tool, path: '', text, exists: true, parsed }, target, disabled, restore), previous: stateIn(context, tool, parsed, target).previous };
}

/** A switch change's failure in words: its own reason, or the plain one for a file system error. */
export const switchFailure = (error: unknown) => (['CK_SWITCH', 'CK_CHANGED'].includes(errorCode(error)) && error instanceof Error ? error.message : plainError(error));
const failure = (message: string) => Object.assign(new Error(message), { code: 'CK_SWITCH' });

// ---------- Each tool's form ----------

interface CodexRule { table: TomlTable; path?: unknown; name?: unknown; enabled?: unknown }
/** A path with forward slashes, as Pi patterns and Codex rules are compared. */
const forwardSlashes = (path: string) => path.split(sep).join('/').replace(/\\/g, '/');
/** Whether a rule's `path` is this copy's SKILL.md: by separator-blind comparison, and without case on Windows, as Codex reads paths there. */
const isPathOf = (rule: CodexRule, skillFile: string) => {
  if (typeof rule.path !== 'string') return false;
  const plain = (path: string) => (process.platform === 'win32' ? forwardSlashes(path).toLowerCase() : forwardSlashes(path));
  return plain(rule.path) === plain(skillFile);
};
/** A switch file parsed: JSON settings, or Codex's skill rules. */
export type ParsedSwitches = { json: Record<string, unknown> } | { rules: CodexRule[] };

const formError = () => Object.assign(new Error('Skill rules in a form not edited here.'), { code: 'CK_FORM' });
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A tool's settings, parsed. Throws when the text isn't the tool's format. */
function parse(tool: HarnessId, text: string): ParsedSwitches {
  if (tool === 'codex-cli') return { rules: codexRules(text) };
  if (!text.trim()) return { json: {} };
  const json = record(JSON.parse(withoutBom(text)));
  if (!json) throw new Error('Not a JSON object.');
  return { json };
}

/**
 * Codex's `[[skills.config]]` entries in order (the last matching one wins), read with codexSkillSwitches like a plugin skill's.
 * Throws on skill rules written as a value (`skills.config = …`, `[skills]` with `config = …`, `skills = { config = … }`) or
 * as a `[skills.config]` table: forms a `[[skills.config]]` block can't be added to.
 */
function codexRules(text: string): CodexRule[] {
  const tables = readTomlTables(text);
  const { switches, inline } = codexSkillSwitches(tables);
  if (inline || tables.some(table => !table.array && table.path[0] === 'skills' && table.path[1] === 'config')) throw formError();
  return switches.map(entry => {
    const table = tables.find(candidate => candidate.array && candidate.start === entry.start)!;
    return { table, path: entry.path, name: entry.name, enabled: table.entries.find(field => field.key === 'enabled')?.value };
  });
}

/**
 * One entry of Codex's `skills.config` list in config.toml: a skill picked by `name` (a plugin's as `plugin:skill`) or by
 * the `path` of its SKILL.md, turned off by `enabled = false`. Where several pick one skill, Codex lets the last decide.
 */
export interface CodexSkillSwitch { name?: string; path?: string; enabled: boolean; /** Where its `[[skills.config]]` block starts in the file; undefined for one written inline (`skills.config = [...]`), which Central Knot reads but never edits. */ start?: number }
/**
 * Codex's skill switches in a config.toml (its `tables`, from readTomlTables), in file order, and whether the list is
 * written as a value (`inline`), even an empty one, where a `[[skills.config]]` block can't be added.
 */
export function codexSkillSwitches(tables: TomlTable[]): { switches: CodexSkillSwitch[]; inline: boolean } {
  const switchOf = (fields: Record<string, TomlValue>, start?: number): CodexSkillSwitch =>
    ({ name: typeof fields.name === 'string' ? fields.name : undefined, path: typeof fields.path === 'string' ? fields.path : undefined, enabled: fields.enabled !== false, start });
  const found: CodexSkillSwitch[] = [];
  let inline = false;
  for (const table of tables) {
    if (table.array && table.path.join('.') === 'skills.config') { found.push(switchOf(Object.fromEntries(table.entries.map(entry => [entry.key, entry.value])), table.start)); continue; }
    if (table.array) continue;
    // The same list written as a value: `skills.config = [{ … }]` at the top, or `config = [{ … }]` under `[skills]`.
    for (const entry of table.entries) {
      const path = [...table.path, ...entry.keys].join('.');
      if (path !== 'skills' && path !== 'skills.config') continue;
      // `skills = { config = [...] }` is the same list inside an inline table, which no `[[skills.config]]` block may extend.
      const list = path === 'skills' ? record(entry.value)?.config : entry.value;
      inline = true;
      for (const item of Array.isArray(list) ? list : []) { const fields = record(item); if (fields) found.push(switchOf(fields as Record<string, TomlValue>)); }
    }
  }
  return { switches: found, inline };
}
/** Pi's exact forms for a copy: relative to its agent folder (how `pi config` writes it) and absolute, for the file and its folder. */
function piForms(target: SwitchTarget, config: string): { written: string; all: Set<string> } {
  const rel = relative(config, target.skillFile);
  const inside = !rel.startsWith('..') && !isAbsolute(rel);
  const file = forwardSlashes(target.skillFile);
  const forms = [file, file.replace(/\/SKILL\.md$/, ''), ...(inside ? [forwardSlashes(rel), forwardSlashes(rel).replace(/\/SKILL\.md$/, '')] : [])];
  return { written: inside ? forwardSlashes(rel) : file, all: new Set(forms) };
}
/** Whether a Pi `skills` entry excludes exactly this copy (`-` or `!` before one of its forms; `./` and `~/` resolved as Pi does). */
function piExcludes(entry: unknown, forms: Set<string>, home: string): boolean {
  if (typeof entry !== 'string' || !/^[-!]/.test(entry)) return false;
  const path = entry.replace(/^[+!-]/, '').replace(/^\.\//, '');
  return forms.has(path.startsWith('~/') ? forwardSlashes(join(home, path.slice(2))) : isAbsolute(path) ? forwardSlashes(path) : path);
}

/** Whether the parsed settings turn this copy off, and (Claude Code) what its override held otherwise. */
function stateIn(context: ShareContext, tool: HarnessId, parsed: ParsedSwitches, target: SwitchTarget): { disabled: boolean; previous?: string } {
  if ('rules' in parsed) return { disabled: parsed.rules.filter(rule => isPathOf(rule, target.skillFile) || rule.name === target.name).at(-1)?.enabled === false };
  const { json } = parsed;
  if (tool === 'claude-cli') { const value = record(json.skillOverrides)?.[target.folder]; return { disabled: value === 'off', previous: typeof value === 'string' && value !== 'off' ? value : undefined }; }
  if (tool === 'copilot-cli') return { disabled: list(json.disabledSkills).includes(target.name) };
  const forms = piForms(target, toolConfigRoot(context, tool)).all;
  return { disabled: list(json.skills).some(entry => piExcludes(entry, forms, context.home)) };
}

/** The file's text with this copy turned off or on. Only the switch changes. */
function withSwitch(context: ShareContext, file: SwitchFile, target: SwitchTarget, disabled: boolean, restore?: string): string {
  if (file.tool === 'codex-cli') return codexWithSwitch(context, file.text, target, disabled);
  // A leading byte-order mark (some Windows editors add one) is kept, and set aside while editing.
  const bom = file.text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = file.text.slice(bom.length);
  const json = (file.parsed as { json: Record<string, unknown> }).json;
  // A list left empty goes with its last entry.
  const putList = (key: string, value: unknown[]) => setJsonMember(text, [key], value.length ? value : undefined);
  if (file.tool === 'claude-cli') {
    if (disabled || restore) return bom + setJsonMember(text, ['skillOverrides', target.folder], disabled ? 'off' : restore);
    const others = Object.keys(record(json.skillOverrides) ?? {}).filter(key => key !== target.folder);
    return bom + setJsonMember(text, others.length ? ['skillOverrides', target.folder] : ['skillOverrides'], undefined);
  }
  if (file.tool === 'copilot-cli') {
    const others = list(json.disabledSkills).filter(name => name !== target.name);
    return bom + putList('disabledSkills', disabled ? [...others, target.name] : others);
  }
  const { written, all } = piForms(target, toolConfigRoot(context, file.tool));
  // Only this copy's exclusions go; a `+` include the person wrote stays (an exclusion wins over it while disabled).
  const others = list(json.skills).filter(entry => !piExcludes(entry, all, context.home));
  return bom + putList('skills', disabled ? [...others, `-${written}`] : others);
}

/**
 * Codex: the rule Central Knot writes is exactly a header, this copy's path and `enabled`, and only a rule in exactly that form is
 * added or taken out whole. Any other rule for this path is the person's (a comment anywhere, another key): it keeps every byte but
 * its `enabled` value. When a later name rule still decides, a path rule for this copy is added at the end, since the last
 * matching rule wins. A file with Windows line ends gets them in what is added too.
 */
function codexWithSwitch(context: ShareContext, text: string, target: SwitchTarget, disabled: boolean): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const wantEnabled = !disabled;
  // Ours to take out: our own rule (as editTomlArray writes it) saying the opposite of what is wanted now. Comment lines
  // at a table's end sit above the next header and belong to what follows.
  const staleRule = ['[[skills.config]]', `path = ${tomlValue(target.skillFile)}`, `enabled = ${!wantEnabled}`].join(eol);
  const ownText = (table: TomlTable) => text.slice(table.start, table.end).replace(/(?:\r?\n[ \t]*(?:#[^\n]*)?)+$/, '').trimEnd();
  const ours = new Set(codexRules(text).filter(rule => isPathOf(rule, target.skillFile) && ownText(rule.table) === staleRule).map(rule => rule.table.start));
  let out = ours.size ? editTomlArray(text, ['skills', 'config'], table => ours.has(table.start)) : text;
  // The person's own rules for this path, from the last, so earlier offsets stay right.
  for (const rule of codexRules(out).filter(candidate => isPathOf(candidate, target.skillFile)).reverse()) {
    const entry = rule.table.entries.find(candidate => candidate.key === 'enabled');
    // Already saying what is wanted (no `enabled` key counts as enabled): left exactly as it is.
    if ((rule.enabled ?? true) === wantEnabled) continue;
    const value = `enabled = ${wantEnabled}`;
    const headerEnd = out.indexOf('\n', rule.table.start) + 1;
    out = entry ? out.slice(0, entry.start) + entry.raw.replace(/enabled\s*=\s*(?:true|false)/, value) + out.slice(entry.end)
      : `${out.slice(0, headerEnd)}${value}${eol}${out.slice(headerEnd)}`;
  }
  if (stateIn(context, 'codex-cli', { rules: codexRules(out) }, target).disabled === disabled) return out;
  return editTomlArray(out, ['skills', 'config'], () => false, { path: target.skillFile, enabled: wantEnabled });
}
