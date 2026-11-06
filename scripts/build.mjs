import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await build({ entryPoints: ['src/renderer.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome140' });
await cp('src/index.html', 'dist/index.html');
await cp('src/style.css', 'dist/style.css');
