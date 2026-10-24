import { detectPage } from '../src/sheet';
import fs from 'fs';
const W = 1650, buf = fs.readFileSync('test/page.gray'); const H = buf.length / W;
const st = detectPage(new Uint8Array(buf), W, H);
for (const s of st) console.log(s.top, s.bot, s.sp.toFixed(2), s.x0, s.x1, s.bars.map(x => x.toFixed(0)).join(','));
