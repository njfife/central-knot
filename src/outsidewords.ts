// Words for a skill's copies outside Central Knot's own: a link in a tool's skills folder, and the shared copy in ~/.agents/skills.
// One spelling of each thing: "link", "shared folder" (the folder), "shared copy" (the skill's folder in it). Pure: names in, sentences out.
import { andList, sentence } from './words.ts';

/** The skill's copy in the shared folder, and how each tool reaches it. */
export interface SharedShape {
  /** The shared folder as the page shows paths: "~/.agents/skills". */
  folder: string;
  /** Tools that read it there and have no copy of their own. */
  readers: string[];
  /** Tools with a link to it in their own skills folder. */
  linkers: string[];
  /** Tools that read it there besides a real copy of their own. */
  besides: string[];
  /** The tool whose whole skills folder is a link to the shared folder: the shared copy is the only one it can have. */
  pinnedBy?: string;
  /** The skill's entry in the shared folder is itself a link. */
  isLink?: boolean;
}
/** A tool's link that leads somewhere other than the shared copy, and where (as the page shows paths). */
export interface LinkElsewhere { tool: string; target: string }
export interface Shape {
  shared?: SharedShape;
  elsewhere: LinkElsewhere[];
  /** Some tool has a real copy of its own (the skill is not only in the shared folder). */
  ownCopies: boolean;
}

const possessive = (tools: string[]) => andList(tools.map(tool => `${tool}’s`));
const reads = (tools: string[]) => (tools.length > 1 ? 'read' : 'reads');
const has = (tools: string[]) => (tools.length > 1 ? 'have' : 'has');
const its = (tools: string[]) => (tools.length > 1 ? 'their' : 'its');
const sharedNoun = (shared: SharedShape) => (shared.isLink ? 'the shared link' : 'the shared copy');
/** What goes on Manage or Delete everywhere besides each tool's own copy: "the link and the shared copy". */
export function outsideNouns(shape: Shape): string[] {
  const links = (shape.shared?.linkers.length ?? 0) + shape.elsewhere.length;
  return [links ? (links > 1 ? 'the links' : 'the link') : '', shape.shared ? sharedNoun(shape.shared) : ''].filter(Boolean);
}
/** "History keeps it", "both" or "them all", for this many things. */
const keeps = (count: number) => `History keeps ${count > 2 ? 'them all' : count === 2 ? 'both' : 'it'}.`;
const them = (count: number) => (count > 1 ? 'them' : 'it');

/** Where the copies are, said once: the shared folder and who reads it there or links to it, and links that lead elsewhere. */
export function whereSentence(shape: Shape): string {
  const out: string[] = [];
  const shared = shape.shared;
  if (shared?.pinnedBy) {
    out.push(`${shared.pinnedBy}’s skills folder is a link to ${shared.folder}, a shared folder other apps read too, so the shared copy is the only one ${shared.pinnedBy} can have.`);
    const others = [...shared.readers, ...shared.linkers, ...shared.besides].filter(tool => tool !== shared.pinnedBy);
    if (others.length) out.push(`${andList(others)} ${reads(others)} it there too.`);
  } else if (shared) {
    out.push(`${shape.ownCopies ? 'A copy of this skill' : 'This skill'} is in ${shared.folder}, a shared folder other apps read too.`);
    const parts = [
      shared.readers.length ? `${andList(shared.readers)} ${reads(shared.readers)} it there` : '',
      shared.linkers.length ? `${andList(shared.linkers)} ${has(shared.linkers)} ${shared.linkers.length > 1 ? 'links' : 'a link'} to it` : '',
      shared.besides.length ? `${andList(shared.besides)} also ${reads(shared.besides)} it there besides ${its(shared.besides)} own copy` : '',
    ].filter(Boolean);
    if (parts.length) out.push(`${sentence(parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts[0])}.`);
  }
  for (const link of shape.elsewhere) out.push(`${link.tool} has a link to ${link.target}, outside its skills folder.`);
  return out.join(' ');
}

/** What taking the skill over does, for the tools as ticked: links replaced, tools given their own copy, tools that lose it. */
export interface TakeOverPlan {
  /** Ticked tools whose link becomes a real copy. */
  links: string[];
  /** Ticked tools that read the shared copy and get their own. */
  gets: string[];
  /** Tools left unticked that read it only in the shared folder, so lose it. */
  loses: string[];
  /** After Manage, every tool it syncs to has its own copy. */
  everyTool: boolean;
}

/** The clauses of a take-over, in the present tense: "replaces Copilot CLI’s link with a real copy", "gives Pi its own copy". */
function takeOverClauses(shape: Shape, plan: TakeOverPlan, awayNote = true): string[] {
  const elsewhere = new Set(shape.elsewhere.map(link => link.tool));
  const toShared = plan.links.filter(tool => !elsewhere.has(tool)), away = plan.links.filter(tool => elsewhere.has(tool));
  const replaced = (tools: string[]) => `replaces ${possessive(tools)} ${tools.length > 1 ? 'links with real copies' : 'link with a real copy'}`;
  return [
    toShared.length ? replaced(toShared) : '',
    away.length ? `${replaced(away)}${awayNote ? ` (what ${away.length > 1 ? 'they lead' : 'it leads'} to stays)` : ''}` : '',
    plan.gets.length ? `gives ${andList(plan.gets)} ${its(plan.gets)} own ${plan.gets.length > 1 ? 'copies' : 'copy'}` : '',
  ].filter(Boolean);
}
const clauseList = (clauses: string[]) => (clauses.length > 2 ? `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}` : clauses.join(' and '));
const losesSentence = (plan: TakeOverPlan) => (plan.loses.length ? ` ${andList(plan.loses)} ${plan.loses.length > 1 ? 'aren’t' : 'isn’t'} ticked and ${reads(plan.loses)} it only there, so ${plan.loses.length > 1 ? 'they' : 'it'} won’t have it any more.` : '');

/** Unmanaged, nothing waiting: what Manage and Delete everywhere would do. */
export function manageSentence(shape: Shape, plan: TakeOverPlan): string {
  const nouns = outsideNouns(shape);
  const away = shape.elsewhere.length && !shape.shared ? '; what it leads to stays' : '';
  const gives = plan.everyTool ? 'gives each tool its own copy' : clauseList(takeOverClauses({ ...shape, elsewhere: [] }, plan));
  const count = (shape.shared?.linkers.length ?? 0) + shape.elsewhere.length + (shape.shared ? 1 : 0);
  return `Manage ${gives ? `${gives} and ` : ''}removes ${andList(nouns)}${away}. Delete everywhere removes ${them(count)} too. ${keeps(count)}`;
}

/** Managed switched on, waiting for Apply all: what Apply all will do to them, and what other apps lose. */
export function pendingSentence(shape: Shape, plan: TakeOverPlan): string {
  const clauses = takeOverClauses(shape, plan, !!shape.shared);
  if (shape.shared) clauses.push(`removes ${sharedNoun(shape.shared)} (History keeps it)`);
  if (!clauses.length) return '';
  // Only links that lead elsewhere: what they lead to stays, and History keeps the links.
  const away = plan.links.length > 1 ? 'What they lead to stays. History keeps the links.' : 'What it leads to stays. History keeps the link.';
  const others = shape.shared ? ` Other apps that read ${shape.shared.folder} won’t find it there.` : ` ${away}`;
  return `On Apply all, Central Knot ${clauseList(clauses)}.${others}${losesSentence(plan)}`;
}

/** Replace with managed copies, armed: what the confirming click does. */
export function replaceSentence(shape: Shape, plan: TakeOverPlan): string {
  const clauses = takeOverClauses(shape, plan);
  if (shape.shared) clauses.push(`removes ${sharedNoun(shape.shared)}`);
  const count = plan.links.length + (shape.shared ? 1 : 0);
  const others = shape.shared ? ` Other apps that read ${shape.shared.folder} won’t find it there.` : '';
  return clauses.length ? `This ${clauseList(clauses)}. ${keeps(count)}${others}${losesSentence(plan)}` : '';
}

/**
 * A managed skill with them: back since it was taken over (an installer may have put them there), or never taken over. What
 * leaving them means, as built: background sync never writes a link or the shared copy, so an edit never reaches them, nor a tool
 * that reads only them (`only`).
 */
export function managedSentence(shape: Shape, back: boolean, only: string[]): string {
  const nouns = outsideNouns(shape);
  const count = (shape.shared?.linkers.length ?? 0) + shape.elsewhere.length + (shape.shared ? 1 : 0);
  const what = sentence(andList(nouns));
  const lead = back ? `${what} came back after you managed this skill; an installer may have put ${them(count)} there.` : `Central Knot doesn’t manage ${andList(nouns)}.`;
  return `${lead} Automatic sync never changes ${them(count)}, so edits won’t reach ${them(count)}${only.length ? `, or ${andList(only)}, which ${has(only)} no other copy` : ''}.`;
}

/**
 * The shared copy that is the only one a tool can have (its skills folder is a link to the shared folder): what Manage does with
 * it, and what that means for edits. `own`: tools with or getting a copy of their own; `gets`: those Manage gives one; `left`:
 * those that keep reading the shared copy.
 */
export function pinnedSentence(shared: SharedShape, managed: boolean, own: string[], left: string[], gets: string[] = []): string {
  const edits = own.length && left.length ? `, so edits made in ${andList(own)} ${managed ? 'don’t' : 'won’t'} reach ${andList(left)}` : '';
  // The other way does work: sync reads the shared copy, so an edit there spreads to the tools with their own copy.
  const back = own.length && left.length ? ` Edits made in the shared copy ${managed ? 'still reach' : 'will still reach'} ${andList(own)}.` : '';
  if (managed) return `Central Knot does not write into the shared copy${edits}.${back}`;
  const manage = gets.length ? `Manage gives ${andList(gets)} ${its(gets)} own ${gets.length > 1 ? 'copies' : 'copy'} and leaves the shared copy for ${andList(left)}.` : `Manage leaves the shared copy for ${andList(left)}.`;
  return `${manage} Central Knot does not write into it${edits}.${back} Delete everywhere removes the shared copy too. History keeps it.`;
}

/** Delete everywhere, armed: what it removes besides each tool's own copy. A link's target stays, unless it is the shared copy, which goes too. */
export function deleteNote(shape: Shape, linkers: string[]): string {
  const parts = [
    linkers.length ? `the ${linkers.length > 1 ? 'links' : 'link'} in ${possessive(linkers)} skills ${linkers.length > 1 ? 'folders' : 'folder'}` : '',
    ...shape.elsewhere.map(link => `the link in ${link.tool}’s skills folder (not what it leads to)`),
    shape.shared ? `${sharedNoun(shape.shared)} in ${shape.shared.folder}, which other apps may read too` : '',
  ].filter(Boolean);
  return parts.length ? `This also removes ${andList(parts)}.` : '';
}

/** One tool's row: where it gets the skill today, or what Apply all does to it. */
export const rowWords = {
  linkToShared: (folder: string) => `A link to the shared copy in ${folder}.`,
  linkElsewhere: (target: string) => `A link to ${target}.`,
  readsShared: (folder: string) => `Reads the shared copy in ${folder}.`,
  alsoShared: (folder: string) => `Also reads the shared copy in ${folder}.`,
  pinned: (folder: string) => `Its skills folder is a link to ${folder}, so it reads the shared copy there.`,
  linkBecomesCopy: 'Its link becomes a real copy on Apply all, then it syncs.',
  getsOwn: 'Gets its own copy on Apply all, then it syncs.',
  loses: 'Reads only the shared copy, which goes on Apply all, so it won’t have this skill any more.',
} as const;

/** "replaced Copilot CLI’s link with a real copy", or for several tools "replaced Copilot CLI’s and Pi’s links with real copies". */
const replacedLinks = (tools: string[]) => `replaced ${possessive(tools)} ${tools.length > 1 ? 'links with real copies' : 'link with a real copy'}`;

/**
 * What a take-over did, after Apply all or Replace with managed copies, as clauses: the links replaced and the shared copy
 * removed. One skill names the tools; several skills are counted, as the count before Apply all counted them.
 */
export function tookOverDone(links: { tool: string; item: string }[], shared: { folder: string; item: string }[]): string[] {
  const folders = [...new Set(shared.map(copy => copy.folder))];
  if (new Set([...links, ...shared].map(entry => entry.item)).size > 1) {
    return [links.length ? `replaced ${links.length} ${links.length > 1 ? 'links with real copies' : 'link with a real copy'}` : '',
      shared.length ? `removed ${shared.length} ${shared.length > 1 ? 'shared copies' : 'shared copy'} from ${andList(folders)}` : ''].filter(Boolean);
  }
  const tools = [...new Set(links.map(link => link.tool))];
  return [tools.length ? replacedLinks(tools) : '', shared.length ? `removed the shared copy in ${andList(folders)}` : ''].filter(Boolean);
}

/** The band after Replace with managed copies: "opus: replaced Copilot CLI’s link with a real copy and removed the shared copy in ~/.agents/skills. History keeps both." */
export function replacedText(name: string, clauses: string[], count: number): string {
  return `${name}: ${clauses.join(' and ')}. ${keeps(count)}`;
}

/** A take-over as History tells it: links replaced, tools given their own copy, the shared copy removed. */
export function tookOverHistory(replaced: string[], placed: string[], folder: string | undefined): string {
  const parts = [
    replaced.length ? replacedLinks(replaced) : '',
    placed.length ? `gave ${andList(placed)} ${placed.length > 1 ? 'their own copies' : 'its own copy'}` : '',
    folder ? `removed the shared copy in ${folder}` : '',
  ].filter(Boolean);
  return sentence(parts.length ? parts.join('; ') : 'took over its copies outside Central Knot');
}

/** What an Undo of take-overs put back: "Copilot CLI’s link and the shared copy are back"; across several skills, counted. */
export function backText(links: { tool: string; item: string }[], shared: { item: string }[]): string {
  if (!links.length && !shared.length) return '';
  if (new Set([...links, ...shared].map(entry => entry.item)).size > 1) {
    const counted = [links.length ? `${links.length} ${links.length > 1 ? 'links' : 'link'}` : '', shared.length ? `${shared.length} ${shared.length > 1 ? 'shared copies' : 'shared copy'}` : ''].filter(Boolean);
    return `${sentence(andList(counted))} ${links.length + shared.length > 1 ? 'are' : 'is'} back.`;
  }
  const tools = [...new Set(links.map(link => link.tool))];
  const back = [tools.length ? `${possessive(tools)} ${tools.length > 1 ? 'links' : 'link'}` : '', shared.length ? 'the shared copy' : ''].filter(Boolean);
  return `${sentence(andList(back))} ${back.length > 1 || tools.length > 1 ? 'are' : 'is'} back.`;
}

/**
 * Undo of a take-over, conclusion first so a narrow status bar keeps what matters: "Undone: opus is unmanaged again. Copilot
 * CLI’s link and the shared copy are back."
 */
export function undoneText(name: string, back: string, removedIn: string[], unmanaged: boolean): string {
  return [`Undone${unmanaged ? `: ${name} is unmanaged again.` : '.'}`, back || 'Its copies are back as they were.',
    removedIn.length ? `Removed the new copies in ${andList(removedIn)}.` : ''].filter(Boolean).join(' ');
}

/** The result of Delete everywhere, managed or not: the skill named, the tools, and the shared folder. */
export function deletedText(name: string, tools: string[], folders: string[]): string {
  const where = [tools.length ? `from ${andList(tools)}` : '', folders.length ? `${tools.length ? ', and ' : ''}from ${andList(folders)}` : ''].join('');
  return `Deleted ${name}${where ? ` ${where}` : ''}. History keeps it.`;
}

/**
 * A managed skill whose copies are the same, where some tools have only a link or the shared copy: "Synced" is said only for the
 * tools Central Knot writes, since edits never reach the others. `synced` is said as a phrase ("Claude Code", "all 3 tools");
 * `via`: whether those tools reach the shared copy, a link elsewhere, or some of each.
 */
export function syncedSome(synced: string, readers: string[], via: 'shared' | 'link' | 'both'): string {
  const what = via === 'shared' ? 'the shared copy' : via === 'link' ? 'it through a link' : 'a link or the shared copy';
  return `${synced ? `Synced in ${synced}` : 'Same copy everywhere'} · ${andList(readers)} ${reads(readers)} ${what}, which Central Knot doesn’t write`;
}

/** Restore after deleting a managed skill, for the links and the shared copy it doesn't put back: each tool has its own copy instead, as Manage gives it. */
export function notPutBack(links: number, shared: number): string {
  const nouns = [links ? (links > 1 ? 'the links' : 'the link') : '', shared ? 'the shared copy' : ''].filter(Boolean);
  return `Each tool has its own copy now; ${andList(nouns)} ${links + shared > 1 ? 'aren’t' : 'isn’t'} put back.`;
}

/** Where a link leads, as a path: its text joined to the folder it sits in, `..` and `.` resolved. */
export function linkTarget(linkPath: string, linkTo: string): string {
  const start = linkTo.startsWith('/') ? [] : linkPath.split('/').slice(0, -1);
  const parts: string[] = [];
  for (const part of [...start, ...linkTo.split('/')]) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return `/${parts.join('/')}`;
}
