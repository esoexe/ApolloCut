/* ApolloCut — rendering & playback engine
   Composites all video tracks onto an offscreen "program" canvas at project
   resolution, mirrors it into the preview, and keeps audio/video elements
   sample-synced. Also feeds canvas.captureStream during export. */
(function(){
'use strict';

const Engine = {
  program: null, pctx: null,
  display: null, dctx: null,
  playing: false, rate: 1,
  master: 1,
  safe: false,
  stopAt: null,          // export stop time
  onTick: null,          // export progress hook
  _raf: 0,
  _anchorT: 0, _anchorP: 0,
  _exportDest: null
};
window.Engine = Engine;

Engine.init = function(){
  Engine.program = document.createElement('canvas');
  Engine.pctx = Engine.program.getContext('2d');
  Engine.display = document.getElementById('program-display');
  Engine.dctx = Engine.display.getContext('2d');
  Engine.resize();
  if (window.ResizeObserver){
    new ResizeObserver(() => Engine.fitDisplay()).observe(document.getElementById('program-wrap'));
  }
  window.addEventListener('resize', () => Engine.fitDisplay());
  Events.on('time', t => Engine.render(t));
  Events.on('structure', () => { if (!Engine.playing) Engine.render(State.playhead); });
  Events.on('pool', () => { if (!Engine.playing) Engine.render(State.playhead); });
};

Engine.resize = function(){
  if (!State.project) return;
  Engine.program.width = State.project.width;
  Engine.program.height = State.project.height;
  Engine.fitDisplay();
  const res = document.getElementById('program-res');
  if (res) res.textContent = ` ${State.project.width}×${State.project.height}`;
  const fps = document.getElementById('fps-ind');
  if (fps) fps.textContent = State.project.fps + ' fps';
};

Engine.fitDisplay = function(){
  const wrap = document.getElementById('program-wrap');
  if (!wrap || !Engine.display) return;
  const r = wrap.getBoundingClientRect();
  const d = Util.dpr();
  Engine.display.width = Math.max(2, Math.floor(r.width * d));
  Engine.display.height = Math.max(2, Math.floor(r.height * d));
  if (!Engine.playing) Engine.render(State.playhead);
};

/* ---------- helpers ---------- */
function env(clip, tl){
  let a = 1;
  if (clip.fadeIn > 0 && tl < clip.fadeIn) a = Math.min(a, tl / clip.fadeIn);
  const fromEnd = clip.duration - tl;
  if (clip.fadeOut > 0 && fromEnd < clip.fadeOut) a = Math.min(a, Math.max(0, fromEnd / clip.fadeOut));
  return Util.clamp(a, 0, 1);
}
Engine.env = env;

function drawOffline(ctx, clip, W, H, media){
  ctx.save();
  const s = 48;
  for (let y=0; y<H; y+=s) for (let x=0; x<W; x+=s){
    ctx.fillStyle = ((x+y)/s) % 2 ? '#2a0f24' : '#4a1538';
    ctx.fillRect(x, y, s, s);
  }
  ctx.fillStyle = '#ff7da0';
  ctx.font = `700 ${Math.round(H*0.045)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('MEDIA OFFLINE — ' + (media ? media.name : clip.label), W/2, H/2);
  ctx.restore();
}

function drawText(ctx, clip, W, H){
  const tx = clip.text;
  const tl = State.playhead - clip.start;
  const sc = State.valueAt(clip, 'scale', tl) / 100;
  const size = tx.size * sc;
  ctx.font = `${tx.weight} ${size}px ${tx.fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = String(tx.content).split('\n');
  const lh = size * 1.2;
  const top = -((lines.length - 1) * lh) / 2;
  if (tx.bg){
    let maxW = 0;
    lines.forEach(l => { maxW = Math.max(maxW, ctx.measureText(l).width); });
    ctx.fillStyle = tx.bgColor;
    const pad = size * 0.35;
    const boxH = lines.length * lh + pad * 1.2;
    ctx.fillRect(-maxW/2 - pad, -boxH/2, maxW + pad*2, boxH);
  }
  lines.forEach((l, i) => {
    const y = top + i * lh;
    if (tx.stroke > 0){
      ctx.lineWidth = tx.stroke; ctx.strokeStyle = tx.strokeColor; ctx.lineJoin = 'round';
      ctx.strokeText(l, 0, y);
    }
    ctx.fillStyle = tx.color;
    ctx.fillText(l, 0, y);
  });
}

function drawClip(ctx, clip, t, W, H, adj, depth){
  depth = depth || 0;
  const tl = t - clip.start;
  const alpha = State.valueAt(clip, 'opacity', tl) / 100 * env(clip, tl);
  if (alpha <= 0.002) return;
  let media = clip.mediaId ? Media.get(clip.mediaId) : null;
  if (clip.mc && window.Multicam){
    const r = Graph.srcOf(clip, t);
    media = r ? r.media : null;
  }
  if (clip.mediaId && clip.type !== 'seq' && (!media || media.offline)){ drawOffline(ctx, clip, W, H, media); return; }

  const sx = State.valueAt(clip, 'x', tl), sy = State.valueAt(clip, 'y', tl);
  const rot = State.valueAt(clip, 'rotation', tl) * Math.PI / 180;
  const sc = State.valueAt(clip, 'scale', tl) / 100;
  const b  = State.valueAt(clip, 'brightness', tl) / 100;
  const c  = State.valueAt(clip, 'contrast', tl) / 100;
  const s  = State.valueAt(clip, 'saturate', tl) / 100;
  const hu = State.valueAt(clip, 'hue', tl);
  const g  = State.valueAt(clip, 'grayscale', tl) / 100;
  const se = State.valueAt(clip, 'sepia', tl) / 100;
  const bl = State.valueAt(clip, 'blur', tl);

  let fb = b, fc = c, fs = s, fhu = hu, fg = g, fse = se, fbl = bl;
  if (adj){
    fb *= adj.b / 100; fc *= adj.c / 100; fs *= adj.s / 100;
    fhu += adj.h; fg = Math.max(fg, adj.g); fse = Math.max(fse, adj.se); fbl += adj.bl;
  }

  ctx.save();
  try { ctx.filter = `brightness(${fb}) contrast(${fc}) saturate(${fs}) hue-rotate(${fhu}deg) grayscale(${fg}) sepia(${fse}) blur(${fbl}px)`; }
  catch(e){ /* filter unsupported */ }
  ctx.globalAlpha = alpha;
  ctx.translate(W/2 + W*sx/100, H/2 + H*sy/100);
  ctx.rotate(rot);

  if (clip.type === 'text'){
    drawText(ctx, clip, W, H);
  } else if (clip.type === 'seq' && window.Nested){
    const cv = Nested.frame2D(clip, tl, W, H, depth);
    if (cv) ctx.drawImage(cv, -W * sc / 2, -H * sc / 2, W * sc, H * sc);
  } else {
    const src = clip.type === 'image' ? (media && media.img) : (media && vidEl(media));
    const ready = clip.type === 'image' ? !!src : (src && src.readyState >= 2);
    if (ready){
      const sw = clip.type === 'image' ? (media.w || 1) : (src.videoWidth || 1);
      const sh = clip.type === 'image' ? (media.h || 1) : (src.videoHeight || 1);
      const base = Util.fit(sw, sh, W, H);
      const dw = base.w * sc, dh = base.h * sc;
      ctx.drawImage(src, -dw/2, -dh/2, dw, dh);
    }
  }
  ctx.restore();
}

/* ---------- media element sync ---------- */
function clampSrc(media, v){ return Util.clamp(v, 0, Math.max(0, (media.duration || 0) - 0.03)); }

/* proxy-aware video source element (preview only; audio always from original) */
function vidEl(media){
  if (State.useProxies !== false && media._proxyUrl){
    if (!media._proxyEl){
      const el = document.createElement('video');
      el.muted = true; el.preload = 'auto'; el.src = media._proxyUrl;
      media._proxyEl = el;
    }
    return media._proxyEl;
  }
  return media.el;
}

/* shared element driver for mc/seq recursion */
function driveEl(media, src, gain, speed, shouldPlay, activeMedia){
  if (!media || !media.el) return;
  activeMedia.add(media.id);
  const actx = Media.ctx();
  const el = media.el, graph = Media.ensureGraph(media);
  if (graph && actx){
    const v = Util.clamp(gain * Engine.master, 0, 4);
    if (Math.abs(graph.gain.value - v) > 0.002) graph.gain.setTargetAtTime(v, actx.currentTime, 0.015);
  }
  if (shouldPlay){
    const need = Util.clamp(speed * Engine.rate, 0.0625, 16);
    if (Math.abs(el.playbackRate - need) > 0.01){ try { el.playbackRate = need; } catch(e){} }
    if (el.paused){
      try { el.currentTime = src; } catch(e){}
      el.play().catch(()=>{});
    } else if (Math.abs(el.currentTime - src) > 0.3){
      try { el.currentTime = src; } catch(e){}
    }
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - src) > 0.008){ try { el.currentTime = src; } catch(e){} }
  }
  const pel = (media.type === 'video' && State.useProxies !== false) ? media._proxyEl : null;
  if (pel){
    if (shouldPlay){
      try { if (Math.abs(pel.playbackRate - el.playbackRate) > 0.01) pel.playbackRate = el.playbackRate; } catch(e){}
      if (pel.paused){ try { pel.currentTime = src; } catch(e){} pel.play().catch(()=>{}); }
      else if (Math.abs(pel.currentTime - src) > 0.35){ try { pel.currentTime = src; } catch(e){} }
    } else {
      if (!pel.paused) pel.pause();
      if (Math.abs(pel.currentTime - src) > 0.008){ try { pel.currentTime = src; } catch(e){} }
    }
  }
}

/* multicam clip: video angle (muted) + continuous audio angle */
function syncMC(clip, tr, t, activeMedia){
  const tl = t - clip.start;
  if (tl < 0 || tl >= clip.duration) return;
  const shouldPlay = Engine.playing && Engine.rate > 0;
  const vv = Multicam.resolveVideo(clip, tl);
  const av = Multicam.resolveAudio(clip, tl);
  const vol = clip.volume / 100 * env(clip, tl) * (tr.muted ? 0 : 1);
  if (vv) driveEl(vv.media, vv.srcT, (av && vv.media && av.media.id === vv.media.id) ? vol : 0, clip.speed, shouldPlay, activeMedia);
  if (av && (!vv || !vv.media || av.media.id !== vv.media.id)) driveEl(av.media, av.srcT, vol, clip.speed, shouldPlay, activeMedia);
}

/* nested sequence clip: recurse into inner clips with composed gain/speed */
function syncSeqInner(clip, t, volMul, mutedChain, activeMedia, depth){
  if ((depth || 0) > 3) return;
  const inner = Nested.tracksOf(clip.seqId);
  if (!inner) return;
  const nt = Graph.nestedTime(clip, t);
  const tlO = t - clip.start;
  const gSeq = (State.valueAt(clip, 'volume', tlO) / 100) * env(clip, tlO) * volMul;
  const shouldPlay = Engine.playing && Engine.rate > 0;
  for (const tr of inner){
    if (tr.hidden) continue;
    const c = tr.clips.find(c => nt >= c.start && nt < c.start + c.duration);
    if (!c) continue;
    const muted = mutedChain || tr.muted;
    if (c.type === 'seq'){ syncSeqInner(c, nt, gSeq, muted, activeMedia, (depth || 0) + 1); continue; }
    if (c.mc && window.Multicam){
      const tl = nt - c.start;
      const vv = Multicam.resolveVideo(c, tl), av = Multicam.resolveAudio(c, tl);
      const vol = (c.volume / 100) * env(c, tl) * gSeq * (muted ? 0 : 1);
      if (vv) driveEl(vv.media, vv.srcT, (av && vv.media && av.media.id === vv.media.id) ? vol : 0, c.speed * clip.speed, shouldPlay, activeMedia);
      if (av && (!vv || !vv.media || av.media.id !== vv.media.id)) driveEl(av.media, av.srcT, vol, c.speed * clip.speed, shouldPlay, activeMedia);
      continue;
    }
    const media = c.mediaId ? Media.get(c.mediaId) : null;
    if (!media || media.offline) continue;
    const tlI = nt - c.start;
    const src = clampSrc(media, c.offset + tlI * c.speed);
    const vol = (c.volume / 100) * env(c, tlI) * gSeq * (muted ? 0 : 1);
    driveEl(media, src, vol, c.speed * clip.speed, shouldPlay, activeMedia);
  }
}

function syncMedia(t){
  const activeMedia = new Set();
  const actx = Media.ctx();
  State.eachClip((clip, tr) => {
    if (clip.type === 'seq' && window.Nested){ syncSeqInner(clip, t, 1, tr.muted, activeMedia, 0); return; }
    if (clip.mc && window.Multicam){ syncMC(clip, tr, t, activeMedia); return; }
    const media = clip.mediaId ? Media.get(clip.mediaId) : null;
    if (!media || !media.el) return;
    const el = media.el;
    const graph = Media.ensureGraph(media);
    const on = t >= clip.start && t < clip.start + clip.duration;
    if (!on) return;
    activeMedia.add(media.id);

    const tl = t - clip.start;
    const src = clampSrc(media, clip.offset + tl * clip.speed);
    const vol = clip.volume/100 * env(clip, tl) * (tr.muted ? 0 : 1);
    if (graph && actx){
      const v = Util.clamp(vol * Engine.master, 0, 4);
      if (Math.abs(graph.gain.value - v) > 0.002) graph.gain.setTargetAtTime(v, actx.currentTime, 0.015);
    }

    const shouldPlay = Engine.playing && Engine.rate > 0;
    if (shouldPlay){
      const need = Util.clamp(clip.speed * Engine.rate, 0.0625, 16);
      if (Math.abs(el.playbackRate - need) > 0.01){ try { el.playbackRate = need; } catch(e){} }
      if (el.paused){
        try { el.currentTime = src; } catch(e){}
        el.play().catch(()=>{});
      } else if (Math.abs(el.currentTime - src) > 0.3){
        try { el.currentTime = src; } catch(e){}
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - src) > 0.008){
        try { el.currentTime = src; } catch(e){}
      }
    }

    // mirror sync to proxy element (video only, always muted)
    const pel = (media.type === 'video' && State.useProxies !== false) ? media._proxyEl : null;
    if (pel){
      if (shouldPlay){
        try { if (Math.abs(pel.playbackRate - el.playbackRate) > 0.01) pel.playbackRate = el.playbackRate; } catch(e){}
        if (pel.paused){
          try { pel.currentTime = src; } catch(e){}
          pel.play().catch(()=>{});
        } else if (Math.abs(pel.currentTime - src) > 0.35){
          try { pel.currentTime = src; } catch(e){}
        }
      } else {
        if (!pel.paused) pel.pause();
        if (Math.abs(pel.currentTime - src) > 0.008){ try { pel.currentTime = src; } catch(e){} }
      }
    }
  });
  // pause everything not active
  State.pool.forEach(m => {
    if (m.el && !activeMedia.has(m.id)){
      if (!m.el.paused) m.el.pause();
      if (m._graph && m._graph.gain.value > 0.002) m._graph.gain.value = 0;
    }
  });
}

/* ---------- main render ---------- */
Engine.render = function(t){
  if (!State.project || !Engine.pctx) return;
  t = Math.max(0, t);
  const W = Engine.program.width, H = Engine.program.height;
  const ctx = Engine.pctx;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  /* GPU path (WebGL2): same draw-list via Graph — falls back to 2D on any error */
  if (State.useGL && window.GL && GL.ready){
    try {
      if (GL.renderScene(ctx, t, W, H, State.project.tracks)){
        if (!GL.didLUT && State.project.lutRef && window.LUT) LUT.applyFrame(ctx, W, H, Engine.playing ? 'fast' : 'best');
        if (window.Plugins) Plugins.runPost(ctx, W, H, t);
        ctx.restore();
        finishFrame(t, W, H);
        return;
      }
    } catch(e){
      console.error('GL frame error:', e);
      try { GL.shutdown(); } catch(e2){}
      UI.toast('GPU engine error — fell back to CPU renderer', 'err');
      State.useGL = false;
      Events.emit('engine');
    }
  }

  Engine.renderTracks2D(ctx, State.project.tracks, t, W, H, 0);

  if (State.project.lutRef && window.LUT) LUT.applyFrame(ctx, W, H, Engine.playing ? 'fast' : 'best');
  if (window.Plugins) Plugins.runPost(ctx, W, H, t);

  ctx.restore();
  finishFrame(t, W, H);
};

/* shared 2D scene pass — used by the main render and by nested sequences */
Engine.renderTracks2D = function(ctx, tracks, t, W, H, depth){
  const vtracks = tracks.filter(x => x.type === 'video');

  // adjustment layers: running filter merge that applies to every track below them
  const adj = new Array(vtracks.length).fill(null);
  let cur = null;
  for (let i = 0; i < vtracks.length; i++){
    adj[i] = cur;
    const tr = vtracks[i];
    if (tr.hidden) continue;
    const ac = tr.clips.find(c => c.type === 'adjustment' && t >= c.start && t < c.start + c.duration);
    if (ac){
      const tl = t - ac.start;
      const s = Util.clamp(ac.opacity / 100, 0, 1) * env(ac, tl);
      if (!cur) cur = { b:100, c:100, s:100, h:0, g:0, se:0, bl:0 };
      cur.b  *= Util.lerp(100, State.valueAt(ac, 'brightness', tl), s) / 100;
      cur.c  *= Util.lerp(100, State.valueAt(ac, 'contrast', tl), s) / 100;
      cur.s  *= Util.lerp(100, State.valueAt(ac, 'saturate', tl), s) / 100;
      cur.h  += Util.lerp(0, State.valueAt(ac, 'hue', tl), s);
      cur.g   = Math.max(cur.g, Util.lerp(0, State.valueAt(ac, 'grayscale', tl), s));
      cur.se  = Math.max(cur.se, Util.lerp(0, State.valueAt(ac, 'sepia', tl), s));
      cur.bl += Util.lerp(0, State.valueAt(ac, 'blur', tl), s);
    }
  }

  for (let i = vtracks.length - 1; i >= 0; i--){   // bottom track first
    const tr = vtracks[i];
    if (tr.hidden) continue;
    const clip = tr.clips.find(c => c.type !== 'adjustment' && t >= c.start && t < c.start + c.duration);
    if (clip) drawClip(ctx, clip, t, W, H, adj[i], depth);
  }
};

function finishFrame(t, W, H){
  syncMedia(t);

  // mirror to display
  const d = Engine.dctx, dw = Engine.display.width, dh = Engine.display.height;
  if (d && dw > 2){
    d.setTransform(1,0,0,1,0,0);
    d.filter = 'none'; d.globalAlpha = 1;
    d.fillStyle = '#000'; d.fillRect(0, 0, dw, dh);
    const f = Util.fit(W, H, dw, dh);
    d.imageSmoothingQuality = 'high';
    d.drawImage(Engine.program, (dw - f.w)/2, (dh - f.h)/2, f.w, f.h);
    if (Engine.safe) drawSafe(d, dw, dh, f);
  }
}

function drawSafe(d, dw, dh, fit){
  const x = (dw - fit.w)/2, y = (dh - fit.h)/2;
  d.save();
  d.strokeStyle = 'rgba(120,255,170,.55)';
  d.lineWidth = Math.max(1, Util.dpr());
  const inset1 = { x: x + fit.w*0.05, y: y + fit.h*0.05, w: fit.w*0.9, h: fit.h*0.9 };
  const inset2 = { x: x + fit.w*0.10, y: y + fit.h*0.10, w: fit.w*0.8, h: fit.h*0.8 };
  d.strokeRect(inset1.x, inset1.y, inset1.w, inset1.h);
  d.strokeRect(inset2.x, inset2.y, inset2.w, inset2.h);
  d.beginPath();
  d.moveTo(dw/2 - 12, dh/2); d.lineTo(dw/2 + 12, dh/2);
  d.moveTo(dw/2, dh/2 - 12); d.lineTo(dw/2, dh/2 + 12);
  d.stroke();
  d.restore();
}

/* seek all active video elements to the exact source time, then render.
   Used by the pro exporter for frame-accurate output. */
Engine.renderReady = async function(t){
  const jobs = [];
  const list = window.Graph ? Graph.mediaJobs(State.project.tracks, t, {}) : [];
  for (const j of list){
    const m = j.media;
    if (!m) continue;
    const el = vidEl(m);
    if (!el) continue;
    const src = clampSrc(m, j.src != null ? j.src : 0);
    if (Math.abs(el.currentTime - src) > 0.002){
      jobs.push(new Promise(res => {
        const to = setTimeout(res, 1200);
        el.addEventListener('seeked', function h(){ el.removeEventListener('seeked', h); clearTimeout(to); res(); });
        try { el.currentTime = src; } catch(e){ res(); }
      }));
    }
  }
  await Promise.all(jobs);
  Engine.pause();
  Engine.render(t);
};
/* expose the 2D text renderer for the GL engine's text-pass */
Engine.drawTextClip = function(ctx, clip, t, W, H){
  const keep = State.playhead;
  State.playhead = t;      // drawText reads State.playhead
  try { drawText(ctx, clip, W, H); } finally { State.playhead = keep; }
};

/* ---------- transport ---------- */
Engine.play = function(rate=1){
  if (!State.project) return;
  if (Engine.playing && Engine.rate === rate) return;
  Media.ctx();
  Engine.playing = true;
  Engine.rate = rate;
  Engine._anchorT = State.playhead;
  Engine._anchorP = performance.now();
  cancelAnimationFrame(Engine._raf);

  const step = () => {
    if (!Engine.playing) return;
    const dt = (performance.now() - Engine._anchorP) / 1000;
    let t = Engine._anchorT + dt * rate;
    const stopAt = Engine.stopAt != null ? Engine.stopAt : State.seqDuration();
    if (rate > 0 && t >= stopAt){
      if (State.loop && Engine.stopAt == null && State.inPoint != null && State.outPoint != null && State.outPoint > State.inPoint){
        Engine._anchorT = State.inPoint; Engine._anchorP = performance.now(); t = State.inPoint;
      } else {
        Engine.playing = false; Engine.rate = 1;
        State.playhead = Math.max(0, stopAt - 1e-4); Events.emit('time'); Events.emit('transport');
        return;
      }
    }
    if (rate < 0 && t <= 0){
      Engine.playing = false; Engine.rate = 1;
      State.playhead = 0; Events.emit('time'); Events.emit('transport');
      return;
    }
    State.playhead = t;
    Events.emit('time');
    if (Engine.onTick) Engine.onTick(t);
    Engine._raf = requestAnimationFrame(step);
  };
  Engine._raf = requestAnimationFrame(step);
  Events.emit('transport');
};

Engine.pause = function(){
  if (!Engine.playing) return;
  Engine.playing = false; Engine.rate = 1;
  cancelAnimationFrame(Engine._raf);
  Events.emit('time');
  Events.emit('transport');
};

Engine.toggle = () => Engine.playing ? Engine.pause() : Engine.play(1);
Engine.setMaster = v => { Engine.master = v; if (!Engine.playing) Engine.render(State.playhead); };

/* ---------- export taps ---------- */
Engine.connectExport = function(dest){
  Engine._exportDest = dest;
  State.pool.forEach(m => { const g = Media.ensureGraph(m); if (g) g.gain.connect(dest); });
};
Engine.disconnectExport = function(){
  if (!Engine._exportDest) return;
  const dest = Engine._exportDest;
  State.pool.forEach(m => { if (m._graph){ try { m._graph.gain.disconnect(dest); } catch(e){} } });
  Engine._exportDest = null;
};

})();
