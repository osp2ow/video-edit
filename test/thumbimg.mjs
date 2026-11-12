// 썸네일에 이미지 얹기: 추가 → 보임 · 끌어 옮기기 · 모서리로 크기 · 배경으로 · 저장 PNG에 들어가고 고름 테두리는 빠짐
// 사용법: node test/thumbimg.mjs 영상 로고.png 사진.jpg 저장폴더
import { chromium } from 'playwright-core';
const [V, LOGO, PHOTO, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 }); await page.waitForTimeout(800);
await page.click('.thumb-btn'); await page.waitForSelector('.thumb-modal canvas'); await page.waitForTimeout(800);
const cv = page.locator('.thumb-modal canvas').first();
const px = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('.thumb-modal canvas'); const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
const isLogo = c => c[0] < 60 && c[1] > 150 && c[2] > 200;
const before = await px(0.5, 0.42);
await page.setInputFiles('#th-img', LOGO); await page.waitForTimeout(800);
const at = await px(0.5, 0.42); console.log('center before/after', before, at);
ok('logo appears where added (center)', isLogo(at));
ok('image listed with controls', await page.locator('.thumb-imgs li').count() === 1);
// 끌어서 옮기기: 가운데 → 왼쪽 위로
const b = await cv.boundingBox();
await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.42); await page.mouse.down();
await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.25, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
ok('drag moves the logo', isLogo(await px(0.3, 0.25)) && !isLogo(await px(0.5, 0.42)));
// 모서리로 크기: 로고 폭 0.35×짧은 변(1080) → 오른쪽 아래 모서리를 바깥으로
const W = 1080, H = 1920, lw = W * 0.35, lh = lw / 2;
const cx = 0.3 * W, cy = 0.25 * H, cornerX = (cx + lw / 2) / W, cornerY = (cy + lh / 2) / H;
await page.mouse.move(b.x + b.width * cornerX, b.y + b.height * cornerY); await page.mouse.down();
await page.mouse.move(b.x + b.width * (cornerX + 0.1), b.y + b.height * (cornerY + 0.03), { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
const wNow = await page.locator('.thumb-imgs input[type=range]').first().inputValue();
console.log('size after corner drag', wNow);
ok('corner drag makes it bigger', parseFloat(wNow) > 0.4);
// 저장 PNG: 로고 들어가고 주황 고름 테두리는 없음
const dl = page.waitForEvent('download');
await page.click('.thumb-modal >> text=PNG 저장'); const d = await dl; const f = OUT + '/thumb1.png'; await d.saveAs(f); console.log('saved', f);
// 배경으로: 사진을 넣고 배경으로 → 영상 대신 사진 색
await page.setInputFiles('#th-img', PHOTO); await page.waitForTimeout(800);
await page.click('.thumb-imgs li.on >> text=배경으로'); await page.waitForTimeout(400);
const bg = await px(0.1, 0.55); console.log('bg pixel', bg);
ok('photo as background fills the frame', bg[0] > 180 && bg[1] < 90 && bg[2] > 160);
ok('logo still on top of background', isLogo(await px(0.3, 0.25)));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
console.log(logs.join('\n') || 'no page errors');
await browser.close();
