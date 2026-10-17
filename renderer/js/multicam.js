/* ApolloCut — multicam clips.
   clip.mc = { angles:[{id, off}], audio:idx, a:0, cuts:[{t, a}] }
   The clip itself is a normal video clip whose displayed source switches per angle-cut.
   Angles are synced manually or via audio envelope cross-correlation (Analyze.audioOffset). */
'use strict';
const Multicam = { viewer: false, els: [] };
window.Multicam = Multicam;

/* ---------- resolution helpers (used by Graph) ---------- */
Multicam.angleAt = function(clip, tl){
  const mc = clip.mc;
  if (!mc) return 0;
  let a = mc.a || 0;
  for (const c of mc.cuts){ if (tl >= c.t) a = c.a; else break; }
  return Math.min(a, mc.angles.length - 1);
};
Multicam.resolveVideo = function(clip, tl){
  const mc = clip.mc;
  const a = Multicam.angleAt(clip, tl);
  const ang = mc.angles[a];
  const media = ang && Media.get(ang.id);
  if (!media) return null;
  return { media, srcT: Util.clamp((ang.off || 0) + clip.offset + tl * clip.speed, 0, Math.max(0, (media.duration || 0) - 0.03)), angle: a };
};
Multicam.audioAngle = function(clip){
  const mc = clip.mc;
  if (!mc) return null;
  const idx = Math.min(mc.audio || 0, mc.angles.length - 1);
  return mc.angles[idx];
};
Multicam.resolveAudio = function(clip, tl){
  const ang = Multicam.audioAngle(clip);
  const media = ang && Media.get(ang.id);
  if (!media) return null;
  return { media, srcT: Util.clamp((ang.off || 0) + clip.offset + tl * clip.speed, 0, Math.max(0, (media.duration || 0) - 0.03)) };
};

/* ---------- creation dialog ---------- */
Multicam.createDialog = function(){
  const vids = [...State.pool.values()].filter(m => m.type === 'video' && !m.offline);
  if (vids.length < 2){ UI.toast('Multicam needs at least 2 video clips in the pool', 'err'); return; }
  UI.dialog({
    title: '🎥 Create Multicam Clip',
    body: `
      <p class="fx-note">Pick 2–4 camera angles. <b>Audio</b> will be taken from the chosen angle continuously.
      Use <i>Auto-sync by audio</i> to align angles recorded simultaneously (clapper-free sync like Premiere's Merge Clips).</p>
      <div class="dlg-row"><label>Angle 1 (master)</label><select name="a0">${vids.map((m,i) => `<option value="${m.id}"${i===0?' selected':''}>${Util.esc(m.name)}</option>`).join('')}</select></div>
      <div class="dlg-row"><label>Angle 2</label><select name="a1">${vids.map((m,i) => `<option value="${m.id}"${i===1?' selected':''}>${Util.esc(m.name)}</option>`).join('')}</select></div>
      <div class="dlg-row"><label>Angle 3</label><select name="a2"><option value="">— none —</option>${vids.map((m,i) => `<option value="${m.id}"${i===2?' selected':''}>${Util.esc(m.name)}</option>`).join('')}</select></div>
      <div class="dlg-row"><label>Angle 4</label><select name="a3"><option value="">— none —</option>${vids.map((m,i) => `<option value="${m.id}"${i===3?' selected':''}>${Util.esc(m.name)}</option>`).join('')}</select></div>
      <div class="fx-check"><input type="checkbox" name="sync" checked><label>Auto-sync angles by audio correlation</label></div>`,
    ok: 'Create',
    onOk: async v => {
      const ids = [v.a0, v.a1, v.a2, v.a3].filter(Boolean);
      const uniq = [...new Set(ids)];
      if (uniq.length < 2){ UI.toast('Pick at least 2 different sources', 'err'); return; }
      const angles = uniq.map(id => ({ id, off: 0 }));
      const doSync = async () => {
        if (!v.sync || !window.Analyze) return angles;
        UI.toast('Syncing angles by audio… (may take a moment)');
        const master = Media.get(angles[0].id);
        for (let i = 1; i < angles.length; i++){
          const m = Media.get(angles[i].id);
          try {
            const off = await Analyze.audioOffset(master, m, 5);
            if (off != null) angles[i].off = Util.round(off, 3);
          } catch(e){ console.warn('sync angle', i, e); }
        }
        return angles;
      };
      const synced = await doSync();
      const master = Media.get(synced[0].id);
      const dur = Math.max(1, ...synced.map(a => ((Media.get(a.id) && Media.get(a.id).duration) || 0) - (a.off || 0))) || (master ? master.duration : 5);
      const clip = State.makeClip(null, { type: 'video', mediaId: master.id, duration: Math.min(dur, (master && master.duration) || dur), label: 'Multicam' });
      clip.mc = { angles: synced, audio: 0, a: 0, cuts: [] };
      clip.label = `Multicam (${synced.length})`;
      clip.trackId = null;
      const vtr = State.project.tracks.filter(t => t.type === 'video' && !t.locked)[0];
      if (!vtr) return;
      clip.start = State.playhead;
      if (State.overlap(vtr, clip.start, clip.duration)) clip.start = State.freeStart(vtr, clip.start, clip.duration);
      clip.trackId = vtr.id;
      State.mutate('Create Multicam', () => { vtr.clips.push(clip); State.sortTrack(vtr); });
      State.setSelection([clip.id]);
      const offs = synced.map(a => a.off ? a.off.toFixed(2) + 's' : '0').join(', ');
      UI.toast(`Multicam clip created — offsets: ${offs}. Play it and press 1–${synced.length} to cut angles live`, 'ok');
    }
  });
};

/* switch angle at playhead (live-cutting, like Premiere's multi-camera monitor) */
Multicam.switchAtPlayhead = function(idx){
  const sel = State.selectionClips().find(s => s.clip.mc);
  if (!sel) return false;
  const { clip } = sel;
  if (idx < 0 || idx >= clip.mc.angles.length) return false;
  const tl = State.playhead - clip.start;
  if (tl < 0 || tl >= clip.duration) return false;
  State.mutate(`Angle ${idx + 1}`, () => {
    const cuts = clip.mc.cuts;
    const ex = cuts.find(c => Math.abs(c.t - tl) < 0.03);
    if (ex) ex.a = idx; else { cuts.push({ t: Util.round(tl, 3), a: idx }); cuts.sort((x, y) => x.t - y.t); }
    clip.mc.a = clip.mc.a || 0;
  });
  Engine.render(State.playhead);
  return true;
};

/* ---------- multicam viewer (angle strip under the program monitor) ---------- */
Multicam.toggleViewer = function(on){
  Multicam.viewer = on == null ? !Multicam.viewer : on;
  const el = document.getElementById('mc-strip');
  if (el) el.classList.toggle('hidden', !Multicam.viewer);
  if (!Multicam.viewer) Multicam._release();
  Events.emit('time');
};

Multicam.syncViewer = function(t){
  const el = document.getElementById('mc-strip');
  if (!Multicam.viewer || !el) return;
  const sel = State.selectionClips().find(s => s.clip.mc);
  if (!sel){ if (Multicam.els.length) Multicam._release(); return; }
  const { clip } = sel;
  const tl = State.playhead - clip.start;
  const on = tl >= 0 && tl < clip.duration;
  const act = on ? Multicam.angleAt(clip, tl) : -1;
  // build cells
  clip.mc.angles.forEach((ang, i) => {
    let m = Media.get(ang.id);
    let cell = Multicam.els[i];
    if (!cell){
      cell = { v: document.createElement('video'), idx: i };
      cell.v.muted = true; cell.v.playbackRate = 1; cell.v.preload = 'auto';
      cell.v.addEventListener('click', () => Multicam.switchAtPlayhead(i));
      cell.box = document.createElement('div');
      cell.box.className = 'mc-cell';
      cell.lab = document.createElement('span');
      cell.lab.className = 'mc-lab';
      cell.box.appendChild(cell.v); cell.box.appendChild(cell.lab);
      el.appendChild(cell.box);
      Multicam.els[i] = cell;
    }
    cell.lab.textContent = String(i + 1);
    cell.box.classList.toggle('active', i === act);
    if (m && !m.offline && cell.v.dataset.mid !== m.id){
      cell.v.src = m.url || window.desktopUrlFromPath(m.path);
      cell.v.dataset.mid = m.id;
    }
    if (on && m && !m.offline){
      const st = Util.clamp((ang.off || 0) + clip.offset + tl * clip.speed, 0, Math.max(0, m.duration - 0.05));
      if (Math.abs(cell.v.currentTime - st) > 0.12){ try { cell.v.currentTime = st; } catch(e){} }
      if (Engine.playing){ if (cell.v.paused) cell.v.play().catch(() => {}); }
      else if (!cell.v.paused) cell.v.pause();
    }
  });
  // trim extra cells
  while (Multicam.els.length > clip.mc.angles.length){
    const c = Multicam.els.pop();
    c.box.remove();
  }
};
Multicam._release = function(){
  Multicam.els.forEach(c => { try { c.v.pause(); c.v.removeAttribute('src'); c.v.load(); } catch(e){} c.box.remove(); });
  Multicam.els = [];
};

Multicam.init = function(){
  window.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select')) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i < 0) return;
    const sel = State.selectionClips().find(s => s.clip.mc);
    if (!sel) return;
    if (Multicam.switchAtPlayhead(i)) e.preventDefault();
  });
  Events.on('time', t => Multicam.syncViewer(t));
  Events.on('selection', () => Multicam.syncViewer(State.playhead));
  Events.on('playing', () => Multicam.syncViewer(State.playhead));
};
