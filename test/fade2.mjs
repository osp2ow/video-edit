// 녹음본 조각 페이드: 추출 소리 합치기에서 볼륨 곡선이 맞는지 (상수 1짜리 소리로 확인)
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
const dir = mkdtempSync(tmpdir() + '/fd-');
await build({ entryPoints: ['test/fade_entry.ts'], bundle: true, outfile: dir + '/t.js', format: 'iife', define: { React: 'window.React' } });
writeFileSync(dir + '/t.html', '<script>window.React={useState(){},useEffect(){},useRef(){}}</script><script src="t.js"></script>');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + dir + '/t.html');
const r = await page.evaluate(async () => {
  const sr = 48000, mk = (sec) => { const b = new AudioBuffer({ length: sec * sr, sampleRate: sr, numberOfChannels: 2 }); for (let c = 0; c < 2; c++) b.getChannelData(c).fill(0.5); return b; };
  const res = {};
  // (1) 추가 녹음본 페이드 아웃: 2초부터 8초 파일 전체, 아웃 2초 → 8~10초 줄어듦
  { const p = T.defaultProject(); p.recAt = 0; p.videoMuted = true; p.recMuted = false;
    p.recClips = [{ src: 'b.wav', at: 2 }]; p.recFades = { 'recx:b.wav': { in: 0, out: 2 } };
    const inp = { master: { duration: 0 }, angles: [], project: p, sheet: null, layout: null, masterAudio: null, recAudio: null, sources: new Map(), sourceAudio: new Map(), sheets: new Map(), extraRecs: new Map([['b.wav', mk(8)]]) };
    const d = (await T.mixAudio(inp, 0, 11)).getChannelData(0), at = t => +(d[Math.round(t * sr)] / 0.5).toFixed(3);
    res.extra = [5, 8.5, 9, 9.5, 9.9].map(at); }
  // (2) 첫 녹음본을 잘라 생긴 뒤 조각 페이드 아웃: 녹음본 10초, 0~4 | 4~10 조각, 뒤 조각 아웃 2초
  { const p = T.defaultProject(); p.recAt = 0; p.videoMuted = true;
    p.recClips = [{ id: 'r1', src: '@main', at: 0 }]; p.trims = { rec: { in: 0, out: 4 }, 'recx:r1': { in: 4, out: 10 } };
    p.recFades = { rec: { in: 0, out: 1 }, 'recx:r1': { in: 0, out: 2 } };
    const inp = { master: { duration: 0 }, angles: [], project: p, sheet: null, layout: null, masterAudio: null, recAudio: mk(10), sources: new Map(), sourceAudio: new Map(), sheets: new Map(), extraRecs: new Map() };
    const d = (await T.mixAudio(inp, 0, 11)).getChannelData(0), at = t => +(d[Math.round(t * sr)] / 0.5).toFixed(3);
    res.cut = [2, 3.5, 5, 8.5, 9, 9.5].map(at); }
  // (3) 뒤로 옮긴 추가 녹음본 (영상 소리 켬, 영상 0~10): 녹음본 아웃만 줄어드는지
  return res;
});
console.log(JSON.stringify(r));
const near = (x, y) => Math.abs(x - y) < 0.03;
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
ok('extra rec fade out (export)', near(r.extra[0], 1) && near(r.extra[1], 0.75) && near(r.extra[2], 0.5) && near(r.extra[3], 0.25));
ok('cut piece fade out (export)', near(r.cut[0], 1) && near(r.cut[1], 0.5) && near(r.cut[2], 1) && near(r.cut[3], 0.75) && near(r.cut[4], 0.5) && near(r.cut[5], 0.25));
await browser.close();
