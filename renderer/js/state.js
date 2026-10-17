/* ApolloCut — project state, history, selection, events */
(function(){
'use strict';

/* ---------- tiny event bus ---------- */
const Events = {
  m: new Map(),
  on(n, f){ let a = this.m.get(n); if (!a){ a = []; this.m.set(n, a); } a.push(f); },
  emit(n, ...args){ (this.m.get(n) || []).slice().forEach(f => { try { f(...args); } catch(e){ console.error('[event '+n+']', e); } }); }
};
window.Events = Events;

/* ---------- state ---------- */
const State = {
  project: null,
  pool: new Map(),          // mediaId -> media object
  selection: new Set(),     // clip ids
  playhead: 0,
  inPoint: null,
  outPoint: null,
  zoom: 56,                 // px per second
  tool: 'select',
  snapping: true,
  loop: false,
  clipboard: null,
  onDirty: null,            // autosave hook, set by app.js
  _hist: [],
  _hi: -1,
  HMAX: 60
};
window.State = State;

State.markDirty = () => { if (State.onDirty) State.onDirty(); };

/* ---------- model factories ---------- */
function mkTrack(name, type){
  return { id: Util.uid('tr'), name, type, muted:false, hidden:false, locked:false, clips: [] };
}
State.mkTrack = mkTrack;

State.newProject = function(name='Untitled Project'){
  State.project = {
    name, width:1920, height:1080, fps:30,
    tracks: [ mkTrack('V2','video'), mkTrack('V1','video'), mkTrack('A1','audio'), mkTrack('A2','audio') ],
    markers: []
  };
  State.pool.clear();
  State.selection.clear();
  State.playhead = 0; State.inPoint = null; State.outPoint = null;
  State.useGL = typeof State.useGL === 'undefined' ? false : State.useGL;
  State._hist = []; State._hi = -1;
  State.pushHist('New Project');
  Events.emit('structure'); Events.emit('pool'); Events.emit('selection'); Events.emit('time'); Events.emit('history');
};

const VIDEO_DEFAULTS = {
  x:0, y:0, scale:100, rotation:0, opacity:100,
  brightness:100, contrast:100, saturate:100, hue:0, grayscale:0, sepia:0, blur:0,
  speed:1, volume:100, fadeIn:0, fadeOut:0
};

State.makeClip = function(media, o={}){
  const type = o.type || (media ? media.type : 'text');
  const c = Object.assign({
    id: Util.uid('cl'),
    mediaId: media ? media.id : null,
    type,
    label: o.label || (media ? media.name : 'Text'),
    start: o.start ?? 0,
    duration: o.duration ?? (media ? (media.duration || 5) : 5),
    offset: o.offset ?? 0,
    kf: {}
  }, Object.assign({}, VIDEO_DEFAULTS));
  if (type === 'image' && o.duration == null) c.duration = 5;
  if (type === 'adjustment'){
    c.label = o.label || 'Adjustment Layer';
    c.duration = o.duration ?? 5;
  }
  if (type === 'seq'){
    c.label = o.label || 'Nested Sequence';
    c.duration = o.duration ?? 5;
    c.seqId = o.seqId || null;
  }
  if (o.mc) c.mc = o.mc;
  if (type === 'text'){
    c.label = o.label || 'Title';
    c.duration = o.duration ?? 5;
    c.text = {
      content: (o.text && o.text.content) || 'New Title',
      fontFamily: 'system-ui, sans-serif',
      size: 140, weight: 700,
      color: '#ffffff',
      bg: false, bgColor: '#00000099',
      stroke: 0, strokeColor: '#000000'
    };
  }
  return c;
};

/* ---------- lookups ---------- */
State.eachClip = cb => { State.project.tracks.forEach(t => t.clips.forEach(c => cb(c, t))); };
State.findClip = id => {
  for (const t of State.project.tracks){
    const c = t.clips.find(c => c.id === id);
    if (c) return { track: t, clip: c };
  }
  return null;
};
State.trackById = id => State.project.tracks.find(t => t.id === id);
State.seqDuration = () => {
  let d = 1;
  State.eachClip(c => { d = Math.max(d, c.start + c.duration); });
  if (State.outPoint != null) d = Math.max(d, State.outPoint);
  return d;
};
State.sortTrack = t => t.clips.sort((a,b) => a.start - b.start);
State.overlap = (tr, s, d, ignoreId) =>
  tr.clips.some(c => c.id !== ignoreId && s < c.start + c.duration - 1e-6 && s + d > c.start + 1e-6);
State.freeStart = (tr, s, d) => {
  let start = Math.max(0, s), moved = true, guard = 0;
  while (moved && guard++ < 800){
    moved = false;
    for (const c of tr.clips){
      if (start < c.start + c.duration - 1e-6 && start + d > c.start + 1e-6){ start = c.start + c.duration; moved = true; }
    }
  }
  return start;
};

State.selectionClips = () => {
  const out = [];
  State.project.tracks.forEach(t => t.clips.forEach(c => { if (State.selection.has(c.id)) out.push({ track: t, clip: c }); }));
  return out;
};
State.setSelection = ids => { State.selection = new Set(ids); Events.emit('selection'); };

/* ---------- time ---------- */
State.setTime = t => {
  t = Util.clamp(t, 0, Math.max(State.seqDuration(), 1));
  State.playhead = t;
  Events.emit('time', t);
};

/* ---------- keyframes ---------- */
State.valueAt = (clip, prop, tLocal) => {
  if (!clip.kf) return clip[prop];
  const k = clip.kf[prop];
  if (!k || !k.length) return clip[prop];
  tLocal = Util.clamp(tLocal, 0, clip.duration);
  if (tLocal <= k[0].t) return k[0].v;
  const last = k[k.length-1];
  if (tLocal >= last.t) return last.v;
  for (let i=0;i<k.length-1;i++){
    const a = k[i], b = k[i+1];
    if (tLocal >= a.t && tLocal <= b.t){
      const f = (tLocal - a.t) / Math.max(1e-6, b.t - a.t);
      return Util.lerp(a.v, b.v, f);
    }
  }
  return last.v;
};

State.kfUpsert = (clip, prop, tLocal, v) => {
  const k = clip.kf[prop] || (clip.kf[prop] = []);
  const t = Util.round(Util.clamp(tLocal, 0, clip.duration), 3);
  const ex = k.find(p => Math.abs(p.t - t) < 0.02);
  if (ex) ex.v = v;
  else { k.push({ t, v }); k.sort((a,b) => a.t - b.t); }
};

/* ---------- history ---------- */
function snapJSON(){
  return JSON.stringify({ project: State.project, inPoint: State.inPoint, outPoint: State.outPoint });
}
State.snap = snapJSON;

State.pushHist = label => {
  const j = snapJSON();
  const top = State._hist[State._hi];
  if (top && top.json === j) return;
  State._hist = State._hist.slice(0, State._hi + 1);
  State._hist.push({ label, json: j });
  if (State._hist.length > State.HMAX) State._hist.shift();
  State._hi = State._hist.length - 1;
  Events.emit('history');
};

/* commit after an externally-applied mutation (e.g. drag) */
State.commit = label => { State.pushHist(label); State.markDirty(); Events.emit('structure'); };

State.mutate = (label, fn) => {
  const r = fn();
  State.pushHist(label);
  State.markDirty();
  Events.emit('structure');
  return r;
};

function restoreEntry(e){
  const o = JSON.parse(e.json);
  State.project = o.project;
  State.inPoint = o.inPoint; State.outPoint = o.outPoint;
  const keep = new Set();
  State.eachClip ? State.eachClip(c => { if (State.selection.has(c.id)) keep.add(c.id); }) : null;
  State.selection.forEach(id => { if (!State.findClip(id)) State.selection.delete(id); });
  State.playhead = Util.clamp(State.playhead, 0, State.seqDuration());
  Events.emit('structure'); Events.emit('selection'); Events.emit('history'); Events.emit('time');
  State.markDirty();
}

State.undo = () => {
  if (State._hi <= 0){ if (window.UI) UI.toast('Nothing to undo'); return; }
  const from = State._hist[State._hi];
  State._hi--;
  restoreEntry(State._hist[State._hi]);
  if (window.UI) UI.toast('Undo: ' + from.label);
};
State.redo = () => {
  if (State._hi >= State._hist.length - 1){ if (window.UI) UI.toast('Nothing to redo'); return; }
  State._hi++;
  restoreEntry(State._hist[State._hi]);
  if (window.UI) UI.toast('Redo: ' + State._hist[State._hi].label);
};

/* ---------- editing operations ---------- */

/* find best placement for a new clip of a given media */
State.placeNew = function(media, opts={}){
  const type = opts.type || (media ? (media.type === 'image' ? 'image' : media.type) : 'text');
  const want = type === 'audio' ? 'audio' : 'video';
  const t0 = opts.at ?? State.playhead;
  const clip = State.makeClip(media, Object.assign({}, opts, { type, start: t0 }));
  let cands = State.project.tracks.filter(t => t.type === want && !t.locked);
  if (want === 'video') cands = cands.slice().reverse(); // prefer lower video track (V1) first
  let track = null, start = t0;
  for (const c of cands){
    if (!State.overlap(c, t0, clip.duration)){ track = c; break; }
  }
  if (!track){
    if (!cands.length) return null;
    track = cands[0];
    start = State.freeStart(track, t0, clip.duration);
  }
  clip.start = start;
  clip.trackId = track.id;
  State.mutate('Add ' + clip.label, () => {
    track.clips.push(clip);
    State.sortTrack(track);
  });
  State.setSelection([clip.id]);
  State.setTime(opts.keepTime ? State.playhead : start);
  return clip;
};

State.addText = function(at, trackId){
  const clip = State.makeClip(null, { type:'text', start: at ?? State.playhead });
  let track = trackId ? State.trackById(trackId) : null;
  if (!track || track.type !== 'video'){
    const vids = State.project.tracks.filter(t => t.type === 'video' && !t.locked);
    track = vids.find(t => !State.overlap(t, clip.start, clip.duration)) || vids[vids.length-1];
  }
  if (!track) return null;
  if (State.overlap(track, clip.start, clip.duration)) clip.start = State.freeStart(track, clip.start, clip.duration);
  clip.trackId = track.id;
  State.mutate('Add Text', () => { track.clips.push(clip); State.sortTrack(track); });
  State.setSelection([clip.id]);
  return clip;
};

State.addAdjustment = function(at, trackId){
  const clip = State.makeClip(null, { type: 'adjustment', start: at ?? State.playhead });
  let track = trackId ? State.trackById(trackId) : null;
  if (!track || track.type !== 'video'){
    const vids = State.project.tracks.filter(t => t.type === 'video' && !t.locked);
    track = vids[0]; // topmost video track
  }
  if (!track) return null;
  if (State.overlap(track, clip.start, clip.duration)) clip.start = State.freeStart(track, clip.start, clip.duration);
  clip.trackId = track.id;
  State.mutate('Adjustment Layer', () => { track.clips.push(clip); State.sortTrack(track); });
  State.setSelection([clip.id]);
  return clip;
};

State.splitClipAt = function(track, clip, time){
  const rel = time - clip.start;
  if (rel <= 0.001 || rel >= clip.duration - 0.001) return null;
  let b = null;
  State.mutate('Split', () => {
    b = Util.deepClone(clip);
    b.id = Util.uid('cl');
    b.start = time;
    b.duration = clip.start + clip.duration - time;
    b.offset = clip.offset + rel * clip.speed;
    b.fadeIn = 0;
    clip.duration = rel;
    clip.fadeOut = 0;
    // partition keyframes
    b.kf = {};
    for (const p in clip.kf){
      const before = [], after = [];
      clip.kf[p].forEach(k => { (k.t >= rel ? after : before).push({ t: k.t - (k.t >= rel ? rel : 0), v: k.v }); });
      clip.kf[p] = before; if (!before.length) delete clip.kf[p];
      b.kf[p] = after; if (!after.length) delete b.kf[p];
    }
    track.clips.push(b);
    State.sortTrack(track);
  });
  return b;
};

State.splitAtPlayhead = function(onlySelected=false){
  const t = State.playhead;
  let n = 0;
  State.project.tracks.slice().forEach(tr => {
    if (tr.locked) return;
    const c = tr.clips.find(c => t > c.start + 0.001 && t < c.start + c.duration - 0.001);
    if (c && (!onlySelected || State.selection.has(c.id))){ State.splitClipAt(tr, c, t); n++; }
  });
  if (!n && window.UI) UI.toast('Nothing to split at playhead');
  return n;
};

State.deleteSelected = function(ripple=false){
  if (!State.selection.size) return;
  State.mutate(ripple ? 'Ripple Delete' : 'Delete', () => {
    const ids = new Set(State.selection);
    const gaps = [];
    State.project.tracks.forEach(tr => {
      const removed = tr.clips.filter(c => ids.has(c.id));
      tr.clips = tr.clips.filter(c => !ids.has(c.id));
      removed.forEach(r => gaps.push({ s: r.start, d: r.duration }));
    });
    if (ripple){
      gaps.forEach(g => {
        State.project.tracks.forEach(tr => {
          if (tr.locked) return;
          tr.clips.forEach(c => { if (c.start >= g.s + g.d - 1e-6) c.start -= g.d; });
        });
      });
    }
    State.selection.clear();
  });
  Events.emit('selection');
};

State.copySelected = function(){
  const sel = State.selectionClips();
  if (!sel.length){ if (window.UI) UI.toast('Nothing selected'); return; }
  State.clipboard = sel.map(({track, clip}) => ({
    clip: Util.deepClone(clip),
    trackIdx: State.project.tracks.indexOf(track)
  }));
  if (window.UI) UI.toast(`Copied ${sel.length} clip${sel.length>1?'s':''}`);
};

State.paste = function(atTime){
  const cb = State.clipboard;
  if (!cb || !cb.length){ if (window.UI) UI.toast('Clipboard empty'); return; }
  const t0 = atTime ?? State.playhead;
  const minStart = Math.min(...cb.map(e => e.clip.start));
  const newIds = [];
  State.mutate('Paste', () => {
    cb.forEach(e => {
      const tr = State.project.tracks[e.trackIdx];
      if (!tr) return;
      const c = Util.deepClone(e.clip);
      c.id = Util.uid('cl');
      c.start = Math.max(0, t0 + (c.start - minStart));
      if (State.overlap(tr, c.start, c.duration)) c.start = State.freeStart(tr, c.start, c.duration);
      tr.clips.push(c);
      State.sortTrack(tr);
      newIds.push(c.id);
    });
  });
  if (newIds.length) State.setSelection(newIds);
};

State.duplicateSelected = function(){
  const sel = State.selectionClips();
  if (!sel.length) return;
  State.copySelected();
  const t0 = Math.max(...sel.map(({clip}) => clip.start + clip.duration));
  State.paste(t0);
};

State.addMarker = function(t, label){
  State.mutate('Add Marker', () => {
    State.project.markers.push({
      id: Util.uid('mk'), time: t,
      label: label || ('Marker ' + (State.project.markers.length + 1)),
      color: '#4bd8ff'
    });
    State.project.markers.sort((a,b) => a.time - b.time);
  });
};

State.setIn = () => { State.inPoint = State.playhead; if (State.outPoint != null && State.outPoint < State.inPoint) State.outPoint = null; State.pushHist('Mark In'); Events.emit('structure'); };
State.setOut = () => { State.outPoint = State.playhead; if (State.inPoint != null && State.inPoint > State.outPoint) State.inPoint = null; State.pushHist('Mark Out'); Events.emit('structure'); };
State.clearIO = () => { State.inPoint = null; State.outPoint = null; State.pushHist('Clear In/Out'); Events.emit('structure'); };

})();
