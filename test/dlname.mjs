import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await browser.newContext({ acceptDownloads: true });
for (const url of ['file:///home/claude/pve/test/blank.html', 'http://localhost:8765/test/blank.html']) {
  const page = await ctx.newPage(); await page.goto(url);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'], { type: 'video/mp4' })); a.download = 'perf_reels_1080p.mp4'; document.body.appendChild(a); a.click();
  })]);
  console.log(url.slice(0, 7), '→', dl.suggestedFilename());
}
await browser.close();
