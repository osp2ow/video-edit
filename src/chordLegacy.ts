// (예전 방식) 정해진 기타 코드 목록 — 이제 화면에서는 쓰지 않고, 예전에 넣은 코드표({name, v}만 있는 것)를 그대로 그리는 데만 씀
// 운지 = 6번줄(굵은 줄)부터 1번줄까지 프렛 번호 (-1 = 안 침(X), 0 = 개방현(O))
// 오픈 코드(학원에서 처음 가르치는 모양) + 6번줄·5번줄·4번줄 근음 모양(바레)을 옮겨서 만들고,
// 각 운지의 음을 계산해서 코드 구성음만 있는지·근음이 맨 아래인지 검사한 것만 씀 (chordProblems)

export const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type Root = typeof ROOTS[number];
const ROOT_PC: Record<Root, number> = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

export interface Quality { id: string; label: string; tones: number[]; need: number[] }
/** 코드 종류: tones = 들어가도 되는 음(근음에서 반음 수), need = 꼭 있어야 하는 음 */
export const QUALITIES: Quality[] = [
  { id: '', label: '', tones: [0, 4, 7], need: [0, 4] },
  { id: 'm', label: 'm', tones: [0, 3, 7], need: [0, 3] },
  { id: '7', label: '7', tones: [0, 4, 7, 10], need: [0, 4, 10] },
  { id: 'm7', label: 'm7', tones: [0, 3, 7, 10], need: [0, 3, 10] },
  { id: 'M7', label: 'M7', tones: [0, 4, 7, 11], need: [0, 4, 11] },
  { id: 'sus4', label: 'sus4', tones: [0, 5, 7], need: [0, 5] },
  { id: 'sus2', label: 'sus2', tones: [0, 2, 7], need: [0, 2] },
  { id: 'add9', label: 'add9', tones: [0, 2, 4, 7], need: [0, 2, 4] },
  { id: '6', label: '6', tones: [0, 4, 7, 9], need: [0, 4, 9] },
  { id: 'm6', label: 'm6', tones: [0, 3, 7, 9], need: [0, 3, 9] },
  { id: '9', label: '9', tones: [0, 2, 4, 7, 10], need: [0, 2, 4, 10] },
  { id: 'dim', label: 'dim', tones: [0, 3, 6], need: [0, 3, 6] },
  { id: 'dim7', label: 'dim7', tones: [0, 3, 6, 9], need: [0, 3, 6, 9] },
  { id: 'aug', label: 'aug', tones: [0, 4, 8], need: [0, 4, 8] },
  { id: 'm7b5', label: 'm7♭5', tones: [0, 3, 6, 10], need: [0, 3, 6, 10] },
];

/** 표준 조율 개방현 음 (6번줄 → 1번줄, MIDI) */
const OPEN = [40, 45, 50, 55, 59, 64];
export type Frets = number[];   // 6개, 6번줄부터
export interface Voicing { frets: Frets; base: number; barre: { fret: number; from: number; to: number } | null }   // base: 표의 첫 칸 프렛 (1 = 맨 앞, 줄받침 그림)

// 옮길 수 있는 모양: 근음 줄에서 근음 프렛 r 기준 상대 프렛 (null = 안 침)
type Tpl = (number | null)[];
const E_SHAPE: Record<string, Tpl[]> = {   // 6번줄 근음
  '': [[0, 2, 2, 1, 0, 0]], m: [[0, 2, 2, 0, 0, 0]], '7': [[0, 2, 0, 1, 0, 0]], m7: [[0, 2, 0, 0, 0, 0]], M7: [[0, 2, 1, 1, 0, 0], [0, null, 1, 1, 0, null]],
  sus4: [[0, 2, 2, 2, 0, 0]], sus2: [[0, 2, 4, 4, 0, 0]], add9: [[0, 2, 4, 1, 0, 0]], '6': [[0, 2, 2, 1, 2, 0]], m6: [[0, 2, 2, 0, 2, 0]],
  '9': [[0, 2, 0, 1, 0, 2]], dim: [[0, 1, 2, 0, null, null]], dim7: [[0, null, -1, 0, -1, null]], aug: [[0, null, 2, 1, 1, 0]], m7b5: [[0, null, 0, 0, -1, null]],
};
const A_SHAPE: Record<string, Tpl[]> = {   // 5번줄 근음
  '': [[null, 0, 2, 2, 2, 0]], m: [[null, 0, 2, 2, 1, 0]], '7': [[null, 0, 2, 0, 2, 0]], m7: [[null, 0, 2, 0, 1, 0]], M7: [[null, 0, 2, 1, 2, 0]],
  sus4: [[null, 0, 2, 2, 3, 0]], sus2: [[null, 0, 2, 2, 0, 0]], add9: [[null, 0, 2, 4, 2, 0]], '6': [[null, 0, 2, 2, 2, 2]], m6: [[null, 0, 2, 2, 1, 2]],
  '9': [[null, 0, -1, 0, 0, null]], dim: [[null, 0, 1, 2, 1, null]], dim7: [[null, 0, 1, -1, 1, null]], aug: [[null, 0, 3, 2, 2, 1]], m7b5: [[null, 0, 1, 0, 1, null]],
};
const D_SHAPE: Record<string, Tpl[]> = {   // 4번줄 근음 (작은 코드)
  '': [[null, null, 0, 2, 3, 2]], m: [[null, null, 0, 2, 3, 1]], '7': [[null, null, 0, 2, 1, 2]], m7: [[null, null, 0, 2, 1, 1]], M7: [[null, null, 0, 2, 2, 2]],
  sus4: [[null, null, 0, 2, 3, 3]], sus2: [[null, null, 0, 2, 3, 0]], '6': [[null, null, 0, 2, 0, 2]], m6: [[null, null, 0, 2, 0, 1]],
  dim: [[null, null, 0, 1, 3, 1]], dim7: [[null, null, 0, 1, 0, 1]], aug: [[null, null, 0, 3, 3, 2]], m7b5: [[null, null, 0, 1, 1, 1]],
};
const SHAPES: { str: number; tpl: Record<string, Tpl[]> }[] = [{ str: 0, tpl: E_SHAPE }, { str: 1, tpl: A_SHAPE }, { str: 2, tpl: D_SHAPE }];

/** 오픈 코드 (코드 이름 → 운지 문자열, 6번줄부터. x = 안 침). 옮긴 모양에서 개방현으로 나오는 것(E·A·D 계열)은 따로 안 적음 */
const OPEN_CHORDS: Record<string, string[]> = {
  C: ['x32010'], C7: ['x32310'], CM7: ['x32000'], Cadd9: ['x32030'], Csus4: ['x33011'], Csus2: ['x30013'], C6: ['x32210'], C9: ['x32333'],
  G: ['320003', '320033'], G7: ['320001'], GM7: ['320002'], G6: ['320000'], Gsus4: ['330013'], Gsus2: ['300033'], Gadd9: ['300203'],
  FM7: ['xx3210'], F: ['xx3211'], B7: ['x21202'], Em7: ['022030'], E7: ['020100'], Am: ['x02210'], Dm: ['xx0231'],
};

const parse = (s: string): Frets => s.split('').map(ch => ch === 'x' ? -1 : parseInt(ch, 36));
const pcOf = (str: number, fret: number) => (OPEN[str] + fret) % 12;

/** 운지가 그 코드에 맞는지 검사 → 문제 설명 (없으면 빈 배열) */
export function chordProblems(root: Root, q: Quality, f: Frets): string[] {
  const r = ROOT_PC[root], out: string[] = [];
  const played = f.map((fr, s) => fr >= 0 ? (pcOf(s, fr) - r + 12) % 12 : null);
  const ints = played.filter((x): x is number => x !== null);
  if (ints.length < 3) out.push('세 줄 미만');
  const bass = played.find(x => x !== null);
  if (bass !== 0) out.push('맨 아래 음이 근음이 아님');
  for (const i of ints) if (!q.tones.includes(i)) out.push(`코드에 없는 음 (${i})`);
  for (const n of q.need) if (!ints.includes(n)) out.push(`빠진 음 (${n})`);
  // 안 치는 줄은 아래쪽(굵은 줄)과 위쪽 끝에만 — 가운데 줄을 뮤트하는 건 dim7·M7 같은 4줄 코드만
  const first = f.findIndex(x => x >= 0);
  for (let s = first; s < 6; s++) if (f[s] < 0 && f.slice(s).some(x => x >= 0) && !(q.id === 'dim7' || q.id === 'm7b5' || q.id === 'M7' || q.id === '9' || q.id === 'dim' || q.id === 'aug' || q.id === 'add9')) out.push('가운데 줄 뮤트');
  const fr = f.filter(x => x > 0);
  if (fr.length && Math.max(...fr) - Math.min(...fr) > 4) out.push('손가락이 너무 벌어짐');
  return out;
}

/** 바레 찾기: 가장 낮은 눌린 프렛이 두 줄 이상이고, 그 사이 줄이 모두 그 프렛 이상으로 눌려 있으면 */
function findBarre(f: Frets): Voicing['barre'] {
  const fr = f.filter(x => x > 0);
  if (!fr.length) return null;
  const low = Math.min(...fr);
  const at = f.map((x, s) => x === low ? s : -1).filter(s => s >= 0);
  if (at.length < 2) return null;
  const a = at[0], b = at[at.length - 1];
  for (let s = a; s <= b; s++) if (f[s] < low) return null;   // 사이에 개방현·뮤트가 있으면 바레 아님
  // 오픈 코드에서 1프렛 두 줄 정도는 손가락 하나씩 짚기도 하지만, 위쪽 줄까지 이어지면 바레로 그림
  return { fret: low, from: a, to: b };
}

function makeVoicing(f: Frets): Voicing {
  const fr = f.filter(x => x > 0);
  const hi = fr.length ? Math.max(...fr) : 0, lo = fr.length ? Math.min(...fr) : 0;
  const base = hi <= 4 ? 1 : lo;
  return { frets: f, base, barre: findBarre(f) };
}

const cache = new Map<string, Voicing[]>();
/** 코드의 운지들 (쉬운 것부터, 최대 3개) */
export function voicingsOf(root: Root, qid: string): Voicing[] {
  const key = root + '|' + qid;
  const hit = cache.get(key); if (hit) return hit;
  const q = QUALITIES.find(x => x.id === qid)!;
  const name = root + q.id;
  const cands: { f: Frets; score: number }[] = [];
  const add = (f: Frets, score: number) => {
    if (chordProblems(root, q, f).length) return;
    if (cands.some(c => c.f.join() === f.join())) return;
    cands.push({ f, score });
  };
  for (const s of OPEN_CHORDS[name] || []) add(parse(s), 0);
  const rp = ROOT_PC[root];
  for (const sh of SHAPES) {
    for (const t of sh.tpl[qid] || []) {
      const r0 = (rp - OPEN[sh.str] % 12 + 24) % 12;
      for (const r of [r0, r0 + 12]) {
        const f = t.map(o => o === null ? -1 : r + o);
        if (f.some((x, i) => t[i] !== null && x < 0) || Math.max(...f) > 15) continue;
        const open = f.some((x, i) => x === 0 && t[i] !== null);
        // 점수: 개방현 코드 → 6번줄 → 5번줄 → 4번줄 근음, 같은 모양은 낮은 프렛부터
        // 4줄짜리(가운데 뮤트) 모양은 같은 자리의 꽉 찬 모양 뒤로
        const thin = f.filter(x => x < 0).length >= 2 && sh.str === 0 ? 2 : 0;
        const sc = (open && r === 0 ? 1 : 10) + r + sh.str * 1.5 + thin + (Math.max(...f) - Math.min(...f.filter(x => x > 0).concat([r]))) * 0.2;
        add(f, sc);
      }
    }
  }
  cands.sort((a, b) => a.score - b.score);
  // 운지끼리 위치가 너무 비슷하지 않게 (같은 자리 모양 두 개보다 다른 자리 하나)
  const pick: Frets[] = [];
  for (const c of cands) { if (pick.length >= 3) break; pick.push(c.f); }
  const out = pick.map(makeVoicing);
  cache.set(key, out);
  return out;
}

export const chordName = (root: Root, qid: string) => root + (QUALITIES.find(q => q.id === qid)?.label ?? qid);
/** 'C#m7' 같은 이름 → 근음·종류 */
export function parseChord(name: string): { root: Root; q: string } | null {
  const m = name.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!m || !(ROOTS as readonly string[]).includes(m[1])) return null;
  const q = QUALITIES.find(x => x.label === m[2] || x.id === m[2]);
  return q ? { root: m[1] as Root, q: q.id } : null;
}
