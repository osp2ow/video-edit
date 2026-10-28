// 편집기 화면: 녹음본 조각 클릭 → 페이드 입력칸 · 손잡이 끌기 / 이어 붙인 두 번째 영상만 크기 바꾸기
// 사용법: node test/recfade_ui.mjs 영상1 녹음본1 영상2 녹음본2 [스크린샷 폴더]
import { chromium } from 'playwright-core';
const [V1, R1, V2, R2, DIR] = process.argv.slice(2);
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
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요|불러왔어요/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec2', R2); await waitMsg(/양 끝을 줄일 수|불러왔어요/); await page.waitForTimeout(800);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const pps = (tl.width - 2) / (end * 1.02), X = t => tl.x + (t + end * 0.01) * pps;
const MAIN_Y = tl.y + 30 + 132 + 25, REC_TOP = tl.y + 30 + 132 + 56;
let p = await P();
console.log('end', end, 'clips', JSON.stringify(p.clips?.map(c => [c.src || 'main', c.start, c.srcOut - c.srcIn])), 'recAt', p.recAt, 'recClips', JSON.stringify(p.recClips));

// --- 두 번째 영상만 크기 ---
const c2 = p.clips.find(c => c.src);
await page.mouse.click(X(c2.start + 1), MAIN_Y); await page.waitForTimeout(300);
const head = await page.textContent('section:has(#vscale) h2');
console.log('panel:', head, '| now', await page.textContent('.now-t'));
ok('panel shows second video', /second/.test(head));
await page.locator('#vscale').fill('1.6'); await page.waitForTimeout(200);
p = await P();
const fr = p.frames?.['9:16'] || {};
ok('only second video scaled', fr[c2.src]?.scale === 1.6 && !fr.main);
if (DIR) await page.screenshot({ path: DIR + '/zoom2.png', clip: await page.locator('canvas.stage').boundingBox() });
// 첫 영상 조각을 고르면 첫 영상 크기 (두 번째는 그대로)
const c1 = p.clips.find(c => !c.src);
await page.mouse.click(X(c1.start + 1), MAIN_Y); await page.waitForTimeout(300);
ok('first clip → first video panel', !/second/.test(await page.textContent('section:has(#vscale) h2')) && Math.abs(+(await page.inputValue('#vscale')) - 1) < 1e-6);

// --- 첫 녹음본: 클릭 → 입력칸 ---
const recLen = (p.trims?.rec?.out ?? 20) - (p.trims?.rec?.in ?? 0);
await page.mouse.click(X(p.recAt + 2), REC_TOP + 30); await page.waitForTimeout(300);
ok('fade box appears', await page.locator('#rec-fade-in').count() === 1);
await page.fill('#rec-fade-in', '1.5'); await page.press('#rec-fade-in', 'Enter');
await page.fill('#rec-fade-out', '2'); await page.press('#rec-fade-out', 'Enter');
p = await P(); console.log('recFades', JSON.stringify(p.recFades));
ok('main rec fades', p.recFades?.rec?.in === 1.5 && p.recFades?.rec?.out === 2);
// --- 추가 녹음본: 위쪽 손잡이 끌기 (끝에서 1초 안쪽으로) ---
const rc = p.recClips[0], key = 'recx:' + rc.src, tr = p.trims?.[key] || { in: 0, out: 8 };
const bEnd = rc.at + tr.out;
await page.mouse.move(X(bEnd) - 2, REC_TOP + 6); await page.mouse.down();
await page.mouse.move(X(bEnd - 1), REC_TOP + 6, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
p = await P(); console.log('recFades', JSON.stringify(p.recFades));
ok('extra rec fade out by handle ≈1s', Math.abs((p.recFades?.[key]?.out ?? 0) - 1) < 0.15);
ok('main rec fade unchanged', p.recFades?.rec?.in === 1.5);
await page.waitForTimeout(200);
if (DIR) await page.screenshot({ path: DIR + '/timeline.png', clip: { x: tl.x, y: tl.y - 34, width: tl.width, height: 280 } });
// 되돌리기
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await page.waitForTimeout(200);
p = await P(); ok('undo works', !(p.recFades?.[key]?.out > 0.5));
console.log(logs.join('\n') || 'no page errors');
await browser.close();
