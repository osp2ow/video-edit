import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = []; page.on('console', m => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
const anchorTxt = () => page.evaluate(() => document.querySelector('.anchor-now')?.textContent);
// A) 악보 없이: 소리만으로 강박 판단
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(500);
console.log('A no sheet:', await anchorTxt());
// B) 악보 넣기
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.waitForFunction(() => document.querySelectorAll('.sys').length > 0, null, { timeout: 30000 });
await page.waitForTimeout(500);
console.log('B sheet:', await anchorTxt(), '|', await page.evaluate(() => document.querySelector('#pickup option')?.textContent));
// 0.885초가 4마디 1박인지: 0.9초로 가서 마디 표시 확인
await page.evaluate(() => { document.querySelector('video').currentTime = 0.9; }); await page.waitForTimeout(400);
console.log('at 0.9s:', await page.evaluate(() => document.querySelector('.barpos').textContent));
// C) 못갖춘마디 수동 1박
await page.selectOption('#pickup', '1'); await page.waitForTimeout(300);
console.log('C pickup1:', await anchorTxt());
await page.evaluate(() => { document.querySelector('video').currentTime = 0.95; }); await page.waitForTimeout(400);
console.log('  at 0.95s:', await page.evaluate(() => document.querySelector('.barpos').textContent));
await page.screenshot({ path: 'test/f_pickup.png' });
await page.selectOption('#pickup', 'auto'); await page.waitForTimeout(300);
// D) 슬라이더 누른 뒤 Space
await page.click('#opacity'); await page.keyboard.press('Space'); await page.waitForTimeout(500);
console.log('D space after slider → playing', await page.evaluate(() => !document.querySelector('video').paused));
await page.keyboard.press('Space'); await page.waitForTimeout(300);
console.log('  space again → paused', await page.evaluate(() => document.querySelector('video').paused));
// BPM 입력칸에서는 Space가 재생 안 함, Enter로 빠져나오면 재생
await page.click('#bpm'); await page.keyboard.press('Space'); await page.waitForTimeout(300);
console.log('  in bpm field → paused', await page.evaluate(() => document.querySelector('video').paused));
await page.keyboard.press('Enter'); await page.keyboard.press('Space'); await page.waitForTimeout(400);
console.log('  after Enter → playing', await page.evaluate(() => !document.querySelector('video').paused));
await page.keyboard.press('Space');
// E) 타임라인 자석 + 휠
const box = await page.locator('.tl-canvas canvas').boundingBox();
const viewBefore = await page.evaluate(() => document.querySelector('video').currentTime);
// 전체 보기 상태에서 마디선 근처 클릭 → 마디 시작 시간에 붙는지
const barT = 0.885 + 6 * (4 * 60 / 91); // 10마디 1박
const pps = (box.width - 2) / (46.733 * 1.02); const startT = -46.733 * 0.01;
await page.mouse.click(box.x + (barT - startT) * pps + 6, box.y + 100);
await page.waitForTimeout(300);
const t = await page.evaluate(() => document.querySelector('video').currentTime);
console.log('E magnet: clicked near', barT.toFixed(3), '→', t.toFixed(3));
await page.mouse.move(box.x + 500, box.y + 100);
await page.mouse.wheel(0, 300); await page.waitForTimeout(200);
await page.screenshot({ path: 'test/f_wheel_pan.png', clip: { x: 0, y: 840, width: 1920, height: 240 } });
await page.keyboard.down('Shift'); await page.mouse.wheel(0, -400); await page.keyboard.up('Shift'); await page.waitForTimeout(200);
await page.screenshot({ path: 'test/f_wheel_zoom.png', clip: { x: 0, y: 840, width: 1920, height: 240 } });
// F) 재생 중 오류 → 자동 복구
await page.evaluate(() => { document.querySelector('video').currentTime = 15; });
await page.keyboard.press('Space'); await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
await page.waitForTimeout(2000);
console.log('F recover:', JSON.stringify(await page.evaluate(() => ({ playing: !document.querySelector('video').paused, t: document.querySelector('video').currentTime, status: document.querySelector('.status').textContent }))));
console.log(logs.filter(l => !l.includes('fonts') && !l.includes('ERR_FAILED') && !l.includes('fake worker')).join('\n'));
await browser.close();
