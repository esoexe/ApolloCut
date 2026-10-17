/* ApolloCut — nested sequences.
   A project holds extra editable sequences (project.seqs = {id:{name,tracks}});
   a `seq` clip on any timeline plays one of them (with offset/speed, like media).
   Editing: Nested.edit(id) swaps project.tracks ↔ seq.tracks (same array refs stay shared
   so the seq always reflects edits); Nested.close() restores. */
'use strict';
const Nested = { editing: null };
window.Nested = Nested;

function mig(){ const P = State.project; if (!P.seqs) P.seqs = {}; return P.seqs; }
Nested.tracksOf = id => { const s = mig()[id]; return s ? s.tracks : null; };
Nested.get = id => mig()[id] || null;

Nested.durationOf = function(id, seen){
  seen = seen || new Set();
  if (seen.has(id)) return 0;
  seen.add(id);
  const trs = Nested.tracksOf(id);
  if (!trs) return 0;
  let d = 0;
  for (const tr of trs) for (const c of tr.clips){
    const end = c.start + c.duration;
    if (end > d) d = end;
  }
  return d;
};

/* ---------- create / nest / insert ---------- */
Nested.create = function(name, reuseTracks){
  const id = Util.uid('sq');
  State.mutate('New Sequence', () => {
    mig()[id] = { name: name || 'Nested Sequence', tracks: reuseTracks || [
      { id: 'v1-' + id, type: 'video', name: 'V1', muted: false, hidden: false, locked: false, clips: [] },
      { id: 'a1-' + id, type: 'audio', name: 'A1', muted: false, hidden: false, locked: false, clips: [] }
    ]};
  });
  return id;
};

Nested.createDialog = function(){
  UI.dialog({
    title: '⧉ New Nested Sequence',
    body: `<div class="dlg-row"><label>Name</label><input name="name" value="Nested Sequence ${Object.keys(mig()).length + 1}"></div>
      <p class="fx-note">Creates an empty sequence you can open, edit and then drop onto any timeline as a single clip — like Premiere Pro nested sequences.</p>`,
    ok: 'Create',
    onOk: v => {
      const id = Nested.create((v.name || '').trim() || 'Nested Sequence');
      UI.toast('Sequence created — use Sequence ▸ Nested ▸ Edit to open it, or Insert to drop it on the timeline', 'ok');
      Nested.edit(id);
    }
  });
};

/* move selected clips into a new sequence and replace with one seq clip */
Nested.nestSelection = function(){
  const sel = State.selectionClips();
  if (!sel.length){ UI.toast('Select clips to nest first'); return; }
  const inT = Math.min(...sel.map(s => s.clip.start));
  const outT = Math.max(...sel.map(s => s.clip.start + s.clip.duration));
  const moved = [];
  State.mutate('Nest Clips', () => {
    for (const { clip, track } of sel){
      track.clips = track.clips.filter(c => c.id !== clip.id);
      moved.push({ clip, track });
    }
    for (const { clip } of moved){
      clip.start -= inT;
      clip.id = Util.uid('cl');
    }
    const vids = moved.filter(m => m.track.type === 'video').map(m => m.clip);
    const auds = moved.filter(m => m.track.type === 'audio').map(m => m.clip);
    const tracks = [
      { id: 'v1n', type: 'video', name: 'V1', muted: false, hidden: false, locked: false, clips: vids },
      { id: 'a1n', type: 'audio', name: 'A1', muted: false, hidden: false, locked: false, clips: auds }
    ].filter(t => t.clips.length || true);
    const id = Nested.create('Nested Sequence', tracks);
    const { track } = sel[0];
    const seqClip = State.makeClip(null, { type: 'seq', start: inT, duration: outT - inT, seqId: id, label: 'Nested Seq' });
    seqClip.trackId = track.id;
    if (State.overlap(track, seqClip.start, seqClip.duration)) seqClip.start = State.freeStart(track, seqClip.start, seqClip.duration);
    track.clips.push(seqClip);
    State.sortTrack(track);
  });
  State.setSelection([]);
  UI.toast('Selection nested — double-click nothing: open via Sequence ▸ Nested ▸ Edit', 'ok');
};

Nested.insertDialog = function(){
  const seqs = mig();
  const ids = Object.keys(seqs).filter(id => !Nested.editing || id !== Nested.editing);
  if (!ids.length){ UI.toast('No nested sequences yet — create one first'); return; }
  UI.dialog({
    title: '⧊ Insert Nested Sequence',
    body: `<div class="dlg-row"><label>Sequence</label><select name="id">${ids.map(id => `<option value="${id}">${Util.esc(seqs[id].name)} (${Util.fmtDur(Nested.durationOf(id))})</option>`).join('')}</select></div>
      <p class="fx-note">Drops the sequence as a single clip on the top video track at the playhead.</p>`,
    ok: 'Insert',
    onOk: v => {
      const id = v.id;
      const clip = State.makeClip(null, { type: 'seq', duration: Nested.durationOf(id) || 5, seqId: id, label: seqs[id].name });
      clip.start = State.playhead;
      const vids = State.project.tracks.filter(t => t.type === 'video' && !t.locked);
      const track = vids[0];
      if (!track) return;
      if (State.overlap(track, clip.start, clip.duration)) clip.start = State.freeStart(track, clip.start, clip.duration);
      clip.trackId = track.id;
      State.mutate('Insert Sequence', () => { track.clips.push(clip); State.sortTrack(track); });
      State.setSelection([clip.id]);
    }
  });
};

/* ---------- edit (swap into main editor) ---------- */
Nested.edit = function(id){
  if (Nested.editing === id) return;
  const seqs = mig();
  if (!seqs[id]) return;
  if (Nested.editing) Nested.close();
  const P = State.project;
  P.__savedTracks = P.tracks;          // stash root by reference (key stays non-enumerable-ish via rename)
  saveKey(P);
  P.tracks = seqs[id].tracks;          // shared array — edits write straight into the seq
  Nested.editing = id;
  State.playhead = 0;
  State._hist = []; State._hi = -1; State.pushHist('Edit Sequence');   // history is seq-local
  Events.emit('structure'); Events.emit('time');
  UI.toast(`Editing sequence "${seqs[id].name}" — Sequence ▸ Nested ▸ Close to return`, 'ok');
};
function saveKey(P){
  // move __savedTracks truly off the JSON path
  if (P.__savedTracks && !P.__rootStash){ P.__rootStash = P.__savedTracks; delete P.__savedTracks; }
}
Nested.close = function(){
  if (!Nested.editing) return;
  const P = State.project;
  P.tracks = P.__rootStash || P.tracks;
  delete P.__rootStash;
  Nested.editing = null;
  State.playhead = 0;
  State._hist = []; State._hi = -1; State.pushHist('Close Sequence');
  Events.emit('structure'); Events.emit('time');
  UI.toast('Back to main sequence', 'ok');
};

/* drop the stashed key before serializing */
Nested.beforeSave = function(){ /* nothing — save reads project which already shares arrays */ };
Nested.afterLoad = function(){
  Nested.editing = null;
  const P = State.project;
  delete P.__rootStash; delete P.__savedTracks;
  mig();
};

/* 2D-engine frame: render the nested content at local time lt onto a cached canvas */
const frameCvs = new Map();
Nested.frame2D = function(clip, lt, W, H, depth){
  if (depth > 3) return null;
  const inner = Nested.tracksOf(clip.seqId);
  if (!inner) return null;
  let cv = frameCvs.get(clip.seqId);
  if (!cv){ cv = document.createElement('canvas'); frameCvs.set(clip.seqId, cv); }
  if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const x = cv.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.save();
  x.scale(W / State.project.width, H / State.project.height);
  Engine.renderTracks2D(x, inner, lt, W, H, depth + 1);
  x.restore();
  return cv;
};

/* audio: recurse into nested seqs to sync inner media elements (preview) */
Nested.syncMedia = function(t, mutedChain, volMul, activeSet){
  const inner = Nested.tracksOf(Nested.editing);
  if (!inner) return;
  for (const tr of inner){
    if (tr.hidden) continue;
    const c = tr.clips.find(c => t >= c.start && t < c.start + c.duration);
    if (!c) continue;
    const r = Graph.srcOf(c, t);
    if (r && r.media && r.media.el) activeSet.add(r.media.id);
  }
};
