// 얼굴 보정: MediaPipe 얼굴 찾기(먼 거리용 모델) + WebGL 피부 보정
// 얼굴 찾기는 몇 프레임마다 비동기로, 보정은 매 프레임 얼굴 주변만 GPU로 처리
export interface FaceOpt { on: boolean; smooth: number; bright: number; warm: number }

const VER = '0.4.1646425229';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@${VER}/`;

type P = [number, number];
interface Face { cx: number; cy: number; w: number; h: number; le: P; re: P; mo: P; seen: number }

let status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let reason: '' | 'gl' | 'load' = '';   // gl: 이 컴퓨터 브라우저에서 WebGL(그래픽 가속)을 못 씀
let fd: any = null;
let busy = false;
let lastSend = 0;
let faces: Face[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

export function onFaceStatus(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function faceStatus() { return { status, reason, count: faces.length }; }

/** 이 브라우저에서 WebGL을 쓸 수 있는지 (얼굴 찾기 모델이 꼭 필요로 함) */
function webglOK() {
  try {
    const c = document.createElement('canvas');
    const g = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!g) return false;
    g.getExtension('WEBGL_lose_context')?.loseContext();   // 확인용 창은 바로 반납
    return true;
  } catch { return false; }
}
function markError(r: 'gl' | 'load', why: unknown) {
  console.warn('[얼굴 보정 끔]', r, why);
  status = 'error'; reason = r; faces = []; busy = false;
  try { fd?.close?.(); } catch { /* 이미 닫힘 */ }
  fd = null;
  emit();
}
// MediaPipe 내부에서 WebGL을 못 만들면 브라우저 경고창(alert)을 띄우고 멈춤 → 경고창 대신 얼굴 보정만 조용히 끄기
let alertGuard = false;
function guardAlerts() {
  if (alertGuard) return; alertGuard = true;
  const orig = window.alert.bind(window);
  window.alert = (msg?: any) => {
    const m = String(msg ?? '');
    if (/webgl|video frame|graph|mediapipe|wasm|gpu/i.test(m)) { markError('gl', m); return; }
    orig(msg);
  };
}

function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}

export async function ensureFace() {
  if (status !== 'idle') return;
  guardAlerts();
  if (!webglOK()) { markError('gl', 'WebGL 없음'); return; }
  status = 'loading'; emit();
  try {
    if (!(window as any).FaceDetection) await loadScript(BASE + 'face_detection.js');
    const FD = (window as any).FaceDetection;
    fd = new FD({ locateFile: (f: string) => BASE + f });
    fd.setOptions({ model: 'full', minDetectionConfidence: 0.45 });
    fd.onResults((r: any) => onResults(r));
    await fd.initialize();
    status = 'ready';
  } catch (e) {
    markError(/webgl|gl context/i.test(String((e as any)?.message || e)) ? 'gl' : 'load', e);
    return;
  }
  emit();
}

function onResults(r: any) {
  const now = performance.now();
  const next: Face[] = [];
  for (const d of r.detections || []) {
    const b = d.boundingBox, l = d.landmarks || [];
    const f: Face = { cx: b.xCenter, cy: b.yCenter, w: b.width, h: b.height,
      re: l[0] ? [l[0].x, l[0].y] : [b.xCenter - b.width * 0.2, b.yCenter - b.height * 0.15],
      le: l[1] ? [l[1].x, l[1].y] : [b.xCenter + b.width * 0.2, b.yCenter - b.height * 0.15],
      mo: l[3] ? [l[3].x, l[3].y] : [b.xCenter, b.yCenter + b.height * 0.25], seen: now };
    // 이전 얼굴과 이어서 부드럽게 (떨림 방지)
    const prev = faces.find(q => Math.hypot(q.cx - f.cx, q.cy - f.cy) < Math.max(q.w, f.w) * 0.8);
    if (prev) {
      const k = 0.55, mix = (a: number, b: number) => a + (b - a) * k, mp = (a: P, b: P): P => [mix(a[0], b[0]), mix(a[1], b[1])];
      next.push({ cx: mix(prev.cx, f.cx), cy: mix(prev.cy, f.cy), w: mix(prev.w, f.w), h: mix(prev.h, f.h), le: mp(prev.le, f.le), re: mp(prev.re, f.re), mo: mp(prev.mo, f.mo), seen: now });
    } else next.push(f);
  }
  // 잠깐 놓친 얼굴은 0.4초 동안 유지
  for (const q of faces) if (!next.some(n => Math.hypot(n.cx - q.cx, n.cy - q.cy) < q.w) && now - q.seen < 400) next.push(q);
  const changed = next.length !== faces.length;
  faces = next;
  if (changed) emit();
}

// 얼굴 찾기용 작은 캔버스
const small = document.createElement('canvas');
function requestDetect(src: HTMLCanvasElement) {
  if (status !== 'ready' || busy) return;
  const now = performance.now();
  if (now - lastSend < 90) return;
  lastSend = now;
  const s = Math.min(1, 640 / Math.max(src.width, src.height));
  small.width = Math.round(src.width * s); small.height = Math.round(src.height * s);
  small.getContext('2d')!.drawImage(src, 0, 0, small.width, small.height);
  busy = true;
  try {
    Promise.resolve(fd.send({ image: small }))
      .catch(e => { if (/webgl|context/i.test(String(e?.message || e))) markError('gl', e); })
      .finally(() => { busy = false; });
  } catch (e) { busy = false; markError('gl', e); }
}

// ---------- WebGL 보정 ----------
const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)*0.5, 1.0-(p.y+1.0)*0.5); gl_Position = vec4(p,0.0,1.0); }`;
const FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D tex; uniform vec2 px; uniform float rad;
uniform vec2 c; uniform vec2 rr; uniform vec2 e1; uniform vec2 e2; uniform vec2 mo; uniform vec2 er; uniform vec2 mr; uniform float asp;
uniform float smooth; uniform float bright; uniform float warm;
float luma(vec3 v){ return dot(v, vec3(0.299,0.587,0.114)); }
float ell(vec2 q, vec2 o, vec2 r){ vec2 d = (q-o)/r; return length(d); }
void main(){
  vec3 o = texture2D(tex, uv).rgb;
  float lo = luma(o);
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i=-3;i<=3;i++) for (int j=-3;j<=3;j++){
    vec2 off = vec2(float(i), float(j)) * rad * px;
    vec3 s = texture2D(tex, uv + off).rgb;
    float dl = luma(s) - lo;
    float w = exp(-float(i*i+j*j)/8.0) * exp(-dl*dl/0.0036);
    acc += s*w; wsum += w;
  }
  vec3 b = acc / wsum;
  // 피부색 정도 (YCbCr) — 부드럽게 한 색으로 판단해서 얼룩지지 않게
  float cb = 0.5 - 0.168736*b.r - 0.331264*b.g + 0.5*b.b;
  float cr = 0.5 + 0.5*b.r - 0.418688*b.g - 0.081312*b.b;
  float lb = luma(b);
  float skin = smoothstep(0.51,0.55,cr)*(1.0-smoothstep(0.66,0.70,cr))*smoothstep(0.27,0.32,cb)*(1.0-smoothstep(0.50,0.54,cb))
             * smoothstep(0.10,0.22,lb);                 // 머리카락·어두운 배경은 제외
  // 얼굴 타원 (가장자리는 부드럽게) · 눈과 입은 보정 제외
  vec2 q = vec2(uv.x*asp, uv.y);
  float m = 1.0 - smoothstep(0.5, 1.0, ell(q, vec2(c.x*asp,c.y), vec2(rr.x*asp, rr.y)));
  float keep = smoothstep(0.7,1.25, ell(q, vec2(e1.x*asp,e1.y), vec2(er.x*asp, er.y)))
             * smoothstep(0.7,1.25, ell(q, vec2(e2.x*asp,e2.y), vec2(er.x*asp, er.y)))
             * smoothstep(0.7,1.25, ell(q, vec2(mo.x*asp,mo.y), vec2(mr.x*asp, mr.y)));
  float sk = skin * m;
  float a = smooth * sk * keep;
  vec3 res = mix(o, b, clamp(a, 0.0, 0.92));
  res += (o - b) * 0.18 * a;            // 결은 살짝 남김
  // 밝게: 피부에만, 검은색은 그대로 두는 감마 방식 (안개 끼지 않게)
  res = pow(max(res, vec3(0.0)), vec3(1.0 / (1.0 + bright * 0.4 * sk)));
  res.r += warm * 0.035 * sk; res.g += warm * 0.008 * sk; res.b -= warm * 0.03 * sk;
  gl_FragColor = vec4(clamp(res, 0.0, 1.0), 1.0);
}`;

let glc: HTMLCanvasElement | null = null, gl: WebGLRenderingContext | null = null, prog: WebGLProgram | null = null, texObj: WebGLTexture | null = null;
let glFailed = false;
const crop = document.createElement('canvas');
const U: Record<string, WebGLUniformLocation | null> = {};

function initGL() {
  if (gl || glFailed) return !!gl;
  try {
    glc = document.createElement('canvas');
    gl = glc.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('no webgl');
    const sh = (t: number, src: string) => { const s = gl!.createShader(t)!; gl!.shaderSource(s, src); gl!.compileShader(s); if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) || 'shader'); return s; };
    prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    texObj = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texObj);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const n of ['tex', 'px', 'rad', 'c', 'rr', 'e1', 'e2', 'mo', 'er', 'mr', 'asp', 'smooth', 'bright', 'warm']) U[n] = gl.getUniformLocation(prog, n);
    return true;
  } catch (e) {
    console.warn('face gl', e); glFailed = true; gl = null; return false;
  }
}

/** 화면에 그려진 영상 위에서 얼굴만 보정 (악보·자막 그리기 전에 호출) */
export function retouchFaces(ctx: CanvasRenderingContext2D, W: number, H: number, opt: FaceOpt | undefined) {
  if (!opt || !opt.on) return;
  if (status === 'idle') ensureFace();
  if (ctx.canvas instanceof HTMLCanvasElement) requestDetect(ctx.canvas);
  if (!faces.length || (opt.smooth <= 0 && opt.bright <= 0 && opt.warm <= 0) || !initGL()) return;
  const g = gl!;
  for (const f of faces) {
    // 얼굴 상자 → 이마·턱까지 넓힌 영역
    const fw = f.w * W, fh = f.h * H;
    const rw = fw * 1.7, rh = fh * 2.0;
    const x0 = Math.max(0, Math.floor(f.cx * W - rw / 2)), y0 = Math.max(0, Math.floor(f.cy * H - rh * 0.56));
    const x1 = Math.min(W, Math.ceil(f.cx * W + rw / 2)), y1 = Math.min(H, Math.ceil(f.cy * H + rh * 0.44));
    const sw = x1 - x0, sh = y1 - y0;
    if (sw < 12 || sh < 12) continue;
    const k = Math.min(1, 512 / Math.max(sw, sh));
    const cw = Math.max(8, Math.round(sw * k)), ch = Math.max(8, Math.round(sh * k));
    crop.width = cw; crop.height = ch;
    crop.getContext('2d')!.drawImage(ctx.canvas, x0, y0, sw, sh, 0, 0, cw, ch);
    glc!.width = cw; glc!.height = ch;
    g.viewport(0, 0, cw, ch);
    g.bindTexture(g.TEXTURE_2D, texObj);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, crop);
    const toU = (x: number, y: number): [number, number] => [(x * W - x0) / sw, (y * H - y0) / sh];
    const c = toU(f.cx, f.cy - f.h * 0.06), e1 = toU(f.le[0], f.le[1]), e2 = toU(f.re[0], f.re[1]), m = toU(f.mo[0], f.mo[1]);
    g.uniform1i(U.tex, 0);
    g.uniform2f(U.px, 1 / cw, 1 / ch);
    g.uniform1f(U.rad, Math.max(0.8, fw * k * 0.012));
    g.uniform2f(U.c, c[0], c[1]);
    g.uniform2f(U.rr, (fw * 0.62) / sw, (fh * 0.78) / sh);
    g.uniform2f(U.e1, e1[0], e1[1]); g.uniform2f(U.e2, e2[0], e2[1]); g.uniform2f(U.mo, m[0], m[1]);
    g.uniform2f(U.er, (fw * 0.13) / sw, (fh * 0.08) / sh);
    g.uniform2f(U.mr, (fw * 0.2) / sw, (fh * 0.1) / sh);
    g.uniform1f(U.asp, sw / sh);
    g.uniform1f(U.smooth, opt.smooth); g.uniform1f(U.bright, opt.bright); g.uniform1f(U.warm, opt.warm);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    ctx.save(); ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.drawImage(glc!, 0, 0, cw, ch, x0, y0, sw, sh);
    ctx.restore();
  }
}
