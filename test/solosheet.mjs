// 악보(PDF/그림)를 넣고 찾은 마디 수·줄별 마디줄 위치를 확인
// 사용법: node test/solosheet.mjs 악보파일 [영상] [스크린샷]
import { chromium } from 'playwright-core';
const [SH, V1, SHOT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
if (V1) { await page.setInputFiles('#f-video', V1); await page.waitForFunction(() => /분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 }); await page.waitForTimeout(500); }
await page.setInputFiles('#f-sheet', SH);
await page.waitForFunction(() => !/찾는 중|읽는 중/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
console.log('status:', await page.textContent('.status'));
const info = await page.evaluate(() => { const s = window.__pveSheet?.(); if (!s) return null; return { bars: s.bars.length, systems: s.systems.map(y => ({ firstBar: y.firstBar, barXs: y.barXs.map(Math.round), w: y.canvas.width })) }; });
console.log(JSON.stringify(info, null, 0));
if (SHOT) await page.screenshot({ path: SHOT });
if (process.env.SYS) {   // 줄마다 그림 + 찾은 마디줄(빨강) 저장
  const urls = await page.evaluate(() => window.__pveSheet().systems.map(y => { const c = document.createElement('canvas'); c.width = y.canvas.width; c.height = y.canvas.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(y.canvas, 0, 0); x.fillStyle = 'rgba(255,0,0,0.6)'; for (const b of y.barXs) x.fillRect(b - 2, 0, 4, c.height); return c.toDataURL('image/png'); }));
  const fs = await import('fs');
  urls.forEach((u, i) => fs.writeFileSync(process.env.SYS + '/sys' + (i + 1) + '.png', Buffer.from(u.split(',')[1], 'base64')));
}
console.log(logs.join('\n') || 'no page errors');
await browser.close();
