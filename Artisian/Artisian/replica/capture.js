// Records every first-party request made while loading artisan.co pages in
// headless Chrome, so server.js can replay them with their original URLs.
// Usage: node capture.js            (all pages in pages.txt)
//        node capture.js /pricing   (specific paths)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'https://www.artisan.co';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ARCHIVE = path.join(__dirname, 'archive');
const FILES = path.join(ARCHIVE, 'files');
const MANIFEST = path.join(ARCHIVE, 'manifest.json');

// Hosts whose responses are archived; everything else is either allowed live
// (if needed for rendering) or blocked (analytics / tracking / chat widgets).
const KEEP_HOSTS = new Set([
  'www.artisan.co',
  'images.ctfassets.net',
  'artisanai-storage.sfo3.cdn.digitaloceanspaces.com',
]);
const BLOCK_RE = /googletagmanager|google-analytics|posthog|facebook|licdn|cookiebot|chilipiper|hotjar|clarity|doubleclick|hubspot|intercom|segment|withsherpa|leadresponse/;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

fs.mkdirSync(FILES, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

function keyOf(u) {
  const url = new URL(u);
  return url.host + url.pathname + url.search;
}

async function capturePage(browser, pagePath, vp) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  }
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const host = new URL(req.url()).host;
    if (BLOCK_RE.test(host)) return req.abort();
    req.continue();
  });
  let count = 0;
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.startsWith('http')) return;
      const host = new URL(url).host;
      if (!KEEP_HOSTS.has(host)) return;
      const status = res.status();
      if (status >= 300 && status < 400) return;
      if (res.request().method() !== 'GET') return;
      const key = keyOf(url);
      if (manifest[key] && manifest[key].status === 200 && status !== 200) return;
      const body = await res.buffer();
      const file = crypto.createHash('sha1').update(key).digest('hex');
      fs.writeFileSync(path.join(FILES, file), body);
      manifest[key] = { file, status, type: res.headers()['content-type'] || '' };
      count++;
    } catch { /* body unavailable (e.g. aborted / preflight) */ }
  });

  try {
    await page.goto(ORIGIN + pagePath, { waitUntil: 'networkidle2', timeout: 90000 });
    // Scroll through the page so lazy-loaded images, videos and chunks are fetched.
    await page.evaluate(async () => {
      const step = window.innerHeight / 2;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
    });
    // Hover nav items so dropdown menus load their content.
    const navItems = await page.$$('header nav button, header nav a, nav button');
    for (const el of navItems.slice(0, 12)) {
      try { await el.hover(); await new Promise((r) => setTimeout(r, 300)); } catch {}
    }
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
  } catch (e) {
    console.error(`  ! ${pagePath} (${vp.width}px): ${e.message}`);
  }
  await page.close();
  return count;
}

(async () => {
  const pages = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readFileSync(path.join(__dirname, 'pages.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));

  // Files the browser asks for outside a page load (headless Chrome skips the favicon).
  for (const p of ['/favicon.ico']) {
    const res = await fetch(ORIGIN + p, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) continue;
    const key = keyOf(ORIGIN + p);
    const file = crypto.createHash('sha1').update(key).digest('hex');
    fs.writeFileSync(path.join(FILES, file), Buffer.from(await res.arrayBuffer()));
    manifest[key] = { file, status: 200, type: res.headers.get('content-type') || '' };
  }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const queue = pages.flatMap((p) => VIEWPORTS.map((vp) => [p, vp]));
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const [p, vp] = queue.shift();
      const n = await capturePage(browser, p, vp);
      console.log(`${p} @${vp.width}px: ${n} responses`);
      save();
    }
  });
  await Promise.all(workers);
  await browser.close();
  save();
  console.log(`Done. ${Object.keys(manifest).length} URLs archived.`);
})();
