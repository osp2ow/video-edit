import { chromium } from 'playwright-core';
import fs from 'fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
page.on('console', m => console.log('PAGE', m.text()));
await page.goto('file:///home/claude/pve/test/blank.html');
await page.addScriptTag({ path: 'test/mp4box.all.min.js' });
await page.addScriptTag({ path: 'test/dec_bundle.js' });
const f = process.argv[2];
const b64 = fs.readFileSync(f).toString('base64');
const r = await page.evaluate(async (b64) => {
  const blob = await (await fetch('data:video/mp4;base64,' + b64)).blob();
  const MP4Box = window.MP4Box;
  const file = MP4Box.createFile(); let info = null; file.onReady = i => info = i;
  const buf = await blob.arrayBuffer(); buf.fileStart = 0; file.appendBuffer(buf); file.flush();
  const vt = info?.videoTracks?.[0];
  const out = { codec: vt?.codec, w: vt?.track_width, h: vt?.track_height };
  try { out.sup = (await VideoDecoder.isConfigSupported({ codec: vt.codec, codedWidth: vt.track_width, codedHeight: vt.track_height })).supported; } catch (e) { out.supErr = String(e); }
  const src = await openFrameSource(blob); console.log('opened', !!src);
  out.src = !!src;
  if (src) {
    const t0 = performance.now(); const res = [];
    for (const t of [0, 0.5, 1, 1.0333, 5, 2, 10.5, 10.5167, 46]) { const tt = performance.now(); const c = await Promise.race([src.frameAt(t), new Promise(r => setTimeout(() => r('TIMEOUT'), 5000))]); console.log('t', t, performance.now() - tt, c === 'TIMEOUT' ? 'TIMEOUT' : ''); if (c === 'TIMEOUT') return out; res.push(t + ':' + (c ? c.getContext('2d').getImageData(270, 480, 1, 1).data.slice(0, 3).join(',') : 'null')); }
    out.res = res; out.ms = performance.now() - t0;
    // 순서대로 600장
    const t1 = performance.now(); for (let i = 0; i < 600; i++) await src.frameAt(12 + i / 60); out.seq600ms = performance.now() - t1;
  }
  return out;
}, b64);
console.log(JSON.stringify(r, null, 1));
await browser.close();
