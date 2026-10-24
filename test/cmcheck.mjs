import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
await page.goto('file:///home/claude/pve/test/blank.html');
console.log(await page.evaluate(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.cssText = 'position:absolute';
  svg.innerHTML = '<filter id="f1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.5 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter>';
  document.body.appendChild(svg);
  const src = document.createElement('canvas'); src.width = src.height = 10; const s = src.getContext('2d'); s.fillStyle = '#c86464'; s.fillRect(0, 0, 10, 10);
  const c = document.createElement('canvas'); c.width = c.height = 10; const x = c.getContext('2d');
  x.filter = 'url(#f1)'; x.drawImage(src, 0, 0); const a = [...x.getImageData(5, 5, 1, 1).data];
  x.filter = 'url(#f1) brightness(1.2)'; x.drawImage(src, 0, 0); const b = [...x.getImageData(5, 5, 1, 1).data];
  return JSON.stringify({ a, b, f: x.filter });
}));
await browser.close();
