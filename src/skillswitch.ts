// A tool's own switch for one skill (capability data, Appendix B; ENB-01, ENB-02): the copy stays where it is and keeps
// receiving updates; the tool just doesn't load it. Central Knot's Off never writes it (Off takes the folder out: library.ts),
// and On and Off write it only for a copy put in Pi or taken out where a pattern in Pi's settings keeps it out (followCopy).
// It is read for the mark on that tool's line (skills.ts rowFacts), cleared by skills.ts clearSwitch (and set again by its
// Undo, switchBack), carried to Central Knot's copy by skills.ts takeOver, released once by the profiles migration
// (profilemigrate.ts), and flipped for a plugin's skill (plugins.ts). Each tool keeps its switch in its own user-wide settings
// file, which is edited in place: only the switch changes. Every other byte stays, apart from these: the JSON list holding
// Copilot's or Pi's switches is written back as a list (same entries, JSON layout); a list or map Enable leaves empty goes with
// its last entry (and a JSON settings file that wasn't there is left as `{}`); a config.toml without a final newline gains one
// when a rule is added; a person's Codex rule with no `enabled` key keeps the `enabled` line a Disable gave it; a JSON settings
// file with Windows line ends gets plain ones in the lines added while a skill is disabled (Enable takes them out again).
//   Claude Code  settings.json   "skillOverrides": { "<folder>": "off" }   (keyed by folder: Claude names a skill after it)
//   Copilot CLI  settings.json   "disabledSkills": ["<name>"]              (what `copilot skill disable` writes; by name)
//   Codex        config.toml     [[skills.config]] path = "<…/SKILL.md>" enabled = false   (by path: a name rule would hit every same-name skill)
//   Pi           settings.json   "skills": ["-skills/<folder>/SKILL.md"]   (the exact exclusion `pi config` writes; where a `!` pattern
//                                such as "!*" keeps a copy out, "+skills/<folder>/SKILL.md", the exact inclusion it writes, lets it
//                                in. Read as Pi 1.5.2 reads the list: piOff. An entry that isn't text stops Pi: read as all out)
//   OpenCode     opencode.json   "permission": { "skill": { "<name>": "deny" } }   (by name, whichever folder holds it; the last
//                                rule that matches a name decides, so the rule goes last. Measured 2026-11-10 on 1.19.5 and 2.2.5:
//                                a denied skill is left out of what a new session is sent.)
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, matchesGlob, relative, sep } from 'node:path';
import { openCodeSettings, toolConfigRoot } from './harnesses.ts';
import { errorCode, plainError, storeDirectory, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { editTomlArray, readJsonc, readTomlTables, setJsonMember, tomlValue, type TomlTable, type TomlValue } from './textedit.ts';
import type { HarnessId, SwitchProblem, SwitchTarget } from './types.ts';
export type { SwitchTarget };
import { problemText, toolName } from './words.ts';
import { record, withoutBom } from './values.ts';



/** One tool's switch file, read and parsed once: its text ('' when there is none yet), or why it can't be used. */
export interface SwitchFile { tool: HarnessId; path: string; text: string; exists: boolean; problem?: SwitchProblem; parsed?: ParsedSwitches }

/** The file that holds a tool's skill switches. */
export const switchPath = (context: ShareContext, tool: HarnessId) =>
  (tool === 'opencode-cli' ? openCodeSettings(toolConfigRoot(context, tool)) : join(toolConfigRoot(context, tool), tool === 'codex-cli' ? 'config.toml' : 'settings.json'));

/** Reads a tool's switch file. A file that can't be read, or isn't the JSON or TOML expected, is reported and never written. */
export async function readSwitchFile(context: ShareContext, tool: HarnessId): Promise<SwitchFile> {
  const path = switchPath(context, tool);
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { tool, path, text: '', exists: false, parsed: parse(tool, '') } : { tool, path, text: '', exists: true, problem: { file: path, reason: 'can’t be read.' } };
  }
  try { return { tool, path, text, exists: true, parsed: parse(tool, text) }; }
  catch (error) {
    const form = errorCode(error) === 'CK_FORM' ? error as { reason: string; read?: ParsedSwitches } : undefined;
    // A form that is read but not edited still says what it turns off: the page shows that, and offers no switch.
    return { tool, path, text, exists: true, problem: { file: path, reason: form?.reason ?? `isn’t valid ${tool === 'codex-cli' ? 'TOML' : 'JSON'}.` }, ...(form?.read ? { parsed: form.read } : {}) };
  }
}

/** Whether a tool's switch file turns this copy off. False for a file that can't be read (one with a problem is never written). */
export function isDisabled(context: ShareContext, file: SwitchFile, target: SwitchTarget): boolean {
  return !!file.parsed && stateIn(context, file.tool, file.parsed, target).disabled;
}

/**
 * Turns one tool's copy of a skill off or on, then reads the file back to confirm. Writes only over the text it read (a save
 * made meanwhile is never overwritten) and only when something changes. `restore`: what Claude Code's override held before a
 * Disable (say "name-only"), put back by Enable instead of no override; without it, Enable puts back the value kept for that
 * folder. Returns whether it changed, and that earlier value. Throws an error whose message says why (see switchFailure).
 */
export async function setDisabled(context: ShareContext, tool: HarnessId, target: SwitchTarget, disabled: boolean, restore?: string): Promise<{ changed: boolean; previous?: string }> {
  const file = await readSwitchFile(context, tool);
  if (file.problem || !file.parsed) throw failure(problemText(file.problem!));
  const now = stateIn(context, tool, file.parsed, target);
  if (now.disabled === disabled) return { changed: false };
  if (tool === 'claude-cli' && !disabled) restore ??= (await readKeptOverrides(context))[target.folder];
  await writeConfirmed(context, file, target, withSwitch(context, file, target, disabled, restore), disabled);
  if (tool === 'claude-cli') await keepOverrides(context, { [target.folder]: disabled ? now.previous : undefined });
  return { changed: true, previous: now.previous };
}

/** Writes a switch file's new text over the text it read, then reads it back: it must say the copy is `disabled` or not, as asked. */
async function writeConfirmed(context: ShareContext, file: SwitchFile, target: SwitchTarget, text: string, disabled: boolean) {
  await writeFileChecked(file.path, text, file.exists ? file.text : undefined);
  const after = await readSwitchFile(context, file.tool);
  if (!after.parsed || stateIn(context, file.tool, after.parsed, target).disabled !== disabled) throw failure(`${toolName(file.tool)}’s settings did not take the change.`);
}

/**
 * Pi, as the pass puts a copy in its skills folder (`placed`) or takes out one that is off there now (skills.ts writeSkill,
 * skillKind.remove): piSwitched with the person's own switch for it left alone, written and read back as setDisabled writes.
 * Other tools, and a file with a problem, are left as they are.
 */
export async function followCopy(context: ShareContext, tool: HarnessId, target: SwitchTarget, placed: boolean) {
  if (tool !== 'pi-cli') return;
  const file = await readSwitchFile(context, tool);
  if (file.problem || !file.parsed) return;
  const skills = list((file.parsed as { json: Record<string, unknown> }).json.skills) as string[];
  const copy = piCopy(context, target);
  const next = piSwitched(skills, copy, context.home, placed, false);
  if (JSON.stringify(next) === JSON.stringify(skills)) return;
  await writeConfirmed(context, file, target, withSkills(file, next), piOff(next, copy, context.home));
}

// Claude Code overrides a Disable replaced (say "name-only"), by skill folder. Kept in the store, not only in History (which
// expires), so any later Enable puts the value back.
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

/** `read`: the settings as parsed, where the form can still be read for what it turns off, only not edited. */
const formError = (reason = 'writes skills.config as a value, a form Central Knot doesn’t edit.', read?: ParsedSwitches) => Object.assign(new Error('Skill rules in a form not edited here.'), { code: 'CK_FORM', reason, read });
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A tool's settings, parsed. Throws when the text isn't the tool's format. */
function parse(tool: HarnessId, text: string): ParsedSwitches {
  if (tool === 'codex-cli') return { rules: codexRules(text) };
  if (!text.trim()) return { json: {} };
  const json = record(tool === 'opencode-cli' ? readJsonc(text) : JSON.parse(withoutBom(text)));
  if (!json) throw new Error('Not a JSON object.');
  // OpenCode's `permission` as one word ("allow") has no place for one skill's rule; and a rule after `skill` that covers
  // skills ("*") decides for every skill, so a rule for one would count only once `skill` moved after it, which would make
  // the rules it overrules count again. Both are forms not edited here.
  // Pi stops at start on an entry of `skills` that isn't text (measured on 1.5.2), so it loads no skill: read so, never edited.
  const notText = tool === 'pi-cli' && list(json.skills).some(entry => typeof entry !== 'string');
  if (notText) throw formError('has an entry in skills that isn’t text, so Pi doesn’t start.', { json });
  const permission = tool === 'opencode-cli' && 'permission' in json ? record(json.permission) : {};
  if (!permission) throw formError('sets permission as one word, a form Central Knot doesn’t edit.');
  const keys = Object.keys(permission);
  if ('skill' in permission && keys.slice(keys.indexOf('skill') + 1).some(key => typeof permission[key] === 'string' && openCodeMatches(key, 'skill'))) throw formError('has a rule after skill in permission that decides for every skill, a form Central Knot doesn’t edit. Move it above skill to switch one skill.', { json });
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
/**
 * How Pi names a copy: `exact`, the paths an exact `+` or `-` matches (absolute, and from its agent folder or, for a shared copy,
 * ~/.agents; each for SKILL.md and its folder); `named`, those and the two names a `!` pattern is also matched against; `written`,
 * what Central Knot writes: `pi config`'s form in Pi's own folder, else the absolute path (from ~/.agents it names Pi's own too).
 */
type PiCopy = { written: string; exact: Set<string>; named: string[] };
function piCopy(context: ShareContext, target: SwitchTarget): PiCopy {
  const inside = (rel: string) => !rel.startsWith('..') && !isAbsolute(rel), file = forwardSlashes(target.skillFile);
  const own = relative(toolConfigRoot(context, 'pi-cli'), target.skillFile);
  const rel = [own, relative(join(context.home, '.agents'), target.skillFile)].find(inside);
  const exact = [file, ...(rel ? [forwardSlashes(rel)] : [])].flatMap(path => [path, path.replace(/\/SKILL\.md$/, '')]);
  const named = [...exact, 'SKILL.md', basename(dirname(target.skillFile))];
  return { written: inside(own) ? forwardSlashes(own) : file, exact: new Set(exact), named };
}
/** An entry's path after its sign, as Pi reads it: `~/` from the home; for an exact one (`+`, `-`), a leading `./` dropped. */
const piPath = (entry: string, home: string) => {
  const path = entry[0] === '!' ? entry.slice(1) : entry.slice(1).replace(/^\.\//, '');
  return path.startsWith('~/') ? `${forwardSlashes(home)}${path.slice(1)}` : path;
};
/**
 * Whether Pi keeps this copy out, as Pi 1.5.2 does (measured 2026-11-20, capability data Appendix B), wherever each entry stands:
 * an exact `-` keeps it out; else an exact `+` lets it in; else a matching `!` pattern keeps it out (minimatch, as Pi uses; `!!…`,
 * Pi's negation, keeps nearly all out). On macOS Node's matchesGlob ignores a wildcard's case, which Pi doesn't: it may read off.
 */
function piOff(skills: string[], copy: PiCopy, home: string): boolean {
  const exact = (sign: string) => skills.some(entry => entry[0] === sign && copy.exact.has(piPath(entry, home)));
  if (exact('-')) return true;
  const matches = (entry: string) => entry[1] === '!' || copy.named.some(name => matchesGlob(name, piPath(entry, home)));
  return !exact('+') && skills.some(entry => entry[0] === '!' && matches(entry));
}
/**
 * Pi's list with this copy let in (`load`) or out, changed as little as does it; no other entry moves, and a pattern never changes.
 * In: where `own` (Let Pi load it), its exclusions go; then `+` where a pattern still keeps it out and no exclusion of its own does.
 * Out: its `+` goes where a pattern then keeps it out; else, where `own`, `-`.
 */
function piSwitched(skills: string[], copy: PiCopy, home: string, load: boolean, own: boolean): string[] {
  const its = (signs: string) => (entry: string) => signs.includes(entry[0]) && copy.exact.has(piPath(entry, home));
  if (load) {
    const kept = own ? skills.filter(entry => !its('-!')(entry)) : skills;
    return piOff(kept, copy, home) && !kept.some(its('-!')) ? [...kept, `+${copy.written}`] : kept;
  }
  const kept = skills.filter(entry => !its('+')(entry));
  return piOff(kept, copy, home) ? kept : own ? [...skills, `-${copy.written}`] : skills;
}
/** The settings' text with Pi's `skills` list as given (gone when empty), a byte-order mark kept. */
const withSkills = (file: SwitchFile, skills: string[]) => {
  const bom = file.text.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + setJsonMember(file.text.slice(bom.length), ['skills'], skills.length ? skills : undefined);
};

/** Whether an OpenCode pattern (`*` any run of characters, `?` one) is this name. */
const openCodeMatches = (pattern: string, name: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 's').test(name);
/**
 * OpenCode's rules about skills, in the order it reads them: `permission.skill`, a map of name patterns or one word for
 * every skill, and any other `permission` key that covers skills (`"*"`), whose word is for every skill too.
 */
const openCodeRules = (json: Record<string, unknown>): [string, unknown][] => Object.entries(record(json.permission) ?? {}).flatMap(([key, value]): [string, unknown][] =>
  (key === 'skill' ? (typeof value === 'string' ? [['*', value]] : Object.entries(record(value) ?? {})) : typeof value === 'string' && openCodeMatches(key, 'skill') ? [['*', value]] : []));
/** What OpenCode's rules say about a skill: the last one matching its name decides (measured, also for a `"*"` written after `skill`). */
const openCodeAction = (rules: [string, unknown][], name: string) => rules.filter(([pattern]) => openCodeMatches(pattern, name)).at(-1)?.[1];

/** Whether the parsed settings turn this copy off, and (Claude Code) what its override held otherwise. */
function stateIn(context: ShareContext, tool: HarnessId, parsed: ParsedSwitches, target: SwitchTarget): { disabled: boolean; previous?: string } {
  if ('rules' in parsed) return { disabled: parsed.rules.filter(rule => isPathOf(rule, target.skillFile) || rule.name === target.name).at(-1)?.enabled === false };
  const { json } = parsed;
  if (tool === 'claude-cli') { const value = record(json.skillOverrides)?.[target.folder]; return { disabled: value === 'off', previous: typeof value === 'string' && value !== 'off' ? value : undefined }; }
  if (tool === 'copilot-cli') return { disabled: list(json.disabledSkills).includes(target.name) };
  if (tool === 'opencode-cli') return { disabled: openCodeAction(openCodeRules(json), target.name) === 'deny' };
  // Pi: an entry that isn't text keeps every skill out (parse).
  const skills = list(json.skills);
  return { disabled: skills.some(entry => typeof entry !== 'string') || piOff(skills as string[], piCopy(context, target), context.home) };
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
  if (file.tool === 'opencode-cli') {
    // Already as asked: not a byte changes.
    if ((openCodeAction(openCodeRules(json), target.name) === 'deny') === disabled) return file.text;
    const path = ['permission', 'skill'];
    const permission = record(json.permission) ?? {};
    const map: Record<string, unknown> = typeof permission.skill === 'string' ? { '*': permission.skill } : record(permission.skill) ?? {};
    const { [target.name]: own, ...others } = map;
    const { skill: _skill, ...rest } = permission;
    // What the other rules say once this skill's own is out: an Enable they would still deny gets an `allow` of its own.
    const decides = openCodeAction(openCodeRules({ permission: { ...permission, skill: others } }), target.name);
    const next = disabled ? { ...others, [target.name]: 'deny' } : decides === 'deny' ? { ...others, [target.name]: 'allow' } : others;
    // `skill` as one word becomes a map that says the same, so one skill's rule has a place.
    if (typeof permission.skill === 'string') return bom + setJsonMember(text, path, next);
    // A map the Enable leaves empty goes with its last entry, and so does a `permission` that held nothing else.
    if (!Object.keys(next).length) return bom + setJsonMember(text, Object.keys(rest).length ? path : ['permission'], undefined);
    // Its own rule, when it is the last that matches, changes its word where it is; otherwise it goes to the end, where it decides.
    const inPlace = own !== undefined && target.name in next && Object.keys(map).findLast(pattern => openCodeMatches(pattern, target.name)) === target.name;
    const out = own === undefined || inPlace ? text : setJsonMember(text, [...path, target.name], undefined);
    return bom + (target.name in next ? setJsonMember(out, [...path, target.name], (next as Record<string, unknown>)[target.name]) : out);
  }
  return withSkills(file, piSwitched(list(json.skills) as string[], piCopy(context, target), context.home, !disabled, true));
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
