/* ApolloCut — project save/load + WebM export via canvas.captureStream & MediaRecorder */
(function(){
'use strict';

const Exporter = { rec: null, _stopping: false };
window.Exporter = Exporter;

/* ================= project files ================= */
Exporter.projectJSON = function(){
  const p = Object.assign({}, State.project);
  if (window.Nested && Nested.editing){
    if (p.__rootStash) p.tracks = p.__rootStash;   // always save the ROOT timeline
    delete p.__rootStash;
  }
  delete p.__savedTracks;
  return {
    app: 'ApolloCut', version: 1, savedAt: new Date().toISOString(),
    project: p,
    inPoint: State.inPoint, outPoint: State.outPoint,
    pool: [...State.pool.values()].map(m => ({
      id: m.id, name: m.name, type: m.type, duration: m.duration, w: m.w, h: m.h,
      path: m.path || null
    }))
  };
};

Exporter.saveProject = async function(){
  const name = (State.project.name || 'apollocut').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'apollocut';
  const json = JSON.stringify(Exporter.projectJSON(), null, 1);
  if (window.desktop && window.desktop.isDesktop){
    const p = await window.desktop.saveProjectDialog(json, name + '.apollocut.json');
    if (p) UI.toast('Project saved: ' + p, 'ok');
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  Util.download(name + '.apollocut.json', blob);
  UI.toast('Project saved (media files stay on your disk — keep them to relink)', 'ok');
};

Exporter.loadData = function(data, opts={}){
  if (!data || data.app !== 'ApolloCut' || !data.project) throw new Error('Not an ApolloCut project');
  State.project = data.project;
  State.inPoint = data.inPoint ?? null;
  State.outPoint = data.outPoint ?? null;
  State.pool.clear();
  (data.pool || []).forEach(p => {
    State.pool.set(p.id, Object.assign({}, p, { offline: true, thumb: [], wave: null }));
  });
  if (!State.project.seqs) State.project.seqs = {};
  if (window.Nested) Nested.afterLoad();
  State.selection.clear();
  State.playhead = 0;
  State._hist = []; State._hi = -1;
  State.pushHist('Open Project');
  const nameInput = document.getElementById('project-name');
  if (nameInput) nameInput.value = State.project.name || 'Untitled Project';
  Engine.resize();
  Events.emit('structure'); Events.emit('pool'); Events.emit('selection'); Events.emit('time'); Events.emit('history'); Events.emit('transport');

  // Desktop: try to auto-relink media straight from their original paths.
  if (window.desktop && window.desktop.isDesktop){
    const offline = [...State.pool.values()].filter(m => m.offline && m.path);
    if (offline.length){
      return Promise.all(offline.map(m => Media.tryRelink(m, m.path))).then(rs => {
        const n = rs.filter(Boolean).length;
        if (n){
          Events.emit('pool'); Events.emit('structure');
          UI.toast(`Auto-relinked ${n} media file${n>1?'s':''} from disk`, 'ok');
        } else if (!opts.silent) {
          UI.toast('Media not found at original paths — re-import files (same names) to relink');
        }
      });
    }
  } else if (!opts.silent && window.UI) UI.toast('Project loaded — re-import missing media to relink (matched by filename)');
};

Exporter.openProjectFile = async function(file){
  try {
    const text = await file.text();
    Exporter.loadData(JSON.parse(text));
    State.markDirty();
  } catch(e){
    console.error(e);
    UI.toast('Could not open project: ' + e.message, 'err');
  }
};

/* ================= frame export ================= */
Exporter.exportFrame = function(){
  Engine.pause();
  Engine.render(State.playhead);
  Engine.program.toBlob(b => {
    if (b) Util.download('apollocut-frame.png', b);
  }, 'image/png');
  UI.toast('Frame exported', 'ok');
};

/* ================= webm export ================= */
Exporter.exportDialog = function(){
  if (typeof MediaRecorder === 'undefined'){
    UI.toast('MediaRecorder is not supported in this browser', 'err');
    return;
  }
  const hasClips = (() => { let n = 0; State.eachClip(() => n++); return n; })();
  if (!hasClips){ UI.toast('Timeline is empty — add some clips first'); return; }

  const hasIO = State.inPoint != null && State.outPoint != null && State.outPoint > State.inPoint;
  UI.dialog({
    title: 'Export Video (WebM)',
    body: `
      <div class="dlg-row"><label>Range</label><select name="range">
        <option value="entire">Entire sequence (${Util.fmtDur(State.seqDuration())})</option>
        ${hasIO ? `<option value="io" selected>In → Out (${Util.fmtDur(State.outPoint - State.inPoint)})</option>` : ''}
      </select></div>
      <div class="dlg-row"><label>Quality</label><select name="quality">
        <option value="6000000">Draft — 6 Mbps</option>
        <option value="10000000" selected>High — 10 Mbps</option>
        <option value="18000000">Extreme — 18 Mbps</option>
      </select></div>
      <div class="dlg-row"><label>Resolution</label><input value="${State.project.width}×${State.project.height} @ ${State.project.fps}fps" disabled></div>
      <p class="fx-note">Export happens in real time (a 10s sequence takes ~10s) and includes mixed audio.
      The file downloads as <b>.webm</b> when finished. Keep this tab focused while exporting.</p>`,
    ok: 'Start Export',
    onOk: v => Exporter.start({
      useIO: v.range === 'io',
      bps: parseInt(v.quality) || 10000000
    })
  });
};

Exporter.start = function({ useIO=false, bps=10000000 }={}){
  const P = State.project;
  const inT  = (useIO && State.inPoint != null) ? State.inPoint : 0;
  const outT = (useIO && State.outPoint != null) ? State.outPoint : State.seqDuration();
  if (outT - inT < 0.1){ UI.toast('Export range too short', 'err'); return; }

  // audio tap
  let dest = null;
  const actx = Media.ctx();
  if (actx){
    State.pool.forEach(m => Media.ensureGraph(m));
    try {
      dest = actx.createMediaStreamDestination();
      Engine.connectExport(dest);
    } catch(e){ console.warn(e); dest = null; }
  }

  const stream = Engine.program.captureStream(P.fps);
  if (dest) dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

  const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  let mime = '';
  for (const m of mimes){ try { if (MediaRecorder.isTypeSupported(m)){ mime = m; break; } } catch(e){} }

  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 } : { videoBitsPerSecond: bps });
  } catch(e){
    UI.toast('Recorder failed: ' + e.message, 'err');
    Engine.disconnectExport();
    return;
  }

  const chunks = [];
  let cancelled = false;
  Exporter.rec = rec;
  Exporter._stopping = false;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal"><h2>⏺ Exporting…</h2><div class="body">
      <div id="exp-label">0%</div>
      <div class="progress"><div id="exp-bar"></div></div>
      <p class="fx-note">Rendering ${inT.toFixed(1)}s → ${outT.toFixed(1)}s in real time. Keep this tab focused.</p>
    </div><div class="btns"><button class="btn" id="exp-cancel">Cancel</button></div></div>`;
  document.getElementById('modal-root').appendChild(modal);
  modal.querySelector('#exp-cancel').addEventListener('click', () => { cancelled = true; stopRec(); });

  const bar = modal.querySelector('#exp-bar');
  const lab = modal.querySelector('#exp-label');

  const cleanup = () => {
    Engine.onTick = null;
    Engine.stopAt = null;
    Engine.disconnectExport();
    modal.remove();
    Exporter.rec = null;
    Exporter._stopping = false;
  };

  const stopRec = () => {
    if (Exporter._stopping) return;
    Exporter._stopping = true;
    Engine.onTick = null;
    Engine.pause();
    if (rec.state !== 'inactive') rec.stop();
  };

  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    cleanup();
    if (cancelled){ UI.toast('Export cancelled'); return; }
    const blob = new Blob(chunks, { type: 'video/webm' });
    const base = (State.project.name || 'apollocut').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'apollocut';
    Util.download(base + '.webm', blob);
    UI.toast(`Exported ${Util.fmtDur(outT - inT)} · ${(blob.size/1048576).toFixed(1)} MB`, 'ok');
  };
  rec.onerror = e => { console.error(e); cleanup(); UI.toast('Export error', 'err'); };

  Engine.pause();
  State.setTime(inT);
  Engine.stopAt = outT;
  Engine.onTick = t => {
    const f = Util.clamp((t - inT) / (outT - inT), 0, 1);
    bar.style.width = (f * 100).toFixed(1) + '%';
    lab.textContent = (f * 100).toFixed(0) + '% — ' + Util.timecode(t, P.fps);
    if (t >= outT - 1 / P.fps) stopRec();
  };
  rec.start(250);
  Engine.play(1);
};

})();
