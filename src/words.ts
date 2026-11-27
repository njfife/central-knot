// Words shared by the pages and by what the engines say: each tool's display name (toolNames), each kind's (kindNouns; the
// rows of one result, of one kind or several: rowNouns, rowNames), the names of the pages called otherwise on screen
// (pageNames), "Turn it on" (turnIt), where a copy was deleted (deletedIn), "a, b and c" lists, and a few sentences more than
// one module says (a tool left out or not managed, through a plugin, a profile leaving use). A page's own words are its module's; a library row's are
// libraryrow.ts libraryWords, a History entry's historyactions.ts and historypage.ts.
import type { HomeKind } from './presence.ts';
import type { NamedRow } from './itemrow.ts';
import type { HarnessId, SwitchProblem } from './types.ts';

export const toolNames: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi', 'opencode-cli': 'OpenCode', 'antigravity-cli': 'Antigravity' };

/** What is said about Cowork where Claude desktop is here (presence.ts, hasCowork): on Claude Code's card, and on a plugin's page. */
export const coworkWords = {
  card: 'uses the plugins in your Claude account',
  plugin: 'Cowork: add plugins in Claude desktop, under Customize › Plugins.',
};

/** Every tool id in the order the app lists tools everywhere (columns, notes, results). */
export const harnessIds = Object.keys(toolNames) as HarnessId[];
export const byToolOrder = (first: HarnessId, second: HarnessId) => harnessIds.indexOf(first) - harnessIds.indexOf(second);
/** Whether two lists hold the same set of tools, regardless of order. */
export const sameTools = (first: readonly HarnessId[], second: readonly HarnessId[]) =>
  new Set(first).size === new Set(second).size && first.every(tool => second.includes(tool));

/** A tool's display name from an id that may come from a file or a report (an unknown id is shown as it is). */
export const toolName = (tool: string) => (toolNames as Record<string, string>)[tool] ?? tool;
/**
 * Where a copy deleted by hand was, after "deleted in": the tool's own folder (its copy, or a link there), by the tool's name, or
 * the shared skills folder it read (`sharedWay` `copy`: library.ts THE SHARED FOLDER).
 */
export const deletedIn = (tool: string, sharedWay?: 'copy' | 'link') => (sharedWay === 'copy' ? 'the shared folder' : toolName(tool));

/**
 * A program and its arguments as one line: each argument as written, one with a space in it (or an empty one) in double quotes so it
 * reads as one. An MCP server's command (catalogdetail.ts) and a hook's (sessionhooks.ts hookLine) are both shown so.
 */
export const commandLine = (command: string, args: string[] = []) => [command, ...args.map(arg => (arg === '' || /\s/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');

/** The last part of a path, on any OS: `CLAUDE.md` from `…/.claude/CLAUDE.md`. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A text's lines, without the empty one after a final line break ('' has one empty line). */
export const linesOf = (text: string) => text.replace(/\n$/, '').split('\n');
/** How many lines a text has (0 for none). */
export const lineCount = (text: string) => (text ? linesOf(text).length : 0);

/** Joins items as a sentence does, with `word` before the last: "a", "a and b", "a, b and c". */
const joined = (items: string[], word: 'and' | 'or') => (items.length > 2 ? `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}` : items.join(` ${word} `));

/** Names in a sentence, the first three and how many more ("notes, standup, idle and 37 more"); all of them when four or fewer. */
export const fewNames = (items: string[]) => (items.length > 4 ? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more` : andList(items));
/**
 * The first words of a result over several items (a run of clicks, Turn these off, a Plugins run) where some didn't go through
 * in every tool, so the header's cut never hides it (renderer.ts resultHere): how many of `of`, and which.
 */
export const notAllThrough = (short: string[], of: number) => `${short.length} of ${of} didn’t go through in every tool: ${fewNames(short)}.`;
/** Rows a lead has just named, said after it by count alone ("Both are off", "All 3 are deleted"), so a result names each row once. */
export const countedAs = (count: number, of: number, now: 'on' | 'off' | 'deleted') => `${count === of && count > 1 ? (count === 2 ? 'Both' : `All ${count}`) : count} ${count === 1 ? 'is' : 'are'} ${now}`;

/** What a record that stops writes adds after why, in the bands and results that say the stop (share.ts syncGate, kindstore.ts readLibraryFile); a row's reason before anything is tried leaves it out (matrix.ts stopFor). */
export const NOTHING_CHANGED = 'Nothing was written or deleted. Put the record back, then try again.';

/** The text with its first letter capitalised, to start a sentence. */
export const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * A change of keep-outs in words, each list in tool order: `${lead} <the tools it is kept out of now>; back in <those it is in
 * again>` ("Out of Codex; back in Pi"); with `count`, a list of more than two tools is counted ("Out of 4 tools"). History's
 * entry (historyactions.ts) and a Profiles row (profileplan.ts listedChanges) say it so.
 */
export function keptOutWords(was: readonly HarnessId[], now: readonly HarnessId[], lead: string, count = false): string {
  const named = (tools: HarnessId[]) => (count && tools.length > 2 ? `${tools.length} tools` : andList(tools.sort(byToolOrder).map(toolName)));
  const out = now.filter(tool => !was.includes(tool)), back = was.filter(tool => !now.includes(tool));
  return [out.length ? `${lead} ${named(out)}` : '', back.length ? `${out.length ? 'back' : 'Back'} in ${named(back)}` : ''].filter(Boolean).join('; ');
}

/** "a", "a and b", "a, b and c". */
export const andList = (items: string[]) => joined(items, 'and');
/** Tools by name, as an and-list: "Claude Code, Copilot CLI and Codex". */
export const toolList = (tools: HarnessId[]) => andList(tools.map(tool => toolNames[tool]));
/** "<Tool> reads it" or "<Tool> and <Tool> read it", for a skill read from another tool's folder (libraryrow.ts, matrix.ts, historyactions.ts). */
export const readsIt = (tools: readonly string[]) => `${andList(tools.map(toolName))} ${tools.length === 1 ? 'reads' : 'read'} it`;

/** "a", "a or b", "a, b or c": for choices, such as where something can be added. */
export const orList = (items: string[]) => joined(items, 'or');

/**
 * Touched tools for History rows and toolsPhrase: all 3+ home tools, names, and fold label ("5 of 6 tools", or "5 tools" when a tool left).
 * Takes ids, so it compares which tools, not how many: an event from before a tool was added or removed is not "all" or "of M".
 */
export function touchedTools(touched: string[], inHome: string[]): { tools: string[]; all: boolean; names: string; fold?: string } {
  const tools = [...new Set(touched)];
  const all = tools.length > 2 && tools.length === inHome.length && inHome.every(tool => tools.includes(tool));
  const fold = !all && tools.length > 2 ? (tools.every(tool => inHome.includes(tool)) ? `${tools.length} of ${inHome.length} tools` : `${tools.length} tools`) : undefined;
  return { tools, all, names: andList(tools.map(toolName)), fold };
}

/** Touched tools in a sentence: "all 3 tools" when they match all 3+ home tools, else their names ("Claude Code and Codex"). */
export function toolsPhrase(touched: string[], inHome: string[]): string {
  const { tools, all, names } = touchedTools(touched, inHome);
  return all ? `all ${tools.length} tools` : names;
}

/** The same, starting a label or a sentence: "All 3 tools", "Claude Code and Codex". */
export const capitalToolsPhrase = (touched: string[], inHome: string[]): string => toolsPhrase(touched, inHome).replace(/^./, first => first.toUpperCase());

/** What a home with no tools says, wherever it says it: one sentence (pages.ts noToolsState adds the way forward). */
export const noToolsSentence = 'No tools were found in this home.';

/** Why nothing was changed in a tool whose Manage switch is off (toolchoice.ts), wherever a request named it anyway. */
export const leftOutSentence = (tool: string) => `${toolName(tool)} is left out of Central Knot here (its Manage switch on Harnesses is off), so nothing was changed there.`;

/** What an Undo says of a tool it would have written that isn't managed now (left out, or uninstalled): it changed nothing there. */
export const notManagedHere = (tool: string) => `${toolName(tool)} isn’t managed here now, so this changed nothing there.`;

/** A switch problem in words: the file (shown through `show`, say as ~/…) and what is wrong with it. */
export const problemText = (problem: SwitchProblem, show = (path: string) => path) => `${show(problem.file)} ${problem.reason}`;

/**
 * The two pages named on screen otherwise than in the code (`Page 'plugins'`, `Page 'sources'`): the one place each name is
 * spelled, read by the sidebar and the header (renderer.ts titles) and by every sentence, link and button that points a
 * person to the page. The things themselves keep their plain words ("a plugin", "a source").
 */
export const pageNames = { plugins: 'Plugin marketplaces', sources: 'Library sources' } as const;
/** The button on the sources' page that hands a marketplace's link to the plugins' page (sourcespage.ts toPlugins). */
export const toPluginsLabel = `Add to ${pageNames.plugins}`;
/**
 * An item's switch turned On or Off from outside its row, "it" being the item the line names: History's action
 * (historyactions.ts switchAction), an item's notice (matrix.ts libraryNotice) and an Off or removed item's line (or single-item Add/Sync band) on the sources' page.
 */
export const turnIt = (on: boolean, inTool?: string) => `Turn it ${on ? 'on' : 'off'}${inTool ? ` in ${inTool}` : ''}`;

/**
 * Each kind's words, the one place they are spelled: one of it and many as a sentence names them, the page's title (plugins':
 * pageNames), the short noun a count uses ("2 servers"), and one of it with its article ("an MCP server").
 */
export const kindNouns: Record<HomeKind, { one: string; many: string; title: string; short: [string, string]; a: string }> = {
  skills: { one: 'skill', many: 'skills', title: 'Skills', short: ['skill', 'skills'], a: 'a skill' },
  mcp: { one: 'MCP server', many: 'MCP servers', title: 'MCP servers', short: ['server', 'servers'], a: 'an MCP server' },
  agents: { one: 'agent', many: 'agents', title: 'Agents', short: ['agent', 'agents'], a: 'an agent' },
  instructions: { one: 'instruction file', many: 'instruction files', title: 'Instructions', short: ['file', 'files'], a: 'an instruction file' },
  plugins: { one: 'plugin', many: 'plugins', title: pageNames.plugins, short: ['plugin', 'plugins'], a: 'a plugin' },
};

/** Each kind as a sentence names it, many of it: "MCP servers". */
export const kindNames = Object.fromEntries(Object.entries(kindNouns).map(([kind, nouns]) => [kind, nouns.many])) as Record<HomeKind, string>;

/** The nouns a result counts its rows with (a run's, Turn these off's): their kind's while they are of one kind, else "item". */
export const rowNouns = (kinds: readonly HomeKind[]) => (new Set(kinds).size === 1 ? kindNouns[kinds[0]!] : { one: 'item', many: 'items' });
/**
 * Reasons, each said once; where they are said over several kinds (`several`), each led by the kinds it is about ("MCP
 * servers: The MCP record is damaged. …"): a bulk Off's and its Undo's (app.ts), and the Library's bands (matrix.ts listBands).
 */
export function saidByKind(pairs: readonly [HomeKind, string][], several: boolean): string[] {
  const kindsOf = new Map<string, HomeKind[]>();
  for (const [kind, reason] of pairs) kindsOf.set(reason, [...new Set([...(kindsOf.get(reason) ?? []), kind])]);
  return [...kindsOf].map(([reason, kinds]) => (several ? `${sentence(andList(kinds.map(kind => kindNouns[kind].many)))}: ${reason}` : reason));
}
type Named = Pick<NamedRow, 'kind' | 'name'>;
/** A name with its kind after it, as a result says a name two kinds share: "review (skill)", "issues (MCP server)". */
export const withKind = ({ kind, name }: Named) => `${name} (${kindNouns[kind].one})`;
/** A result's rows by name, each with its kind after it (withKind) where a row of another kind `among` the result's has that name too. */
export const rowNames = (rows: readonly Named[], among: readonly Named[] = rows) =>
  rows.map(row => (among.some(other => other.kind !== row.kind && other.name === row.name) ? withKind(row) : row.name));

/** Why a tool gets no copy of an item it already has through a plugin: said in its box, its row and wherever a copy is refused. */
export const throughPlugin = (tool: HarnessId, given: { plugin: string; version?: string; off?: true }, item = 'skill') =>
  `${toolNames[tool]} has this ${item} through the plugin ${given.plugin}${given.version ? ` (version ${given.version})` : ''}${given.off ? ', turned off there' : ''}, so no separate copy is placed there.`;

/** Shown in View source when a hook's declaring file or script cannot be read (hooksource.ts, hooksourceview.ts, main.ts). */
export const HOOK_SOURCE_UNREADABLE = 'This file couldn’t be read.';

/**
 * Before an act that would end the profiles in use (matrix.ts endsOf; after it, in the same verb: profileLeftUse): "Everyday stays
 * saved but stops being the profile in use", `may`: "… but may stop …"; `short`: "would leave Everyday" ("might …"). profileBack: what puts it back.
 */
export function profileStops(names: readonly string[], may: boolean, short = false): string {
  const many = names.length > 1, who = andList([...names]);
  if (short) return `${may ? 'might' : 'would'} leave ${who}`;
  return `${who} ${many ? 'stay' : 'stays'} saved but ${may ? 'may stop' : many ? 'stop' : 'stops'} being the ${many ? 'profiles' : 'profile'} in use`;
}
export const profileBack = (names: readonly string[]) => `Undo, or switching to ${names.length > 1 ? 'one of them' : 'it'} again, puts it back in use.`;

/**
 * Says that profiles stopped being in use (after an act: app.ts profileEndedLine):
 * "Everyday stopped being the profile in use.", or for several "Everyday and Focus stopped being the profiles in use.".
 */
export function profileLeftUse(names: readonly string[]): string {
  if (!names.length) return '';
  return `${andList([...names])} stopped being the ${names.length === 1 ? 'profile' : 'profiles'} in use.`;
}

