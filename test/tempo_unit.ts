import { defaultProject, barAt, barStart, snapTime, sheetClipEnd, sheetPos, bpmAt } from '../src/model';
const p: any = { ...defaultProject(), bpm: 120, anchorTime: 1, anchorBar: 1 };
p.sheetClips = [{ id: 'a', start: 1, barIn: 0, barOut: 4 }, { id: 'b', start: 9, barIn: 0, barOut: 4, sheet: 's2', bpm: 90 }];
console.log('bar at 9 =', barAt(p, 9), 'bar5 start', barStart(p, 5), 'bar6 start', barStart(p, 6), 'bpm@10', bpmAt(p, 10));
console.log('clip b end', sheetClipEnd(p, p.sheetClips[1]), 'expect', 9 + 4 * 4 * 60 / 90);
console.log('sheetPos at 9+8/3 (1 bar into b)', JSON.stringify(sheetPos(p, 9 + 8 / 3, 4)));
console.log('snap 10.1 beat', snapTime(p, 10.1, 'beat'), 'expected 10.333');
console.log('bar at 0', barAt(p, 0), 'bar0 start', barStart(p, 0));
