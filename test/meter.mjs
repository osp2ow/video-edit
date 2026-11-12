// 박자표 x/8: 6/8을 고르면 BPM이 ♪ 기준으로 바뀌고 마디 길이·1마디 위치·메트로놈·악보 템포 표시가 맞는지
// 사용법: node test/meter.mjs 6/8영상(♪=180, 첫 소리 1.5초) [악보] [스크린샷]
import { chromium } from 'playwright-core';
const [V, SH, SHOT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 }); await page.waitForTimeout(1200);
let p = await P(); const bpm44 = p.bpm; console.log('4/4 detected: bpm', p.bpm, 'anchor', p.anchorTime.toFixed(3), '|', await page.textContent('.status'));
const opts = await page.$$eval('#bpb option', os => os.map(o => o.value)); console.log('meters', opts.join(' '));
ok('6/8 · 9/8 · 12/8 offered', ['6/8', '9/8', '12/8', '7/8'].every(m => opts.includes(m)));
await page.selectOption('#bpb', '6/8'); await page.waitForTimeout(1200);
p = await P(); const bar = p.beatsPerBar * 60 / p.bpm;
console.log('6/8: bpm', p.bpm, 'beatUnit', p.beatUnit, 'bar', bar.toFixed(3), 's', 'anchor', p.anchorTime.toFixed(3));
ok('6/8 BPM in eighths ≈ 180', Math.abs(p.bpm - 180) < 2);
ok('6/8 bar length ≈ 2 s', Math.abs(bar - 2) < 0.03);
ok('bar 1 starts at first hit (1.5 s)', Math.abs(p.anchorTime - 1.5) < 0.06);
console.log('note:', await page.textContent('.note').catch(() => ''));
// 메트로놈 켜고 재생 (오류 없는지)
const met = page.locator('button', { hasText: '메트로놈' }).first(); if (await met.count()) await met.click().catch(() => {});
await page.evaluate(() => window.__pveTransport.play(1.4)); await page.waitForTimeout(1500); await page.evaluate(() => window.__pveTransport.pause());
if (SH) { await page.setInputFiles('#f-sheet', SH); await page.waitForTimeout(2500); await page.evaluate(() => window.__pveTransport.seek(3.6)); await page.waitForTimeout(800); }
if (SHOT) await page.screenshot({ path: SHOT });
// 4/4로 되돌리면 BPM도 원래대로
await page.selectOption('#bpb', '4/4'); await page.waitForTimeout(800);
p = await P(); console.log('back to 4/4: bpm', p.bpm, p.beatUnit);
ok('back to 4/4 restores the detected quarter BPM', Math.abs(p.bpm - bpm44) < 0.5);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
