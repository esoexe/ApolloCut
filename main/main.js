/* ApolloCut — Electron main process: window, native menus, dialogs, media
   protocol, LUT & plugin managers, CLI headless render mode. */
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const ffmpeg = require('./ffmpeg');
const ai = require('./ai');

let mainWindow = null;

/* ================= CLI mode =================
   apollocut --render project.apollocut.json --out out.mp4 [--format mp4-h264]
             [--quality high] [--range 0-10.5]                                         */
function parseCli(){
  const argv = process.argv.slice(app.isPackaged ? 1 : 2);
  const i = argv.indexOf('--render');
  if (i === -1 || !argv[i + 1]) return null;
  const get = k => { const j = argv.indexOf(k); return j !== -1 ? argv[j + 1] : null; };
  let projectJson = null, projectPath = argv[i + 1];
  try { projectJson = fs.readFileSync(projectPath, 'utf8'); } catch(e){
    console.error('[ApolloCut CLI] cannot read project: ' + e.message);
    process.exit(2);
  }
  let range = null;
  const r = get('--range');
  if (r && /-/.test(r)){ const [a, b] = r.split('-').map(Number); if (isFinite(a) && isFinite(b)) range = [a, b]; }
  return {
    projectPath, json: projectJson,
    out: get('--out') || 'apollocut-export.mp4',
    format: get('--format') || 'mp4-h264',
    quality: get('--quality') || 'high',
    range
  };
}
const cliJob = parseCli();

/* ---------- single instance (GUI only) ---------- */
if (!cliJob){
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
  else app.on('second-instance', () => {
    if (mainWindow){ if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}

/* ---------- media streaming protocol ---------- */
protocol.registerSchemesAsPrivileged([
  { scheme: 'apollo', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
]);
function toMediaUrl(filePath){
  const norm = filePath.replace(/\\/g, '/');
  return 'apollo://local' + norm.split('/').map(encodeURIComponent).join('/');
}

function createWindow(hidden = false){
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1120, minHeight: 680,
    backgroundColor: '#0e0e13',
    title: 'ApolloCut',
    icon: path.join(__dirname, '..', 'assets-src', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false
    }
  });
  if (!hidden) mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.on('closed', () => { mainWindow = null; });
  if (!hidden) buildMenu();
}

/* ================= lifecycle ================= */
app.whenReady().then(() => {
  protocol.handle('apollo', (req) => {
    try {
      const u = new URL(req.url);
      let p = decodeURIComponent(u.pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      if (process.platform !== 'win32' && !p.startsWith('/')) p = '/' + p;
      return net.fetch(pathToFileURL(p).toString());
    } catch (e) { console.error('protocol error', e); return new Response('not found', { status: 404 }); }
  });

  createWindow(!!cliJob);
  ffmpeg.register(ipcMain, () => mainWindow, app);
  ai.register(ipcMain, () => mainWindow, app, ffmpegPathForAi());
  registerIpc();
  seedPlugins();

  if (cliJob){
    console.log(`[ApolloCut CLI] rendering ${cliJob.projectPath} → ${cliJob.out} (${cliJob.format}/${cliJob.quality}${cliJob.range ? ' range ' + cliJob.range.join('-') : ''})`);
    setTimeout(() => { console.error('[ApolloCut CLI] timeout — aborting'); app.exit(3); }, 4 * 3600 * 1000);
  }
  app.on('activate', () => { if (!cliJob && BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
function ffmpegPathForAi(){
  let p = null;
  try { p = require('ffmpeg-static'); } catch(e){}
  if (p && app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked');
  try { return p && fs.existsSync(p) ? p : null; } catch(e){ return null; }
}

app.on('window-all-closed', () => { if (cliJob) app.exit(1); else if (process.platform !== 'darwin') app.quit(); });

/* ================= IPC ================= */
function registerIpc(){
  const w = () => mainWindow;

  ipcMain.handle('dialog:openMedia', async () => {
    if (!w()) return [];
    const r = await dialog.showOpenDialog(w(), {
      title: 'Import Media', properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Media', extensions: ['mp4','mov','mkv','webm','avi','m4v','m2ts','mp3','wav','ogg','oga','m4a','aac','flac','weba','png','jpg','jpeg','gif','webp','bmp','svg','avif'] },
        { name: 'Video', extensions: ['mp4','mov','mkv','webm','avi','m4v','m2ts'] },
        { name: 'Audio', extensions: ['mp3','wav','ogg','oga','m4a','aac','flac','weba'] },
        { name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','bmp','svg','avif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (r.canceled) return [];
    return r.filePaths.map(p => { let size = 0; try { size = fs.statSync(p).size; } catch(e){} return { path: p, name: path.basename(p), url: toMediaUrl(p), size }; });
  });

  ipcMain.handle('file:pathToUrl', (e, p) => toMediaUrl(p));
  ipcMain.handle('file:stat', (e, p) => { try { const s = fs.statSync(p); return { size: s.size, mtime: s.mtimeMs }; } catch(err){ return null; } });

  ipcMain.handle('dialog:saveProject', async (e, { json, defName }) => {
    if (!w()) return null;
    const r = await dialog.showSaveDialog(w(), { title: 'Save Project', defaultPath: defName || 'project.apollocut.json',
      filters: [{ name: 'ApolloCut Project', extensions: ['apollocut.json', 'json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, json, 'utf8');
    return r.filePath;
  });

  ipcMain.handle('dialog:openProject', async () => {
    if (!w()) return null;
    const r = await dialog.showOpenDialog(w(), { title: 'Open Project', properties: ['openFile'],
      filters: [{ name: 'ApolloCut Project', extensions: ['json', 'apollocut'] }, { name: 'All Files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    try { return { path: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') }; }
    catch(err){ return { error: err.message }; }
  });

  ipcMain.handle('dialog:saveExport', async (e, { defName, ext, filterName }) => {
    if (!w()) return null;
    const r = await dialog.showSaveDialog(w(), { title: 'Export', defaultPath: defName || ('export.' + ext),
      filters: [{ name: filterName || ext.toUpperCase(), extensions: [ext] }] });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('dialog:openText', async (e, { title, extensions }) => {
    if (!w()) return null;
    const r = await dialog.showOpenDialog(w(), { title: title || 'Open', properties: ['openFile'],
      filters: [{ name: 'Text files', extensions: extensions || ['txt'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    try { return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') }; }
    catch(err){ return { error: err.message }; }
  });

  ipcMain.handle('file:write', (e, { path: dest, content }) => {
    try { fs.writeFileSync(dest, content, 'utf8'); return { ok: true }; }
    catch(err){ return { ok: false, error: err.message }; }
  });

  ipcMain.handle('file:writeTemp', (e, { name, content }) => {
    try {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'apollocut-'));
      const p = path.join(dir, name);
      fs.writeFileSync(p, content, 'utf8');
      return { ok: true, path: p, dir };
    } catch(err){ return { ok: false, error: err.message }; }
  });

  ipcMain.handle('shell:showItem', (e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openPath', (e, p) => shell.openPath(p));
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('shell:openExternal', (e, url) => {
    if (typeof url === 'string' && /^https:\/\/(github\.com|esoexe\.github\.io)\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('app:set-title', (e, t) => { if (w()) w().setTitle(t ? `${t} — ApolloCut` : 'ApolloCut'); });

  /* ---- LUT manager ---- */
  function lutsDir(){ const d = path.join(app.getPath('userData'), 'luts'); fs.mkdirSync(d, { recursive: true }); return d; }
  ipcMain.handle('lut:import', async () => {
    if (!w()) return null;
    const r = await dialog.showOpenDialog(w(), { title: 'Import LUT (.cube)', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'LUTs', extensions: ['cube', 'CUBE'] }] });
    if (r.canceled) return [];
    const out = [];
    for (const p of r.filePaths){
      const name = path.basename(p);
      try { fs.copyFileSync(p, path.join(lutsDir(), name)); out.push(name); } catch(e){}
    }
    return out;
  });
  ipcMain.handle('lut:list', () => { try { return fs.readdirSync(lutsDir()).filter(f => /\.cube$/i.test(f)); } catch(e){ return []; } });
  ipcMain.handle('lut:read', (e, name) => { try { return { ok: true, text: fs.readFileSync(path.join(lutsDir(), name), 'utf8') }; } catch(err){ return { ok: false }; } });
  ipcMain.handle('lut:delete', (e, name) => { try { fs.unlinkSync(path.join(lutsDir(), name)); return { ok: true }; } catch(err){ return { ok: false }; } });

  /* ---- plugins ---- */
  ipcMain.handle('plugins:dir', () => pluginsDir());
  ipcMain.handle('plugins:list', () => {
    try { return fs.readdirSync(pluginsDir()).filter(f => f.endsWith('.js')); } catch(e){ return []; }
  });
  ipcMain.handle('plugins:read', (e, name) => { try { return { ok: true, code: fs.readFileSync(path.join(pluginsDir(), name), 'utf8') }; } catch(err){ return { ok: false }; } });

  /* ---- CLI bridge ---- */
  ipcMain.handle('cli:getJob', () => cliJob);
  ipcMain.on('cli:progress', (e, line) => console.log('[render] ' + line));
  ipcMain.on('cli:done', (e, res) => {
    if (res && res.ok) console.log(`[ApolloCut CLI] ✅ done: ${res.outPath} (${((res.size || 0) / 1048576).toFixed(1)} MB)`);
    else console.error('[ApolloCut CLI] ❌ failed: ' + (res && res.error || 'unknown'));
    setTimeout(() => app.exit(res && res.ok ? 0 : 1), 300);
  });
}

function pluginsDir(){ const d = path.join(app.getPath('userData'), 'plugins'); fs.mkdirSync(d, { recursive: true }); return d; }
function seedPlugins(){
  const samples = {
    'vignette.js': `// ApolloCut sample plugin — cinematic vignette
registerPlugin({
  id: 'vignette', name: 'Vignette (soft edges)', type: 'postprocess',
  apply(ctx, W, H){
    const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.35, W/2, H/2, Math.max(W,H)*0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
});\n`,
    'film-grain.js': `// ApolloCut sample plugin — animated film grain
registerPlugin({
  id: 'film-grain', name: 'Film Grain (35mm)', type: 'postprocess',
  apply(ctx, W, H, time){
    const s = this._noise || (this._noise = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'); const d = x.createImageData(128, 128);
      for (let i = 0; i < d.data.length; i += 4){ const v = Math.random() * 255 | 0; d.data[i] = d.data[i+1] = d.data[i+2] = v; d.data[i+3] = 255; }
      x.putImageData(d, 0, 0); return c;
    })());
    const ox = (Math.sin(time * 12.9898) * 43758.5453 % 1) * 128;
    const oy = (Math.sin(time * 78.233) * 12578.5453 % 1) * 128;
    ctx.save(); ctx.globalAlpha = 0.07;
    const p = ctx.createPattern(s, 'repeat'); p.setTransform(new DOMMatrix().translate(ox, oy));
    ctx.fillStyle = p; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
});\n`,
    'letterbox.js': `// ApolloCut sample plugin — 2.35:1 cinematic bars
registerPlugin({
  id: 'letterbox', name: 'Letterbox 2.35:1', type: 'postprocess',
  apply(ctx, W, H){
    const target = 2.35, cur = W / H;
    if (cur <= target) return;
    const bar = (H - W / target) / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
  }
});\n`
  };
  for (const [name, code] of Object.entries(samples)){
    try { const p = path.join(pluginsDir(), name); if (!fs.existsSync(p)) fs.writeFileSync(p, code); } catch(e){}
  }
}

/* ================= native menu ================= */
function send(id){ if (mainWindow) mainWindow.webContents.send('menu:action', id); }
const item = (id, label, accelerator, opts = {}) =>
  ({ id, label, accelerator, registerAccelerator: false, click: () => send(id), ...opts });

function buildMenu(){
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      item('new-project', 'New Project'),
      item('open-project', 'Open Project…', 'CmdOrCtrl+O'),
      item('save-project', 'Save Project', 'CmdOrCtrl+S'),
      { type: 'separator' },
      item('import-media', 'Import Media…', 'CmdOrCtrl+I'),
      item('load-demo', 'Load Demo Media'),
      { type: 'separator' },
      item('export-webm', 'Export Fast (WebM)…', 'CmdOrCtrl+E'),
      item('export-pro', 'Export Pro (MP4 / MOV)…', 'CmdOrCtrl+Shift+E'),
      item('export-frame', 'Export Current Frame (PNG)'),
      { type: 'separator' },
      item('edl-export', 'Export EDL (interchange)…'),
      item('edl-import', 'Import EDL…'),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit', label: 'Exit ApolloCut' }
    ]},
    { label: 'Edit', submenu: [
      item('undo', 'Undo', 'CmdOrCtrl+Z'), item('redo', 'Redo', 'CmdOrCtrl+Y'),
      { type: 'separator' },
      item('split', 'Split at Playhead', 'CmdOrCtrl+K'),
      item('clip-copy', 'Copy Clip', 'CmdOrCtrl+C'), item('clip-paste', 'Paste Clip', 'CmdOrCtrl+V'),
      item('clip-duplicate', 'Duplicate', 'CmdOrCtrl+D'),
      item('clip-delete', 'Delete', 'Delete'), item('clip-ripple-delete', 'Ripple Delete', 'Shift+Delete'),
      { type: 'separator' },
      item('select-all', 'Select All Clips', 'CmdOrCtrl+A'), item('deselect', 'Deselect', 'Esc')
    ]},
    { label: 'Clip', submenu: [
      item('clip-multicam', 'Create Multicam Clip…'),
      { type: 'separator' },
      item('clip-matte-off', 'Track Matte: None'),
      item('clip-matte-luma', 'Track Matte: Luma (clip above)'),
      item('clip-matte-alpha', 'Track Matte: Alpha (clip above)'),
      { type: 'separator' },
      item('clip-rename', 'Rename…'), item('clip-speed', 'Speed / Duration…'),
      { type: 'separator' },
      item('clip-fadein', 'Fade In 1s'), item('clip-fadeout', 'Fade Out 1s'), item('clip-reset-fx', 'Reset Effects')
    ]},
    { label: 'Tools', submenu: [
      item('ai-scene-cut', 'Scene Auto-Cut…'),
      item('ai-silence-remover', 'Remove Silences…'),
      item('ai-speech-captions', 'Speech → Captions (AI)…'),
      item('tools-motion', 'Motion Track…'),
      { type: 'separator' },
      item('caps-import', 'Import Captions (SRT / VTT)…'),
      item('caps-export', 'Export Captions (SRT)'),
      { type: 'separator' },
      item('lut-import', 'Import LUT (.cube)…'),
      item('lut-manage', 'Output LUT…'),
      { type: 'separator' },
      item('plugins-open-folder', 'Open Plugins Folder'),
      item('plugins-refresh', 'Reload Plugins')
    ]},
    { label: 'Sequence', submenu: [
      item('seq-settings', 'Settings…'),
      item('seq-reframe', 'Smart Reframe… (9:16 / 1:1 / 4:5)'),
      { type: 'separator' },
      item('seq-new-nested', 'New Nested Sequence…'),
      item('seq-nest', 'Nest Selection…'),
      item('seq-insert', 'Insert Nested Sequence…'),
      item('seq-close', 'Close Nested Sequence'),
      { type: 'separator' },
      item('seq-add-video', 'Add Video Track'),
      item('seq-add-audio', 'Add Audio Track'),
      item('seq-add-adjustment', 'Add Adjustment Layer')
    ]},
    { label: 'Markers', submenu: [
      item('marker-add', 'Add Marker', 'M'), item('marker-next', 'Next Marker'), item('marker-prev', 'Previous Marker'),
      { type: 'separator' }, item('marker-clear', 'Clear All Markers')
    ]},
    { label: 'View', submenu: [
      item('zoom-in', 'Zoom In', '+'), item('zoom-out', 'Zoom Out', '-'), item('zoom-fit', 'Zoom to Fit', '\\'),
      { type: 'separator' },
      item('toggle-proxies', 'Toggle Proxy Mode'),
      item('view-gpu', 'GPU Engine (WebGL2)'),
      item('view-mc', 'Multicam Viewer'),
      item('toggle-snap', 'Toggle Snapping', 'S'), item('toggle-safe', 'Safe Margins'), item('toggle-loop', 'Toggle Loop'),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools', visible: !app.isPackaged }
    ]},
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom', visible: isMac }, { role: 'close', visible: !isMac }] },
    { label: 'Help', submenu: [ item('help-selftest', 'Self-Test & Support Report…'), item('help-shortcuts', 'Keyboard Shortcuts'), item('help-about', 'About ApolloCut') ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
