// 다른 편집기(캡컷 등)에서 만든 영상을 다시 추출할 때 장면이 겹치거나 빠지는지(뚝뚝 끊김) 점검
// 원본: 장면 번호가 밝기로 들어간 영상 → 추출본의 장면 순서를 읽어서 겹침/빠짐 개수
import { chromium } from 'playwright-core';
const [V, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', ...(process.env.MP4BOX ? { 'mp4box.all.min.js': process.env.MP4BOX } : {}) };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (/추출/.test(m.text())) logs.push(m.text()); });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.click('.export-btn');
await page.click('text=720p');
const dlP = page.waitForEvent('download', { timeout: 300000 });
await page.evaluate(() => { delete window.showSaveFilePicker; });
await page.click('text=추출 시작');
await page.waitForFunction(() => document.querySelector('.ok-text') || /실패|못 했|오류/.test(document.querySelector('.modal-body')?.textContent || ''), null, { timeout: 300000 });
await (await dlP).saveAs(OUT);
console.log(logs.join('\n')); await browser.close();
