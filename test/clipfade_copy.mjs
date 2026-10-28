// 영상 조각 페이드(화면) · 복사/붙여넣기 · 회전
// 사용법: node test/clipfade_copy.mjs 영상1 녹음본 영상2 [스크린샷 폴더]
import { chromium } from 'playwright-core';
const [V1, R1, V2, DIR] = process.argv.slice(2);
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
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요|불러왔어요/); await page.waitForTimeout(1000);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const endOf = () => page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
let end = await endOf();
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const MAIN_Y = tl.y + 30 + 132 + 25, MAIN_TOP = tl.y + 30 + 132, REC_Y = tl.y + 30 + 188 + 25;
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(350); };
const bright = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(c.width * 0.3, c.height * 0.45, c.width * 0.4, c.height * 0.1).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return Math.round(s / (d.length / 4) / 3); });
let p = await P();
const c2 = p.clips.find(c => c.src);
console.log('clips', JSON.stringify(p.clips.map(c => [c.src || 'main', c.start, c.srcOut - c.srcIn])));
// --- 영상 조각 페이드 ---
await page.mouse.click(X(c2.start + 3), MAIN_Y); await page.waitForTimeout(300);
ok('fade box for video clip', await page.locator('#rec-fade-in').count() === 1);
await page.fill('#rec-fade-in', '2'); await page.press('#rec-fade-in', 'Enter'); await page.waitForTimeout(150);
p = await P(); ok('clip fadeIn saved', p.clips.find(c => c.id === c2.id).fadeIn === 2);
// 끝쪽 손잡이 끌기 → 페이드 아웃 1초
const e2 = c2.start + (c2.srcOut - c2.srcIn);
await page.mouse.move(X(e2) - 2, MAIN_TOP + 6); await page.mouse.down(); await page.mouse.move(X(e2 - 1), MAIN_TOP + 6, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
p = await P(); const f2 = p.clips.find(c => c.id === c2.id); ok('clip fadeOut by handle ≈1s (' + f2.fadeOut + ')', Math.abs((f2.fadeOut || 0) - 1) < 0.15);
await seek(c2.start + 0.5); const b1 = await bright();
await seek(c2.start + 4); const b2 = await bright();
console.log('brightness at 0.5s / 4s:', b1, b2);
ok('picture darker during fade in', b1 < b2 * 0.5 && b2 > 20);
if (DIR) await page.screenshot({ path: DIR + '/tl-fade.png', clip: { x: tl.x, y: tl.y - 34, width: tl.width, height: 260 } });
// --- 복사 · 붙여넣기 (영상 조각) ---
await page.mouse.click(X(c2.start + 3), MAIN_Y); await page.waitForTimeout(200);
await page.keyboard.press('Control+c'); await page.waitForTimeout(100);
await seek(end - 0.5);
await page.keyboard.press('Control+v'); await page.waitForTimeout(300);
p = await P();
const pasted = p.clips.filter(c => c.src === c2.src);
console.log('after paste', JSON.stringify(p.clips.map(c => [c.src || 'main', +c.start.toFixed(2), c.fadeIn || 0, c.fadeOut || 0])));
ok('video clip pasted at playhead with fades', pasted.length === 2 && pasted.some(c => Math.abs(c.start - (end - 0.5)) < 0.05 && c.fadeIn === 2));
// 되돌리기
await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
p = await P(); ok('undo paste', p.clips.filter(c => c.src === c2.src).length === 1);
// --- 녹음본 + 영상 같이 (Ctrl+클릭 두 개) → 간격 유지 ---
end = await endOf();
await page.mouse.click(X(c2.start + 3), MAIN_Y); await page.waitForTimeout(150);
const recAt = p.recAt;
await page.keyboard.down('Control'); await page.mouse.click(X(recAt + 3), REC_Y); await page.keyboard.up('Control'); await page.waitForTimeout(150);
await page.click('.tl-head >> text=복사'); await page.waitForTimeout(100);
await seek(end - 1);
await page.click('.tl-head >> text=붙여넣기'); await page.waitForTimeout(300);
p = await P();
const nc = p.clips.filter(c => c.src === c2.src).sort((a, b) => b.start - a.start)[0], nr = (p.recClips || []).slice(-1)[0];
console.log('pasted clip', nc?.start, 'rec', JSON.stringify(nr), 'trim', JSON.stringify(p.trims?.['recx:' + nr?.id]));
const tin = p.trims?.['recx:' + nr?.id]?.in ?? 0;
ok('two items pasted, spacing kept', nc && nr && Math.abs((nr.at + tin - nc.start) - (recAt + (p.trims?.rec?.in || 0) - c2.start)) < 0.02);
// --- 회전 ---
await page.mouse.click(X(c2.start + 3), MAIN_Y); await page.waitForTimeout(300);
await page.locator('#vrot').fill('5'); await page.waitForTimeout(200);
p = await P();
ok('rotation saved for that video', p.frames?.['9:16']?.[c2.src]?.rot === 5 && !p.frames?.['9:16']?.main?.rot);
await seek(c2.start + 4); await page.focus('#vrot'); await page.waitForTimeout(300);
if (DIR) await page.screenshot({ path: DIR + '/rot.png', clip: await page.locator('canvas.stage').boundingBox() });
console.log(logs.join('\n') || 'no page errors');
await browser.close();
