// The build side of a custom build (ORG-01, ORG-02, ORG-06): reads the optional build inputs, packs a marketplace into one
// release (bundle.ts), and stages what the app's build then takes in. Nothing here needs a Mac or Electron, so the same code
// runs in a local build, in CI and in tests. What a marketplace holds is copied as it is: only the fetch's own .git folders
// stay behind, and an entry is rewritten only to point at files that were fetched from elsewhere for it.
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { BUILD_ID, CARRIED_FOLDER, CUSTOM_FILE, RELEASE_FILE, fileDigest, packArchive, releaseLabel, type BundleRelease, type CustomBuild } from './bundle.ts';
import { CODEX_MANIFEST, MANIFEST, parseObject, sourceLabel } from './catalogdetail.ts';
import { parseCatalog, readCatalog, readRemotePlugin, type PluginContext } from './plugins.ts';
import { isFolder, record, text } from './values.ts';
import type { CatalogPlugin } from './types.ts';

// ---------- The build's optional inputs ----------

/** The standard app's name, which a custom build keeps unless it is given its own. */
export const STANDARD_NAME = 'Central Knot';

/** The optional inputs a build takes. None given: the standard app. */
export interface BuildInputs {
  /** The marketplace to carry: owner/repo, a Git URL or a folder. */
  marketplace?: string;
  appName?: string;
  appId?: string;
  /** The app's icon: a .png (1024 by 1024) or a Mac .icns. */
  appIcon?: string;
  marketplaceName?: string;
  marketplaceLogo?: string;
  /** The release's place in the order of releases; the time it was made when not given. */
  sequence?: number;
}

const OPTIONS: Record<string, keyof BuildInputs> = {
  '--marketplace': 'marketplace', '--app-name': 'appName', '--app-id': 'appId', '--app-icon': 'appIcon',
  '--marketplace-name': 'marketplaceName', '--marketplace-logo': 'marketplaceLogo', '--sequence': 'sequence',
};

/**
 * The build inputs among a command line's arguments (`--name value` or `--name=value`), and the arguments that are not
 * build inputs, left for the caller. An input given without a value, or twice, is an error said in plain words.
 */
export function buildInputs(args: string[]): { inputs: BuildInputs; rest: string[] } {
  const inputs: BuildInputs = {};
  const rest: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const [name, inline] = args[at]!.split(/=(.*)/s) as [string, string | undefined];
    const key = OPTIONS[name];
    if (!key) { rest.push(args[at]!); continue; }
    const value = inline ?? args[++at];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Error(`${name} needs a value.`);
    if (inputs[key] !== undefined) throw new Error(`${name} was given twice.`);
    if (key === 'sequence') {
      if (!/^\d{1,15}$/.test(value)) throw new Error('--sequence takes a whole number: a later release has a higher one.');
      inputs.sequence = Number(value);
    } else inputs[key] = value;
  }
  return { inputs, rest };
}

/** Whether any optional input was given: any one makes the build a custom build, with its own identity (ORG-01). */
export const isCustom = (inputs: BuildInputs) => Object.values(inputs).some(value => value !== undefined);

/** An identity from a name: "Acme Knot" is "acme-knot". */
const slug = (name: string) => name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/**
 * The custom build these inputs describe, or why they describe none. Every custom build is given its name: left with the
 * standard app's, its file would take the standard app's place in Applications. Marketplace branding with no marketplace
 * is refused rather than built without one. The identity is `--app-id`, else made from the name.
 */
export function describeBuild(inputs: BuildInputs): CustomBuild {
  if (!inputs.marketplace && (inputs.marketplaceName || inputs.marketplaceLogo)) throw new Error('--marketplace-name and --marketplace-logo are for a build that carries a marketplace: add --marketplace.');
  if (!inputs.marketplace && inputs.sequence !== undefined) throw new Error('--sequence orders a carried marketplace’s releases: add --marketplace.');
  if (inputs.appName === undefined) throw new Error(`A custom build needs its own name: add --app-name "<name>". Under the standard app’s name it would take that app’s place in Applications.`);
  const name = inputs.appName.trim();
  if (!name || name.length > 60 || /[\\/:\n\r\t]/.test(name) || name.startsWith('.')) throw new Error('--app-name is the app’s name as people see it: up to 60 characters, without / \\ : or line breaks.');
  const id = inputs.appId ?? slug(name);
  if (!BUILD_ID.test(id) || id === 'central-knot') throw new Error(inputs.appId ? '--app-id is lower-case letters, digits, dots and dashes (not “central-knot”, the standard app’s).' : 'Give the build an identity with --app-id: lower-case letters, digits, dots and dashes.');
  for (const [option, file, kinds] of [['--app-icon', inputs.appIcon, ['.png', '.icns']], ['--marketplace-logo', inputs.marketplaceLogo, ['.png', '.svg', '.jpg', '.jpeg', '.webp']]] as const) {
    if (file && !(kinds as readonly string[]).includes(extname(file).toLowerCase())) throw new Error(`${option} takes a ${kinds.join(' or ')} file.`);
  }
  return { id, name, bundleId: `com.centralknot.custom.${id}`,
    ...(inputs.marketplace ? { marketplace: { ...(inputs.marketplaceName?.trim() ? { displayName: inputs.marketplaceName.trim() } : {}), ...(inputs.marketplaceLogo ? { logo: `marketplace-logo${extname(inputs.marketplaceLogo).toLowerCase()}` } : {}) } } : {}) };
}

// ---------- Packing a marketplace ----------

const exists = (path: string) => stat(path).then(() => true, () => false);
/**
 * The commit a folder is at, when it is a Git repository's own top folder (a folder inside some other repository names no
 * commit of its own), with a note when it holds changes that commit doesn't.
 */
const gitCommit = (folder: string) => new Promise<string>(done => execFile('git', ['-C', folder, 'rev-parse', '--show-prefix', 'HEAD'], { encoding: 'utf8' }, (error, out) => {
  const [prefix, head] = error ? [] : out.split('\n');
  if (error || prefix !== '' || !head) { done(''); return; }
  execFile('git', ['-C', folder, 'status', '--porcelain'], { encoding: 'utf8' }, (failed, changes) => done(`${head.slice(0, 10)}${!failed && changes.trim() ? ' with changes not committed' : ''}`));
}));

/** Copies a folder as it is (modes and links kept), without the .git folder at its top: the fetch's own, never content. */
const copyTree = (from: string, to: string) => cp(from, to, { recursive: true, verbatimSymlinks: true, filter: source => resolve(source) !== resolve(from, '.git') });

/** Why a plugin whose files aren't in the marketplace can't be fetched for packing, from its entry. */
function whyNotFetched(plugin: CatalogPlugin): string {
  const kind = text(record(plugin.entry?.source)?.source);
  if (typeof plugin.entry?.source === 'string') return `Its folder (${plugin.entry.source}) is not in the marketplace.`;
  return plugin.from ? `Its files are kept elsewhere (${plugin.from.label}), in a form that can’t be fetched here.` : kind ? `Its files are kept elsewhere (${kind}), in a form that can’t be fetched here.` : 'Its entry doesn’t say where its files are.';
}

/**
 * Packs one release of a marketplace into `out`: release.json and the archive it names. `source` is owner/repo, a Git URL
 * (fetched with this computer's own Git sign-in into `work`) or a folder. Every plugin's files go in: one kept in another
 * repository is fetched and its entry pointed at the copy, which sits in a folder of its own in the archive (the manifest
 * is then written again as JSON: every value as it was, its layout not). A plugin that
 * can't be fetched is named in `unpackaged` with the reason; its entry stays as written, and the release is still made.
 */
export async function packRelease({ source, out, work, sequence, now = new Date(), fetchPlugin = readRemotePlugin }: { source: string; out: string; work: string; sequence?: number; now?: Date; /** Fetches a plugin kept in another repository; replaceable in tests. */ fetchPlugin?: typeof readRemotePlugin }): Promise<{ release: BundleRelease } | { problem: string }> {
  const context: PluginContext = { home: work, dataDir: join(work, 'fetched'), binaries: {} };
  const where = isFolder(source) ? resolve(source) : source.trim();
  const catalog = await readCatalog(context, where);
  if (catalog.problem || !catalog.root) return { problem: `The marketplace (${source}) could not be read: ${catalog.problem ?? 'it has no files.'}` };
  const commit = await gitCommit(catalog.root);
  const stage = join(work, 'snapshot');
  await rm(stage, { recursive: true, force: true });
  await copyTree(catalog.root, stage);

  // Plugins kept elsewhere: fetched, copied into a folder of their own, and their entries pointed there.
  let held = '_bundled';
  for (let n = 2; await exists(join(stage, held)); n++) held = `_bundled-${n}`;
  const moved = new Map<string, string>();
  const unpackaged: BundleRelease['unpackaged'] = [];
  for (const plugin of catalog.plugins) {
    if (plugin.folder) { if (!(await exists(plugin.folder))) unpackaged.push({ name: plugin.name, reason: whyNotFetched(plugin) }); continue; }
    if (!plugin.remote) { unpackaged.push({ name: plugin.name, reason: whyNotFetched(plugin) }); continue; }
    const copy = await fetchPlugin(context, plugin.remote);
    if ('problem' in copy) { unpackaged.push({ name: plugin.name, reason: `Its files couldn’t be fetched from ${plugin.from?.label ?? plugin.remote.url}: ${copy.problem}` }); continue; }
    await mkdir(join(stage, held), { recursive: true });
    await cp(copy.folder, join(stage, held, plugin.name), { recursive: true, verbatimSymlinks: true, filter: path => resolve(path) !== resolve(copy.root, '.git') });
    moved.set(plugin.name, `./${held}/${plugin.name}`);
  }
  if (moved.size) {
    for (const [file, local] of [[MANIFEST, (path: string): unknown => path], [CODEX_MANIFEST, (path: string): unknown => ({ source: 'local', path })]] as const) {
      const manifest = parseObject(await readFile(join(stage, file), 'utf8').catch(() => ''));
      if (!manifest || !Array.isArray(manifest.plugins)) continue;
      for (const entry of manifest.plugins.map(record)) if (entry && moved.has(text(entry.name))) entry.source = local(moved.get(text(entry.name))!);
      await writeFile(join(stage, file), `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  // What the archive holds is read once more, as the app will read it: a plugin counts as packed only if it is found there.
  const packed = await parseCatalog(stage, stage, 'folder', { counts: false });
  if (packed.problem) return { problem: `The packed marketplace could not be read back: ${packed.problem}` };
  const missing = new Set(unpackaged.map(item => item.name));
  for (const plugin of packed.plugins) if (!plugin.folder && !missing.has(plugin.name)) unpackaged.push({ name: plugin.name, reason: 'Its files are not in the packed marketplace.' });
  const left = new Set(unpackaged.map(item => item.name));

  const order = sequence ?? Math.floor(now.getTime() / 1000);
  const archive = `content-${order}.tgz`;
  await mkdir(out, { recursive: true });
  const failed = await packArchive(stage, join(out, archive));
  if (failed) return { problem: `The marketplace could not be packed: ${failed}` };
  const release: BundleRelease = { format: 1, marketplace: packed.name, sequence: order, madeAt: now.toISOString(),
    from: `${sourceLabel(where)}${commit ? ` at ${commit}` : ''}`, archive, ...(await fileDigest(join(out, archive))),
    plugins: packed.plugins.filter(plugin => !left.has(plugin.name)).map(plugin => ({ name: plugin.name, ...(plugin.version ? { version: plugin.version } : {}) })), unpackaged };
  await writeFile(join(out, RELEASE_FILE), `${JSON.stringify(release, null, 2)}\n`);
  await rm(stage, { recursive: true, force: true });
  return { release };
}

// ---------- Staging a custom build ----------

/** A staged custom build: what the app's build takes in (scripts/build.mjs), and the report of what was made. */
export interface StagedBuild { build: CustomBuild; release?: BundleRelease; /** The app icon as given, copied beside the rest. */ icon?: string; report: string }

/**
 * Stages a custom build in `out` from the inputs: custom-build.json, the carried release under bundle/ with the marketplace's
 * logo, the app icon, and build-report.txt. `work` is scratch space for the fetch. The report says what the build is, what
 * it carries, each plugin that could not be packed, and that it has no update location and no content feed.
 */
export async function stageCustomBuild(inputs: BuildInputs, { out, work, now }: { out: string; work: string; now?: Date }): Promise<StagedBuild> {
  // The inputs are checked before anything is fetched.
  const build = describeBuild(inputs);
  for (const [option, file] of [['--app-icon', inputs.appIcon], ['--marketplace-logo', inputs.marketplaceLogo]] as const) {
    if (file && !(await stat(file).then(found => found.isFile(), () => false))) throw new Error(`${option}: there is no file at ${file}.`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  let release: BundleRelease | undefined;
  if (inputs.marketplace) {
    const packed = await packRelease({ source: inputs.marketplace, out: join(out, CARRIED_FOLDER), work, sequence: inputs.sequence, now });
    if ('problem' in packed) throw new Error(packed.problem);
    release = packed.release;
  }
  if (inputs.marketplaceLogo && build.marketplace?.logo) await copyFile(inputs.marketplaceLogo, join(out, CARRIED_FOLDER, build.marketplace.logo));
  const icon = inputs.appIcon ? `app-icon${extname(inputs.appIcon).toLowerCase()}` : undefined;
  if (icon) await copyFile(inputs.appIcon!, join(out, icon));
  await writeFile(join(out, CUSTOM_FILE), `${JSON.stringify(build, null, 2)}\n`);
  const report = buildReport(build, release, inputs);
  await writeFile(join(out, 'build-report.txt'), report);
  return { build, release, icon, report };
}

/** The build report: what was built, in plain lines. */
export function buildReport(build: CustomBuild, release: BundleRelease | undefined, inputs: BuildInputs): string {
  const lines = [
    `${build.name}: a custom build of Central Knot`,
    '',
    `Identity: ${build.id} (${build.bundleId}). Its settings are its own: it installs beside the standard app and never shares its settings.`,
    `App name: ${build.name}${build.name === STANDARD_NAME ? ' (the standard app’s name: the two can’t be in one folder)' : ''}`,
    `App icon: ${inputs.appIcon ? basename(inputs.appIcon) : 'the standard icon'}`,
  ];
  if (release) {
    lines.push('',
      `Marketplace: ${release.marketplace}${build.marketplace?.displayName ? `, shown as “${build.marketplace.displayName}”` : ''}${inputs.marketplaceLogo ? `, with the logo ${basename(inputs.marketplaceLogo)}` : ''}`,
      `Release: ${releaseLabel(release)}, sequence ${release.sequence}`,
      `Archive: ${release.archive}, ${release.size} bytes, SHA-256 ${release.sha256}`,
      `Plugins packed (${release.plugins.length}): ${release.plugins.map(plugin => `${plugin.name}${plugin.version ? ` ${plugin.version}` : ''}`).join(', ') || 'none'}`);
    if (release.unpackaged.length) lines.push(`NOT PACKED (${release.unpackaged.length}): the build carries no files for these, and it offers no install of them.`, ...release.unpackaged.map(item => `  - ${item.name}: ${item.reason}`));
  } else lines.push('', 'Marketplace: none. This build carries no marketplace.');
  lines.push('',
    'App updates: not met. No update location is configured, so this build does not update itself. It never uses the standard app’s updates.',
    release ? 'Content feed: not met. No feed is configured, so the carried marketplace changes only with a new build.' : 'Content feed: none (no marketplace is carried).');
  return `${lines.join('\n')}\n`;
}

/** A file name for the build's downloads: "Acme Knot" is "Acme-Knot". */
export const downloadName = (name: string) => name.trim().replace(/\s+/g, '-');
