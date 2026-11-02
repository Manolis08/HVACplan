// Το intro σε WebGL2: η φωτογραφία της εφαρμογής ξαπλωμένη σε φωτεινό «δάπεδο» στούντιο, τα κουμπιά και οι
// κάρτες ως ξεχωριστά επίπεδα που σηκώνονται και στέκονται προς τον φακό, με σκιές, και βάθος πεδίου ανά
// pixel (ό,τι είναι κοντά στον φακό θολώνει πολύ, ό,τι είναι πίσω από την εστίαση ελάχιστα). Κάθε καρέ
// υπολογίζεται μόνο από τον χρόνο t μέσα στο seek(t).
import { FLOORS } from './floors';
import { makeTimeline, type Piece } from './timeline';

export interface IntroLayout {
  width: number;
  height: number;
  dpr: number;
  pad: number;
  page: string;
  pieces: (Piece & { file: string })[];
}

export interface IntroImages {
  page: ImageBitmap;
  pieces: ImageBitmap[];
}

export interface Film {
  seek(t: number): void;
  resize(): void;
  dispose(): void;
}

export async function loadImages(base: string, layout: IntroLayout): Promise<IntroImages> {
  const load = async (file: string) => {
    const res = await fetch(base + file);
    if (!res.ok) throw new Error(file);
    return createImageBitmap(await res.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
  };
  const [page, ...pieces] = await Promise.all([load(layout.page), ...layout.pieces.map((p) => load(p.file))]);
  return { page, pieces };
}

const QUAD_VS = `#version 300 es
in vec2 aUv;
uniform mat4 uView, uProj;
uniform vec4 uRect;      // κέντρο (x, y) και μισό μέγεθος (w/2, h/2) της γεωμετρίας, σε px σελίδας
uniform vec2 uLift;      // ύψος και γωνία «σηκώματος» (rad)
uniform float uSquash;   // σκιά: συμπίεση κατά y (στοιχείο που στέκεται ρίχνει πιο κοντή σκιά)
uniform int uMode;
out vec2 vLocal;
out float vDepth;
void main() {
  vec2 local = (aUv * 2.0 - 1.0) * uRect.zw;
  vec3 p;
  if (uMode == 2 || uMode == 3) {
    p = vec3(uRect.x + local.x, uRect.y + local.y * uSquash, 0.0);
  } else {
    float c = cos(uLift.y), s = sin(uLift.y);
    // στρέφεται γύρω από τη μέση του· η πάνω ακμή ανεβαίνει προς τον φακό
    p = vec3(uRect.x + local.x, uRect.y + local.y * c, uLift.x - local.y * s);
  }
  vec4 viewPos = uView * vec4(p.x, -p.y, p.z, 1.0);
  vDepth = -viewPos.z;
  vLocal = local;
  gl_Position = uProj * viewPos;
}`;

const QUAD_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTex;
uniform int uMode;          // 0 σελίδα, 1 στοιχείο, 2 σκιά στοιχείου, 3 σκιά σελίδας
uniform vec2 uHalf;         // μισό μέγεθος της εικόνας (px σελίδας)
uniform vec2 uCenterOff;    // σκιά: πόσο έχει μετατοπιστεί από την εικόνα
uniform float uCorner, uOpacity, uLod, uDepthScale;
in vec2 vLocal;
in float vDepth;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDepth;
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
const vec3 SHADOW = vec3(0.102, 0.129, 0.2); // #1a2133
void main() {
  vec4 c;
  if (uMode == 0) {
    c = texture(uTex, vLocal / (2.0 * uHalf) + 0.5);
    float d = sdRound(vLocal, uHalf, uCorner);
    float aa = max(fwidth(d), 1e-3);
    c *= 1.0 - smoothstep(-aa, aa, d);
  } else if (uMode == 1) {
    c = texture(uTex, vLocal / (2.0 * uHalf) + 0.5);
  } else if (uMode == 2) {
    vec2 uv = (vLocal - uCenterOff) / (2.0 * uHalf) + 0.5;
    float a = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : textureLod(uTex, uv, uLod).a;
    c = vec4(SHADOW, 1.0) * a * uOpacity;
  } else {
    // πλατιά, απαλή σκιά της εφαρμογής πάνω στο δάπεδο
    float d = sdRound(vLocal, uHalf, uCorner);
    c = vec4(SHADOW, 1.0) * (1.0 - smoothstep(-30.0, 90.0, d)) * uOpacity;
  }
  oColor = c;
  oDepth = vec4(vDepth / uDepthScale * c.a, 0.0, 0.0, c.a);
}`;

const FULL_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vUv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uFocus, uDepthScale;
uniform vec3 uCenter, uEdge;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDepth;
void main() {
  // δάπεδο στούντιο: χρώμα στη μέση και στις γωνίες (ανά φόντο)
  float k = smoothstep(0.0, 1.0, length((vUv - 0.5) * vec2(1.25, 1.0)) * 1.35);
  oColor = vec4(mix(uCenter, uEdge, k), 1.0);
  oDepth = vec4(uFocus / uDepthScale, 0.0, 0.0, 1.0);
}`;

const DOF_FS = `#version 300 es
precision highp float;
uniform sampler2D uColor, uDepth;
uniform vec2 uRes;
uniform float uFocus, uNear, uFar, uCap, uDepthScale;
out vec4 o;
float coc(float d) {
  return d < uFocus ? min(uCap, uNear * (uFocus - d) / d) : min(uCap, uFar * (d - uFocus) / d);
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float d = texelFetch(uDepth, px, 0).r * uDepthScale;
  float r = coc(d);
  if (r < 0.5) { o = vec4(texelFetch(uColor, px, 0).rgb, 1.0); return; }
  vec2 uv = gl_FragCoord.xy / uRes;
  // κάθε δείγμα από επίπεδο mip ανάλογο του θολώματος (χωρίς «κόκκους» στα μεγάλα θολώματα)
  float lod = log2(max(1.0, r * 0.28));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / 40.0) * r;
    float an = fi * 2.39996323;
    acc += textureLod(uColor, uv + vec2(cos(an), sin(an)) * rr / uRes, lod).rgb;
  }
  o = vec4(acc / 40.0, 1.0);
}`;

// ---------- μικρά μαθηματικά πινάκων (column-major) ----------
type M4 = Float32Array;
function perspective(fovY: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye: number[], c: number[], up: number[]): M4 {
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = norm([c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]]);
  const s = norm(cross(f, up));
  const u = cross(s, f);
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1]);
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(prog, name));
    return uniforms.get(name)!;
  };
  return { prog, u };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function createFilm(canvas: HTMLCanvasElement, layout: IntroLayout, images: IntroImages, mobile: boolean, theme = 'light'): Film | null {
  const [floorCenter, floorEdge] = (FLOORS[theme] ?? FLOORS.light).map(rgb);
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) return null;
  const floatDepth = !!gl.getExtension('EXT_color_buffer_float');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

  const quad = compile(gl, QUAD_VS, QUAD_FS);
  const floor = compile(gl, FULL_VS, FLOOR_FS);
  const dof = compile(gl, FULL_VS, DOF_FS);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(quad.prog, 'aUv');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const emptyVao = gl.createVertexArray();

  // υφές με mipmaps και ανισοτροπικό φιλτράρισμα (αλλιώς το μακρινό κείμενο «τρεμοπαίζει»)
  const texture = (img: ImageBitmap) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  };
  const pageTex = texture(images.page);
  const pieceTex = images.pieces.map(texture);

  // στόχοι απόδοσης: χρώμα (με mipmaps για το θόλωμα) και βάθος
  let W = 0, H = 0, RW = 0, RH = 0, scale = Math.min(window.devicePixelRatio || 1, 1.5);
  let colorTex: WebGLTexture | null = null, depthTex: WebGLTexture | null = null, fbo: WebGLFramebuffer | null = null;
  let tl = makeTimeline({ w: layout.width, h: layout.height }, { w: 1, h: 1 }, mobile);

  function allocTargets() {
    if (colorTex) gl!.deleteTexture(colorTex);
    if (depthTex) gl!.deleteTexture(depthTex);
    if (fbo) gl!.deleteFramebuffer(fbo);
    colorTex = gl!.createTexture();
    gl!.bindTexture(gl!.TEXTURE_2D, colorTex);
    const levels = Math.floor(Math.log2(Math.max(RW, RH))) + 1;
    gl!.texStorage2D(gl!.TEXTURE_2D, levels, gl!.RGBA8, RW, RH);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    depthTex = gl!.createTexture();
    gl!.bindTexture(gl!.TEXTURE_2D, depthTex);
    gl!.texStorage2D(gl!.TEXTURE_2D, 1, floatDepth ? gl!.R16F : gl!.RGBA8, RW, RH);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    fbo = gl!.createFramebuffer();
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, colorTex, 0);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT1, gl!.TEXTURE_2D, depthTex, 0);
    gl!.drawBuffers([gl!.COLOR_ATTACHMENT0, gl!.COLOR_ATTACHMENT1]);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }

  function resize() {
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    RW = Math.round(W * scale);
    RH = Math.round(H * scale);
    canvas.width = RW;
    canvas.height = RH;
    tl = makeTimeline({ w: layout.width, h: layout.height }, { w: W, h: H }, mobile);
    allocTargets();
  }
  resize();

  // αν η συσκευή δεν προλαβαίνει, χαμηλώνει η ανάλυση (μία φορά)
  let slowFrames = 0, lastNow = 0, lowered = false;

  function seek(t: number) {
    const now = performance.now();
    if (lastNow && now - lastNow > 26 && !lowered) slowFrames++;
    lastNow = now;
    if (slowFrames > 12 && !lowered) {
      lowered = true;
      scale = 1;
      resize();
    }

    const cam = tl.camera(t);
    const L = [cam.lx, -cam.ly, 0];
    const eye = [L[0], L[1] - cam.D * Math.sin(cam.tilt), cam.D * Math.cos(cam.tilt)];
    const view = lookAt(eye, L, [0, Math.cos(cam.tilt), Math.sin(cam.tilt)]);
    const proj = perspective(2 * Math.atan(H / 2 / cam.F), W / H, Math.max(1, cam.D * 0.05), cam.D * 12 + 6000);
    proj[9] = -cam.shift; // μετατόπιση του κέντρου του φακού (το κάδρο ανεβαίνει, η κάμερα δεν γυρίζει)
    const depthScale = floatDepth ? 1 : cam.D * 4;

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.viewport(0, 0, RW, RH);
    gl!.disable(gl!.DEPTH_TEST);

    // δάπεδο
    gl!.disable(gl!.BLEND);
    gl!.useProgram(floor.prog);
    gl!.uniform1f(floor.u('uFocus'), cam.D);
    gl!.uniform1f(floor.u('uDepthScale'), depthScale);
    gl!.uniform3fv(floor.u('uCenter'), floorCenter);
    gl!.uniform3fv(floor.u('uEdge'), floorEdge);
    gl!.bindVertexArray(emptyVao);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    // σελίδα, σκιές, στοιχεία: χωρίς buffer βάθους, από το χαμηλότερο στο ψηλότερο
    gl!.enable(gl!.BLEND);
    gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.useProgram(quad.prog);
    gl!.bindVertexArray(vao);
    gl!.uniformMatrix4fv(quad.u('uView'), false, view);
    gl!.uniformMatrix4fv(quad.u('uProj'), false, proj);
    gl!.uniform1f(quad.u('uDepthScale'), depthScale);
    gl!.uniform1i(quad.u('uTex'), 0);
    gl!.activeTexture(gl!.TEXTURE0);
    const PW = layout.width, PH = layout.height;
    const draw = (mode: number, rect: number[], half: number[], opts: { lift?: number[]; squash?: number; off?: number[]; opacity?: number; lod?: number; corner?: number }) => {
      gl!.uniform1i(quad.u('uMode'), mode);
      gl!.uniform4f(quad.u('uRect'), rect[0], rect[1], rect[2], rect[3]);
      gl!.uniform2f(quad.u('uHalf'), half[0], half[1]);
      gl!.uniform2f(quad.u('uLift'), opts.lift?.[0] ?? 0, opts.lift?.[1] ?? 0);
      gl!.uniform1f(quad.u('uSquash'), opts.squash ?? 1);
      gl!.uniform2f(quad.u('uCenterOff'), opts.off?.[0] ?? 0, opts.off?.[1] ?? 0);
      gl!.uniform1f(quad.u('uOpacity'), opts.opacity ?? 1);
      gl!.uniform1f(quad.u('uLod'), opts.lod ?? 0);
      gl!.uniform1f(quad.u('uCorner'), opts.corner ?? 0);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    };

    // σκιά της εφαρμογής πάνω στο δάπεδο, και η ίδια η εφαρμογή με στρογγυλεμένες γωνίες
    // (η υφή δένεται πριν από τη σκιά: αλλιώς στη μονάδα 0 μένει η εικόνα του προηγούμενου καρέ, στην
    // οποία γράφουμε τώρα, και ο browser απορρίπτει τη σχεδίαση)
    gl!.bindTexture(gl!.TEXTURE_2D, pageTex);
    if (cam.pageShadow > 0.001) draw(3, [PW / 2, PH / 2 + 18, PW / 2 + 110, PH / 2 + 110], [PW / 2, PH / 2], { corner: cam.corner, opacity: 0.2 * cam.pageShadow });
    draw(0, [PW / 2, PH / 2, PW / 2, PH / 2], [PW / 2, PH / 2], { corner: cam.corner });

    const lifts = layout.pieces.map((p) => tl.lift(p, t));
    // σκιές: ίδιο σχήμα σε #1a2133, μετατόπιση (0,10z, 4 + 0,36z), θόλωμα 7 + 0,5z, 26 %
    layout.pieces.forEach((p, i) => {
      const { z, a } = lifts[i];
      const off = [0.1 * z, 4 + 0.36 * z];
      const blur = 7 + 0.5 * z;
      const cx = p.x + p.w / 2 + off[0], cy = p.y + p.h / 2 + off[1];
      gl!.bindTexture(gl!.TEXTURE_2D, pieceTex[i]);
      draw(2, [cx, cy, p.w / 2 + blur, p.h / 2 + blur], [p.w / 2, p.h / 2], {
        squash: Math.cos(a),
        opacity: 0.26,
        lod: Math.log2(Math.max(1, blur * layout.dpr * 0.6)),
      });
    });
    const order = layout.pieces.map((_, i) => i).sort((i, j) => lifts[i].z - lifts[j].z);
    for (const i of order) {
      const p = layout.pieces[i];
      gl!.bindTexture(gl!.TEXTURE_2D, pieceTex[i]);
      draw(1, [p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2], [p.w / 2, p.h / 2], { lift: [lifts[i].z, lifts[i].a] });
    }

    // βάθος πεδίου
    gl!.bindTexture(gl!.TEXTURE_2D, colorTex);
    gl!.generateMipmap(gl!.TEXTURE_2D);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, RW, RH);
    gl!.disable(gl!.BLEND);
    gl!.useProgram(dof.prog);
    gl!.bindVertexArray(emptyVao);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, colorTex);
    gl!.uniform1i(dof.u('uColor'), 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, depthTex);
    gl!.uniform1i(dof.u('uDepth'), 1);
    const k = (H / 1152) * scale; // οι τιμές θολώματος είναι για κάδρο ύψους 1152 px
    gl!.uniform2f(dof.u('uRes'), RW, RH);
    gl!.uniform1f(dof.u('uFocus'), cam.D);
    gl!.uniform1f(dof.u('uNear'), 75 * k);
    gl!.uniform1f(dof.u('uFar'), 6 * k);
    gl!.uniform1f(dof.u('uCap'), 120 * k);
    gl!.uniform1f(dof.u('uDepthScale'), depthScale);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    // οι στόχοι του καρέ δεν μένουν δεμένοι ως υφές για το επόμενο
    gl!.bindTexture(gl!.TEXTURE_2D, null);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, null);
  }

  function dispose() {
    for (const t of [pageTex, ...pieceTex, colorTex, depthTex]) if (t) gl!.deleteTexture(t);
    if (fbo) gl!.deleteFramebuffer(fbo);
    gl!.deleteBuffer(vbo);
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return { seek, resize, dispose };
}
