import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, ValidationError, NotFoundError } from './store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'request body must be valid JSON');
  }
}

// [method, pattern, handler(store, params, req, url)] — handlers return [status, body].
const routes = [
  ['GET', /^\/api\/users$/, (s, _p, _r, url) => [200, s.listUsers({ q: url.searchParams.get('q') })]],
  ['POST', /^\/api\/users$/, async (s, _p, req) => [201, s.createUser(await readJson(req))]],
  ['GET', /^\/api\/users\/([^/]+)$/, (s, [id]) => [200, s.getUser(id)]],
  ['PATCH', /^\/api\/users\/([^/]+)$/, async (s, [id], req) => [200, s.updateAccount(id, await readJson(req))]],
  ['DELETE', /^\/api\/users\/([^/]+)$/, (s, [id]) => { s.deleteUser(id); return [204]; }],
  ['POST', /^\/api\/users\/([^/]+)\/interests$/,
    async (s, [id], req) => [200, s.addInterest(id, (await readJson(req)).interest)]],
  ['DELETE', /^\/api\/users\/([^/]+)\/interests\/([^/]+)$/,
    (s, [id, interest]) => [200, s.removeInterest(id, interest)]],
  ['PUT', /^\/api\/users\/([^/]+)\/subreddits$/,
    async (s, [id], req) => [200, s.setSubredditInterest(id, await readJson(req))]],
  ['DELETE', /^\/api\/users\/([^/]+)\/subreddits\/([^/]+)$/,
    (s, [id, subreddit]) => [200, s.removeSubredditInterest(id, subreddit)]],
  ['POST', /^\/api\/users\/([^/]+)\/schedule$/,
    async (s, [id], req) => [200, s.addScheduleEntry(id, await readJson(req))]],
  ['DELETE', /^\/api\/users\/([^/]+)\/schedule\/([^/]+)$/,
    (s, [id, entryId]) => [200, s.removeScheduleEntry(id, entryId)]],
];

async function handleApi(store, req, res, url) {
  let pathMatched = false;
  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (!match) continue;
    pathMatched = true;
    if (method !== req.method) continue;
    const params = match.slice(1).map(decodeURIComponent);
    const [status, body] = await handler(store, params, req, url);
    return send(res, status, body);
  }
  throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method not allowed' : 'not found');
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, relative));
  if (!file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(404, 'not found');
  let content;
  try {
    content = await readFile(file);
  } catch {
    throw new HttpError(404, 'not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : content);
}

export function createServer(store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(store, req, res, url);
      else await serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'internal server error' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = new Store({
    file: process.env.DB_FILE || join(ROOT, 'data', 'db.json'),
    seedFile: join(ROOT, 'data', 'seed.json'),
  });
  const port = Number(process.env.PORT) || 3000;
  createServer(store).listen(port, () => {
    console.log(`account-spawn listening on http://localhost:${port}`);
  });
}
