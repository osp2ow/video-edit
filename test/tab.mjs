import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
for (const f of process.argv.slice(2)) {
  await page.setInputFiles('#f-sheet', f);
  await page.waitForFunction(() => /찾았어요|찾지 못했|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 30000 });
  console.log(f.split('/').pop(), '→', await page.evaluate(() => document.querySelector('.status')?.textContent)); await page.evaluate(() => { const s = document.querySelector('.status'); if (s) s.textContent = ''; });
}
console.log(logs.join('\n')); await browser.close();
