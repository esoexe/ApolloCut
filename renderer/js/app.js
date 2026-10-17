/* ApolloCut — app shell: menus, UI helpers, pool, transport, shortcuts, autosave, demo */
(function(){
'use strict';

const $ = id => document.getElementById(id);
const AUTO_KEY = 'apollocut.autosave.v1';

/* GPU engine toggle (View menu + Program GPU button) */
function toggleGPU(){
  if (!window.GL || !GL.ready){ UI.toast('WebGL2 not available on this machine', 'err'); return; }
  State.useGL = !State.useGL;
  try { localStorage.setItem('apollocut:useGL', State.useGL ? '1' : '0'); } catch(e){}
  const gb = $('pgm-gl');
  if (gb) gb.classList.toggle('active', State.useGL);
  UI.toast(State.useGL ? 'GPU engine ON — shader compositor (mattes / 3D LUT / blur / nested)' : 'CPU renderer', 'ok');
  Engine.render(State.playhead);
}

/* track matte setter for the current selection */
function setMatte(mode){
  const sel = State.selectionClips().filter(s => s.clip.type === 'video' || s.clip.type === 'image');
  if (!sel.length){ UI.toast('Select the clip(s) the matte should apply to', 'err'); return; }
  State.mutate('Track Matte', () => sel.forEach(s => { s.clip.matte = mode; }));
  if (mode !== 'off' && (!window.GL || !GL.ready || !State.useGL))
    UI.toast('Matte set — enable the GPU engine to render it (2D engine skips mattes)');
  else UI.toast(mode === 'off' ? 'Track matte cleared' : `Track matte: ${mode.toUpperCase()} (uses clip on track above)`, 'ok');
  Events.emit('structure');
  Engine.render(State.playhead);
}

/* ================================================================
   UI helpers
================================================================ */
const UI = {};
window.UI = UI;

UI.status = msg => { $('status-msg').textContent = msg; };

UI.toast = (msg, kind='') => {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('toast-root').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 3200);
};

let modalCount = 0;
UI.dialog = function(opts){
  const root = $('modal-root');
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"${opts.wide ? ' style="min-width:640px"' : ''}>
      <h2>${opts.title || ''}</h2>
      <div class="body"></div>
      <div class="btns"></div>
    </div>`;
  const body = ov.querySelector('.body');
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  const btns = ov.querySelector('.btns');
  const close = () => { ov.remove(); modalCount--; };
  const collect = () => {
    const v = {};
    body.querySelectorAll('[name]').forEach(el => {
      v[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return v;
  };
  (opts.extra || []).forEach(x => {
    const b = document.createElement('button');
    b.className = 'btn';
    if (x.danger) b.style.borderColor = 'var(--danger)', b.style.color = 'var(--danger)';
    b.textContent = x.label;
    b.addEventListener('click', () => { x.action && x.action(); close(); });
    btns.appendChild(b);
  });
  if (opts.cancel !== false){
    const c = document.createElement('button');
    c.className = 'btn';
    c.textContent = opts.cancelText || 'Cancel';
    c.addEventListener('click', close);
    btns.appendChild(c);
  }
  const ok = document.createElement('button');
  ok.className = 'btn accent';
  ok.textContent = opts.ok || 'OK';
  ok.addEventListener('click', () => {
    const v = collect();
    if (opts.onOk){ const r = opts.onOk(v); if (r === false) return; }
    close();
  });
  btns.appendChild(ok);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  root.appendChild(ov);
  modalCount++;
  const first = body.querySelector('input,select,textarea');
  if (first){ first.focus(); first.select && first.select(); }
  body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); ok.click(); } });
  return { close };
};
UI.isModalOpen = () => modalCount > 0;

let ctxEl = null;
UI.ctxMenu = function(x, y, items){
  UI.closeCtx();
  ctxEl = document.createElement('div');
  ctxEl.className = 'ctx-menu';
  items.forEach(it => {
    if (it.sep){ const s = document.createElement('div'); s.className = 'msep'; ctxEl.appendChild(s); return; }
    const d = document.createElement('div');
    d.className = 'mi' + (it.disabled ? ' disabled' : '');
    d.innerHTML = `<span>${it.label}</span>${it.sc ? `<span class="sc">${it.sc}</span>` : ''}`;
    d.addEventListener('click', () => { UI.closeCtx(); it.action && it.action(); });
    ctxEl.appendChild(d);
  });
  document.body.appendChild(ctxEl);
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  ctxEl.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
};
UI.closeCtx = () => { if (ctxEl){ ctxEl.remove(); ctxEl = null; } };
window.addEventListener('pointerdown', e => { if (ctxEl && !ctxEl.contains(e.target)) UI.closeCtx(); }, true);

/* named dialogs */
UI.renameClipDialog = clip => UI.dialog({
  title: 'Rename Clip',
  body: `<div class="dlg-row"><label>Name</label><input name="name" value="${Util.esc(clip.label)}"></div>`,
  onOk: v => { if (v.name.trim()) State.mutate('Rename Clip', () => { clip.label = v.name.trim(); }); }
});

UI.speedDialog = clip => {
  const media = clip.mediaId ? Media.get(clip.mediaId) : null;
  UI.dialog({
    title: 'Speed / Duration',
    body: `
      <div class="dlg-row"><label>Speed (%)</label><input name="speed" type="number" min="10" max="800" step="1" value="${Math.round(clip.speed*100)}"></div>
      <div class="dlg-row"><label>Duration (s)</label><input name="dur" type="number" min="0.1" step="0.1" value="${Util.round(clip.duration,2)}"></div>
      ${media && !media.offline && (clip.type === 'video' || clip.type === 'audio') ?
        `<p class="fx-note">Source: ${Util.fmtDur(media.duration)} · offset ${Util.round(clip.offset,2)}s. Speed changes re-pitch audio.</p>` :
        `<p class="fx-note">Still/text clip — duration is free.</p>`}`,
    onOk: v => State.mutate('Speed/Duration', () => {
      const s = parseFloat(v.speed);
      if (!isNaN(s)) clip.speed = Util.clamp(s/100, 0.1, 8);
      const d = parseFloat(v.dur);
      if (!isNaN(d)){
        let nd = Math.max(0.1, d);
        if (media && !media.offline && clip.type !== 'text' && clip.type !== 'image')
          nd = Math.min(nd, Math.max(0.1, (media.duration - clip.offset) / clip.speed));
        clip.duration = nd;
      }
      State.sortTrack(State.findClip(clip.id).track);
    })
  });
};

UI.shortcutsDialog = () => UI.dialog({
  title: '⌨ Keyboard Shortcuts',
  wide: true,
  body: `<table class="sc-table">
    <tr><td>Space</td><td>Play / Pause</td><td>J / K / L</td><td>Shuttle reverse / stop / forward (re-press = faster)</td></tr>
    <tr><td>← / →</td><td>Step 1 frame (Shift = 5)</td><td>↑ / ↓</td><td>Previous / next edit point</td></tr>
    <tr><td>Home / End</td><td>Sequence start / end</td><td>I / O</td><td>Mark In / Out (Alt = clear)</td></tr>
    <tr><td>V / C</td><td>Selection / razor tool</td><td>M</td><td>Add marker at playhead</td></tr>
    <tr><td>Ctrl+K</td><td>Split at playhead</td><td>S</td><td>Toggle snapping</td></tr>
    <tr><td>T</td><td>New text title</td><td>Delete / Shift+Del</td><td>Lift / ripple delete</td></tr>
    <tr><td>Ctrl+C / V / D</td><td>Copy / paste / duplicate</td><td>Ctrl+A / Esc</td><td>Select all / deselect</td></tr>
    <tr><td>Ctrl+Z / Ctrl+Shift+Z</td><td>Undo / redo</td><td>Ctrl+S / Ctrl+O</td><td>Save / open project</td></tr>
    <tr><td>Ctrl+I</td><td>Import media</td><td>Ctrl+E</td><td>Export video</td></tr>
    <tr><td>+ / −</td><td>Timeline zoom</td><td>\</td><td>Zoom to fit</td></tr>
    <tr><td>Ctrl+Wheel</td><td>Zoom at cursor</td><td>Alt-drag clip</td><td>Duplicate clip</td></tr>
  </table>`,
  ok: 'Close', cancel: false
});

UI.aboutDialog = () => UI.dialog({
  title: 'About',
  body: `<div class="about-ic">
      <img src="assets/icon-128.png" width="64" height="64" alt="Apollo" style="border-radius:14px">
      <div><div style="font-size:17px;font-weight:700">ApolloCut</div>
      <div class="dim">v1.0 — free &amp; open-source desktop video editor</div></div>
    </div>
    <p>Named after <b>Apollo</b> — Greek god of the arts, music and light — fitting patron for an editor made of light and sound.</p>
    <p style="margin-top:8px">Multi-track timeline · real-time compositing · keyframed effects · audio mixing · FFmpeg render engine (MP4 / H.265 / ProRes / WebM). Everything runs locally — your media never leaves your machine.</p>
    <p class="dim" style="margin-top:10px">MIT License — free forever, for everyone.</p>`,
  ok: 'Close', cancel: false
});

UI.seqSettingsDialog = () => {
  const P = State.project;
  UI.dialog({
    title: 'Sequence Settings',
    body: `
      <div class="dlg-row"><label>Preset</label><select name="preset">
        <option value="1920x1080"${P.width===1920&&P.height===1080?' selected':''}>1920 × 1080 (Full HD)</option>
        <option value="1280x720"${P.width===1280&&P.height===720?' selected':''}>1280 × 720 (HD)</option>
        <option value="3840x2160"${P.width===3840&&P.height===2160?' selected':''}>3840 × 2160 (4K UHD)</option>
        <option value="1080x1920"${P.width===1080&&P.height===1920?' selected':''}>1080 × 1920 (Vertical)</option>
        <option value="1080x1080"${P.width===1080&&P.height===1080?' selected':''}>1080 × 1080 (Square)</option>
      </select></div>
      <div class="dlg-row"><label>Frame rate</label><select name="fps">
        ${[24,25,30,50,60].map(f => `<option value="${f}"${P.fps===f?' selected':''}>${f} fps</option>`).join('')}
      </select></div>
      <p class="fx-note">Applies to preview and export. Existing clips are not scaled.</p>`,
    onOk: v => {
      const [w, h] = v.preset.split('x').map(Number);
      State.mutate('Sequence Settings', () => {
        P.width = w; P.height = h; P.fps = parseInt(v.fps);
      });
      Engine.resize();
    }
  });
};

/* ================================================================
   Menus
================================================================ */
const MENUS = [
  { label: 'File', items: [
    { label: 'New Project', action: newProjectConfirm },
    { label: 'Open Project…', sc: 'Ctrl+O', action: () => (window.AppActions && window.desktop) ? AppActions['open-project']() : $('project-input').click() },
    { label: 'Save Project', sc: 'Ctrl+S', action: () => Exporter.saveProject() },
    { sep: true },
    { label: 'Import Media…', sc: 'Ctrl+I', action: () => window.desktopImport ? window.desktopImport() : $('file-input').click() },
    { label: 'Load Demo Media', action: () => loadDemo(true) },
    { sep: true },
    { label: 'Export Video (WebM)…', sc: 'Ctrl+E', action: () => Exporter.exportDialog() },
    { label: 'Export Pro (MP4 / MOV)…', sc: 'Ctrl+Shift+E', action: () => window.ProExport ? ProExport.dialog() : UI.toast('Pro export requires the desktop build') },
    { label: 'Export Current Frame (PNG)', action: () => Exporter.exportFrame() },
    { sep: true },
    { label: 'Export EDL (Premiere/Resolve interchange)…', action: () => window.EDL && EDL.exportDialog() },
    { label: 'Import EDL…', action: () => window.EDL && EDL.importDialog() }
  ]},
  { label: 'Edit', items: [
    { label: 'Undo', sc: 'Ctrl+Z', action: () => State.undo() },
    { label: 'Redo', sc: 'Ctrl+Y', action: () => State.redo() },
    { sep: true },
    { label: 'Split at Playhead', sc: 'Ctrl+K', action: () => State.splitAtPlayhead(!!State.selection.size) },
    { label: 'Duplicate', sc: 'Ctrl+D', action: () => State.duplicateSelected() },
    { label: 'Delete', sc: 'Del', action: () => State.deleteSelected(false) },
    { label: 'Ripple Delete', sc: 'Shift+Del', action: () => State.deleteSelected(true) },
    { sep: true },
    { label: 'Select All Clips', sc: 'Ctrl+A', action: () => { const ids = []; State.eachClip(c => ids.push(c.id)); State.setSelection(ids); } },
    { label: 'Deselect', sc: 'Esc', action: () => State.setSelection([]) }
  ]},
  { label: 'Clip', items: [
    { label: 'Create Multicam Clip…', action: () => Multicam.createDialog() },
    { sep: true },
    { label: 'Track Matte: None', action: () => setMatte('off') },
    { label: 'Track Matte: Luma (clip above)', action: () => setMatte('luma') },
    { label: 'Track Matte: Alpha (clip above)', action: () => setMatte('alpha') },
    { sep: true },
    { label: 'Rename…', action: () => { const s = State.selectionClips(); if (s.length) UI.renameClipDialog(s[0].clip); else UI.toast('Select a clip first'); } },
    { label: 'Speed / Duration…', action: () => { const s = State.selectionClips(); if (s.length) UI.speedDialog(s[0].clip); else UI.toast('Select a clip first'); } },
    { sep: true },
    { label: 'Fade In 1s', action: () => applyToSel(c => { c.fadeIn = Math.min(1, c.duration/2); }, 'Fade In') },
    { label: 'Fade Out 1s', action: () => applyToSel(c => { c.fadeOut = Math.min(1, c.duration/2); }, 'Fade Out') },
    { label: 'Reset Effects', action: () => applyToSel(c => { Object.assign(c, { x:0,y:0,scale:100,rotation:0,opacity:100,brightness:100,contrast:100,saturate:100,hue:0,grayscale:0,sepia:0,blur:0 }); c.kf = {}; }, 'Reset Effects') }
  ]},
  { label: 'Tools', items: [
    { label: 'Scene Auto-Cut…', action: () => AITools.sceneCutDialog() },
    { label: 'Remove Silences…', action: () => AITools.silenceDialog() },
    { label: 'Speech → Captions (AI)…', action: () => AITools.sttDialog() },
    { label: 'Motion Track…', action: () => window.MotionTrack ? MotionTrack.dialog() : UI.toast('Tracker unavailable', 'err') },
    { sep: true },
    { label: 'Import Captions (SRT / VTT)…', action: () => Captions.importDialog() },
    { label: 'Export Captions (SRT)', action: () => Captions.exportDialog() },
    { sep: true },
    { label: 'Import LUT (.cube)…', action: () => LUT.importDialog() },
    { label: 'Output LUT…', action: () => LUT.manageDialog() },
    { sep: true },
    { label: 'Reload Plugins', action: () => window.Plugins && Plugins.refresh(true) },
    { label: window.desktop ? 'Open Plugins Folder' : 'Load Plugin Files…', action: () => window.Plugins && Plugins.openFolder() }
  ]},
  { label: 'Sequence', items: [
    { label: 'Settings…', action: () => UI.seqSettingsDialog() },
    { label: 'Smart Reframe… (9:16 / 1:1 / 4:5)', action: () => window.Reframe ? Reframe.dialog() : UI.toast('Reframe unavailable', 'err') },
    { sep: true },
    { label: 'New Nested Sequence…', action: () => Nested.createDialog() },
    { label: 'Nest Selection…', action: () => Nested.nestSelection() },
    { label: 'Insert Nested Sequence…', action: () => Nested.insertDialog() },
    { label: 'Close Nested Sequence', action: () => Nested.editing ? Nested.close() : UI.toast('Not editing a nested sequence') },
    { sep: true },
    { label: 'Add Adjustment Layer', action: () => State.addAdjustment() },
    { label: 'Add Video Track', action: () => State.mutate('Add Track', () => {
        const n = State.project.tracks.filter(t => t.type === 'video').length;
        State.project.tracks.splice(Math.max(0, State.project.tracks.findIndex(t => t.type === 'audio')), 0, State.mkTrack('V' + (n + 1), 'video'));
      }) },
    { label: 'Add Audio Track', action: () => State.mutate('Add Track', () => {
        const n = State.project.tracks.filter(t => t.type === 'audio').length;
        State.project.tracks.push(State.mkTrack('A' + (n + 1), 'audio'));
      }) }
  ]},
  { label: 'Markers', items: [
    { label: 'Add Marker', sc: 'M', action: () => State.addMarker(State.playhead) },
    { label: 'Next Marker', action: () => { const next = State.project.markers.find(m => m.time > State.playhead + 0.01); if (next) State.setTime(next.time); } },
    { label: 'Previous Marker', action: () => { const prev = [...State.project.markers].reverse().find(m => m.time < State.playhead - 0.01); if (prev) State.setTime(prev.time); } },
    { sep: true },
    { label: 'Clear All Markers', action: () => State.mutate('Clear Markers', () => { State.project.markers = []; }) }
  ]},
  { label: 'View', items: [
    { label: 'Zoom In', sc: '+', action: () => TL.setZoom(State.zoom * 1.35) },
    { label: 'Zoom Out', sc: '−', action: () => TL.setZoom(State.zoom / 1.35) },
    { label: 'Zoom to Fit', sc: '\\', action: () => TL.zoomFit() },
    { sep: true },
    { label: 'Toggle Proxy Mode', action: () => window.Proxy ? Proxy.toggle() : UI.toast('Proxies require the desktop app') },
    { label: 'GPU Engine (WebGL2)', sc: '', action: () => toggleGPU() },
    { label: 'Multicam Viewer', action: () => window.Multicam ? Multicam.toggleViewer() : null },
    { label: 'Toggle Snapping', sc: 'S', action: () => TL.toggleSnap() },
    { label: 'Safe Margins', action: () => { Engine.safe = !Engine.safe; $('btn-safe').classList.toggle('active', Engine.safe); Engine.render(State.playhead); } },
    { label: 'Toggle Loop', action: () => setLoop(!State.loop) }
  ]},
  { label: 'Help', items: [
    { label: 'Self-Test & Support Report…', action: () => window.Diagnostics && Diagnostics.run() },
    { label: 'Keyboard Shortcuts', action: () => UI.shortcutsDialog() },
    { label: 'About ApolloCut Ω', action: () => UI.aboutDialog() }
  ]}
];

function applyToSel(fn, label){
  const sel = State.selectionClips();
  if (!sel.length){ UI.toast('Select a clip first'); return; }
  State.mutate(label, () => sel.forEach(({clip}) => fn(clip)));
}

function buildMenus(){
  const nav = $('menus');
  MENUS.forEach(m => {
    const b = document.createElement('button');
    b.className = 'menu-btn';
    b.textContent = m.label;
    b.addEventListener('click', ev => { ev.stopPropagation(); openMenu(b, m); });
    b.addEventListener('pointerenter', () => { const open = document.querySelector('.menu-pop'); if (open && !open._for.includes(m.label)) openMenu(b, m); });
    nav.appendChild(b);
  });
}
let menuPop = null;
function openMenu(btn, m){
  closeMenu();
  menuPop = document.createElement('div');
  menuPop.className = 'menu-pop';
  menuPop._for = [m.label];
  m.items.forEach(it => {
    if (it.sep){ const s = document.createElement('div'); s.className = 'msep'; menuPop.appendChild(s); return; }
    const d = document.createElement('div');
    d.className = 'mi' + (it.disabled ? ' disabled' : '');
    d.innerHTML = `<span>${it.label}</span>${it.sc ? `<span class="sc">${it.sc}</span>` : ''}`;
    d.addEventListener('click', () => { closeMenu(); it.action && it.action(); });
    menuPop.appendChild(d);
  });
  document.body.appendChild(menuPop);
  const r = btn.getBoundingClientRect();
  menuPop.style.left = Math.min(r.left, innerWidth - 260) + 'px';
  menuPop.style.top = (r.bottom + 4) + 'px';
  btn.classList.add('open');
  menuPop._btn = btn;
}
function closeMenu(){ if (menuPop){ menuPop._btn && menuPop._btn.classList.remove('open'); menuPop.remove(); menuPop = null; } }
window.addEventListener('pointerdown', e => { if (menuPop && !menuPop.contains(e.target)) closeMenu(); }, true);

function newProjectConfirm(){
  UI.dialog({
    title: 'New Project',
    body: `<p>Start a fresh project? The current timeline will be discarded (autosave will be overwritten).</p>`,
    ok: 'New Project',
    onOk: () => {
      State.newProject();
      $('project-name').value = State.project.name;
      Engine.resize();
    }
  });
}

/* ================================================================
   Panels: tabs & splitters
================================================================ */
function initTabs(){
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      ['pool', 'fxlib', 'scopes', 'plugins', 'history'].forEach(n => {
        const el = $('tab-' + n);
        if (el) el.classList.toggle('hidden', n !== t.dataset.tab);
      });
    });
  });
}

function initSplitters(){
  const dragSplit = (el, onMove) => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const mv = ev => onMove(ev);
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  };
  dragSplit($('split-1'), e => {
    const x = Util.clamp(e.clientX, 170, 480);
    $('panel-left').style.flexBasis = x + 'px';
  });
  dragSplit($('split-2'), e => {
    const w = Util.clamp(innerWidth - e.clientX, 220, 560);
    $('panel-right').style.flexBasis = w + 'px';
  });
  dragSplit($('split-main'), e => {
    const main = $('main').getBoundingClientRect();
    const h = Util.clamp(main.bottom - e.clientY, 150, main.height - 160);
    $('timeline').style.flexBasis = h + 'px';
  });
}

/* ================================================================
   Media pool UI
================================================================ */
function renderPool(){
  const host = $('media-pool');
  const q = ($('pool-search').value || '').toLowerCase();
  host.innerHTML = '';
  const items = [...State.pool.values()].filter(m => !q || m.name.toLowerCase().includes(q));
  $('pool-empty').style.display = State.pool.size ? 'none' : '';
  items.forEach(m => {
    const card = document.createElement('div');
    card.className = 'media-card' + (m.offline ? ' offline' : '');
    card.draggable = !m.offline;
      const thumb = m.thumb && m.thumb.length ? ` style="background-image:url('${m.thumb[1] || m.thumb[0]}')"` : '';
    const icon = m.type === 'audio' ? '♪' : m.type === 'video' ? '▶' : '▦';
    const px = window.Proxy ? Proxy.statusFor(m) : { state: 'none' };
    const pxBtn = (window.desktop && m.type === 'video' && m.path)
      ? (px.state === 'none' ? `<button class="mproxy" title="Create 540p proxy for smooth editing">PX</button>`
        : px.state === 'working' ? `<button class="mproxy ready" data-proxy-key="${px.key}" title="Generating proxy…">…</button>`
        : `<button class="mproxy ready" title="Proxy ready — toggle with the PX button on the Program monitor">PX</button>`)
      : '';
    card.innerHTML = `
      <div class="thumb"${thumb}>${m.thumb && m.thumb.length ? '' : icon}</div>
      <div class="mname" title="${Util.esc(m.name)}">${Util.esc(m.name)}</div>
      <div class="mmeta"><span class="mtype">${m.type}</span><span>${m.type === 'image' ? 'still' : Util.fmtDur(m.duration)}${m._proxyUrl ? ' · PX' : ''}</span></div>
      ${pxBtn}
      <button class="mdel" title="Remove from project (also removes its clips)">✕</button>`;
    const pxEl = card.querySelector('.mproxy:not(.ready)');
    if (pxEl) pxEl.addEventListener('click', ev => { ev.stopPropagation(); window.Proxy && Proxy.generate(m); });
    card.querySelector('.mdel').addEventListener('click', ev => { ev.stopPropagation(); Media.remove(m.id); });
    card.addEventListener('dblclick', () => {
      if (m.offline){ UI.toast('Offline — re-import the file named “' + m.name + '” to relink'); $('file-input').click(); return; }
      State.placeNew(m);
    });
    card.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData('application/x-apollocut-media', m.id);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    host.appendChild(card);
  });
}

/* ================================================================
   Transport & status
================================================================ */
function setLoop(v){
  State.loop = v;
  $('btn-loop').classList.toggle('active', v);
  UI.status('Loop ' + (v ? 'on (plays In→Out repeatedly)' : 'off'));
}

function initTransport(){
  $('btn-play').addEventListener('click', () => Engine.toggle());
  $('btn-goto-start').addEventListener('click', () => State.setTime(0));
  $('btn-goto-end').addEventListener('click', () => State.setTime(State.seqDuration()));
  $('btn-prev-frame').addEventListener('click', () => frameStep(-1));
  $('btn-next-frame').addEventListener('click', () => frameStep(1));
  $('btn-loop').addEventListener('click', () => setLoop(!State.loop));
  $('btn-safe').addEventListener('click', () => { Engine.safe = !Engine.safe; $('btn-safe').classList.toggle('active', Engine.safe); Engine.render(State.playhead); });
  $('btn-in').addEventListener('click', () => State.setIn());
  $('btn-out').addEventListener('click', () => State.setOut());
  $('btn-export').addEventListener('click', () => Exporter.exportDialog());
  $('master-vol').addEventListener('input', e => Engine.setMaster(parseFloat(e.target.value) / 100));
  $('tc-display').addEventListener('keydown', e => {
    if (e.key === 'Enter'){
      const t = Util.parseTime(e.target.value, State.project.fps);
      if (t != null) State.setTime(t);
      e.target.blur();
    }
  });
  Events.on('transport', () => { $('btn-play').textContent = Engine.playing ? '⏸' : '▶'; });
  Events.on('structure', () => {
    const d = document.getElementById('tc-dur');
    if (d) d.textContent = '/ ' + Util.timecode(State.seqDuration(), State.project.fps);
    updateIOInd();
  });
}

function frameStep(n){
  Engine.pause();
  State.setTime(State.playhead + n / State.project.fps);
}

function updateIOInd(){
  $('btn-in').classList.toggle('active', State.inPoint != null);
  $('btn-out').classList.toggle('active', State.outPoint != null);
}

/* ================================================================
   Keyboard shortcuts
================================================================ */
function initKeys(){
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable){
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (UI.isModalOpen()){
      if (e.key === 'Escape'){ const ov = document.querySelector('.modal-overlay'); if (ov) ov.remove(), modalCount = Math.max(0, modalCount - 1); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (mod){
      const kl = k.toLowerCase();
      if (kl === 'z'){ e.preventDefault(); e.shiftKey ? State.redo() : State.undo(); }
      else if (kl === 'y'){ e.preventDefault(); State.redo(); }
      else if (kl === 's'){ e.preventDefault(); Exporter.saveProject(); }
      else if (kl === 'o'){ e.preventDefault(); $('project-input').click(); }
      else if (kl === 'e'){ e.preventDefault(); (e.shiftKey && window.ProExport) ? ProExport.dialog() : Exporter.exportDialog(); }
      else if (kl === 'i'){ e.preventDefault(); $('file-input').click(); }
      else if (kl === 'k'){ e.preventDefault(); State.splitAtPlayhead(!!State.selection.size); }
      else if (kl === 'a'){ e.preventDefault(); const ids = []; State.eachClip(c => ids.push(c.id)); State.setSelection(ids); }
      else if (kl === 'c'){ e.preventDefault(); State.copySelected(); }
      else if (kl === 'v'){ e.preventDefault(); State.paste(); }
      else if (kl === 'd'){ e.preventDefault(); State.duplicateSelected(); }
      return;
    }

    switch (k){
      case ' ': e.preventDefault(); Engine.toggle(); break;
      case 'j': case 'J': {
        const r = Engine.playing ? (Engine.rate < 0 ? Engine.rate * 2 : -1) : -1;
        Engine.play(Util.clamp(r, -8, -1)); break;
      }
      case 'k': case 'K': Engine.pause(); break;
      case 'l': case 'L': {
        const r = Engine.playing ? (Engine.rate > 0 ? Engine.rate * 2 : 1) : 1;
        Engine.play(Util.clamp(r, 1, 8)); break;
      }
      case 'ArrowLeft': e.preventDefault(); frameStep(e.shiftKey ? -5 : -1); break;
      case 'ArrowRight': e.preventDefault(); frameStep(e.shiftKey ? 5 : 1); break;
      case 'ArrowUp': case 'ArrowDown': {
        e.preventDefault();
        const pts = TL.editPoints();
        const t = State.playhead;
        if (k === 'ArrowUp'){
          for (let i = pts.length - 1; i >= 0; i--) if (pts[i] < t - 0.01){ State.setTime(pts[i]); return; }
          State.setTime(0);
        } else {
          for (let i = 0; i < pts.length; i++) if (pts[i] > t + 0.01){ State.setTime(pts[i]); return; }
          State.setTime(State.seqDuration());
        }
        break;
      }
      case 'Home': State.setTime(0); break;
      case 'End': State.setTime(State.seqDuration()); break;
      case 'i': case 'I': e.altKey ? State.clearIO() : State.setIn(); break;
      case 'o': case 'O': e.altKey ? State.clearIO() : State.setOut(); break;
      case 'm': case 'M': State.addMarker(State.playhead); break;
      case 'v': case 'V': TL.setTool('select'); break;
      case 'c': case 'C': TL.setTool('razor'); break;
      case 's': case 'S': TL.toggleSnap(); break;
      case 't': case 'T': State.addText(); break;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        State.deleteSelected(e.shiftKey);
        break;
      case 'Escape': State.setSelection([]); break;
      case '+': case '=': TL.setZoom(State.zoom * 1.3); break;
      case '-': case '_': TL.setZoom(State.zoom / 1.3); break;
      case '\\': TL.zoomFit(); break;
    }
  });
  // avoid spacebar re-triggering focused buttons
  window.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) b.blur();
  });
}

/* ================================================================
   Drag & drop / import
================================================================ */
function initDrop(){
  let depth = 0;
  window.addEventListener('dragenter', e => {
    if ([...e.dataTransfer.types].includes('Files')){ depth++; $('drop-overlay').classList.add('show'); }
  });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('drop-overlay').classList.remove('show'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    depth = 0; $('drop-overlay').classList.remove('show');
    if (e.dataTransfer.files && e.dataTransfer.files.length && !e.target.closest('#tl-right')){
      e.preventDefault();
      Media.importFiles(e.dataTransfer.files);
    }
  });
  $('file-input').addEventListener('change', e => { Media.importFiles(e.target.files); e.target.value = ''; });
  $('project-input').addEventListener('change', e => { if (e.target.files[0]) Exporter.openProjectFile(e.target.files[0]); e.target.value = ''; });
  $('btn-import').addEventListener('click', () => $('file-input').click());
  $('btn-demo').addEventListener('click', () => loadDemo(true));
  $('pool-search').addEventListener('input', renderPool);
}

/* ================================================================
   Autosave
================================================================ */
const doAutosave = () => {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(Exporter.projectJSON()));
    const d = new Date();
    $('save-ind').textContent = 'autosaved ' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
  } catch(e){ /* storage full etc. */ }
};
const autosaveDeb = Util.debounce(doAutosave, 900);

/* ================================================================
   Demo media (generated in-browser — no downloads needed)
================================================================ */
function blobToFile(blob, name, type){ return new File([blob], name, { type }); }

function canvasToFile(cv, name){
  return new Promise(res => cv.toBlob(b => res(blobToFile(b, name, 'image/png')), 'image/png'));
}

function makeWav(name){
  const sr = 44100, secs = 4, n = sr * secs;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++){
    const t = i / sr;
    const f = 220 + 220 * Math.sin(t * 0.8);
    const env = Math.min(1, t * 4, (secs - t) * 2);
    const v = Math.sin(2 * Math.PI * f * t) * 0.42 * env;
    dv.setInt16(44 + i * 2, Util.clamp(v, -1, 1) * 32767, true);
  }
  return blobToFile(new Blob([buf], { type: 'audio/wav' }), name, 'audio/wav');
}

async function loadDemo(placeOnTimeline=true){
  UI.status('Generating demo media…');
  // color bars
  const bars = document.createElement('canvas'); bars.width = 640; bars.height = 360;
  {
    const ctx = bars.getContext('2d');
    const cols = ['#c0c0c0','#c0c000','#00c0c0','#00c000','#c000c0','#c00000','#0000c0'];
    cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * bars.width / 7, 0, bars.width / 7 + 1, bars.height); });
    ctx.fillStyle = '#111'; ctx.fillRect(0, bars.height - 60, bars.width, 60);
    ctx.fillStyle = '#fff'; ctx.font = '700 26px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('APOLLOCUT COLOR BARS', bars.width/2, bars.height - 22);
  }
  // title card
  const card = document.createElement('canvas'); card.width = 640; card.height = 360;
  {
    const ctx = card.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, '#2a1a5e'); g.addColorStop(1, '#14082f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 360);
    const g2 = ctx.createLinearGradient(0, 120, 640, 260);
    g2.addColorStop(0, '#8f6bff'); g2.addColorStop(1, '#e77bff');
    ctx.fillStyle = g2; ctx.font = '700 130px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText('Ω', 320, 250);
    ctx.fillStyle = '#cfc8ff'; ctx.font = '600 30px system-ui';
    ctx.fillText('APOLLOCUT', 320, 315);
  }
  try {
    const files = [
      await canvasToFile(card, 'Demo Title Card.png'),
      await canvasToFile(bars, 'Demo Color Bars.png'),
      makeWav('Demo Tone.wav')
    ];
    const before = [...State.pool.keys()];
    await Media.importFiles(files);
    const fresh = [...State.pool.values()].filter(m => !before.includes(m.id));
    if (placeOnTimeline && fresh.length){
      State.playhead = 0;
      const title = fresh.find(m => m.name.includes('Title'));
      const barsM = fresh.find(m => m.name.includes('Bars'));
      const tone = fresh.find(m => m.name.includes('Tone'));
      if (title){ title.duration = 4; State.placeNew(title, { at: 0, keepTime: true }); }
      if (barsM){ barsM.duration = 4; State.placeNew(barsM, { at: 4, keepTime: true }); }
      if (tone) State.placeNew(tone, { at: 0.5, keepTime: true });
      State.setSelection([]);
      State.setTime(0);
      TL.zoomFit();
    }
    UI.toast('Demo media loaded — press Space to play', 'ok');
  } catch(e){
    console.error(e);
    UI.toast('Demo generation failed', 'err');
  }
  UI.status('Ready');
}

/* ================================================================
   Boot
================================================================ */
function boot(){
  State.newProject();
  State.onDirty = autosaveDeb;

  buildMenus();
  initTabs();
  initSplitters();
  initTransport();
  initKeys();
  initDrop();

  Engine.init();
  TL.init();
  EffectsUI.init();
  if (window.Scopes) Scopes.init();
  if (window.LUT) LUT.init();
  if (window.Plugins) Plugins.init();
  if (window.Proxy) Proxy.init();
  if (window.Multicam) Multicam.init();
  State.useGL = localStorage.getItem('apollocut:useGL') !== '0';
  if (window.GL && GL.init()){
    const gb = $('pgm-gl');
    if (gb){
      gb.classList.remove('hidden');
      gb.classList.toggle('active', State.useGL);
      gb.addEventListener('click', () => toggleGPU());
    }
    setTimeout(() => UI.toast(State.useGL ? 'GPU engine active — WebGL2 Mercury-class compositor' : 'GPU engine available (GPU button on Program)', 'ok'), 1200);
  } else State.useGL = false;
  TL.render();
  Events.emit('selection');
  Events.emit('time');

  const pxb = $('pgm-proxy');
  if (pxb && window.desktop && window.desktop.isDesktop){
    pxb.classList.remove('hidden');
    pxb.classList.add('active');
    pxb.addEventListener('click', () => window.Proxy && Proxy.toggle());
  }

  $('project-name').addEventListener('change', e => {
    const v = e.target.value.trim();
    if (v) State.mutate('Rename Project', () => { State.project.name = v; });
  });

  Events.on('pool', renderPool);
  renderPool();

  // restore autosave?
  let restored = false;
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (raw){
      const data = JSON.parse(raw);
      if (data && data.project && (data.pool || []).length){
        Exporter.loadData(data, { silent: true });
        restored = true;
        UI.toast('Restored autosaved session — re-import media to relink it (same filenames)', 'ok');
      }
    }
  } catch(e){ console.warn('autosave restore failed', e); }
  if (!restored) loadDemo(true);
  else State.setTime(0);

  TL.zoomFit();
  UI.status('Ready — Ω ApolloCut. Drop media anywhere, or drag it straight to the timeline.');

  setInterval(doAutosave, 30000);
  window.addEventListener('beforeunload', e => {
    doAutosave();
    let clips = 0; State.eachClip(() => clips++);
    if (clips){ e.preventDefault(); e.returnValue = ''; }
  });
}

document.addEventListener('DOMContentLoaded', boot);

window.__toggleGPU = toggleGPU;
window.__setMatte = setMatte;
})();
