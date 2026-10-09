// Loads pages from the local replica (server.js must be running) and reports
// requests missing from the archive, JS errors, and saves screenshots.
// Usage: node verify.js [paths...]   (defaults to pages.txt)
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE || 'http://localhost:3005';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const pages = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readFileSync(path.join(__dirname, 'pages.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  let problems = 0;
  for (const p of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const missing = new Set();
    const errors = [];
    page.on('response', (r) => {
      if (r.url().startsWith(BASE) && r.status() >= 400) missing.add(r.status() + ' ' + r.url().slice(BASE.length));
    });
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errors.push(e.message));
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 450) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
    const name = (p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')) + '.png';
    await page.screenshot({ path: path.join(SHOTS, name) });
    const ok = !missing.size && !errors.length;
    if (!ok) problems++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${p}`);
    for (const m of missing) console.log('     missing ' + m);
    for (const e of errors) console.log('     error   ' + e);
    await page.close();
  }
  await browser.close();
  console.log(`\n${pages.length - problems}/${pages.length} pages clean.`);
})();
