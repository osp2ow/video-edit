// 앵글 줄을 골라도 미리보기는 효과 넣은 화면 · '이 앵글만 보기'를 눌러야 그 앵글만 보임 · 구간 넣기는 그대로 됨
// 사용법: node test/anglesolo.mjs 영상1 앵글영상
import { chromium } from 'playwright-core';
const [V1, A1] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V1);
await page.waitForFunction(() => /분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 }); await page.waitForTimeout(1000);
await page.setInputFiles('#f-angle', A1);
await page.waitForFunction(() => /앵글을 추가했어요|읽지 못했어요/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 }); await page.waitForTimeout(1500);
const hash = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 64) h = (h * 31 + d[i]) | 0; return h; });
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
await page.mouse.click(tl.x + tl.width * 0.3, tl.y + 21); await page.waitForTimeout(700);
const h0 = await hash();
// 앵글 줄 = 녹음본 줄 자리(녹음본이 없으면 영상 바로 아래) — 줄 이름 글자로 찾기 어려워 아래로 훑으며 앵글 도구 막대가 뜨는 곳
let y = 0;
for (let dy = 190; dy < tl.height - 5; dy += 12) { await page.mouse.click(tl.x + tl.width * 0.6, tl.y + dy); await page.waitForTimeout(150); if (await page.$('.srcbar') && /2번 앵글/.test(await page.textContent('.srcbar .src-tag'))) { y = dy; break; } }
ok('angle row picked → angle tools shown', y > 0);
await page.mouse.click(tl.x + tl.width * 0.3, tl.y + 21); await page.waitForTimeout(700);
const h1 = await hash();
ok('preview still shows the full result (no solo)', h0 === h1);
await page.click('.srcbar >> text=이 앵글만 보기'); await page.waitForTimeout(700);
const h2 = await hash();
ok('"이 앵글만 보기" switches the preview to that angle', h2 !== h1 && !!(await page.$('.srcbar >> text=효과 넣은 화면 보기')));
await page.click('.srcbar >> text=효과 넣은 화면 보기'); await page.waitForTimeout(700);
ok('back to result view', (await hash()) === h1);
await page.click('.srcbar >> text=여기부터 넣기'); await page.waitForTimeout(400);
const cuts = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject().cuts)));
console.log('cuts', JSON.stringify(cuts), await page.textContent('.status'));
ok('여기부터 넣기 still works', cuts.some(c => c.angle && c.angle !== 'main'));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('Esc closes angle tools', !(await page.$('.srcbar')));
console.log(logs.join('\n') || 'no page errors');
await browser.close();
