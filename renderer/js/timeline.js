/* ApolloCut — timeline: ruler, lanes, clips, drag/trim/split, markers, zoom */
(function(){
'use strict';

const RULER_H = 30;
const LANE_H = { video: 58, audio: 46 };
const $ = id => document.getElementById(id);

const TL = {};
window.TL = TL;

let els = {};
let drag = null;          // active drag session
let scrub = null;         // playhead scrub session

TL.init = function(){
  els.headersInner = $('tl-headers-inner');
  els.right  = $('tl-right');
  els.inner  = $('tl-inner');
  els.ruler  = $('tl-ruler');
  els.lanes  = $('tl-lanes');
  els.playhead = $('tl-playhead');
  els.right.addEventListener('scroll', () => {
    els.headersInner.style.transform = `translateY(${-els.right.scrollTop}px)`;
  });

  // toolbar
  $('tool-select').onclick = () => TL.setTool('select');
  $('tool-razor').onclick  = () => TL.setTool('razor');
  $('btn-snap').onclick    = () => TL.toggleSnap();
  $('btn-cut').onclick     = () => State.splitAtPlayhead(!State.selection.size ? false : true);
  $('btn-marker').onclick  = () => State.addMarker(State.playhead);
  $('btn-add-text').onclick= () => State.addText();
  $('btn-undo').onclick    = () => State.undo();
  $('btn-redo').onclick    = () => State.redo();
  $('zoom-in').onclick  = () => TL.setZoom(State.zoom * 1.35);
  $('zoom-out').onclick = () => TL.setZoom(State.zoom / 1.35);
  $('zoom-fit').onclick = () => TL.zoomFit();
  $('zoom-slider').oninput = e => TL.setZoom(parseFloat(e.target.value));

  els.ruler.addEventListener('pointerdown', onRulerDown);
  els.ruler.addEventListener('dblclick', onRulerDbl);
  els.lanes.addEventListener('pointerdown', onLaneDown);
  els.lanes.addEventListener('dblclick', onLaneDbl);
  els.lanes.addEventListener('contextmenu', onLaneCtx);
  els.right.addEventListener('wheel', onWheel, { passive: false });

  // drag & drop from pool / OS
  els.right.addEventListener('dragover', onDragOver);
  els.right.addEventListener('dragleave', onDragLeave);
  els.right.addEventListener('drop', onDrop);

  Events.on('structure', () => TL.render());
  Events.on('pool', () => TL.render());
  Events.on('time', () => TL.renderTime());
  Events.on('selection', () => TL.renderSel());
};

/* ---------- geometry ---------- */
const px2t = x => x / State.zoom;
const laneH = tr => LANE_H[tr.type] || 50;
function totalH(){ return RULER_H + State.project.tracks.reduce((a,t) => a + laneH(t), 0); }
function contentW(){
  const vw = els.right.clientWidth || 800;
  return Math.max(State.seqDuration() * State.zoom + 900, vw + 60);
}
function laneAtY(y){
  let acc = 0;
  for (const tr of State.project.tracks){
    const h = laneH(tr);
    if (y >= acc && y < acc + h) return tr;
    acc += h;
  }
  return null;
}
function laneY(tr){
  let acc = 0;
  for (const t of State.project.tracks){ if (t === tr) return acc; acc += laneH(t); }
  return acc;
}

/* ---------- tools ---------- */
TL.setTool = tool => {
  State.tool = tool;
  $('tool-select').classList.toggle('active', tool === 'select');
  $('tool-razor').classList.toggle('active', tool === 'razor');
  els.lanes.style.cursor = tool === 'razor' ? 'crosshair' : '';
  UI.status(tool === 'razor' ? 'Razor tool — click a clip to cut' : 'Selection tool');
};
TL.toggleSnap = () => {
  State.snapping = !State.snapping;
  $('btn-snap').classList.toggle('active', State.snapping);
  UI.status('Snapping ' + (State.snapping ? 'on' : 'off'));
};

/* ---------- zoom ---------- */
TL.setZoom = function(z, anchorT, anchorClientX){
  z = Util.clamp(z, 8, 420);
  if (anchorT == null){
    anchorT = px2t(els.right.scrollLeft + els.right.clientWidth/2);
    anchorClientX = els.right.clientWidth/2;
  } else if (anchorClientX == null){
    anchorClientX = els.right.clientWidth/2;
  }
  State.zoom = z;
  $('zoom-slider').value = z;
  TL.render();
  els.right.scrollLeft = anchorT * z - anchorClientX;
};
TL.zoomFit = function(){
  const d = State.seqDuration();
  TL.setZoom((els.right.clientWidth - 60) / Math.max(d, 1));
  els.right.scrollLeft = 0;
};

/* ================================================================
   FULL RENDER
================================================================ */
TL.render = function(){
  if (!State.project) return;
  const cw = contentW();
  els.inner.style.width = cw + 'px';
  els.inner.style.height = totalH() + 'px';
  els.lanes.style.top = RULER_H + 'px';

  buildHeaders();
  buildLanes();
  drawRuler();
  TL.renderTime();
  TL.renderSel();
};

function buildHeaders(){
  els.headersInner.innerHTML = '';
  State.project.tracks.forEach(tr => {
    const h = document.createElement('div');
    h.className = 'tr-head' + (tr.locked ? ' locked' : '');
    h.style.height = laneH(tr) + 'px';
    const isV = tr.type === 'video';
    h.innerHTML = `
      <div class="tname">${Util.esc(tr.name)}</div>
      <div class="tbtns">
        ${isV ? `<button data-a="hide" class="${tr.hidden?'on':''}" title="Hide track video">H</button>` : ''}
        <button data-a="mute" class="warn ${tr.muted?'on':''}" title="Mute track">M</button>
        <button data-a="lock" class="warn ${tr.locked?'on':''}" title="Lock track">🔒</button>
      </div>`;
    h.querySelectorAll('button').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      State.mutate('Track ' + b.dataset.a, () => {
        if (b.dataset.a === 'hide') tr.hidden = !tr.hidden;
        if (b.dataset.a === 'mute') tr.muted = !tr.muted;
        if (b.dataset.a === 'lock') tr.locked = !tr.locked;
      });
    }));
    h.querySelector('.tname').addEventListener('dblclick', () => {
      UI.dialog({
        title: 'Rename Track',
        body: `<div class="dlg-row"><label>Name</label><input name="name" value="${Util.esc(tr.name)}"></div>`,
        onOk: v => { if (v.name.trim()) State.mutate('Rename Track', () => { tr.name = v.name.trim(); }); }
      });
    });
    els.headersInner.appendChild(h);
  });
}

function buildLanes(){
  els.lanes.innerHTML = '';
  State.project.tracks.forEach(tr => {
    const lane = document.createElement('div');
    lane.className = 'lane' + (tr.locked ? ' locked' : '');
    lane.style.height = laneH(tr) + 'px';
    lane.dataset.trackId = tr.id;
    tr.clips.forEach(c => lane.appendChild(clipEl(tr, c)));
    els.lanes.appendChild(lane);
  });
}

function clipEl(tr, c){
  const e = document.createElement('div');
  e.className = 'clip clip-' + c.type + (tr.locked ? ' clip-locked' : '');
  e.dataset.id = c.id;
  positionClipEl(e, c);

  const media = c.mediaId ? Media.get(c.mediaId) : null;
  const offline = c.mediaId && (!media || media.offline);
  if (offline) e.classList.add('offline');

  let inner = '';
  if (!offline && (c.type === 'video' || c.type === 'image') && media && media.thumb && media.thumb.length){
    const im = c.type === 'image' ? media.thumb[0] : (media.thumb[1] || media.thumb[0]);
    inner += `<div class="clip-bg" style="background-image:url('${im}')"></div>`;
  }
  if (!offline && c.type === 'audio' || (c.type === 'video' && media && media.wave)){
    inner += `<canvas class="clip-waves"></canvas>`;
  }
  const spd = c.speed !== 1 ? ` (${Util.round(c.speed*100,0)}%)` : '';
  const label = c.type === 'text' && c.text ? c.text.content.split('\n')[0] : c.label;
  inner += `<div class="clip-label">${ Util.esc(offline ? c.label + ' [OFFLINE]' : label + spd) }</div>`;
  inner += `<div class="fadeov l"></div><div class="fadeov r"></div>`;
  inner += `<div class="h hl" title="Trim in"></div><div class="h hr" title="Trim out"></div>`;
  inner += `<div class="fade-handle fl" title="Fade in"></div><div class="fade-handle fr" title="Fade out"></div>`;
  if (c.type === 'text') inner += `<div class="typebadge">T</div>`;
  if (c.type === 'image') inner += `<div class="typebadge">▦</div>`;
  if (c.type === 'adjustment') inner += `<div class="typebadge">ADJ</div>`;
  if (c.type === 'seq') inner += `<div class="typebadge">SEQ</div>`;
  if (c.mc) inner += `<div class="typebadge">MC${(c.mc.angles || []).length}</div>`;
  if (c.matte && c.matte !== 'off') inner += `<div class="typebadge">MAT◧</div>`;
  e.innerHTML = inner;
  updateFadeEls(e, c);
  // waveform
  if (media && media.wave){
    const cv = e.querySelector('.clip-waves');
    if (cv) drawWave(cv, c, media);
  }
  return e;
}

function positionClipEl(e, c){
  e.style.left = (c.start * State.zoom) + 'px';
  e.style.width = Math.max(3, c.duration * State.zoom) + 'px';
}
function updateFadeEls(e, c){
  const l = e.querySelector('.fadeov.l'), r = e.querySelector('.fadeov.r');
  if (l) l.style.width = (c.fadeIn * State.zoom) + 'px';
  if (r) r.style.width = (c.fadeOut * State.zoom) + 'px';
}

function drawWave(cv, clip, media){
  const wpx = Math.max(4, Math.round(clip.duration * State.zoom));
  const hpx = laneH({ type: 'audio' }) - 4;
  const d = Util.dpr();
  cv.width = wpx * d; cv.height = (hpx + 8) * d;
  cv.style.height = '100%';
  const ctx = cv.getContext('2d');
  ctx.scale(d, d);
  const H = (hpx + 8), mid = H/2;
  const wave = media.wave, n = wave.length;
  const dur = media.duration || 1;
  const startSrc = clip.offset, endSrc = clip.offset + clip.duration * clip.speed;
  ctx.strokeStyle = 'rgba(140,255,180,.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(wpx / 600));
  for (let x = 0; x < wpx; x += step){
    const srcT = startSrc + (x / wpx) * (endSrc - startSrc);
    const idx = Util.clamp(Math.floor(srcT / dur * n), 0, n - 1);
    const a = wave[idx] * (H/2 - 2);
    ctx.moveTo(x + .5, mid - a);
    ctx.lineTo(x + .5, mid + a + 1);
  }
  ctx.stroke();
}

/* ---------- selection ---------- */
TL.renderSel = function(){
  els.lanes.querySelectorAll('.clip').forEach(e => {
    e.classList.toggle('selected', State.selection.has(e.dataset.id));
  });
  // keyframe dots on selected clips
  els.lanes.querySelectorAll('.kf-dot').forEach(k => k.remove());
  State.selection.forEach(id => {
    const e = els.lanes.querySelector(`.clip[data-id="${id}"]`);
    const f = State.findClip(id);
    if (!e || !f) return;
    const times = new Set();
    Object.values(f.clip.kf || {}).forEach(arr => arr.forEach(k => times.add(k.t)));
    times.forEach(t => {
      const dot = document.createElement('div');
      dot.className = 'kf-dot';
      dot.style.left = (t * State.zoom) + 'px';
      e.appendChild(dot);
    });
  });
};

/* ---------- playhead / ruler time ---------- */
TL.renderTime = function(){
  const t = State.playhead;
  els.playhead.style.left = (t * State.zoom) + 'px';
  const tc = $('tc-display');
  if (tc && document.activeElement !== tc) tc.value = Util.timecode(t, State.project.fps);
  const dur = $('tc-dur');
  if (dur) dur.textContent = '/ ' + Util.timecode(State.seqDuration(), State.project.fps);
  // follow playhead while playing
  if (Engine.playing){
    const x = t * State.zoom;
    const sl = els.right.scrollLeft, vw = els.right.clientWidth;
    if (x > sl + vw - 40) els.right.scrollLeft = x - vw * 0.25;
    else if (x < sl) els.right.scrollLeft = Math.max(0, x - vw * 0.2);
  }
};

/* ---------- ruler ---------- */
function drawRuler(){
  const d = Util.dpr();
  const cw = contentW();
  els.ruler.width = cw * d;
  els.ruler.height = RULER_H * d;
  els.ruler.style.width = cw + 'px';
  const ctx = els.ruler.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, cw, RULER_H);

  const z = State.zoom, fps = State.project.fps;
  const dur = State.seqDuration();

  // in/out shading
  const iX = State.inPoint != null ? State.inPoint * z : null;
  const oX = State.outPoint != null ? State.outPoint * z : null;
  if (iX != null || oX != null){
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, iX ?? 0, RULER_H);
    ctx.fillRect(oX ?? cw, 0, cw - (oX ?? cw), RULER_H);
    ctx.fillStyle = 'rgba(143,107,255,.12)';
    ctx.fillRect(iX ?? 0, 0, (oX ?? cw) - (iX ?? 0), RULER_H);
  }

  // ticks
  const minPx = 92;
  const steps = [1/fps, 2/fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  let step = steps[steps.length-1];
  for (const s of steps) if (s * z >= minPx){ step = s; break; }
  ctx.strokeStyle = '#3a3a4e';
  ctx.fillStyle = '#9aa';
  ctx.font = '9.5px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.beginPath();
  for (let t = 0; t <= dur + step; t += step/4){
    const x = Math.round(t * z) + .5;
    const major = Math.abs(t / step - Math.round(t / step)) < 0.01;
    ctx.moveTo(x, major ? 12 : 21);
    ctx.lineTo(x, RULER_H);
    if (major){
      const showF = step <= 1;
      ctx.fillText(showF ? Util.timecode(t, fps) : Util.timecode(t, fps).slice(0, 8), x + 4, 3);
    }
  }
  ctx.stroke();

  // markers
  TL._marks = [];
  State.project.markers.forEach(m => {
    const x = m.time * z;
    ctx.fillStyle = m.color || '#4bd8ff';
    ctx.beginPath();
    ctx.moveTo(x - 5, RULER_H - 11); ctx.lineTo(x + 5, RULER_H - 11); ctx.lineTo(x, RULER_H - 2);
    ctx.closePath(); ctx.fill();
    TL._marks.push({ x, m });
  });

  // in/out flags
  ctx.fillStyle = '#ffd54a';
  if (iX != null){ ctx.beginPath(); ctx.moveTo(iX, 0); ctx.lineTo(iX + 7, 0); ctx.lineTo(iX, 9); ctx.closePath(); ctx.fill(); }
  if (oX != null){ ctx.beginPath(); ctx.moveTo(oX, 0); ctx.lineTo(oX - 7, 0); ctx.lineTo(oX, 9); ctx.closePath(); ctx.fill(); }
}
TL.drawRuler = drawRuler;

function onRulerDown(e){
  if (e.button === 2) return;
  const rect = els.ruler.getBoundingClientRect();
  const x0 = e.clientX - rect.left;
  const z = State.zoom;
  let mode = 'scrub';
  if (State.inPoint != null && Math.abs(x0 - State.inPoint * z) < 8) mode = 'in';
  else if (State.outPoint != null && Math.abs(x0 - State.outPoint * z) < 8) mode = 'out';
  const apply = ev => {
    const t = Util.clamp(px2t(ev.clientX - rect.left), 0, Math.max(State.seqDuration(), 1));
    if (mode === 'scrub') State.setTime(t);
    else if (mode === 'in'){ State.inPoint = t; if (State.outPoint != null && State.outPoint < t) State.outPoint = null; drawRuler(); }
    else { State.outPoint = t; if (State.inPoint != null && State.inPoint > t) State.inPoint = null; drawRuler(); }
  };
  apply(e);
  const mv = ev => apply(ev);
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    if (mode !== 'scrub'){ State.pushHist('Set In/Out'); State.markDirty(); Events.emit('structure'); }
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

function onRulerDbl(e){
  const rect = els.ruler.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const hit = (TL._marks || []).find(k => Math.abs(k.x - x) < 8);
  if (hit){
    UI.dialog({
      title: 'Marker',
      body: `<div class="dlg-row"><label>Label</label><input name="label" value="${Util.esc(hit.m.label)}"></div>
             <div class="dlg-row"><label>Time</label><input name="time" value="${Util.round(hit.m.time, 3)}"></div>`,
      ok: 'Save', extra: [{ label: 'Delete', danger: true, action: () => {
        State.mutate('Delete Marker', () => {
          State.project.markers = State.project.markers.filter(m => m.id !== hit.m.id);
        });
      }}],
      onOk: v => State.mutate('Edit Marker', () => {
        hit.m.label = v.label;
        const t = parseFloat(v.time);
        if (!isNaN(t)) hit.m.time = Math.max(0, t);
        State.project.markers.sort((a,b) => a.time - b.time);
      })
    });
  }
}

/* ================================================================
   LANE INTERACTIONS (select / move / trim / fades / razor)
================================================================ */
function laneTime(e){
  const r = els.lanes.getBoundingClientRect();
  return { t: px2t(e.clientX - r.left), y: e.clientY - r.top };
}

function buildSnaps(excludeIds){
  const pts = [0, State.playhead];
  if (State.inPoint != null) pts.push(State.inPoint);
  if (State.outPoint != null) pts.push(State.outPoint);
  State.project.markers.forEach(m => pts.push(m.time));
  State.eachClip(c => {
    if (!excludeIds.has(c.id)){ pts.push(c.start); pts.push(c.start + c.duration); }
  });
  return pts;
}
function snapDelta(pos, candidates){
  if (!State.snapping) return 0;
  const thr = 9 / State.zoom;
  let best = null, bestD = thr;
  for (const c of candidates){
    const d = Math.abs(c - pos);
    if (d < bestD){ bestD = d; best = c; }
  }
  return best == null ? 0 : best - pos;
}

function onLaneDown(e){
  if (e.button === 2) return;
  const { t, y } = laneTime(e);
  const clipEl = e.target.closest('.clip');
  const laneEl = e.target.closest('.lane');

  if (State.tool === 'razor'){
    if (clipEl){
      const f = State.findClip(clipEl.dataset.id);
      if (f && !f.track.locked) State.splitClipAt(f.track, f.clip, t);
    }
    return;
  }

  if (!clipEl){
    // empty area: clear selection + scrub
    if (!e.shiftKey) State.setSelection([]);
    State.setTime(t);
    const rect = els.lanes.getBoundingClientRect();
    const mv = ev => State.setTime(px2t(ev.clientX - rect.left));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    return;
  }

  let f = State.findClip(clipEl.dataset.id);
  if (!f) return;
  if (f.track.locked){ UI.status('Track is locked'); return; }

  // selection
  if (e.shiftKey){
    const s = new Set(State.selection);
    s.has(f.clip.id) ? s.delete(f.clip.id) : s.add(f.clip.id);
    State.setSelection([...s]);
    return;
  }
  if (!State.selection.has(f.clip.id)) State.setSelection([f.clip.id]);

  // determine mode
  let mode = 'move';
  if (e.target.classList.contains('hl')) mode = 'trimL';
  else if (e.target.classList.contains('hr')) mode = 'trimR';
  else if (e.target.classList.contains('fl')) mode = 'fadeL';
  else if (e.target.classList.contains('fr')) mode = 'fadeR';

  // alt-drag duplicates
  if (e.altKey && mode === 'move'){
    const clone = Util.deepClone(f.clip);
    clone.id = Util.uid('cl');
    f.track.clips.push(clone);
    State.sortTrack(f.track);
    State.setSelection([clone.id]);
    TL.render();
    f = { track: f.track, clip: clone };
    drag = null; // will be set below with duplicate flag
  }

  const items = State.selectionClips().map(({track, clip}) => ({
    track, clip,
    el: els.lanes.querySelector(`.clip[data-id="${clip.id}"]`),
    origStart: clip.start, origDur: clip.duration,
    origOffset: clip.offset, origFade: mode === 'fadeL' ? clip.fadeIn : clip.fadeOut
  }));
  const excludeIds = new Set(items.map(i => i.clip.id));
  drag = {
    mode, x0: e.clientX, y0: e.clientY,
    items: items.length ? items : [],
    primary: f.clip,
    primaryTrack: f.track,
    candidates: buildSnaps(excludeIds),
    moved: false
  };
  const mv = ev => onDragMove(ev);
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onDragEnd(); };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  e.preventDefault();
}

function neighborBounds(track, clip){
  const sorted = track.clips.filter(c => c !== clip).sort((a,b) => a.start - b.start);
  let prevEnd = 0, nextStart = Infinity;
  for (const c of sorted){
    if (c.start + c.duration <= clip.start + 1e-6) prevEnd = Math.max(prevEnd, c.start + c.duration);
    else if (c.start >= clip.start + clip.duration - 1e-6){ nextStart = Math.min(nextStart, c.start); break; }
  }
  return { prevEnd, nextStart };
}

function onDragMove(e){
  if (!drag) return;
  const dt = (e.clientX - drag.x0) / State.zoom;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3 && Math.abs(e.clientY - drag.y0) < 3) return;
  drag.moved = true;

  if (drag.mode === 'move'){
    // horizontal delta with per-item clamping
    let lo = -Infinity, hi = Infinity;
    drag.items.forEach(it => {
      const { prevEnd, nextStart } = neighborBounds(it.track, it.clip);
      lo = Math.max(lo, prevEnd - it.origStart, -it.origStart);
      hi = Math.min(hi, nextStart - (it.origStart + it.origDur));
    });
    let d = Util.clamp(dt, lo, hi);
    // snapping (single selection)
    if (drag.items.length === 1){
      const it = drag.items[0];
      const s1 = snapDelta(it.origStart + d, drag.candidates);
      const s2 = snapDelta(it.origStart + it.origDur + d, drag.candidates);
      d += (Math.abs(s1) > 1e-9) ? s1 : s2;
      d = Util.clamp(d, lo, hi);
    }
    // vertical move (single item)
    let targetTrack = drag.primaryTrack;
    if (drag.items.length === 1){
      const r = els.lanes.getBoundingClientRect();
      const tr = laneAtY(e.clientY - r.top);
      if (tr && tr !== drag.primaryTrack && tr.type === drag.primaryTrack.type && !tr.locked) targetTrack = tr;
    }
    drag.items.forEach(it => {
      it.clip.start = Util.round(it.origStart + d, 3);
      if (it.el) positionClipEl(it.el, it.clip);
    });
    if (targetTrack !== drag.primaryTrack && drag.items.length === 1){
      const it = drag.items[0];
      drag.primaryTrack.clips = drag.primaryTrack.clips.filter(c => c !== it.clip);
      targetTrack.clips.push(it.clip);
      State.sortTrack(targetTrack);
      it.track = targetTrack;
      drag.primaryTrack = targetTrack;
      TL.render();
    }
    const c = drag.primary;
    UI.status(`Move: ${Util.timecode(c.start, State.project.fps)}  (${Util.fmtDur(c.duration)})`);
  }

  else if (drag.mode === 'trimL' || drag.mode === 'trimR'){
    const it = drag.items.find(i => i.clip === drag.primary) || drag.items[0];
    const c = it.clip;
    const media = c.mediaId ? Media.get(c.mediaId) : null;
    const noSource = c.type === 'image' || c.type === 'text' || !media || media.offline;
    const { prevEnd, nextStart } = neighborBounds(it.track, c);

    if (drag.mode === 'trimL'){
      let lo = Math.max(prevEnd - it.origStart, -it.origStart, noSource ? -Infinity : -it.origOffset / Math.max(c.speed, 1e-6));
      let hi = it.origDur - 0.04;
      let d = Util.clamp(dt, lo, hi);
      d += snapDelta(it.origStart + d, drag.candidates);
      d = Util.clamp(d, lo, hi);
      c.start = Util.round(it.origStart + d, 3);
      c.duration = Util.round(it.origDur - d, 3);
      c.offset = Util.round(it.origOffset + d * c.speed, 3);
    } else {
      let lo = 0.04 - it.origDur;
      let hi = Math.min(nextStart - (it.origStart + it.origDur), noSource ? Infinity : ((media.duration - it.origOffset) / Math.max(c.speed, 1e-6)) - it.origDur);
      let d = Util.clamp(dt, lo, hi);
      d += snapDelta(it.origStart + it.origDur + d, drag.candidates);
      d = Util.clamp(d, lo, hi);
      c.duration = Util.round(it.origDur + d, 3);
    }
    if (it.el){ positionClipEl(it.el, c); updateFadeEls(it.el, c);
      const lab = it.el.querySelector('.clip-label');
      if (lab) lab.textContent = `${c.label}  ${Util.fmtDur(c.duration)}`;
    }
    UI.status(`Trim: in ${Util.timecode(c.start, State.project.fps)} · dur ${Util.fmtDur(c.duration)}`);
  }

  else if (drag.mode === 'fadeL' || drag.mode === 'fadeR'){
    const it = drag.items.find(i => i.clip === drag.primary) || drag.items[0];
    const c = it.clip;
    let v = Util.clamp(it.origFade + dt, 0, c.duration - 0.02);
    if (drag.mode === 'fadeL'){ v = Math.min(v, c.duration - c.fadeOut - 0.01); c.fadeIn = Util.round(Math.max(0, v), 3); }
    else { v = Math.min(v, c.duration - c.fadeIn - 0.01); c.fadeOut = Util.round(Math.max(0, v), 3); }
    if (it.el) updateFadeEls(it.el, c);
    UI.status(`Fade ${drag.mode === 'fadeL' ? 'in' : 'out'}: ${Util.round(drag.mode === 'fadeL' ? c.fadeIn : c.fadeOut, 2)}s`);
  }
}

function onDragEnd(){
  if (!drag) return;
  const labels = { move: 'Move Clip', trimL: 'Trim In', trimR: 'Trim Out', fadeL: 'Fade In', fadeR: 'Fade Out' };
  if (drag.moved) State.commit(labels[drag.mode] || 'Edit');
  drag = null;
  UI.status('Ready');
}

/* ---------- dblclick & context ---------- */
function onLaneDbl(e){
  const clipEl = e.target.closest('.clip');
  if (!clipEl) return;
  const f = State.findClip(clipEl.dataset.id);
  if (!f) return;
  if (f.clip.type === 'text' && window.EffectsUI) EffectsUI.focusText();
}

function onLaneCtx(e){
  e.preventDefault();
  const clipEl = e.target.closest('.clip');
  const { t, y } = laneTime(e);
  if (clipEl){
    const f = State.findClip(clipEl.dataset.id);
    if (!f) return;
    if (!State.selection.has(f.clip.id)) State.setSelection([f.clip.id]);
    const items = [
      { label: 'Rename…', action: () => UI.renameClipDialog(f.clip) },
      { label: 'Speed / Duration…', action: () => UI.speedDialog(f.clip) },
      { sep: true },
      { label: 'Fade In 1s', action: () => State.mutate('Fade In', () => { f.clip.fadeIn = Math.min(1, f.clip.duration / 2); }) },
      { label: 'Fade Out 1s', action: () => State.mutate('Fade Out', () => { f.clip.fadeOut = Math.min(1, f.clip.duration / 2); }) },
      { sep: true },
      { label: 'Duplicate', sc: 'Ctrl+D', action: () => State.duplicateSelected() },
      { label: 'Delete', sc: 'Del', action: () => State.deleteSelected(false) },
      { label: 'Ripple Delete', sc: 'Shift+Del', action: () => State.deleteSelected(true) }
    ];
    UI.ctxMenu(e.clientX, e.clientY, items);
  } else {
    const tr = laneAtY(y);
    UI.ctxMenu(e.clientX, e.clientY, [
      { label: 'Paste', sc: 'Ctrl+V', disabled: !State.clipboard, action: () => State.paste(t) },
      { label: 'Add Text Here', action: () => State.addText(t, tr && tr.type === 'video' ? tr.id : null) },
      { sep: true },
      { label: 'Add Marker', sc: 'M', action: () => State.addMarker(t) }
    ]);
  }
}

/* ---------- wheel: zoom / scroll ---------- */
function onWheel(e){
  if (e.ctrlKey || e.metaKey){
    e.preventDefault();
    const r = els.right.getBoundingClientRect();
    const anchorT = px2t(els.right.scrollLeft + (e.clientX - r.left));
    const nz = State.zoom * (e.deltaY > 0 ? 1/1.15 : 1.15);
    TL.setZoom(nz, anchorT, e.clientX - r.left);
  } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)){
    e.preventDefault();
    els.right.scrollLeft += e.deltaY;
  }
}

/* ---------- drag & drop from pool ---------- */
let dropLane = null;
function onDragOver(e){
  const hasMedia = [...e.dataTransfer.types].includes('application/x-apollocut-media') || [...e.dataTransfer.types].includes('Files');
  if (!hasMedia) return;
  e.preventDefault();
  const r = els.lanes.getBoundingClientRect();
  const tr = laneAtY(e.clientY - r.top);
  if (dropLane) dropLane.classList.remove('drop');
  dropLane = tr ? els.lanes.querySelector(`.lane[data-track-id="${tr.id}"]`) : null;
  if (dropLane) dropLane.classList.add('drop');
}
function onDragLeave(e){
  if (dropLane && !els.right.contains(e.relatedTarget)){ dropLane.classList.remove('drop'); dropLane = null; }
}
async function onDrop(e){
  if (dropLane){ dropLane.classList.remove('drop'); dropLane = null; }
  const r = els.lanes.getBoundingClientRect();
  const tr = laneAtY(e.clientY - r.top);
  const t = Math.max(0, px2t(e.clientX - r.left));

  const mediaId = e.dataTransfer.getData('application/x-apollocut-media');
  if (mediaId){
    e.preventDefault();
    const media = Media.get(mediaId);
    if (!media || media.offline) return;
    const want = media.type === 'audio' ? 'audio' : 'video';
    let track = tr && tr.type === want && !tr.locked ? tr
      : State.project.tracks.find(x => x.type === want && !x.locked);
    if (!track) return;
    const clip = State.makeClip(media, { start: t });
    clip.start = State.freeStart(track, clip.start, clip.duration);
    State.mutate('Add ' + clip.label, () => { track.clips.push(clip); State.sortTrack(track); });
    State.setSelection([clip.id]);
    return;
  }
  if (e.dataTransfer.files && e.dataTransfer.files.length){
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    await Media.importFiles(files);
    // place the freshly imported items at the drop point
    let at = t;
    [...State.pool.values()].slice(-files.length).forEach(m => {
      const c = State.placeNew(m, { at, keepTime: true });
      if (c) at = Math.max(at, c.start + c.duration);
    });
  }
}

/* ---------- edit points (for up/down navigation) ---------- */
TL.editPoints = function(){
  const pts = new Set([0]);
  State.eachClip(c => { pts.add(c.start); pts.add(c.start + c.duration); });
  return [...pts].sort((a,b) => a - b);
};

})();
