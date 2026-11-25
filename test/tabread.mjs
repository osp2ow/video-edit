// 기타 타브 PDF → 읽은 음을 마디별로 출력 (줄번호:프렛@위치)
// 사용법: node test/tabread.mjs 타브.pdf
import { chromium } from 'playwright-core';
const [SH] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (/타브/.test(m.text())) logs.push(m.text()); });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-sheet', SH);
await page.waitForFunction(() => window.__pveSheet?.()?.bars?.length, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
const r = await page.evaluate(() => { const s = window.__pveSheet(); const by = {}; for (const n of s.tab || []) (by[n.bar + 1] ||= []).push(`${6 - n.str}:${n.fret}@${n.pos.toFixed(2)}`); return { bars: s.bars.length, n: (s.tab || []).length, by }; });
console.log('bars', r.bars, 'notes', r.n);
for (const [b, l] of Object.entries(r.by)) console.log(b.padStart(2), l.join(' '));
console.log(logs.join('\n'));
await browser.close();
