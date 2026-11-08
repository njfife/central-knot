#!/usr/bin/env node
// Serves bare Git repositories over smart HTTP on localhost, through `git http-backend`, for marketplace tests.
// Usage: node scripts/git-http-fixture.mjs <folder holding *.git repositories> [port]
// Prints the base URL, then serves until killed. Localhost only; read-only (no receive-pack).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 0);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname.endsWith('/git-receive-pack') || url.searchParams.get('service') === 'git-receive-pack') {
    response.writeHead(403).end('read-only');
    return;
  }
  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: request.method ?? 'GET', PATH_INFO: decodeURIComponent(url.pathname), QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers['content-type'] ?? '', CONTENT_LENGTH: request.headers['content-length'] ?? '',
      HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '', GIT_PROTOCOL: request.headers['git-protocol'] ?? '',
      REMOTE_ADDR: '127.0.0.1',
    },
  });
  request.pipe(backend.stdin);
  // CGI output: headers, a blank line, then the body.
  let head = Buffer.alloc(0);
  let headersDone = false;
  backend.stdout.on('data', chunk => {
    if (headersDone) { response.write(chunk); return; }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) return;
    headersDone = true;
    let status = 200;
    for (const line of head.subarray(0, end).toString('latin1').split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10) || 200;
      else response.setHeader(name, value);
    }
    response.statusCode = status;
    response.write(head.subarray(end + 4));
  });
  backend.on('close', () => response.end());
  backend.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end(); });
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  console.log(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`);
});
