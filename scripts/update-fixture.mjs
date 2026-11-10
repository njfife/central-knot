// A stand-in for GitHub's releases for update tests: a list shaped like `GET /repos/{owner}/{repo}/releases`, and each
// release's Mac zip, served on this computer only. The app reads it through CK_UPDATE_RELEASES (src/updater.ts).
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';

/**
 * Serves `releases`: each `{ tag, zip }`, `zip` a file path, newest first. Options per release: `cut` (send only that share of
 * the zip, then drop the connection: an interrupted download), `bytesPerSecond` (a slow download, for watching progress).
 * `port`: a fixed port, for builds that have the fixture's address built in. Returns `{ url, releasesUrl, served, close }`;
 * `served` lists the zip requests.
 */
export async function serveReleases(releases, port = 0) {
  const served = [];
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://fixture');
    if (pathname === '/releases') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(releases.map(release => ({
        tag_name: release.tag, name: `Central Knot ${release.tag}`, draft: false, prerelease: release.tag.includes('-'),
        html_url: `https://github.com/njfife/central-knot/releases/tag/${release.tag}`,
        assets: [{ name: 'Central-Knot-0.5.0-mac-arm64.zip', size: statSync(release.zip).size, browser_download_url: `${url}/download/${release.tag}/Central-Knot-0.5.0-mac-arm64.zip` }],
      }))));
      return;
    }
    const release = releases.find(entry => pathname === `/download/${entry.tag}/Central-Knot-0.5.0-mac-arm64.zip`);
    if (!release) { response.writeHead(404); response.end(); return; }
    served.push(release.tag);
    const bytes = readFileSync(release.zip);
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length });
    const end = release.cut ? Math.floor(bytes.length * release.cut) : bytes.length;
    const step = release.bytesPerSecond ? Math.ceil(release.bytesPerSecond / 10) : end;
    let at = 0;
    const next = () => {
      if (response.destroyed) return;
      if (at >= end) { if (release.cut) response.destroy(); else response.end(); return; }
      response.write(bytes.subarray(at, Math.min(end, at + step)));
      at += step;
      if (release.bytesPerSecond) setTimeout(next, 100); else setImmediate(next);
    };
    next();
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, releasesUrl: `${url}/releases`, served, close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
