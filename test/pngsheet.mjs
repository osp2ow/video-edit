import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
for (const f0 of process.argv.slice(2)) { const f = f0.includes('+') ? f0.split('+') : f0;
  await page.setInputFiles('#f-sheet', f);
  await page.waitForFunction(() => !document.querySelector('.status')?.textContent?.includes('찾는 중'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(String(f).split('/').pop(), '→', await page.evaluate(() => document.querySelector('.status')?.textContent));
}
await browser.close();
