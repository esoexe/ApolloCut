/* ApolloCut — WebGL2 GPU compositor ("Mercury-style" engine).
   Drop-in alternative to the Canvas2D renderer, driven by the same Graph draw-list,
   so preview/2D/export always agree. Per-layer shader does the full CSS-filter
   equivalent (brightness/contrast/saturate/hue/grayscale/sepia + opacity + transform),
   separable gaussian blur, track mattes (luma/alpha), nested sequences via recursive
   FBO render, 3D-LUT final pass, then blit to the 2D program canvas for plugins/scopes.
   Any failure flips GL.ready=false and the engine falls back to 2D permanently. */
'use strict';
(function(){
const GL = { ready: false, gl: null, didLUT: false };
window.GL = GL;

const VERT = `#version 300 es
in vec2 aPos;
uniform mat3 uMat;      // unit quad -> clip space
uniform vec2 uRes;      // scene px (for scene-uv / matte sampling)
out vec2 vUV;
out vec2 vScene;
void main(){
  vec3 p = uMat * vec3(aPos - 0.5, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = aPos;
  // recover scene-space uv from clip space (-1..1 → 0..1, y flip)
  vScene = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
}`;

const FRAG_LAYER = `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vScene;
uniform sampler2D uTex;
uniform sampler2D uMatte; uniform float uMatteMode; // 0 off, 1 luma, 2 alpha
uniform float uB, uC, uS, uH, uG, uSE, uOpacity;
out vec4 outColor;
vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
void main(){
  vec4 col = texture(uTex, vUV);
  col.rgb *= uB;
  col.rgb = (col.rgb - 0.5) * uC + 0.5;
  float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
  col.rgb = mix(vec3(l), col.rgb, uS);
  col.rgb = hueRot(col.rgb, uH);
  col.rgb = mix(col.rgb, vec3(l), uG);
  vec3 sep = vec3(dot(col.rgb, vec3(0.393,0.769,0.189)), dot(col.rgb, vec3(0.349,0.686,0.168)), dot(col.rgb, vec3(0.272,0.534,0.131)));
  col.rgb = mix(col.rgb, sep, uSE);
  col.rgb = clamp(col.rgb, 0.0, 1.0);
  col.a *= uOpacity;
  if (uMatteMode > 0.5){
    vec4 m = texture(uMatte, vScene);
    float k = uMatteMode < 1.5 ? dot(m.rgb, vec3(0.2126,0.7152,0.0722)) * m.a : m.a;
    col.a *= clamp(k, 0.0, 1.0);
  }
  outColor = col;
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex; uniform vec2 uDir; // texel-scaled step
out vec4 outColor;
void main(){
  vec4 s = texture(uTex, vUV) * 0.2270270270;
  s += texture(uTex, vUV + uDir * 1.3846153846) * 0.3162162162;
  s += texture(uTex, vUV - uDir * 1.3846153846) * 0.3162162162;
  s += texture(uTex, vUV + uDir * 3.2307692308) * 0.0702702703;
  s += texture(uTex, vUV - uDir * 3.2307692308) * 0.0702702703;
  outColor = s;
}`;

const FRAG_COPY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler3D uLUT; uniform float uHasLUT, uLUTSize;
uniform float uOpacity;
out vec4 outColor;
void main(){
  vec4 col = texture(uTex, vUV);
  if (uHasLUT > 0.5 && col.a > 0.001){
    float S = uLUTSize;
    vec3 sc = clamp(col.rgb, 0.0, 1.0) * ((S - 1.0) / S) + 0.5 / S;
    vec3 g = texture(uLUT, sc).rgb;
    col.rgb = mix(col.rgb, g, 1.0);
  }
  col.a *= uOpacity;
  outColor = col;
}`;

let gl = null, cvs = null;
let progLayer, progBlur, progCopy, quadVAO;
const loc = {};         // uniform locations
const fbos = {};        // name -> {tex,fbo,w,h}
const mediaTex = new Map();  // mediaId -> {tex,w,h}
let lutTex = null, lutSize = 0;

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}
function U(p, n){
  const k = p + ':' + n;
  if (!(k in loc)) loc[k] = gl.getUniformLocation(p, n);
  return loc[k];
}

function fbo(name, W, H){
  let f = fbos[name];
  if (f && (f.w !== W || f.h !== H)){ gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); f = null; }
  if (!f){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    f = fbos[name] = { tex, fbo: fb, w: W, h: H };
  }
  return f;
}

function bindFbo(f, clear){
  gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fbo : null);
  gl.viewport(0, 0, f ? f.w : cvs.width, f ? f.h : cvs.height);
  if (clear !== false){ gl.clearColor(0, 0, 0, clear === 'alpha0' ? 0 : 0); gl.clear(gl.COLOR_BUFFER_BIT); }
}

/* ---- mat3 helpers (column-major, like GLSL) ---- */
function mIdent(){ return [1,0,0, 0,1,0, 0,0,1]; }
function mMul(a, b){
  const o = new Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    o[c*3+r] = a[r]*b[c*3] + a[3+r]*b[c*3+1] + a[6+r]*b[c*3+2];
  return o;
}
const mT = (x, y) => [1,0,0, 0,1,0, x,y,1];
const mR = a => { const c = Math.cos(a), s = Math.sin(a); return [c,s,0, -s,c,0, 0,0,1]; };
const mS = (x, y) => [x,0,0, 0,y,0, 0,0,1];
/* build: quad (unit, centered) → size(dw,dh) → rotate → translate(cx,cy px) → px→ndc */
function layerMat(W, H, cx, cy, dw, dh, rot){
  return mMul(mS(2/W, -2/H), mMul(mT(cx - W/2, H/2 - cy), mMul(mR(rot), mS(dw, dh))));
}
const fullMat = (W, H) => layerMat(W, H, W/2, H/2, W, H, 0);

/* read clip's animated params for time t (same math as 2D engine) */
function params(clip, t, W, H){
  const tl = t - clip.start;
  const alpha = State.valueAt(clip, 'opacity', tl) / 100 * env(clip, tl);
  const sx = State.valueAt(clip, 'x', tl), sy = State.valueAt(clip, 'y', tl);
  const rot = State.valueAt(clip, 'rotation', tl) * Math.PI / 180;
  const sc = State.valueAt(clip, 'scale', tl) / 100;
  let b = State.valueAt(clip, 'brightness', tl) / 100;
  let c = State.valueAt(clip, 'contrast', tl) / 100;
  let s = State.valueAt(clip, 'saturate', tl) / 100;
  let hu = State.valueAt(clip, 'hue', tl);
  let g = State.valueAt(clip, 'grayscale', tl) / 100;
  let se = State.valueAt(clip, 'sepia', tl) / 100;
  let bl = State.valueAt(clip, 'blur', tl);
  return { tl, alpha, sx, sy, rot, sc, b, c, s, hu, g, se, bl };
}
function env(clip, tl){
  let a = 1;
  if (clip.fadeIn > 0 && tl < clip.fadeIn) a = tl / clip.fadeIn;
  const dr = clip.start + clip.duration - tl;
  if (clip.fadeOut > 0 && dr < clip.fadeOut) a = Math.min(a, dr / clip.fadeOut);
  return Util.clamp(a, 0, 1);
}

/* ---- texture sources ---- */
function texFor(media, W, H){
  if (!media.el && !media.img) return null;
  const el = media.type === 'image' ? media.img : media.el;
  const ready = media.type === 'image' ? (el && el.complete && el.naturalWidth) : (el && el.readyState >= 2);
  let t = mediaTex.get(media.id);
  if (!t){
    t = { tex: gl.createTexture(), w: 0, h: 0 };
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    mediaTex.set(media.id, t);
  }
  if (ready){
    try {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      t.w = media.type === 'image' ? el.naturalWidth : el.videoWidth;
      t.h = media.type === 'image' ? el.naturalHeight : el.videoHeight;
    } catch(e){ /* stale element */ }
  }
  return t.w ? t : null;
}

/* prerender a text clip into a canvas texture (reused cache) */
const textCvs = new Map();
function texForText(clip, t, W, H){
  let cv = textCvs.get(clip.id);
  if (!cv){ cv = document.createElement('canvas'); textCvs.set(clip.id, cv); }
  if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const x = cv.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.save();
  x.translate(0, 0);
  Engine.drawTextClip(x, clip, t, W, H);
  x.restore();
  let t2 = textCvs.get(clip.id + ':tex');
  if (!t2){
    t2 = { tex: gl.createTexture(), w: 0, h: 0 };
    gl.bindTexture(gl.TEXTURE_2D, t2.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textCvs.set(clip.id + ':tex', t2);
  }
  gl.bindTexture(gl.TEXTURE_2D, t2.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  t2.w = W; t2.h = H;
  return t2;
}

/* ---- drawing ---- */
function drawLayerTex(tex, W, H, mat, p, matteTex, matteMode){
  gl.useProgram(progLayer);
  gl.bindVertexArray(quadVAO);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(U(progLayer, 'uTex'), 0);
  gl.uniformMatrix3fv(U(progLayer, 'uMat'), false, mat);
  gl.uniform2f(U(progLayer, 'uRes'), W, H);
  gl.uniform1f(U(progLayer, 'uB'), p.b);
  gl.uniform1f(U(progLayer, 'uC'), p.c);
  gl.uniform1f(U(progLayer, 'uS'), p.s);
  gl.uniform1f(U(progLayer, 'uH'), p.hu * Math.PI / 180);
  gl.uniform1f(U(progLayer, 'uG'), p.g);
  gl.uniform1f(U(progLayer, 'uSE'), p.se);
  gl.uniform1f(U(progLayer, 'uOpacity'), p.alpha);
  if (matteTex){
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, matteTex);
    gl.uniform1i(U(progLayer, 'uMatte'), 1);
    gl.uniform1f(U(progLayer, 'uMatteMode'), matteMode === 'luma' ? 1 : 2);
  } else gl.uniform1f(U(progLayer, 'uMatteMode'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/* blur scratch: src fbo texture → ping/pong → returned fbo */
function blurPass(srcTex, W, H, blurPx){
  const ping = fbo('ping', W, H), pong = fbo('pong', W, H);
  gl.useProgram(progBlur);
  gl.bindVertexArray(quadVAO);
  const iters = blurPx > 14 ? 3 : blurPx > 6 ? 2 : 1;
  let src = srcTex, dst = ping, step = Math.min(10, blurPx) / 2;
  const mat = fullMat(W, H);
  for (let i = 0; i < iters * 2; i++){
    bindFbo(dst, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(U(progBlur, 'uTex'), 0);
    gl.uniformMatrix3fv(U(progBlur, 'uMat'), false, mat);
    const d = (i % 2 === 0) ? [step / W, 0] : [0, step / H];
    gl.uniform2f(U(progBlur, 'uDir'), d[0], d[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    src = dst.tex;
    dst = (dst === ping) ? pong : ping;
  }
  return src; // texture containing blurred layer
}

function copyPass(srcTex, W, H, target /*fbo|null|'current'*/, opts){
  opts = opts || {};
  gl.useProgram(progCopy);
  gl.bindVertexArray(quadVAO);
  if (target !== 'current') bindFbo(target, false);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(U(progCopy, 'uTex'), 0);
  gl.uniformMatrix3fv(U(progCopy, 'uMat'), false, fullMat(W, H));
  gl.uniform1f(U(progCopy, 'uOpacity'), opts.opacity == null ? 1 : opts.opacity);
  const useLUT = !!(opts.lut && lutTex);
  gl.uniform1f(U(progCopy, 'uHasLUT'), useLUT ? 1 : 0);
  if (useLUT){
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    gl.uniform1i(U(progCopy, 'uLUT'), 1);
    gl.uniform1f(U(progCopy, 'uLUTSize'), lutSize);
  }
  if (opts.noBlend) gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (opts.noBlend) gl.enable(gl.BLEND);
}

/* render ops of a track list into the CURRENT framebuffer */
function renderOps(tracks, t, W, H, depth){
  const ops = Graph.build(tracks, t, { supportsMatte: true });
  for (const op of ops){
    const clip = op.clip;
    let tex = null, sw = 0, sh = 0, mat = null;

    if (clip.type === 'text'){
      const tt = texForText(clip, t, W, H);
      if (!tt) continue;
      tex = tt.tex; sw = W; sh = H;
      const p = params(clip, t, W, H);
      if (p.alpha <= 0.002) continue;
      mat = layerMat(W, H, W/2 + W*p.sx/100, H/2 + H*p.sy/100, W, H, p.rot);
      drawLayerTex(tex, W, H, mat, p, null, null);
      continue;
    }

    if (clip.type === 'seq' && window.Nested && depth < 4){
      const inner = Nested.tracksOf(clip.seqId);
      if (!inner) continue;
      const nf = fbo('nested' + depth, W, H);
      const nt = Graph.nestedTime(clip, t);
      bindFbo(nf, true);
      renderOps(inner, nt, W, H, depth + 1);
      // restore parent target: top-level scene or the enclosing nested fbo
      bindFbo(depth ? fbo('nested' + (depth - 1), W, H) : fbo('scene', W, H), false);
      tex = nf.tex; sw = W; sh = H;
    } else {
      const r = Graph.srcOf(clip, t);
      if (!r || !r.media) continue;
      if (r.media.offline) continue;
      const mt = texFor(r.media, W, H);
      if (!mt) continue;
      tex = mt.tex; sw = mt.w; sh = mt.h;
    }
    if (!tex) continue;

    const p = params(clip, t, W, H);
    if (p.alpha <= 0.002) continue;
    const fit = Util.fit(sw, sh, W, H);
    const dw = fit.w * p.sc, dh = fit.h * p.sc;
    mat = layerMat(W, H, W/2 + W*p.sx/100, H/2 + H*p.sy/100, dw, dh, p.rot);

    let matteTex = null, matteMode = null;
    if (op.matte){
      const mf = fbo('matte', W, H);
      bindFbo(mf, true);
      // draw matte clip (its own params, no matte recursion)
      const mc = op.matte.clip;
      const mp = params(mc, t, W, H);
      let mtex = null, msw = W, msh = H;
      if (mc.type === 'text'){ const tt2 = texForText(mc, t, W, H); mtex = tt2 && tt2.tex; }
      else { const mr = Graph.srcOf(mc, t); if (mr && mr.media && !mr.media.offline){ const mm = texFor(mr.media, W, H); if (mm){ mtex = mm.tex; msw = mm.w; msh = mm.h; } } }
      if (mtex){
        const mfit = Util.fit(msw, msh, W, H);
        const mm2 = layerMat(W, H, W/2 + W*mp.sx/100, H/2 + H*mp.sy/100, mfit.w * mp.sc, mfit.h * mp.sc, mp.rot);
        drawLayerTex(mtex, W, H, mm2, { ...mp, hu: 0, g: 0, se: 0, b: 1, c: 1, s: 1, alpha: 1 }, null, null);
        matteTex = mf.tex; matteMode = op.matte.mode;
      }
      bindFbo(depth ? fbo('nested' + (depth - 1), W, H) : fbo('scene', W, H), false);
    }

    if (p.bl > 0.25){
      // render layer (no blur) into scratch, blur, composite into parent target
      const scratch = fbo('scratch', W, H);
      bindFbo(scratch, true);
      drawLayerTex(tex, W, H, mat, { ...p, alpha: 1 }, matteTex, matteMode);
      const blurredTex = blurPass(scratch.tex, W, H, p.bl);
      bindFbo(depth ? fbo('nested' + (depth - 1), W, H) : fbo('scene', W, H), false);
      copyPass(blurredTex, W, H, 'current', { opacity: p.alpha });
    } else {
      drawLayerTex(tex, W, H, mat, p, matteTex, matteMode);
    }
  }
}

GL.init = function(){
  if (GL.ready) return true;
  try {
    cvs = document.createElement('canvas');
    gl = cvs.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: true });
    if (!gl){ console.warn('WebGL2 unavailable'); return false; }
    progLayer = program(FRAG_LAYER);
    progBlur = program(FRAG_BLUR);
    progCopy = program(FRAG_COPY);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    GL.ready = true;
    console.log('%cGL compositor ready', 'color:#4f4');
    return true;
  } catch(e){ console.error('GL init failed:', e); GL.ready = false; cvs = null; return false; }
};

/* engine entry: draw full scene at time t onto the given 2D context */
GL.renderScene = function(ctx2d, t, W, H, tracks){
  if (!GL.ready) return false;
  GL.didLUT = false;
  if (cvs.width !== W || cvs.height !== H){ cvs.width = W; cvs.height = H; }
  const scene = fbo('scene', W, H);
  bindFbo(scene, true);
  renderOps(tracks, t, W, H, 0);
  // final pass → default framebuffer (optionally with LUT)
  const lut = (State.project.lutRef && window.LUT && LUT.activeData) ? LUT.activeData() : null;
  if (lut && !lutTex) buildLutTex(lut);
  if (lut && lutTex) GL.didLUT = true;
  bindFbo(null, true);
  copyPass(scene.tex, W, H, null, { noBlend: true, lut: lut && lutTex ? true : false });
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.drawImage(cvs, 0, 0);
  return true;
};

function buildLutTex(lut){
  if (lutTex) gl.deleteTexture(lutTex);
  lutTex = gl.createTexture();
  lutSize = lut.size;
  const S = lut.size;
  const data = new Uint8Array(S * S * S * 4);
  for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4){
    data[j] = Math.round(lut.data[i] * 255);
    data[j+1] = Math.round(lut.data[i+1] * 255);
    data[j+2] = Math.round(lut.data[i+2] * 255);
    data[j+3] = 255;
  }
  gl.bindTexture(gl.TEXTURE_3D, lutTex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, S, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}
GL.setLUT = function(lut){ if (!GL.ready) return; if (!lut){ if (lutTex){ gl.deleteTexture(lutTex); lutTex = null; } return; } try { buildLutTex(lut); } catch(e){} };

GL.shutdown = function(){ GL.ready = false; };
})();
