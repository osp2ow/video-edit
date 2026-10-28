// 두 번째 악보부터 템포 바꾸기: 왼쪽 목록 BPM 칸 · 소리로 찾기 · 뒤 악보가 따라 붙는지
// 사용법: node test/sheettempo.mjs 영상 녹음본 악보1 악보2 악보3 [스크린샷 폴더]
import { chromium } from 'playwright-core';
const [V, R, S1, S2, S3, DIR] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const st = () => page.textContent('.status');
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
await page.setInputFiles('#f-sheet', S1); await page.waitForTimeout(1500);
await page.setInputFiles('#f-video', V); await page.waitForTimeout(500);
await page.setInputFiles('#f-rec', R); await waitMsg(/자동 감지/); await page.waitForTimeout(1500);
console.log('status:', await st());
await page.setInputFiles('#f-sheet2', S2); await waitMsg(/붙였어요|찾지 못/); console.log('status:', await st());
await page.setInputFiles('#f-sheet2', S3); await waitMsg(/붙였어요|찾지 못/); await page.waitForTimeout(300);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const clips = p => (p.sheetClips || []).map(c => ({ s: c.sheet || 'A', start: +c.start.toFixed(3), bars: c.barOut - c.barIn, bpm: c.bpm }));
let p = await P();
console.log('bpm', p.bpm, 'anchor', p.anchorTime.toFixed(3), JSON.stringify(clips(p)));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
ok('list has tempo boxes', await page.locator('#sheet-bpm-2').count() === 1 && await page.locator('#sheet-bpm-3').count() === 1);
// 소리로 찾기 (악보 2)
await page.locator('.src-item', { hasText: 'sheetB' }).locator('text=소리로 찾기').click(); await page.waitForTimeout(300);
console.log('status:', await st());
p = await P(); console.log(JSON.stringify(clips(p)));
const b = p.sheetClips.find(c => c.sheet?.includes('sheetB')), c3 = p.sheetClips.find(c => c.sheet?.includes('sheetC'));
ok('found ~90 BPM for sheet 2', b.bpm && Math.abs(b.bpm - 90) < 1.5);
const L = x => 4 * 60 / (x.bpm || p.bpm);
ok('sheet 3 follows sheet 2 end', Math.abs(c3.start - (b.start + (b.barOut - b.barIn) * L(b))) < 0.01);
ok('sheet 3 keeps its own tempo', !!c3.bpm && Math.abs(c3.bpm - p.bpm) < 0.01);
// 직접 넣기
await page.fill('#sheet-bpm-2', '100'); await page.press('#sheet-bpm-2', 'Enter'); await page.waitForTimeout(200);
p = await P();
const b2 = p.sheetClips.find(c => c.sheet?.includes('sheetB')), c32 = p.sheetClips.find(c => c.sheet?.includes('sheetC'));
ok('typed 100 BPM', b2.bpm === 100);
ok('sheet 3 moved with it', Math.abs(c32.start - (b2.start + (b2.barOut - b2.barIn) * 2.4)) < 0.01);
if (DIR) await page.screenshot({ path: DIR + '/sheets.png' });
console.log(logs.join('\n') || 'no page errors');
await browser.close();
