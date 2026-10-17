/* ApolloCut — AI tools UI: scene auto-cut, silence remover, whisper speech-to-captions. */
(function(){
'use strict';

const AITools = {};
window.AITools = AITools;

function requireDesktop(){
  if (!window.desktop || !window.desktop.isDesktop){
    UI.toast('AI tools require the desktop app (bundled FFmpeg)', 'err');
    return false;
  }
  return true;
}

function selectedMediaClip(){
  const s = State.selectionClips();
  if (!s.length){ UI.toast('Select a clip first'); return null; }
  const { clip, track } = s[0];
  const media = clip.mediaId ? Media.get(clip.mediaId) : null;
  if (!media || !media.path || media.offline){ UI.toast('Selected clip needs a disk-based media file'); return null; }
  return { clip, track, media };
}

function progressModal(title){
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal"><h2>${title}</h2><div class="body">
    <div class="ai-label">Working…</div><div class="progress"><div style="width:2%"></div></div>
    </div></div>`;
  document.getElementById('modal-root').appendChild(modal);
  return {
    set(t, pct){
      modal.querySelector('.ai-label').textContent = t;
      if (pct != null && pct >= 0) modal.querySelector('.progress > div').style.width = Math.round(pct * 100) + '%';
    },
    close(){ modal.remove(); }
  };
}

/* ================= scene auto-cut ================= */
AITools.sceneCutDialog = function(){
  if (!requireDesktop()) return;
  const sel = selectedMediaClip();
  if (!sel) return;
  if (sel.clip.type !== 'video'){ UI.toast('Select a video clip for scene detection', 'err'); return; }
  UI.dialog({
    title: '🎬 Scene Auto-Cut',
    body: `
      <div class="dlg-row"><label>Sensitivity</label><select name="th">
        <option value="0.6">Low — only hard changes</option>
        <option value="0.35" selected>Medium (default)</option>
        <option value="0.2">High — many cuts</option>
        <option value="0.1">Very high — subtle changes</option>
      </select></div>
      <p class="fx-note">Analyzes <b>${Util.esc(sel.media.name)}</b> with FFmpeg's scene detector and cuts the selected
      clip at every detected shot change (inside its trimmed range).</p>`,
    ok: 'Detect & Cut',
    onOk: v => runSceneCut(sel, parseFloat(v.th))
  });
};

async function runSceneCut({ clip, track, media }, threshold){
  const pm = progressModal('🎬 Detecting scenes…');
  const unsub = window.desktop.onAIProgress(d => { if (d.phase === 'scene') pm.set('Analyzing… ' + Math.round(d.pct * 100) + '%', d.pct); });
  const r = await window.desktop.aiSceneDetect(media.path, threshold, media.duration || 0);
  unsub(); pm.close();
  if (!r.ok || !r.times) { UI.toast('Scene detection failed', 'err'); return; }

  // scene times inside the clip's *source* range → timeline times
  const srcStart = clip.offset, srcEnd = clip.offset + clip.duration * clip.speed;
  const cuts = r.times
    .filter(t => t > srcStart + 0.05 && t < srcEnd - 0.05)
    .map(t => clip.start + (t - srcStart) / clip.speed);
  if (!cuts.length){ UI.toast('No scene changes found in this clip’s range'); return; }

  State.mutate('Scene Auto-Cut', () => splitMany(track, clip, cuts));
  State.setSelection([]);
  UI.toast(`Cut into ${cuts.length + 1} shots ✂`, 'ok');
}

/* split a clip at multiple absolute times in one history step (keyframes partitioned) */
function splitMany(track, clip, times){
  times = times.slice().sort((a, b) => a - b).filter(t => t > clip.start + 0.001 && t < clip.start + clip.duration - 0.001);
  if (!times.length) return;
  const end = clip.start + clip.duration;
  const srcKf = Util.deepClone(clip.kf || {});
  const cuts = times.map(t => t - clip.start);         // clip-relative cut points
  const bounds = [0, ...cuts, clip.duration];

  const kfsFor = (a, b) => {
    const out = {};
    for (const p in srcKf){
      const seg = srcKf[p].filter(k => k.t >= a && k.t < b).map(k => ({ t: Util.round(k.t - a, 3), v: k.v }));
      if (seg.length) out[p] = seg;
    }
    return out;
  };

  for (let i = 0; i < bounds.length - 1; i++){
    const a = bounds[i], b = bounds[i + 1];
    if (i === 0){
      clip.duration = Util.round(b - a, 3);
      clip.fadeOut = 0;
      clip.kf = kfsFor(a, b);
    } else {
      const nb = Util.deepClone(clip);
      nb.id = Util.uid('cl');
      nb.start = Util.round(clip.start + a, 3);
      nb.offset = Util.round(clip.offset + a * clip.speed, 3);
      nb.duration = Util.round(b - a, 3);
      nb.kf = kfsFor(a, b);
      nb.fadeIn = 0;
      if (i < bounds.length - 2) nb.fadeOut = 0;
      track.clips.push(nb);
    }
  }
  State.sortTrack(track);
}

/* ================= silence remover ================= */
AITools.silenceDialog = function(){
  if (!requireDesktop()) return;
  const sel = selectedMediaClip();
  if (!sel) return;
  UI.dialog({
    title: '🔇 Remove Silences',
    body: `
      <div class="dlg-row"><label>Silence under</label><select name="db">
        <option value="-30">-30 dB (loud room)</option>
        <option value="-35" selected>-35 dB (default)</option>
        <option value="-40">-40 dB</option>
        <option value="-50">-50 dB (quiet room)</option>
      </select></div>
      <div class="dlg-row"><label>Min. length</label><select name="dur">
        <option value="0.25">0.25 s</option>
        <option value="0.5" selected>0.5 s</option>
        <option value="1.0">1.0 s</option>
        <option value="2.0">2.0 s</option>
      </select></div>
      <div class="dlg-row"><label>Padding</label><select name="pad">
        <option value="0">None</option>
        <option value="0.12" selected>0.12 s (natural)</option>
        <option value="0.3">0.3 s (loose)</option>
      </select></div>
      <p class="fx-note">Finds silent stretches in <b>${Util.esc(sel.media.name)}</b> and rebuilds the clip as a
      sequence of sound-only segments — podcast/talking-head editing in one click.</p>`,
    ok: 'Remove Silences',
    onOk: v => runSilence(sel, parseFloat(v.db), parseFloat(v.dur), parseFloat(v.pad))
  });
};

async function runSilence({ clip, track, media }, noiseDb, minDur, pad){
  const pm = progressModal('🔇 Analyzing audio…');
  const r = await window.desktop.aiSilenceDetect(media.path, noiseDb, minDur);
  pm.close();
  if (!r.ok){ UI.toast('Silence analysis failed', 'err'); return; }

  // limit to the clip's source range
  const s0 = clip.offset, s1 = clip.offset + clip.duration * clip.speed;
  const sil = (r.silences || []).map(x => ({ start: Math.max(x.start, s0), end: Math.min(x.end, s1) }))
    .filter(x => x.end - x.start > 0.02)
    .sort((a, b) => a.start - b.start);
  if (!sil.length){ UI.toast('No silences found — clip is already tight 🎙', 'ok'); return; }

  // build keep segments (source time), padded
  const keeps = [];
  let cur = s0;
  const clampPad = (t, a, b) => Math.min(b, Math.max(a, t));
  for (const g of sil){
    const ks = cur, ke = g.start;
    if (ke - ks > 0.03) keeps.push({ s: clampPad(ks, s0, s1), e: clampPad(ke + pad, s0, s1) });
    cur = Math.max(cur, g.end);
  }
  if (s1 - cur > 0.03) keeps.push({ s: cur - pad > s0 ? cur - pad : cur, e: s1 });

  State.mutate('Remove Silences', () => {
    const at = clip.start;
    const idx = track.clips.indexOf(clip);
    track.clips.splice(idx, 1);
    let t = at;
    keeps.forEach((k, i) => {
      const nb = Util.deepClone(clip);
      nb.id = Util.uid('cl');
      nb.start = t;
      nb.offset = Util.clamp(k.s, 0, media.duration);
      nb.duration = Math.max(0.03, (k.e - k.s) / clip.speed);
      nb.fadeIn = 0; nb.fadeOut = 0;
      nb.kf = {};
      if (i === 0){ Object.assign(clip, { start: t, offset: nb.offset, duration: nb.duration, fadeIn: 0, fadeOut: 0, kf: {} }); track.clips.splice(idx, 0, clip); }
      else track.clips.push(nb);
      t += nb.duration;
    });
    State.sortTrack(track);
    State.selection.clear();
  });
  Events.emit('selection');
  UI.toast(`Removed ${sil.length} silent gaps — ${keeps.length} segments remain`, 'ok');
}

/* ================= whisper speech-to-captions ================= */
AITools.sttDialog = async function(){
  if (!requireDesktop()) return;
  const sel = selectedMediaClip();
  if (!sel) return;
  const st = await window.desktop.aiWhisperStatus().catch(() => null);
  if (!st){ UI.toast('AI status check failed', 'err'); return; }

  if (!st.binary){
    UI.dialog({
      title: '🗣 Speech → Captions (AI)',
      body: `<p>Speech recognition uses the open-source <b>whisper.cpp</b> engine, running 100% locally.</p>
        <p style="margin-top:8px">Install step 1 of 2 — place a <b>whisper-cli</b> binary in:</p>
        <p class="fx-note" style="word-break:break-all">${Util.esc(st.dir)}</p>
        <p class="fx-note">Build it from <b>github.com/ggerganov/whisper.cpp</b> (one command: <code>make</code>),
        or drop any release binary named <code>whisper-cli</code> in that folder. Then use Tools → Speech → Captions again.</p>`,
      ok: 'Open AI Folder', cancelText: 'Close',
      onOk: () => window.desktop.openPath(st.dir)
    });
    return;
  }

  const models = st.models.length ? st.models : [];
  UI.dialog({
    title: '🗣 Speech → Captions (whisper.cpp)',
    body: `
      <div class="dlg-row"><label>Media</label><input value="${Util.esc(sel.media.name)}" disabled></div>
      <div class="dlg-row"><label>Model</label><select name="model">
        ${models.map(m => `<option value="${m}">${m} ✓ downloaded</option>`).join('')}
      </select></div>
      <div class="dlg-row"><label>Language</label><select name="lang">
        <option value="auto" selected>Auto-detect</option>
        <option value="en">English</option><option value="fr">French</option><option value="de">German</option>
        <option value="es">Spanish</option><option value="ar">Arabic</option><option value="el">Greek</option>
        <option value="it">Italian</option><option value="pt">Portuguese</option><option value="tr">Turkish</option>
      </select></div>
      ${!models.length ? `<p class="fx-note">No model yet — download one (step 2 of 2):</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" data-dl="tiny">tiny · 75 MB (fastest)</button>
          <button class="btn" data-dl="base">base · 142 MB</button>
          <button class="btn" data-dl="small">small · 466 MB (best value)</button>
        </div>` : `<p class="fx-note">Runs fully offline on your CPU. Larger models = more accurate, slower.</p>`}`,
    ok: models.length ? 'Transcribe' : 'Close',
    cancel: models.length ? 'Cancel' : false,
    onOk: v => { if (models.length) runStt(sel.media, v.model, v.lang); }
  });
  document.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
    b.textContent = 'Downloading…'; b.disabled = true;
    const pm = progressModal('⬇ Downloading model…');
    const unsub = window.desktop.onAIProgress(d => { if (d.phase === 'model') pm.set('Downloading ' + b.dataset.dl + '… ' + Math.round(d.pct * 100) + '%', d.pct); });
    const r = await window.desktop.aiModelDownload(b.dataset.dl);
    unsub(); pm.close();
    const ov = document.querySelector('.modal-overlay'); if (ov) ov.remove();
    if (r.ok){ UI.toast('Model ready: ' + b.dataset.dl, 'ok'); AITools.sttDialog(); }
    else UI.toast('Download failed: ' + r.error, 'err');
  }));
};

async function runStt(media, model, lang){
  const pm = progressModal('🗣 Transcribing…');
  const unsub = window.desktop.onAIProgress(d => {
    if (d.phase === 'transcribe') pm.set('Running whisper (' + model + ')…');
  });
  UI.status('Transcribing with whisper.cpp…');
  const r = await window.desktop.aiTranscribe(media.path, model, lang);
  unsub(); pm.close(); UI.status('Ready');
  if (!r.ok){ UI.toast('Transcription failed: ' + r.error, 'err'); return; }
  const cues = Captions.parse(r.srt);
  if (!cues.length){ UI.toast('No speech detected'); return; }
  Captions.importCues(cues, { at: 0 });
}

})();
