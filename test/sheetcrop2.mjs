import { chromium } from 'playwright-core';
import fs from 'fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ path: 'test/sheet_bundle.js' });
const b64 = fs.readFileSync(process.argv[3]).toString('base64');
const out = await page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
  const s = detectSheet([c], 'x');
  // 모든 줄을 흰 배경에 세로로 이어 붙임
  const W = Math.max(...s.systems.map(y => y.canvas.width)), H = s.systems.reduce((a, y) => a + y.canvas.height + 10, 0);
  const o = document.createElement('canvas'); o.width = W; o.height = H; const ox = o.getContext('2d'); ox.fillStyle = '#f0c0c0'; ox.fillRect(0, 0, W, H);
  let y = 0; for (const sy of s.systems) { ox.fillStyle = '#fff'; ox.fillRect(0, y, sy.canvas.width, sy.canvas.height); ox.drawImage(sy.canvas, 0, y); y += sy.canvas.height + 10; }
  return { url: o.toDataURL(), n: s.systems.length, hs: s.systems.map(y => [y.canvas.width, y.canvas.height]) };
}, b64);
fs.writeFileSync(process.argv[2] || 'test/crops.png', Buffer.from(out.url.split(',')[1], 'base64'));
console.log(out.n, JSON.stringify(out.hs));
await browser.close();
