import { analyzeTrack, estimateTempo, firstStrongBeat } from '../src/analysis';
import fs from 'fs';
const b = fs.readFileSync('test/rec.f32'); const x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
const tr = analyzeTrack(new Float32Array(x));
console.log(tr.onsets.filter(o => o.t < 8).map(o => o.t.toFixed(3) + '(' + o.s.toFixed(2) + ')').join(' '));
const te = estimateTempo(tr.env); console.log(te);
console.log('first', firstStrongBeat(tr.onsets));
