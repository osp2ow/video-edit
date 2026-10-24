import { analyzeTrack, estimateTempo, firstStrongBeat, HOP_SEC } from '../src/analysis';
import fs from 'fs';
const b = fs.readFileSync('test/rec.f32'); const x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
const tr = analyzeTrack(new Float32Array(x));
const f0 = firstStrongBeat(tr.onsets)!; const beat = 60 / 91;
const at = (e: Float32Array, t: number) => { const f = Math.round(t / HOP_SEC); return Math.max(e[f - 1] || 0, e[f] || 0, e[f + 1] || 0); };
let mL = Math.max(...tr.low), mE = Math.max(...tr.env);
for (let j = 0; j < 4; j++) { let sl = 0, se = 0, c = 0; for (let t = f0 + j * beat; t < tr.duration; t += 4 * beat) { sl += at(tr.low, t) / mL; se += at(tr.env, t) / mE; c++; } console.log(j, (sl / c).toFixed(3), (se / c).toFixed(3)); }
