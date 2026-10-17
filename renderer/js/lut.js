/* ApolloCut — .cube LUT engine (1D & 3D): parse, cache, nearest preview / trilinear render.
   Sequence-level "Output LUT" (like a Premiere output transform). */
(function(){
'use strict';

const LUT = {};
window.LUT = LUT;

const registry = new Map();   // name -> { title, size, data:Float32Array, tabR/G/B }

function parseCube(text, name){
  const lines = text.split(/\r?\n/);
  let size = 0, is1D = false, title = name;
  const floats = [];
  for (const raw of lines){
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^LUT_([13])D_SIZE\s+(\d+)/i);
    if (m){ is1D = m[1] === '1'; size = parseInt(m[2]); continue; }
    const t = line.match(/^TITLE\s+"?(.+?)"?$/i);
    if (t){ title = t[1]; continue; }
    if (/^(DOMAIN_|LUT_)/i.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(isFinite)) floats.push(parts[0], parts[1], parts[2]);
  }
  if (!size) throw new Error('no LUT size found');
  const lut = { title, size, is1D };
  if (is1D){
    // expand 1D curve into a 3D cube of the same size
    const N = size, cube = new Float32Array(N * N * N * 3);
    let max = 1;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++){
      const o = (r * N * N + g * N + b) * 3;
      cube[o]   = floats[r * 3];
      cube[o+1] = floats[g * 3 + 1];
      cube[o+2] = floats[b * 3 + 2];
    }
    for (let i = 0; i < cube.length; i++) if (cube[i] > max) max = cube[i];
    if (max > 1.001) for (let i = 0; i < cube.length; i++) cube[i] /= max;
    lut.data = cube; lut.is1D = false;
  } else {
    const need = size * size * size * 3;
    if (floats.length < need) throw new Error('LUT data truncated');
    let max = 1;
    const data = new Float32Array(need);
    for (let i = 0; i < need; i++){ data[i] = floats[i]; if (data[i] > max) max = data[i]; }
    if (max > 1.001) for (let i = 0; i < need; i++) data[i] /= max;
    lut.data = data;
  }
  // fast nearest-index tables
  const N = size;
  lut.tabR = new Uint8Array(256); lut.tabG = new Uint8Array(256); lut.tabB = new Uint8Array(256);
  for (let v = 0; v < 256; v++){
    const f = Math.round(v / 255 * (N - 1));
    lut.tabR[v] = f; lut.tabG[v] = f; lut.tabB[v] = f;
  }
  return lut;
}
LUT.parseCube = parseCube;

LUT.registerText = function(name, text){
  const lut = parseCube(text, name);
  registry.set(name, lut);
  return lut;
};

function activeName(){ return State.project && State.project.lutRef ? State.project.lutRef.name : null; }
function activeLut(){ const n = activeName(); return n ? registry.get(n) : null; }
LUT.active = activeLut;

/* ensure the active LUT is parsed (load from disk if desktop) */
LUT.ensureActive = async function(){
  const n = activeName();
  if (!n || registry.has(n)) return;
  if (window.desktop && window.desktop.isDesktop){
    const r = await window.desktop.lutRead(n).catch(() => null);
    if (r && r.ok){
      try { LUT.registerText(n, r.text); } catch(e){ console.warn('lut parse failed', e); }
    }
  } else if (!registry.has(n)){
    // web session ended — clear dangling reference
    if (State.project){ State.project.lutRef = null; }
  }
};

/* apply active LUT onto a canvas 2d context (in place) */
LUT.applyFrame = function(ctx, W, H, quality){
  const lut = activeLut();
  if (!lut) return;
  let img;
  try { img = ctx.getImageData(0, 0, W, H); } catch(e){ return; }
  const d = img.data, N = lut.size, data = lut.data;
  if (quality === 'best'){
    const s = (N - 1) / 255;
    for (let i = 0; i < d.length; i += 4){
      const cr = d[i] * s, cg = d[i+1] * s, cb = d[i+2] * s;
      const r0 = cr | 0, g0 = cg | 0, b0 = cb | 0;
      const r1 = Math.min(N - 1, r0 + 1), g1 = Math.min(N - 1, g0 + 1), b1 = Math.min(N - 1, b0 + 1);
      const fr = cr - r0, fg = cg - g0, fb = cb - b0;
      for (let c = 0; c < 3; c++){
        const c000 = data[(r0 * N * N + g0 * N + b0) * 3 + c], c100 = data[(r1 * N * N + g0 * N + b0) * 3 + c];
        const c010 = data[(r0 * N * N + g1 * N + b0) * 3 + c], c110 = data[(r1 * N * N + g1 * N + b0) * 3 + c];
        const c001 = data[(r0 * N * N + g0 * N + b1) * 3 + c], c101 = data[(r1 * N * N + g0 * N + b1) * 3 + c];
        const c011 = data[(r0 * N * N + g1 * N + b1) * 3 + c], c111 = data[(r1 * N * N + g1 * N + b1) * 3 + c];
        const c00 = c000 + (c100 - c000) * fr, c10 = c010 + (c110 - c010) * fr;
        const c01 = c001 + (c101 - c001) * fr, c11 = c011 + (c111 - c011) * fr;
        const c0 = c00 + (c10 - c00) * fg, c1 = c01 + (c11 - c01) * fg;
        d[i + c] = Util.clamp((c0 + (c1 - c0) * fb) * 255, 0, 255);
      }
    }
  } else {
    const tR = lut.tabR, tG = lut.tabG, tB = lut.tabB, NN = N * N;
    for (let i = 0; i < d.length; i += 4){
      const o = (tR[d[i]] * NN + tG[d[i+1]] * N + tB[d[i+2]]) * 3;
      d[i] = data[o] * 255; d[i+1] = data[o+1] * 255; d[i+2] = data[o+2] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
};

/* ---------------- UI ---------------- */
LUT.setActive = function(name){
  State.mutate('Output LUT', () => { State.project.lutRef = name ? { name } : null; });
  if (window.GL && GL.ready) GL.setLUT(null);   // invalidate GPU LUT; rebuilt by ensureActive
  if (name) LUT.ensureActive().then(() => {
    if (window.GL && GL.ready){ const l = activeLut(); if (l) GL.setLUT({ size: l.size, data: l.data }); }
    Events.emit('pool'); Engine.render(State.playhead);
  });
  else if (window.GL && GL.ready) Engine.render(State.playhead);
  UI.status(name ? `Output LUT: ${name}` : 'Output LUT: none');
};

/* parsed {size, data} of the active LUT (used by the GL final pass) */
LUT.activeData = function(){
  const l = activeLut();
  return l ? { size: l.size, data: l.data } : null;
};

LUT.list = async function(){
  const names = new Set(registry.keys());
  if (window.desktop && window.desktop.isDesktop){
    const disk = await window.desktop.lutList().catch(() => []);
    disk.forEach(n => names.add(n));
  }
  return [...names].sort();
};

LUT.importDialog = async function(){
  if (window.desktop && window.desktop.isDesktop){
    const added = await window.desktop.lutImport();
    if (added && added.length){
      UI.toast(`Imported ${added.length} LUT${added.length > 1 ? 's' : ''}`, 'ok');
      if (added.length === 1) LUT.setActive(added[0]);
      else LUT.manageDialog();
    }
    return;
  }
  // web fallback: read .cube in-page (session-only)
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.cube';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      LUT.registerText(f.name, text);
      LUT.setActive(f.name);
      UI.toast('LUT imported (session only in web mode)', 'ok');
    } catch(e){ UI.toast('Invalid .cube: ' + e.message, 'err'); }
  };
  input.click();
};

LUT.manageDialog = async function(){
  const names = await LUT.list();
  const cur = activeName();
  const rows = names.map(n =>
    `<div class="dlg-row" style="gap:6px"><input type="radio" name="lutsel" value="${Util.esc(n)}" ${n === cur ? 'checked' : ''} style="flex:0 0 auto">
     <label style="flex:1;cursor:pointer">${Util.esc(n)}</label>
     ${window.desktop ? `<button class="btn" data-del="${Util.esc(n)}" title="Delete">✕</button>` : ''}</div>`).join('');
  const d = UI.dialog({
    title: 'Output Color LUT',
    body: `
      <div class="dlg-row"><input type="radio" name="lutsel" value="" ${!cur ? 'checked' : ''} style="flex:0 0 auto"><label style="flex:1">None (no output transform)</label></div>
      ${rows || '<p class="fx-note">No LUTs yet.</p>'}
      <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" id="lut-import-btn">Import .cube…</button></div>
      <p class="fx-note">Applied to the final composite — previews fast, renders trilinear &amp; is included in all exports.</p>`,
    ok: 'Apply',
    onOk: v => LUT.setActive(v.lutsel || null)
  });
  const body = document.querySelector('.modal:last-child .body') || document;
  const ib = document.getElementById('lut-import-btn');
  if (ib) ib.addEventListener('click', async () => { d.close(); await LUT.importDialog(); });
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
    const n = b.dataset.del;
    await window.desktop.lutDelete(n);
    registry.delete(n);
    if (activeName() === n) LUT.setActive(null);
    d.close(); LUT.manageDialog();
  }));
};

LUT.init = function(){
  Events.on('structure', () => { if (activeName() && !registry.get(activeName())) LUT.ensureActive(); });
};

})();
