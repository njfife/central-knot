import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CARRIED_FOLDER, CUSTOM_FILE, readCustomBuild } from '../src/bundle.ts';
import { STANDARD_NAME } from '../src/bundlepack.ts';

const families = ['inter', 'jetbrains-mono'];
const subsets = ['latin', 'latin-ext', 'cyrillic', 'greek'];

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await build({ entryPoints: ['src/renderer.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome140' });
await cp('src/index.html', 'dist/index.html');
await cp('src/style.css', 'dist/style.css');
await cp('assets/logo.svg', 'dist/logo.svg');
await mkdir('dist/fonts', { recursive: true });
for (const family of families) {
  const folder = `node_modules/@fontsource-variable/${family}`;
  await cp(`${folder}/LICENSE`, `dist/fonts/${family}-LICENSE`);
  for (const subset of subsets) await cp(`${folder}/files/${family}-${subset}-wght-normal.woff2`, `dist/fonts/${family}-${subset}.woff2`);
}

// A custom build (ORG-01, ORG-06): CK_CUSTOM_BUILD names a folder staged by scripts/custom-build.mjs. Its identity file and
// the release it carries go in beside the code, and the app calls itself by the build's own name and shows its own mark.
// Without it the build is the standard app, and whatever an earlier custom build left in dist/ is removed.
await rm(join('dist', CUSTOM_FILE), { force: true });
await rm(join('dist', CARRIED_FOLDER), { recursive: true, force: true });
await rm('dist/logo.png', { force: true });
const staged = process.env.CK_CUSTOM_BUILD;
if (staged) {
  const custom = await readCustomBuild(staged);
  if (!custom) throw new Error(`CK_CUSTOM_BUILD: ${staged} holds no ${CUSTOM_FILE} that can be read. Stage it with scripts/custom-build.mjs.`);
  await cp(join(staged, CUSTOM_FILE), join('dist', CUSTOM_FILE));
  if (await stat(join(staged, CARRIED_FOLDER)).catch(() => undefined)) await cp(join(staged, CARRIED_FOLDER), join('dist', CARRIED_FOLDER), { recursive: true });
  // The sidebar's mark: the app icon when it was given as a picture the page can show (CK_CUSTOM_LOGO: a .png made from an .icns).
  const mark = process.env.CK_CUSTOM_LOGO || (await stat(join(staged, 'app-icon.png')).catch(() => undefined) ? join(staged, 'app-icon.png') : undefined);
  if (mark) await cp(mark, 'dist/logo.png');
  // The app's name, wherever the app says it. In code the name is written with every character but letters, digits and
  // spaces escaped, which reads the same inside any quotes; in the page, as HTML text.
  const inCode = [...custom.name].map(char => (/[A-Za-z0-9 ]/.test(char) ? char : [...Array(char.length).keys()].map(at => `\\u${char.charCodeAt(at).toString(16).padStart(4, '0')}`).join(''))).join('');
  const inPage = custom.name.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  for (const [file, name] of [['dist/main.cjs', inCode], ['dist/preload.cjs', inCode], ['dist/renderer.js', inCode], ['dist/index.html', inPage]]) {
    let text = (await readFile(file, 'utf8')).replaceAll(STANDARD_NAME, () => name);
    if (mark && file === 'dist/index.html') text = text.replace('src="logo.svg"', 'src="logo.png"');
    await writeFile(file, text);
  }
}
