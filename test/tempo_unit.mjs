// src/model.ts
var sheetHome = (p2) => barStart(p2, 1 + (p2.sheetOffset || 0));
function sheetClipsOf(p2, nBars) {
  if (p2.sheetClips) return [...p2.sheetClips].sort((a, b) => a.start - b.start);
  return nBars > 0 ? [{ id: "k0", start: sheetHome(p2), barIn: 0, barOut: nBars }] : [];
}
var clipBarLen = (p2, c) => c.bpm ? p2.beatsPerBar * 60 / c.bpm : barLen(p2, c.start);
var sheetClipEnd = (p2, c) => c.start + (c.barOut - c.barIn) * clipBarLen(p2, c);
function sheetClipAt(p2, t, nBars) {
  let hit = null;
  for (const c of sheetClipsOf(p2, nBars)) if (t >= c.start - 1e-6 && t < sheetClipEnd(p2, c) - 1e-6) hit = c;
  return hit;
}
var NEUTRAL_FILTER = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, hue: 0 };
var defaultFx = () => ({
  trType: "cut",
  trDur: 0.5,
  fadeIn: 0,
  fadeOut: 0,
  fadeColor: "black",
  audioFade: true,
  intro: { on: false, title: "", sub: "", dur: 2.5 },
  outro: { on: false, title: "", sub: "", dur: 3 },
  kenBurns: 0,
  preset: "none",
  filter: { ...NEUTRAL_FILTER },
  vignette: 0,
  logo: null,
  watermark: { on: false, pos: "br", size: 0.16, opacity: 0.85 },
  punch: "off",
  punchAmt: 0.06,
  zooms: [],
  punches: [],
  flash: false,
  shake: false,
  hits: [],
  face: { on: false, smooth: 0.55, bright: 0.25, warm: 0.2 },
  sheetCursor: true,
  sheetFollow: true,
  sheetFollowBars: 2.5,
  sheetBold: true,
  colorMatch: { on: false, m: {} }
});
var baseCaption = {
  font: "IBM Plex Sans KR",
  weight: 700,
  letter: 0,
  lineH: 1.3,
  align: "center",
  color: "#ffffff",
  outline: true,
  outlineColor: "#000000",
  outlineW: 0.14,
  shadow: true,
  shadowBlur: 0.3,
  box: false,
  boxColor: "#000000",
  boxOpacity: 0.6,
  boxPad: 0.4,
  boxRadius: 0.3,
  anim: "pop"
  // 등장 효과 기본: 팝
};
var defaultCaptionStyles = () => ({
  "9:16": { ...baseCaption, size: 0.08, x: 0.5, y: 0.6 },
  "4:5": { ...baseCaption, size: 0.08, x: 0.5, y: 0.8 },
  "16:9": { ...baseCaption, size: 0.045, x: 0.5, y: 0.86 }
  // 가로 화면은 폭이 넓어서 릴스 80과 같은 글자 높이
});
var defaultProject = () => ({
  bpm: 120,
  beatsPerBar: 4,
  anchorTime: 0,
  anchorBar: 1,
  recOffset: 0,
  videoMuted: false,
  videoVol: 1,
  recMuted: false,
  recVol: 1,
  clickOn: false,
  snapOnset: true,
  bpmTouched: false,
  anchorTouched: false,
  syncTouched: false,
  cuts: [],
  angleOffsets: {},
  cutSnap: "beat",
  sheetOffset: 0,
  frames: {},
  captions: [],
  captionStyles: defaultCaptionStyles(),
  fx: defaultFx()
});
function sheetPos(p2, t, nBars) {
  const c = sheetClipAt(p2, t, nBars), L = c ? clipBarLen(p2, c) : barLen(p2);
  const x = c ? c.barIn + (t - c.start) / L : (t - sheetHome(p2)) / L;
  const idx = Math.floor(x + 1e-9), frac = x - idx;
  return { idx, beat: Math.min(p2.beatsPerBar - 1, Math.floor(frac * p2.beatsPerBar + 1e-9)), frac, clip: c };
}
function snapTime(p2, t, mode = p2.cutSnap) {
  if (mode === "off") return t;
  const u = mode === "bar" ? 1 : 1 / p2.beatsPerBar;
  return barStart(p2, Math.round((barAt(p2, t) - p2.anchorBar) / u) * u + p2.anchorBar);
}
var tempoCache = /* @__PURE__ */ new WeakMap();
function tempoSegs(p2) {
  let segs = tempoCache.get(p2);
  if (segs) return segs;
  const L0 = p2.beatsPerBar * 60 / p2.bpm;
  segs = [{ t0: p2.anchorTime, b0: p2.anchorBar, L: L0, bpm: p2.bpm }];
  const ch = (p2.sheetClips || []).filter((c) => c.bpm && c.bpm > 0).sort((a, b) => a.start - b.start);
  for (const c of ch) {
    const cur = segs[segs.length - 1];
    if (Math.abs(cur.bpm - c.bpm) < 1e-6 || segs.length > 1 && c.start <= cur.t0 + 1e-6) continue;
    let b = cur.b0 + (c.start - cur.t0) / cur.L;
    if (Math.abs(b - Math.round(b)) < 0.03) b = Math.round(b);
    segs.push({ t0: c.start, b0: b, L: p2.beatsPerBar * 60 / c.bpm, bpm: c.bpm });
  }
  tempoCache.set(p2, segs);
  return segs;
}
var segAtT = (p2, t) => {
  const s = tempoSegs(p2);
  let k = 0;
  for (let i = 1; i < s.length; i++) if (s[i].t0 <= t + 1e-9) k = i;
  return s[k];
};
var segAtBar = (p2, n) => {
  const s = tempoSegs(p2);
  let k = 0;
  for (let i = 1; i < s.length; i++) if (s[i].b0 <= n + 1e-9) k = i;
  return s[k];
};
var barLen = (p2, t) => t === void 0 ? p2.beatsPerBar * 60 / p2.bpm : segAtT(p2, t).L;
var bpmAt = (p2, t) => segAtT(p2, t).bpm;
var barAt = (p2, t) => {
  const g = segAtT(p2, t);
  return g.b0 + (t - g.t0) / g.L;
};
var barStart = (p2, n) => {
  const g = segAtBar(p2, n);
  return g.t0 + (n - g.b0) * g.L;
};

// test/tempo_unit.ts
var p = { ...defaultProject(), bpm: 120, anchorTime: 1, anchorBar: 1 };
p.sheetClips = [{ id: "a", start: 1, barIn: 0, barOut: 4 }, { id: "b", start: 9, barIn: 0, barOut: 4, sheet: "s2", bpm: 90 }];
console.log("bar at 9 =", barAt(p, 9), "bar5 start", barStart(p, 5), "bar6 start", barStart(p, 6), "bpm@10", bpmAt(p, 10));
console.log("clip b end", sheetClipEnd(p, p.sheetClips[1]), "expect", 9 + 4 * 4 * 60 / 90);
console.log("sheetPos at 9+8/3 (1 bar into b)", JSON.stringify(sheetPos(p, 9 + 8 / 3, 4)));
console.log("snap 10.1 beat", snapTime(p, 10.1, "beat"), "expected 10.333");
console.log("bar at 0", barAt(p, 0), "bar0 start", barStart(p, 0));
