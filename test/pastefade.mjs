// 녹음본을 I로 자르고 → 자른 조각 복사 → 붙여넣기 → 붙여넣은 조각에 페이드 아웃 (숫자 칸) → 타임라인에 표시·저장되는지
import { chromium } from 'playwright-core';
const [V1, R1, SHOT] = process.argv.slice(2);
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
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
let tl, end, X;
const remeasure = async () => { tl = await page.locator('.tl-canvas canvas').boundingBox(); end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; }); X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02)); };
await remeasure();
const REC_Y = () => tl.y + 30 + 188 + 25;
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(300); };
let p = await P();
// 자르기: 녹음본 줄 누르고 12초에서 I
await page.mouse.click(X(p.recAt + 3), REC_Y()); await page.waitForTimeout(300); await remeasure();
await seek(p.recAt + 12); await page.keyboard.press('KeyI'); await page.waitForTimeout(400);
p = await P(); const cut = p.recClips[0], ck = 'recx:' + cut.id;
console.log('clips', JSON.stringify(p.clips));
console.log('cut piece', JSON.stringify(cut), JSON.stringify(p.trims[ck]));
// 자른 조각 고르고 복사
await remeasure();
await page.mouse.click(X(p.recAt + 16), REC_Y()); await page.waitForTimeout(300);
await page.keyboard.press('Control+c'); await page.waitForTimeout(200);
// 녹음본 끝 뒤로 재생 위치 옮겨 붙여넣기
await remeasure();
await seek(Math.min(end - 1, p.recAt + 20.5)); await page.keyboard.press('Control+v'); await page.waitForTimeout(500);
p = await P(); const pc = p.recClips.find(c => c.id !== cut.id), pk = 'recx:' + pc.id;
console.log('clips', JSON.stringify(p.clips), 'recAt', p.recAt, 'sel', await page.evaluate(() => document.querySelector('.tl-head')?.textContent));
console.log('pasted', JSON.stringify(pc), JSON.stringify(p.trims[pk]));
await remeasure();
const pa = pc.at + p.trims[pk].in, pb = pc.at + p.trims[pk].out;
console.log('pasted range', pa.toFixed(2), pb.toFixed(2), 'end', end);
// 붙여넣은 조각 고르고 아웃 2초
await page.mouse.click(X((pa + pb) / 2), REC_Y()); await page.waitForTimeout(300);
if (process.env.TWICE) { await page.mouse.click(X((pa + pb) / 2), REC_Y()); await page.waitForTimeout(300); }
const has = !!(await page.$('#rec-fade-out'));
console.log('head after click', await page.evaluate(() => document.querySelector('.tl-head')?.textContent));
ok('fade box for pasted piece', has);
if (has) { await page.fill('#rec-fade-out', '2'); await page.press('#rec-fade-out', 'Enter'); await page.waitForTimeout(300); }
p = await P(); console.log('recFades', JSON.stringify(p.recFades));
ok('fade-out saved for pasted piece', p.recFades?.[pk]?.out === 2);
ok('input shows 2', has && (await page.inputValue('#rec-fade-out')) === '2');
if (SHOT) await page.screenshot({ path: SHOT, clip: { x: tl.x, y: tl.y - 34, width: tl.width, height: 300 } });
// 다시: 붙여넣은 직후(여러 개 선택 상태) 바로 오른쪽 위 모서리를 끌어서 페이드 아웃
await remeasure();
await seek(Math.min(end - 1, pb + 1)); await page.keyboard.press('Control+v'); await page.waitForTimeout(500);
p = await P(); const pc2 = p.recClips[p.recClips.length - 1], pk2 = 'recx:' + pc2.id;
await remeasure();
const b2 = pc2.at + p.trims[pk2].out, top = tl.y + 30 + 188 + 6;
await page.mouse.move(X(b2) - 3, top); await page.mouse.down();
await page.mouse.move(X(b2 - 1.5) - 3, top, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
p = await P(); console.log('recFades', JSON.stringify(p.recFades), 'pasted2 at', pc2.at, '→', p.recClips.find(c => c.id === pc2.id).at);
ok('top-right drag right after paste → fade-out (piece not moved)', (p.recFades?.[pk2]?.out ?? 0) > 1.2 && p.recClips.find(c => c.id === pc2.id).at === pc2.at);
// 붙여넣은 직후 가운데를 잡고 끌면 여전히 옮겨짐
await remeasure();
await seek(Math.min(end - 1, 2)); await page.keyboard.press('Control+v'); await page.waitForTimeout(500);
p = await P(); const pc3 = p.recClips[p.recClips.length - 1], pk3 = 'recx:' + pc3.id;
await remeasure();
const m3 = pc3.at + (p.trims[pk3].in + p.trims[pk3].out) / 2;
await page.mouse.move(X(m3), tl.y + 30 + 188 + 30); await page.mouse.down();
await page.mouse.move(X(m3) + 60, tl.y + 30 + 188 + 30, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
p = await P(); const moved = p.recClips.find(c => c.id === pc3.id).at - pc3.at;
console.log('pasted3 moved', moved.toFixed(3));
ok('drag middle right after paste still moves the pasted piece', Math.abs(moved) > 0.5);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
