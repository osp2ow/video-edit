import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', 'firebase-app-compat.js': '/home/claude/pve/test/fake-firebase.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const logs = [];
await ctx.route('**/*', r => {
  const u = r.request().url();
  const f = Object.keys(map).find(k => u.endsWith('/' + k));
  if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' });
  if (u.includes('firebase-auth-compat') || u.includes('firebase-firestore-compat')) return r.fulfill({ body: '', contentType: 'application/javascript' });
  if (u.endsWith('/config.js')) return r.fulfill({ body: 'window.FIREBASE_CONFIG={apiKey:"test",projectId:"t"};window.APP_ADMINS=["*"];', contentType: 'application/javascript' });
  if (u.includes('fonts.g')) return r.abort();
  return r.continue();
});
const URL = 'http://localhost:8765/deploy/video-editor/index.html';
const A = await ctx.newPage(), B = await ctx.newPage();
for (const [pg, n] of [[A, 'A'], [B, 'B']]) { pg.on('pageerror', e => logs.push(n + ' PAGEERROR: ' + e.message)); }
await A.goto(URL); await A.evaluate(() => localStorage.clear()); await A.reload();
await A.waitForSelector('.login-card');
await A.evaluate(() => { window.__FAKE_LOGIN = { uid: 'u1', email: 'osp2ow@gmail.com', displayName: '오세혁', emailVerified: true }; });
await A.click('.btn.google'); await A.waitForSelector('.cloudbar');
await A.setInputFiles('#f-video', 'test/test.webm');
await A.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await A.waitForTimeout(2500);
console.log('A saved:', await A.textContent('.save'));
// B: 다른 선생님이 다른 컴퓨터에서
await B.goto(URL); await B.waitForSelector('.login-card, .cloudbar');
if (await B.$('.login-card')) { await B.evaluate(() => { window.__FAKE_LOGIN = { uid: 'u2', email: 'teacher@x.com', displayName: '김선생', emailVerified: true }; }); await B.click('.btn.google'); }
await B.waitForSelector('.cloudbar');
await B.click('.cloudbar >> text=프로젝트'); await B.waitForTimeout(300);
console.log('B list tabs:', await B.evaluate(() => [...document.querySelectorAll('.modal-body .seg button')].map(b => b.textContent).join('|')), '| items:', await B.evaluate(() => [...document.querySelectorAll('.pj-list li')].map(e => e.querySelector('.pj-meta')?.textContent.slice(0, 40) + ' [' + [...e.querySelectorAll('.pj-act button')].map(b => b.textContent).join(',') + ']')));
await B.click('.pj-act >> text=열기'); await B.waitForTimeout(500);
await B.setInputFiles('#f-video', 'test/test.webm');
await B.waitForTimeout(3000);
console.log('B title:', await B.inputValue('#pj-title-input'), '|', await B.textContent('.save'));
// B가 자막 추가 → A가 자동으로 받아와야
const tlB = await B.locator('.tl-canvas canvas').boundingBox();
await B.mouse.click(tlB.x + 200, tlB.y + 21); await B.keyboard.press('Shift+KeyC'); await B.waitForTimeout(200); await B.keyboard.type('B가 쓴 자막'); await B.keyboard.press('Escape');
await B.waitForTimeout(2500);
console.log('B saved:', await B.textContent('.save'));
await A.waitForTimeout(800);
const capsA = await A.evaluate(() => { const d = window.__fakeDump(); return Object.values(d.projects)[0].project.captions?.map(c => c.text); });
console.log('stored caps:', JSON.stringify(capsA), '| A status:', await A.textContent('.status'));
console.log('A ui has caption:', await A.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('pve.proj:')).map(k => JSON.parse(localStorage.getItem(k)).captions?.map(c => c.text)))));
// 충돌: A는 저장 실패(오프라인) 상태에서 변경, B가 또 저장
await A.evaluate(() => { window.__FAKE_FAIL = true; });
const tlA = await A.locator('.tl-canvas canvas').boundingBox();
await A.mouse.click(tlA.x + 400, tlA.y + 21); await A.keyboard.press('Shift+KeyC'); await A.waitForTimeout(200); await A.keyboard.type('A 자막'); await A.keyboard.press('Escape');
await A.waitForTimeout(1800);
await B.mouse.click(tlB.x + 600, tlB.y + 21); await B.keyboard.press('Shift+KeyC'); await B.waitForTimeout(200); await B.keyboard.type('B 두번째'); await B.keyboard.press('Escape');
await B.waitForTimeout(2500);
console.log('A banner:', await A.evaluate(() => document.querySelector('.remote-edit')?.textContent?.slice(0, 80)));
await A.evaluate(() => { window.__FAKE_FAIL = false; });
await A.click('.remote-edit >> text=그 내용 불러오기'); await A.waitForTimeout(2500);
const after = await A.evaluate(() => Object.values(window.__fakeDump().projects)[0]);
console.log('after load-theirs: stored', JSON.stringify(after.project.captions.map(c => c.text)), 'editedBy', after.editedByName, '| banner gone:', !(await A.$('.remote-edit')));
await A.screenshot({ path: 'test/share_A.png' });
console.log(logs.join('\n')); await browser.close();
