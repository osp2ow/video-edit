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
  const p = T.defaultProject();
  // 첫 녹음본: 타임라인 0~10초, 페이드 인 2초 · 아웃 1초 / 추가 녹음본: 12초부터 4초 길이 (파일 1~5초만 사용), 페이드 인 1초
  p.recAt = 0; p.videoMuted = true;
  p.recClips = [{ src: 'b.wav', at: 11 }];
  p.trims = { 'recx:b.wav': { in: 1, out: 5 } };
  p.recFades = { rec: { in: 2, out: 1 }, 'recx:b.wav': { in: 1, out: 0 } };
  const inp = { master: { duration: 0 }, angles: [], project: p, sheet: null, layout: null, masterAudio: null, recAudio: mk(10), sources: new Map(), sourceAudio: new Map(), sheets: new Map(), extraRecs: new Map([['b.wav', mk(8)]]) };
  const out = await T.mixAudio(inp, 0, 17);
  const d = out.getChannelData(0), at = t => +(d[Math.round(t * sr)] / 0.5).toFixed(3);
  // 중간에서 시작한 추출 (페이드 인 도중부터)
  const out2 = await T.mixAudio(inp, 1, 3);
  const d2 = out2.getChannelData(0), at2 = t => +(d2[Math.round(t * sr)] / 0.5).toFixed(3);
  return { a: [0.5, 1, 1.5, 2.5, 5, 9.25, 9.5, 9.75, 10.5], v: [0.5, 1, 1.5, 2.5, 5, 9.25, 9.5, 9.75, 10.5].map(at), b: [12.25, 12.5, 13, 14, 15.9].map(at), mid: [0.1, 0.5, 1, 1.5].map(at2) };
});
console.log(JSON.stringify(r));
const near = (x, y) => Math.abs(x - y) < 0.02;
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
ok('rec fade in', near(r.v[0], 0.25) && near(r.v[1], 0.5) && near(r.v[2], 0.75) && near(r.v[3], 1));
ok('rec fade out', near(r.v[5], 0.75) && near(r.v[6], 0.5) && near(r.v[7], 0.25) && near(r.v[8], 0));
ok('extra rec fade in (starts 12s)', near(r.b[0], 0.25) && near(r.b[1], 0.5) && near(r.b[2], 1) && near(r.b[3], 1));
ok('export starting mid-fade', near(r.mid[0], 0.55) && near(r.mid[1], 0.75) && near(r.mid[2], 1));
await browser.close();
