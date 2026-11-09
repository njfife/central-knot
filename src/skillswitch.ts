// Disabling a standalone skill in one tool with that tool's own switch (capability data, Appendix B; ENB-01, ENB-02).
// The copy stays where it is and keeps receiving updates; the tool just doesn't load it. Each tool keeps its switch in its own
// user-wide settings file, which is edited in place: only the switch changes. Every other byte stays, apart from a list or map
// that Enable leaves empty, which goes with its last entry.
//   Claude Code  settings.json   "skillOverrides": { "<folder>": "off" }   (keyed by folder: Claude names a skill after it)
//   Copilot CLI  settings.json   "disabledSkills": ["<name>"]              (what `copilot skill disable` writes; by name)
//   Codex        config.toml     [[skills.config]] path = "<…/SKILL.md>" enabled = false   (by path: a name rule would hit every same-name skill)
//   Pi           settings.json   "skills": ["-skills/<folder>/SKILL.md"]   (the exact exclusion `pi config` writes)
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { harnesses, toolConfigRoot } from './harnesses.ts';
import { errorCode, plainError, writeFileChecked, type ShareContext } from './share.ts';
import { appendTomlTable, readTomlTables, removeTomlTables, setJsonMember, tomlValue, type TomlTable } from './textedit.ts';
import type { HarnessId } from './types.ts';
import { record, withoutBom } from './values.ts';

/** One tool's copy of a skill, as its switch names it. */
export interface SwitchTarget { folder: string; name: string; /** Absolute path to the copy's SKILL.md (where it is, or where it will be written). */ skillFile: string }

/** One tool's switch file, read and parsed once: its text ('' when there is none yet), or why it can't be used. */
export interface SwitchFile { tool: HarnessId; path: string; text: string; exists: boolean; problem?: string; parsed?: Parsed }

/**
 * The lowest build of each tool where its switch was seen working (Appendix B, V-20). Below it, no new Disable is offered
 * (ENB-01, DET-03); a copy already disabled still shows as disabled. An unknown build (no CLI found) is not held back: the
 * settings file is the tool's documented one either way.
 */
const VERIFIED_FROM: Record<HarnessId, string> = { 'claude-cli': '2.1.311', 'copilot-cli': '1.0.107', 'codex-cli': '0.142.3', 'pi-cli': '1.5.0' };

/** Why Disable isn't offered for this build of a tool, if it isn't. */
export function unverifiedBuild(tool: HarnessId, version: string | undefined): string | undefined {
  if (!version) return undefined;
  const parts = (value: string) => value.split(/[.+-]/).slice(0, 3).map(Number);
  const [have, floor] = [parts(version), parts(VERIFIED_FROM[tool])];
  const first = have.findIndex((part, index) => part !== floor[index]);
  return first >= 0 && have[first] < floor[first] ? `Disable is verified from version ${VERIFIED_FROM[tool]}; this is ${version}. Update it to use Disable here.` : undefined;
}

/** The file that holds a tool's skill switches. */
export const switchPath = (context: ShareContext, tool: HarnessId) => join(toolConfigRoot(context, tool), tool === 'codex-cli' ? 'config.toml' : 'settings.json');

/** Reads a tool's switch file. A file that can't be read, or isn't the JSON or TOML expected, is reported and never written. */
export async function readSwitchFile(context: ShareContext, tool: HarnessId): Promise<SwitchFile> {
  const path = switchPath(context, tool);
  // Said in the tool's own row, so the file is named as the person knows it (~/…) and the tool is "here".
  const shown = path.startsWith(context.home + sep) ? `~${path.slice(context.home.length)}` : path;
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { tool, path, text: '', exists: false, parsed: parse(tool, '') } : { tool, path, text: '', exists: true, problem: `${shown} can’t be read.` };
  }
  try { return { tool, path, text, exists: true, parsed: parse(tool, text) }; }
  catch (error) {
    const why = errorCode(error) === 'CK_FORM' ? 'lists skill rules in a form Central Knot doesn’t edit' : `isn’t valid ${tool === 'codex-cli' ? 'TOML' : 'JSON'}`;
    return { tool, path, text, exists: true, problem: `${shown} ${why}.` };
  }
}

/** Whether a tool's switch file turns this copy off. False for a file with a problem (which is never written). */
export function isDisabled(context: ShareContext, file: SwitchFile, target: SwitchTarget): boolean {
  return !!file.parsed && stateIn(context, file.tool, file.parsed, target).disabled;
}

/**
 * Turns one tool's copy of a skill off or on, then reads the file back to confirm. Writes only over the text it read (a save
 * made meanwhile is never overwritten) and only when something changes. `restore`: what Claude Code's override held before a
 * Disable (say "name-only"), put back by Enable instead of no override. Returns whether it changed, and that earlier value.
 * Throws an error whose message says why (see switchFailure).
 */
export async function setDisabled(context: ShareContext, tool: HarnessId, target: SwitchTarget, disabled: boolean, restore?: string): Promise<{ changed: boolean; previous?: string }> {
  const file = await readSwitchFile(context, tool);
  if (!file.parsed) throw failure(file.problem!);
  const now = stateIn(context, tool, file.parsed, target);
  if (now.disabled === disabled) return { changed: false };
  await writeFileChecked(file.path, withSwitch(context, file, target, disabled, restore), file.exists ? file.text : undefined);
  const after = await readSwitchFile(context, tool);
  if (!after.parsed || stateIn(context, tool, after.parsed, target).disabled !== disabled) throw failure(`${harnesses[tool].name}’s settings did not take the change.`);
  return { changed: true, previous: now.previous };
}

/** A switch change's failure in words: its own reason, or the plain one for a file system error. */
export const switchFailure = (error: unknown) => (['CK_SWITCH', 'CK_CHANGED'].includes(errorCode(error)) && error instanceof Error ? error.message : plainError(error));
const failure = (message: string) => Object.assign(new Error(message), { code: 'CK_SWITCH' });

// ---------- Each tool's form ----------

interface CodexRule { table: TomlTable; path?: unknown; name?: unknown; enabled?: unknown }
type Parsed = { json: Record<string, unknown> } | { rules: CodexRule[] };

const formError = () => Object.assign(new Error('Skill rules in a form not edited here.'), { code: 'CK_FORM' });
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A tool's settings, parsed. Throws when the text isn't the tool's format. */
function parse(tool: HarnessId, text: string): Parsed {
  if (tool === 'codex-cli') return { rules: codexRules(text) };
  if (!text.trim()) return { json: {} };
  const json = record(JSON.parse(withoutBom(text)));
  if (!json) throw new Error('Not a JSON object.');
  return { json };
}

/**
 * Codex's `[[skills.config]]` entries in order (the last matching one wins). Throws on skill rules written any other way:
 * `skills = { config = … }`, `[skills]` with `config = …`, a `[skills.config]` table, or `skills.config = …` as a dotted key.
 */
function codexRules(text: string): CodexRule[] {
  const tables = readTomlTables(text);
  const isRule = (table: TomlTable) => table.array === true && table.path.length === 2 && table.path[0] === 'skills' && table.path[1] === 'config';
  for (const table of tables) {
    if (isRule(table)) continue;
    if (table.path[0] === 'skills' && table.path[1] === 'config') throw formError();
    for (const entry of table.entries) {
      const path = [...table.path, ...entry.keys];
      const inlineRules = path[0] === 'skills' && (path.length === 1 || path[1] === 'config');
      if (inlineRules) throw formError();
    }
  }
  return tables.filter(isRule).map(table => {
    const value = (key: string) => table.entries.find(entry => entry.key === key)?.value;
    return { table, path: value('path'), name: value('name'), enabled: value('enabled') };
  });
}

/** Pi's exact forms for a copy: relative to its agent folder (how `pi config` writes it) and absolute, for the file and its folder. */
function piForms(target: SwitchTarget, config: string): { written: string; all: Set<string> } {
  const posix = (path: string) => path.split(sep).join('/');
  const rel = relative(config, target.skillFile);
  const inside = !rel.startsWith('..') && !isAbsolute(rel);
  const file = posix(target.skillFile);
  const forms = [file, file.replace(/\/SKILL\.md$/, ''), ...(inside ? [posix(rel), posix(rel).replace(/\/SKILL\.md$/, '')] : [])];
  return { written: inside ? posix(rel) : file, all: new Set(forms) };
}
/** Whether a Pi `skills` entry is a pattern with one of `signs` naming exactly this copy (`./` and `~/` resolved as Pi resolves them). */
function piEntryNames(entry: unknown, forms: Set<string>, home: string, signs = /^[+!-]/): boolean {
  if (typeof entry !== 'string' || !signs.test(entry)) return false;
  const path = entry.replace(/^[+!-]/, '').replace(/^\.\//, '');
  return forms.has(path.startsWith('~/') ? join(home, path.slice(2)).split(sep).join('/') : isAbsolute(path) ? path.split(sep).join('/') : path);
}

/** Whether the parsed settings turn this copy off, and (Claude Code) what its override held otherwise. */
function stateIn(context: ShareContext, tool: HarnessId, parsed: Parsed, target: SwitchTarget): { disabled: boolean; previous?: string } {
  if ('rules' in parsed) return { disabled: parsed.rules.filter(rule => rule.path === target.skillFile || rule.name === target.name).at(-1)?.enabled === false };
  const { json } = parsed;
  if (tool === 'claude-cli') { const value = record(json.skillOverrides)?.[target.folder]; return { disabled: value === 'off', previous: typeof value === 'string' && value !== 'off' ? value : undefined }; }
  if (tool === 'copilot-cli') return { disabled: list(json.disabledSkills).includes(target.name) };
  const forms = piForms(target, toolConfigRoot(context, tool)).all;
  return { disabled: list(json.skills).some(entry => piEntryNames(entry, forms, context.home, /^[-!]/)) };
}

/** The file's text with this copy turned off or on. Only the switch changes. */
function withSwitch(context: ShareContext, file: SwitchFile, target: SwitchTarget, disabled: boolean, restore?: string): string {
  if (file.tool === 'codex-cli') return codexWithSwitch(context, file.text, target, disabled);
  // A leading byte-order mark (some Windows editors add one) is kept, and set aside while editing.
  const bom = file.text.startsWith('﻿') ? '﻿' : '';
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
  const others = list(json.skills).filter(entry => !piEntryNames(entry, all, context.home));
  return bom + putList('skills', disabled ? [...others, `-${written}`] : others);
}

/**
 * Codex: a rule Central Knot added (just this copy's path and `enabled`, no comments) is added or removed whole. A rule the
 * person wrote for this path keeps its comments and other keys: only its `enabled` value changes. When a later name rule still
 * decides, a path rule for this copy is added at the end, since the last matching rule wins.
 */
function codexWithSwitch(context: ShareContext, text: string, target: SwitchTarget, disabled: boolean): string {
  // Ours to take out: a bare rule for this path saying the opposite of what is wanted now.
  const added = (rule: CodexRule) => rule.table.entries.length === 2 && rule.enabled === disabled && !/^\s*#/m.test(text.slice(rule.table.start, rule.table.end));
  const ours = codexRules(text).filter(rule => rule.path === target.skillFile && added(rule));
  let out = removeTomlTables(text, ours.map(rule => rule.table));
  // A removed rule at the end of the file takes the blank line before it too; one in the middle took its own after it.
  if (ours.some(rule => rule.table.end === text.length)) out = out.replace(/\n\n$/, '\n');
  // The person's own rules for this path, from the last, so earlier offsets stay right.
  for (const rule of codexRules(out).filter(candidate => candidate.path === target.skillFile).reverse()) {
    const entry = rule.table.entries.find(candidate => candidate.key === 'enabled');
    const value = `enabled = ${!disabled}`;
    const headerEnd = out.indexOf('\n', rule.table.start) + 1;
    out = entry ? out.slice(0, entry.start) + entry.raw.replace(/enabled\s*=\s*(?:true|false)/, value) + out.slice(entry.end)
      : `${out.slice(0, headerEnd)}${value}\n${out.slice(headerEnd)}`;
  }
  if (stateIn(context, 'codex-cli', { rules: codexRules(out) }, target).disabled === disabled) return out;
  return appendTomlTable(out, `[[skills.config]]\npath = ${tomlValue(target.skillFile)}\nenabled = ${!disabled}\n`);
}
