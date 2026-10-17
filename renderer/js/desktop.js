/* ApolloCut — desktop integration: native menu actions, native dialogs, auto-relink.
   Loaded after app.js; only activates inside Electron. */
(function(){
'use strict';
if (!window.desktop || !window.desktop.isDesktop) return;

const D = window.desktop;
const $ = id => document.getElementById(id);

window.desktopUrlFromPath = p =>
  'apollo://local' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');

/* ---------- native import / project IO ---------- */
window.desktopImport = async function(){
  const files = await D.openMediaDialog();
  if (files && files.length) await Media.importPaths(files);
};

async function desktopOpenProject(){
  const r = await D.openProjectDialog();
  if (!r) return;
  if (r.error){ UI.toast('Could not open project: ' + r.error, 'err'); return; }
  try {
    Exporter.loadData(JSON.parse(r.json));
    State.markDirty();
  } catch(e){ UI.toast('Could not open project: ' + e.message, 'err'); }
}

/* ---------- action map shared by native menu & web menu ---------- */
function firstSel(){ const s = State.selectionClips(); return s.length ? s[0].clip : null; }
function applyToSel(fn, label){
  const sel = State.selectionClips();
  if (!sel.length){ UI.toast('Select a clip first'); return; }
  State.mutate(label, () => sel.forEach(({clip}) => fn(clip)));
}

window.AppActions = {
  'new-project': () => UI.dialog({
    title: 'New Project',
    body: '<p>Start a fresh project? The current timeline will be discarded.</p>',
    ok: 'New Project',
    onOk: () => { State.newProject(); $('project-name').value = State.project.name; Engine.resize(); D.setTitle(State.project.name); }
  }),
  'open-project': desktopOpenProject,
  'save-project': () => Exporter.saveProject(),
  'import-media': window.desktopImport,
  'load-demo': () => $('btn-demo').click(),
  'export-webm': () => Exporter.exportDialog(),
  'export-pro': () => ProExport.dialog(),
  'export-frame': () => Exporter.exportFrame(),
  'undo': () => State.undo(),
  'redo': () => State.redo(),
  'split': () => State.splitAtPlayhead(!!State.selection.size),
  'clip-copy': () => State.copySelected(),
  'clip-paste': () => State.paste(),
  'clip-duplicate': () => State.duplicateSelected(),
  'clip-delete': () => State.deleteSelected(false),
  'clip-ripple-delete': () => State.deleteSelected(true),
  'select-all': () => { const ids = []; State.eachClip(c => ids.push(c.id)); State.setSelection(ids); },
  'deselect': () => State.setSelection([]),
  'clip-rename': () => { const c = firstSel(); c ? UI.renameClipDialog(c) : UI.toast('Select a clip first'); },
  'clip-speed': () => { const c = firstSel(); c ? UI.speedDialog(c) : UI.toast('Select a clip first'); },
  'clip-fadein':  () => applyToSel(c => { c.fadeIn = Math.min(1, c.duration/2); }, 'Fade In'),
  'clip-fadeout': () => applyToSel(c => { c.fadeOut = Math.min(1, c.duration/2); }, 'Fade Out'),
  'clip-reset-fx': () => applyToSel(c => Object.assign(c, {
    x:0,y:0,scale:100,rotation:0,opacity:100,brightness:100,contrast:100,saturate:100,
    hue:0,grayscale:0,sepia:0,blur:0, kf: {} }), 'Reset Effects'),
  'seq-settings': () => UI.seqSettingsDialog(),
  'seq-add-video': () => State.mutate('Add Track', () => {
    const n = State.project.tracks.filter(t => t.type === 'video').length;
    State.project.tracks.splice(Math.max(0, State.project.tracks.findIndex(t => t.type === 'audio')), 0, State.mkTrack('V' + (n + 1), 'video'));
  }),
  'seq-add-audio': () => State.mutate('Add Track', () => {
    const n = State.project.tracks.filter(t => t.type === 'audio').length;
    State.project.tracks.push(State.mkTrack('A' + (n + 1), 'audio'));
  }),
  'marker-add': () => State.addMarker(State.playhead),
  'marker-next': () => { const m = State.project.markers.find(m => m.time > State.playhead + 0.01); if (m) State.setTime(m.time); },
  'marker-prev': () => { const m = [...State.project.markers].reverse().find(m => m.time < State.playhead - 0.01); if (m) State.setTime(m.time); },
  'marker-clear': () => State.mutate('Clear Markers', () => { State.project.markers = []; }),
  'ai-scene-cut': () => AITools.sceneCutDialog(),
  'ai-silence-remover': () => AITools.silenceDialog(),
  'ai-speech-captions': () => AITools.sttDialog(),
  'caps-import': () => Captions.importDialog(),
  'caps-export': () => Captions.exportDialog(),
  'lut-import': () => LUT.importDialog(),
  'lut-manage': () => LUT.manageDialog(),
  'plugins-open-folder': () => Plugins.openFolder(),
  'plugins-refresh': () => window.Plugins && Plugins.refresh(true),
  'seq-add-adjustment': () => State.addAdjustment(),
  'seq-new-nested': () => Nested.createDialog(),
  'seq-nest': () => Nested.nestSelection(),
  'seq-insert': () => Nested.insertDialog(),
  'seq-close': () => Nested.editing ? Nested.close() : UI.toast('Not editing a nested sequence'),
  'seq-reframe': () => window.Reframe && Reframe.dialog(),
  'clip-multicam': () => Multicam.createDialog(),
  'clip-matte-off': () => window.__setMatte && window.__setMatte('off'),
  'clip-matte-luma': () => window.__setMatte && window.__setMatte('luma'),
  'clip-matte-alpha': () => window.__setMatte && window.__setMatte('alpha'),
  'tools-motion': () => window.MotionTrack && MotionTrack.dialog(),
  'view-gpu': () => window.__toggleGPU && window.__toggleGPU(),
  'edl-export': () => window.EDL && EDL.exportDialog(),
  'edl-import': () => window.EDL && EDL.importDialog(),
  'help-selftest': () => window.Diagnostics && Diagnostics.run(),
  'view-mc': () => window.Multicam && Multicam.toggleViewer(),
  'toggle-proxies': () => window.Proxy && Proxy.toggle(),
  'zoom-in': () => TL.setZoom(State.zoom * 1.35),
  'zoom-out': () => TL.setZoom(State.zoom / 1.35),
  'zoom-fit': () => TL.zoomFit(),
  'toggle-snap': () => TL.toggleSnap(),
  'toggle-safe': () => $('btn-safe').click(),
  'toggle-loop': () => $('btn-loop').click(),
  'help-shortcuts': () => UI.shortcutsDialog(),
  'help-about': () => UI.aboutDialog()
};

/* ---------- wire everything after the app boots ---------- */
document.addEventListener('DOMContentLoaded', () => {
  D.onMenuAction(id => {
    const a = window.AppActions[id];
    if (a) a();
    else console.warn('unknown menu action', id);
  });

  // make the web import button use the native dialog too
  const btn = $('btn-import');
  if (btn) btn.onclick = window.desktopImport;

  // native title bar shows the project name
  D.setTitle($('project-name').value);
  $('project-name').addEventListener('change', e => D.setTitle(e.target.value.trim()));

  // show Pro Export availability once ready
  D.proExportAvailable().then(r => {
    if (r && r.available) UI.toast('FFmpeg render engine ready — MP4/MOV export enabled (Ctrl+Shift+E)', 'ok');
    else console.warn('ffmpeg not available; pro export hidden');
  }).catch(() => {});

  /* ---------- CLI headless render mode ---------- */
  if (D.cliJob){
    D.cliJob().then(async job => {
      if (!job) return;
      try {
        await new Promise(r => setTimeout(r, 600)); // let the app finish booting
        Exporter.loadData(JSON.parse(job.json), { silent: true });
        const relinkJobs = [...State.pool.values()].filter(m => m.offline && m.path).map(m => Media.tryRelink(m, m.path));
        if (relinkJobs.length){
          const rs = await Promise.all(relinkJobs);
          D.cliProgress(`relinked ${rs.filter(Boolean).length}/${relinkJobs.length} media files`);
        }
        D.cliProgress(`project loaded — ${Util.fmtDur(State.seqDuration())} @ ${State.project.width}x${State.project.height}/${State.project.fps}fps`);
        await ProExport.headless(job);
      } catch(e){ D.cliDone({ ok: false, error: String(e && e.message || e) }); }
    });
  }
});

})();
