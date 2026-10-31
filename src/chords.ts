// 기타 코드표 (직접 만들기): 코드 이름 + 줄마다 누르는 프렛을 사용자가 찍음
// 줄 순서: 6번줄(굵은 줄)부터 1번줄까지. 값: 1 이상 = 그 프렛에 점, 0 = 개방현(O), -1 = 안 침(X), -2 = 아무 표시 없음
import { voicingsOf, parseChord } from './chordLegacy';

export const MUTE = -1, OPEN_STR = 0, NONE = -2;
export type Frets = number[];
/** 그리기용 코드표 */
export interface Voicing { frets: Frets; base: number; barre: { fret: number; from: number; to: number } | null; span?: number }   // base: 표 첫 칸의 프렛 · span: 칸 수
/** 코드표 데이터 (자막에 들어감 · 내 코드표에 저장) */
export interface ChordData { name: string; frets?: Frets; base?: number; span?: number; barre?: boolean; v?: number }   // v: 예전 방식(정해진 목록의 운지 번호)

export const blankChord = (): ChordData => ({ name: '', frets: [NONE, NONE, NONE, NONE, NONE, NONE], base: 1, span: 4, barre: true });

/** 바레 찾기: 가장 낮은 눌린 프렛이 두 줄 이상이고, 그 사이 줄이 모두 그 프렛 이상으로 눌려 있으면 */
export function findBarre(f: Frets): Voicing['barre'] {
  const fr = f.filter(x => x > 0);
  if (!fr.length) return null;
  const low = Math.min(...fr);
  const at = f.map((x, s) => x === low ? s : -1).filter(s => s >= 0);
  if (at.length < 2) return null;
  const a = at[0], b = at[at.length - 1];
  for (let s = a; s <= b; s++) if (f[s] < low) return null;
  return { fret: low, from: a, to: b };
}

/** 코드표 데이터 → 그리기용 (예전 방식이면 정해진 목록에서 찾아옴) */
export function chartOf(c: ChordData): Voicing | null {
  if (c.frets) {
    const f = c.frets.slice(0, 6); while (f.length < 6) f.push(NONE);
    return { frets: f, base: Math.max(1, c.base || 1), barre: c.barre === false ? null : findBarre(f), span: c.span || 4 };
  }
  const pc = parseChord(c.name);
  if (!pc) return null;
  const vs = voicingsOf(pc.root, pc.q);
  return vs[Math.max(0, Math.min(vs.length - 1, c.v || 0))] || null;
}
/** 예전 방식 코드표를 직접 고칠 수 있는 데이터로 */
export function editableOf(c: ChordData): ChordData {
  if (c.frets) return { span: 4, barre: true, base: 1, ...c };
  const v = chartOf(c);
  if (!v) return { ...blankChord(), name: c.name };
  const fr = v.frets.filter(x => x > 0);
  return { name: c.name, frets: v.frets.slice(), base: v.base, span: Math.max(4, fr.length ? Math.max(...fr) - v.base + 1 : 4), barre: true };
}
