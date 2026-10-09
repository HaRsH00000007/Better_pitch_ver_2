// Replays the archive recorded by capture.js on http://localhost:PORT.
// Usage: node server.js   (PORT env var optional, default 3005)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3005;
const ARCHIVE = path.join(__dirname, 'archive');
const manifest = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'manifest.json'), 'utf8'));
const SITE = 'www.artisan.co';
const EXT_HOSTS = ['images.ctfassets.net', 'artisanai-storage.sfo3.cdn.digitaloceanspaces.com'];

// Indexes for fuzzy fallbacks.
const imageByUrl = {};   // /_next/image?url=X  -> [{w, key}]
const rscByPath = {};    // pathname            -> key of any recorded ?_rsc= response
for (const key of Object.keys(manifest)) {
  if (!key.startsWith(SITE + '/')) continue;
  const u = new URL('http://' + key);
  if (u.pathname === '/_next/image') {
    const src = u.searchParams.get('url');
    (imageByUrl[src] ||= []).push({ w: Number(u.searchParams.get('w')) || 0, key });
  } else if (u.searchParams.has('_rsc')) {
    rscByPath[u.pathname] ||= key;
  }
}

// Redirects the live site performs (checked with curl).
const REDIRECTS = {
  '/talk-to-sales': '/request-demo',
};

const TEXT_RE =/text\/|javascript|json|x-component|svg|xml/;

// Replacements must keep the exact byte length: Next.js embeds RSC "T" rows
// whose length prefix covers this text, and a mismatch breaks hydration
// ("Connection closed."). "http://localhost:" + 5-digit zero-padded port is
// 22 chars, same as "https://www.artisan.co"; "/__ext//" is 8 chars, same as "https://".
const LOCAL_ORIGIN = 'http://localhost:' + String(PORT).padStart(5, '0');

function rewrite(body) {
  let s = body.toString('utf8');
  s = s.split('https://www.artisan.co').join(LOCAL_ORIGIN);
  for (const h of EXT_HOSTS) s = s.split('https://' + h).join('/__ext//' + h);
  return s;
}

function lookup(u) {
  if (u.pathname.startsWith('/__ext/')) {
    const k = u.pathname.replace(/^\/__ext\/+/, '') + u.search;
    return manifest[k] ? k : null;
  }
  const exact = SITE + u.pathname + u.search;
  if (manifest[exact]) return exact;

  if (u.pathname === '/_next/image') {
    // Image URLs rewritten to /__ext/<host> by rewrite() come back here; map them to the original.
    const src = u.searchParams.get('url').replace(/^\/__ext\/+/, 'https://');
    const list = imageByUrl[src];
    if (!list) return null;
    const w = Number(u.searchParams.get('w')) || 0;
    return list.slice().sort((a, b) => Math.abs(a.w - w) - Math.abs(b.w - w))[0].key;
  }
  if (u.searchParams.has('_rsc')) return rscByPath[u.pathname] || null;

  // Same path without query string, and trailing-slash variants.
  const bare = u.pathname.replace(/\/+$/, '') || '/';
  for (const k of [SITE + bare, SITE + bare + '/']) if (manifest[k]) return k;
  return null;
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  // Analytics endpoints (PostHog proxy) - answer with an empty success so nothing errors.
  if (u.pathname.startsWith('/ingest') || req.method !== 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{}');
  }
  const key = lookup(u);
  if (!key && REDIRECTS[u.pathname]) {
    res.writeHead(308, { location: REDIRECTS[u.pathname] });
    return res.end();
  }
  if (!key) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not in archive: ' + u.pathname + u.search + '\nRun: node capture.js ' + u.pathname);
  }
  const entry = manifest[key];
  let body = fs.readFileSync(path.join(ARCHIVE, 'files', entry.file));
  if (TEXT_RE.test(entry.type)) body = rewrite(body);
  res.writeHead(entry.status === 200 ? 200 : entry.status, {
    'content-type': entry.type || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(body);
}).listen(PORT, () => console.log(`Artisan replica running at http://localhost:${PORT}`));
