// 로고 워터마크를 오른쪽 위(↗)에 넣었을 때 악보 카드와 겹치는지 화면 확인
import { chromium } from 'playwright-core';
const [V, SH, LOGO, SHOT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
if (SH) { await page.setInputFiles('#f-sheet', SH); await page.waitForTimeout(2000); }
await page.click('text=효과'); await page.waitForTimeout(300);
await page.setInputFiles('#logo-file', LOGO); await page.waitForTimeout(800);
await page.click('.subbox .seg button:has-text("↗")'); await page.waitForTimeout(300);
await page.evaluate(() => window.__pveTransport.seek(3)); await page.waitForTimeout(800);
await page.locator('canvas.stage').screenshot({ path: SHOT });
await browser.close();
