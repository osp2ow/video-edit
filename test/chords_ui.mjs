// 코드표: 버튼 → 패널 → 근음·코드 누르기 → 재생 위치에 넣기 / 같은 자리 바꾸기 / 운지 / 끌어 옮기기 / 크기
import { chromium } from 'playwright-core';
const [V, DIR] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', V); await page.waitForFunction(() => /분석 완료|자동 감지/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(300); };
ok('chord button next to caption button', await page.locator('.studio-tabs .chord-tab').count() === 1 && await page.locator('.studio-tabs .studio-tab').count() === 2);
await page.click('.chord-tab');
ok('panel open', await page.locator('#chord-panel').count() === 1);
await seek(2);
await page.click('#chord-panel .chord-roots button:text-is("G")');
await page.click('#chord-panel .chord-grid .chord-btn >> nth=0');   // G
await page.waitForTimeout(200);
let p = await P(); let ch = (p.captions || []).filter(c => c.chord);
console.log('chords', JSON.stringify(ch.map(c => [c.chord.name, c.chord.v, +c.start.toFixed(2), +c.end.toFixed(2)])));
ok('G inserted at playhead', ch.length === 1 && ch[0].chord.name === 'G' && Math.abs(ch[0].start - 2) < 0.6);
const box = await page.locator('canvas.stage').boundingBox();
if (DIR) await page.screenshot({ path: DIR + '/chord-g.png' });
// 같은 자리에서 Em7 누르기 → 바꾸기
await page.click('#chord-panel .chord-roots button:text-is("E")');
await page.click('#chord-panel .chord-grid .chord-btn >> nth=3');   // Em7
await page.waitForTimeout(200);
p = await P(); ch = p.captions.filter(c => c.chord);
console.log('   now', await page.textContent('.now-t'), JSON.stringify(ch.map(c => [c.chord.name, c.start, c.end])));
ok('same spot → replaced with Em7', ch.length === 1 && ch[0].chord.name === 'Em7');
// 운지 2번째
await page.click('#chord-panel .chord-voicings .chord-btn >> nth=1'); await page.waitForTimeout(150);
p = await P(); ok('voicing 2 chosen', p.captions.find(c => c.chord).chord.v === 1);
// 다른 자리에 하나 더
await seek(ch[0].end + 1);
await page.click('#chord-panel .chord-roots button:text-is("C")');
await page.click('#chord-panel .chord-grid .chord-btn >> nth=4');   // CM7
await page.waitForTimeout(200);
p = await P(); ch = p.captions.filter(c => c.chord).sort((a, b) => a.start - b.start);
ok('second chord CM7 added', ch.length === 2 && ch[1].chord.name === 'CM7');
// 미리보기에서 끌어 옮기기 (지금 보이는 CM7)
const cp0 = p.chordPos?.['9:16'] || { x: 0.5, y: 0.36 };
const k = box.width / 1080;
const sx = box.x + cp0.x * 1080 * k, sy = box.y + cp0.y * 1920 * k;
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - 60, sy + 120, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200);
p = await P(); console.log('chordPos', JSON.stringify(p.chordPos));
ok('dragged chord position (shared)', p.chordPos?.['9:16'] && p.chordPos['9:16'].y > cp0.y + 0.05 && !p.captions.some(c => c.chord && c.pos));
await page.locator('#chord-size').fill('1.4'); await page.waitForTimeout(150);
p = await P(); ok('size saved', p.chordPos['9:16'].size === 1.4);
if (DIR) { await page.screenshot({ path: DIR + '/chord-cm7.png' }); await page.locator('#chord-panel').screenshot({ path: DIR + '/panel.png' }); }
// 자막 패널에는 코드표가 안 나옴
await page.click('.studio-tabs .studio-tab >> nth=0'); await page.waitForTimeout(200);
ok('caption studio opens and chord panel closes', await page.locator('#chord-panel').count() === 0);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
