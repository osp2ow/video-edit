import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
await page.goto('file:///home/claude/pve/test/blank.html');
for (const n of ['abc.mp4', '연주_릴스.mp4', 'test_릴스_1080p.mp4']) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(n => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'], { type: 'video/mp4' })); a.download = n; document.body.appendChild(a); a.click(); }, n)]);
  console.log(n, '->', dl.suggestedFilename());
}
await browser.close();
