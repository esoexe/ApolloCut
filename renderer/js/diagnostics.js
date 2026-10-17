/* ApolloCut — self-test & battle-hardening report.
   Probes every subsystem the way a support engineer would, prints a report
   the user can attach to a bug report, and offers one-click autosave recovery. */
'use strict';
const Diagnostics = {};
window.Diagnostics = Diagnostics;

async function probe(name, fn){
  try { const r = await fn(); return { name, ok: r !== false, note: typeof r === 'string' ? r : (r === false ? 'unavailable' : 'ok') }; }
  catch(e){ return { name, ok: false, note: String(e && e.message || e).slice(0, 120) }; }
}

Diagnostics.run = async function(){
  document.querySelector('.modal-overlay')?.remove();
  const rows = [];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal wide"><h2>🩺 ApolloCut Self-Test</h2><div class="body"><div id="diag-rows" class="fx-note" style="white-space:pre-line;line-height:1.9">Running probes…</div>
  <div class="fx-row" style="margin-top:10px;gap:8px;display:flex">
    <button class="btn" id="diag-copy">Copy report</button>
    <button class="btn" id="diag-save">Save report…</button>
    <button class="btn warn" id="diag-recover">Restore autosave</button>
  </div></div><div class="btns"><button class="ok" id="diag-close">Close</button></div></div>`;
  document.getElementById('modal-root').appendChild(modal);
  const out = modal.querySelector('#diag-rows');
  modal.querySelector('#diag-close').addEventListener('click', () => modal.remove());

  const P = State.project;
  const tests = [];
  const step = async (t) => { tests.push(t); render(); };

  out.textContent = 'Running probes…';
  const render = () => {
    out.textContent = tests.map(t => `${t.ok ? ' ✅' : ' ⚠️ '} ${t.name} — ${t.note}`).join('\n');
  };

  await step(await probe('UI / DOM', () => !!document.getElementById('program-display')));
  await step(await probe('WebGL2 GPU compositor', () => {
    const c = document.createElement('canvas').getContext('webgl2');
    if (!c) return 'WebGL2 context unavailable (CPU renderer will run)';
    const gl = c.getParameter(c.RENDERER) || 'GPU OK';
    const dbg = c.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl;
    return String(r).slice(0, 90);
  }));
  await step(await probe('WebAudio engine', () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx(); const sr = ctx.sampleRate; ctx.close && ctx.close();
    return `sampleRate ${sr} Hz`;
  }));
  await step(await probe('Video decode (element)', () => {
    const v = document.createElement('video');
    return v.canPlayType('video/mp4; codecs="avc1.42E01E"') ? 'H.264 ok' : 'H.264 uncertain';
  }));
  if (window.desktop && window.desktop.isDesktop){
    const r = await window.desktop.proExportAvailable().catch(() => null);
    await step({ name: 'FFmpeg render engine', ok: !!(r && r.available), note: r && r.exe ? r.exe : (r && r.available ? 'bundled' : 'not found') });
    const enc = await window.desktop.proExportEncoders().catch(() => null);
    await step({ name: 'GPU encoders (NVENC/QSV/AMF/Vt)', ok: !!(enc && enc.engines && enc.engines.length),
                 note: enc && enc.engines && enc.engines.length ? enc.engines.map(e => e.label).join(', ') : 'CPU encode only' });
  } else {
    await step({ name: 'Desktop bridge', ok: true, note: 'browser build (FFmpeg/export advanced features need the desktop app)' });
  }
  const off = [...State.pool.values()].filter(m => m.offline).length;
  await step(await probe('Media relink status', () => off === 0 ? `${State.pool.size} asset(s) online` : `${off}/${State.pool.size} still offline — re-import to relink` ));
  const auto = (() => { try { return localStorage.getItem(AUTO_KEY()); } catch(e){ return null; } })();
  await step(await probe('Autosave watchdog', () => auto ? `autosave present (${(auto.length / 1024 | 0)} KB)` : 'no autosave yet (created 20 s after first edit)'));
  await step(await probe('History / undo stack', () => `${State._hist ? State._hist.length : 0} states`));
  await step(await probe('Render engine selection', () => (State.useGL ? 'GPU (WebGL2)' : 'CPU canvas')));

  const report = () =>
`ApolloCut Self-Test — ${new Date().toISOString()}
Project: ${P.name} · ${P.width}×${P.height} @ ${P.fps} fps · ${P.tracks.length} tracks · ${State.pool.size} pool assets
Platform: ${navigator.userAgent}
${tests.map(t => `${t.ok ? 'PASS' : 'WARN'}  ${t.name} — ${t.note}`).join('\n')}
`;

  modal.querySelector('#diag-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(report()); UI.toast('Report copied', 'ok'); }
    catch(e){ UI.toast('Copy blocked — use Save instead', 'err'); }
  });
  modal.querySelector('#diag-save').addEventListener('click', async () => {
    const text = report();
    if (window.desktop && window.desktop.isDesktop){
      const p = await window.desktop.saveExportDialog({ defName: 'apollocut-report.txt', ext: 'txt', filterName: 'Text' });
      if (p) await window.desktop.fileWrite(p, text);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = 'apollocut-report.txt'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  });
  modal.querySelector('#diag-recover').addEventListener('click', () => {
    if (!auto){ UI.toast('No autosave found', 'err'); return; }
    if (!confirm('Restore the last autosave? Current unsaved changes will be replaced.')) return;
    try {
      Exporter.loadData(JSON.parse(auto), { silent: true });
      UI.toast('Autosave restored', 'ok');
      modal.remove();
    } catch(e){ UI.toast('Autosave is damaged: ' + e.message, 'err'); }
  });
};

function AUTO_KEY(){ return 'apollocut.autosave.v1'; }
