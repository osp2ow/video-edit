// 맞닿은 녹음본 두 조각: 경계에서 앞 조각 페이드 아웃 손잡이를 (미리 고르지 않고) 바로 끌 수 있는지
// 사용법: node test/fadehandle.mjs 영상 녹음본1 녹음본2
import { chromium } from 'playwright-core';
const [V1, R1, R2] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec', R1); await waitMsg(/자동 감지|녹음본 분석 완료/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec2', R2); await waitMsg(/녹음본|맞췄|붙였/); await page.waitForTimeout(1500);
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const REC_TOP = tl.y + 30 + 188;
let p = await P();
const recEnd = p.recAt + (await page.evaluate(() => window.__pveTransport.player.recBuf.duration));
const c2 = p.recClips[0];
console.log('rec ends', recEnd.toFixed(3), 'next rec starts', c2.at);
// 1) 앞 조각 끝 손잡이: 경계 바로 왼쪽(3px)을 잡고 왼쪽으로 2초
const bx = (X(recEnd) + X(c2.at)) / 2;
await page.mouse.move(bx - 3, REC_TOP + 6); await page.mouse.down();
await page.mouse.move(X(recEnd - 2) - 3, REC_TOP + 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
p = await P(); console.log('recFades', JSON.stringify(p.recFades));
ok('left side of the seam → first recording fade-out', (p.recFades?.rec?.out ?? 0) > 1.5 && !(p.recFades?.['recx:' + c2.src]?.in > 0));
// 2) 경계 바로 오른쪽 → 뒤 조각 페이드 인
await page.mouse.click(X(5), tl.y + 21); await page.waitForTimeout(200);   // 선택 풀기 대신 재생 위치만
await page.mouse.move(bx + 3, REC_TOP + 6); await page.mouse.down();
await page.mouse.move(X(c2.at + 2) + 3, REC_TOP + 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
p = await P(); console.log('recFades', JSON.stringify(p.recFades));
ok('right side of the seam → next recording fade-in', (p.recFades?.['recx:' + c2.src]?.in ?? 0) > 1.5);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
