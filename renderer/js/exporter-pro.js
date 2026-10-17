/* ApolloCut — Pro Export (desktop): frame-accurate render through the bundled FFmpeg.
   The renderer sweeps the timeline frame by frame, mixes audio offline with
   WebAudio, and streams everything to FFmpeg in the main process.
   Formats: MP4 H.264/H.265, MOV ProRes, WebM VP9, WAV & MP3 (audio only). */
(function(){
'use strict';
if (!window.desktop || !window.desktop.isDesktop) return;

const D = window.desktop;

const FORMATS = [
  { id: 'mp4-h264',  label: 'MP4 — H.264 (universal)',        ext: 'mp4',  video: true  },
  { id: 'mp4-h265',  label: 'MP4 — H.265 / HEVC (smaller)',   ext: 'mp4',  video: true  },
  { id: 'mov-prores',label: 'MOV — ProRes 422 HQ (editing)',  ext: 'mov',  video: true  },
  { id: 'webm-vp9',  label: 'WebM — VP9',                     ext: 'webm', video: true  },
  { id: 'audio-wav', label: 'WAV — audio only (lossless)',    ext: 'wav',  video: false },
  { id: 'audio-mp3', label: 'MP3 — audio only',               ext: 'mp3',  video: false }
];
const QUALITIES = [
  { id: 'master',   label: 'Master — CRF 15, slow (largest)', crf: 15, preset: 'slow'   },
  { id: 'high',     label: 'High — CRF 18, slow',             crf: 18, preset: 'slow'   },
  { id: 'standard', label: 'Standard — CRF 21, medium',       crf: 21, preset: 'medium' },
  { id: 'draft',    label: 'Draft — CRF 27, fast',            crf: 27, preset: 'fast'   }
];

const ProExport = { running: false, cancel: false };
window.ProExport = ProExport;

ProExport.dialog = async function(){
  if (ProExport.running){ UI.toast('An export is already running'); return; }
  let avail, enc;
  try { avail = await D.proExportAvailable(); } catch(e){ avail = null; }
  if (!avail || !avail.available){
    UI.toast('FFmpeg engine not found in this build — pro export unavailable', 'err');
    return;
  }
  try { enc = await D.proExportEncoders(); } catch(e){ enc = null; }
  const engines = (enc && enc.engines && enc.engines.length) ? enc.engines : [];
  const caps = Captions.collect().length;

  let clips = 0; State.eachClip(() => clips++);
  if (!clips){ UI.toast('Timeline is empty'); return; }
  const hasIO = State.inPoint != null && State.outPoint != null && State.outPoint > State.inPoint;

  UI.dialog({
    title: '⚙ Pro Export — FFmpeg render engine',
    body: `
      <div class="dlg-row"><label>Format</label><select name="format">
        ${FORMATS.map((f,i) => `<option value="${f.id}"${i===0?' selected':''}>${f.label}</option>`).join('')}
      </select></div>
      <div class="dlg-row"><label>Quality</label><select name="quality">
        ${QUALITIES.map((q,i) => `<option value="${q.id}"${i===1?' selected':''}>${q.label}</option>`).join('')}
      </select></div>
      <div class="dlg-row"><label>Engine</label><select name="engine">
        <option value="" selected>CPU — maximum quality</option>
        ${engines.map(e => `<option value="${e.id}">GPU — ${e.label} (fast)</option>`).join('')}
      </select></div>
      <div class="dlg-row"><label>Range</label><select name="range">
        <option value="entire">Entire sequence (${Util.fmtDur(State.seqDuration())})</option>
        ${hasIO ? `<option value="io" selected>In → Out (${Util.fmtDur(State.outPoint - State.inPoint)})</option>` : ''}
      </select></div>
      <div class="dlg-row"><label>Resolution</label><input value="${State.project.width}×${State.project.height} @ ${State.project.fps} fps" disabled></div>
      <div class="fx-check"><input type="checkbox" name="burn" ${caps ? '' : 'disabled'}><label>Burn in captions (${caps} cue${caps === 1 ? '' : 's'})</label></div>
      <div class="fx-check"><input type="checkbox" name="loudnorm"><label>Normalize loudness <b>−14 LUFS</b> (YouTube/broadcast-safe loudness standard)</label></div>
      <p class="fx-note">Frame-accurate render: every frame is composited at full quality and encoded by the
      bundled FFmpeg — identical to a Premiere Pro "Render &amp; Export" (with Mercury GPU acceleration when a GPU engine is picked).
      LUTs and enabled plugins are baked in. Audio is mixed in 48 kHz stereo first.</p>`,
    ok: 'Render',
    onOk: v => {
      const fmt = FORMATS.find(f => f.id === v.format) || FORMATS[0];
      const q = QUALITIES.find(x => x.id === v.quality) || QUALITIES[1];
      run({ fmt, q, useIO: v.range === 'io', engine: v.engine || null, burn: !!v.burn, loudnorm: !!v.loudnorm });
    }
  });
};

/* ---------------- offline audio mix ---------------- */
async function ensureDecoded(media){
  if (media._ab || media._noAudio) return media._ab || null;
  try {
    const actx = Media.ctx();
    const res = await fetch(media.url);
    const buf = await res.arrayBuffer();
    media._ab = await actx.decodeAudioData(buf);
    return media._ab;
  } catch(e){ media._noAudio = true; return null; }
}

function audibleClips(inT, outT){
  if (window.Graph) return Graph.audioJobs(State.project.tracks, inT, outT);
  const list = [];
  State.eachClip((clip, tr) => {
    const m = clip.mediaId ? Media.get(clip.mediaId) : null;
    if (!m || !m.el || m.offline) return;
    if (tr.muted) return;
    list.push({
      clip, media: m, start: clip.start, end: clip.start + clip.duration,
      speed: clip.speed,
      g: t => Util.clamp(State.valueAt(clip, 'volume', t - clip.start) / 100 * Engine.env(clip, t - clip.start) * Engine.master, 0, 4),
      srcAt: t => clip.offset + (t - clip.start) * clip.speed
    });
  });
  return list;
}

function encodeWav(audioBuf){
  const sr = audioBuf.sampleRate, ch = Math.min(2, audioBuf.numberOfChannels);
  const n = audioBuf.length;
  const bytes = 44 + n * ch * 2;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); wstr(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const L = audioBuf.getChannelData(0), R = audioBuf.getChannelData(ch > 1 ? 1 : 0);
  let o = 44;
  for (let i = 0; i < n; i++){
    dv.setInt16(o, Util.clamp(L[i], -1, 1) * 32767, true); o += 2;
    if (ch === 2){ dv.setInt16(o, Util.clamp(R[i], -1, 1) * 32767, true); o += 2; }
  }
  return buf;
}

async function renderWavMix(inT, outT, jobs, sr = 48000){
  const dur = outT - inT;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  let used = 0;
  for (const j of jobs){
    const ab = await ensureDecoded(j.media);
    if (!ab) continue;
    const s = Math.max(j.start, inT), e = Math.min(j.end, outT);
    if (e - s <= 0.01) continue;
    const src = ctx.createBufferSource();
    src.buffer = ab;
    try { src.playbackRate.value = Util.clamp(j.speed, 0.0625, 16); } catch(e2){}
    const g = ctx.createGain();
    // volume + fade + keyframed volume envelope (+ nested-seq gains), sampled every 25 ms
    const steps = Math.max(1, Math.ceil((e - s) / 0.025));
    for (let i = 0; i <= steps; i++){
      const t = s + (e - s) * (i / steps);
      g.gain.setValueAtTime(Util.clamp(j.g(t), 0, 4), t - inT);
    }
    src.connect(g); g.connect(ctx.destination);
    const when = s - inT;
    const offset = Util.clamp(j.srcAt(s), 0, Math.max(0, ab.duration - 0.01));
    const srcDur = (e - s) * Util.clamp(j.speed, 0.0625, 16);
    try { src.start(when, offset, srcDur); used++; } catch(e3){}
  }
  if (!used) return null;
  const rendered = await ctx.startRendering();
  return { buffer: encodeWav(rendered), sampleRate: sr };
}

/* ---------------- export run ---------------- */
async function run({ fmt, q, useIO, engine = null, burn = false, loudnorm = false }){
  const P = State.project;
  const inT  = (useIO && State.inPoint != null) ? State.inPoint : 0;
  const outT = (useIO && State.outPoint != null) ? State.outPoint : State.seqDuration();
  const dur = outT - inT;
  if (dur < 0.1){ UI.toast('Export range too short', 'err'); return; }

  const base = (P.name || 'apollocut').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'apollocut';
  const outPath = await D.saveExportDialog({ defName: `${base}.${fmt.ext}`, ext: fmt.ext, filterName: fmt.label });
  if (!outPath) return;

  ProExport.running = true; ProExport.cancel = false;
  Engine.pause();

  // exports always use ORIGINAL media, never proxies
  const prevProxies = State.useProxies;
  State.useProxies = false;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal"><h2>⚙ Rendering — ${fmt.label}</h2><div class="body">
      <div id="exp-label">Preparing…</div>
      <div class="progress"><div id="exp-bar"></div></div>
      <div id="exp-fps" class="fx-note"></div>
    </div><div class="btns"><button class="btn" id="exp-cancel">Cancel</button></div></div>`;
  document.getElementById('modal-root').appendChild(modal);
  const bar = modal.querySelector('#exp-bar'), lab = modal.querySelector('#exp-label'), fpsEl = modal.querySelector('#exp-fps');
  const closeModal = () => modal.remove();
  modal.querySelector('#exp-cancel').addEventListener('click', async () => {
    ProExport.cancel = true;
    lab.textContent = 'Cancelling…';
    try { await D.proExportCancel(); } catch(e){}
  });

  try {
    /* 1 — audio mix */
    lab.textContent = 'Analyzing audio…';
    const jobs = audibleClips(inT, outT);
    let audioPath = null;
    if (jobs.length){
      lab.textContent = 'Mixing audio (48 kHz stereo)…';
      const wav = await renderWavMix(inT, outT, jobs);
      if (wav){
        const r = await D.proExportAudio({ buffer: wav.buffer, sampleRate: wav.sampleRate });
        if (r && r.ok) audioPath = r.path;
      }
    }
    if (!fmt.video && !audioPath){
      closeModal(); ProExport.running = false;
      UI.toast('No audible clips in the selected range', 'err'); return;
    }
    if (ProExport.cancel) throw { cancelled: true };

    /* 1.5 — caption burn-in */
    let subtitlesPath = null;
    if (burn){
      lab.textContent = 'Writing captions…';
      subtitlesPath = await Captions.writeTempSrt(inT, outT);
    }

    /* 2 — start ffmpeg */
    lab.textContent = 'Starting FFmpeg…';
    const start = await D.proExportStart({
      format: fmt.id, quality: q, engine,
      fps: P.fps, width: P.width, height: P.height,
      outPath, audioPath, subtitlesPath, loudnorm
    });
    if (!start.ok){ closeModal(); ProExport.running = false; UI.toast('FFmpeg failed to start: ' + start.error, 'err'); return; }

    /* 3 — frames */
    if (fmt.video){
      const frames = Math.max(1, Math.round(dur * P.fps));
      const t0 = performance.now();
      for (let i = 0; i < frames; i++){
        if (ProExport.cancel) break;
        const t = inT + i / P.fps;
        await Engine.renderReady(t);
        const blob = await new Promise(r => Engine.program.toBlob(r, 'image/jpeg', 0.93));
        const buf = await blob.arrayBuffer();
        const w = await D.proExportFrame(buf);
        if (!w.ok) throw { fatal: w.error || 'pipe error' };
        const pct = ((i + 1) / frames * 100);
        bar.style.width = pct.toFixed(1) + '%';
        const el = (performance.now() - t0) / 1000;
        const fps = (i + 1) / el;
        lab.textContent = `Frame ${i + 1} / ${frames} (${pct.toFixed(0)}%)`;
        fpsEl.textContent = `${fps.toFixed(1)} fps · elapsed ${Util.fmtDur(el)} · eta ${Util.fmtDur((frames - i - 1) / Math.max(fps, 0.01))}`;
      }
      if (!ProExport.cancel){ lab.textContent = 'Finalizing encode…'; bar.style.width = '99%'; }
    } else {
      lab.textContent = 'Encoding audio…'; bar.style.width = '50%';
    }

    /* 4 — finish */
    const res = await D.proExportFinish();
    State.useProxies = prevProxies;
    closeModal();
    ProExport.running = false;
    if (res.cancelled || ProExport.cancel){ UI.toast('Export cancelled'); return; }
    if (!res.ok){ UI.toast('Export failed: ' + (res.error || 'unknown error'), 'err'); return; }
    UI.dialog({
      title: '✅ Export complete',
      body: `<p><b>${fmt.label}</b></p>
             <p class="fx-note">${outPath}<br>${(res.size / 1048576).toFixed(1)} MB · ${Util.fmtDur(dur)}</p>`,
      ok: 'Show in folder', cancelText: 'Close',
      onOk: () => D.showItem(outPath)
    });
  } catch(err){
    State.useProxies = prevProxies;
    closeModal();
    ProExport.running = false;
    try { await D.proExportCancel(); await D.proExportFinish(); } catch(e){}
    if (err && err.cancelled) UI.toast('Export cancelled');
    else { console.error(err); UI.toast('Export error: ' + (err && (err.fatal || err.message) || err), 'err'); }
  }
}

/* ================= headless CLI render ================= */
ProExport.headless = async function(job){
  const P = State.project;
  const fmt = FORMATS.find(f => f.id === job.format) || FORMATS[0];
  const q = QUALITIES.find(x => x.id === job.quality) || QUALITIES[1];
  const inT  = job.range ? job.range[0] : 0;
  const outT = job.range ? job.range[1] : State.seqDuration();
  const dur = outT - inT;
  if (dur < 0.1){ D.cliDone({ ok: false, error: 'empty range' }); return; }

  const prevProxies = State.useProxies;
  State.useProxies = false;
  try {
    let audioPath = null;
    const jobs = audibleClips(inT, outT);
    D.cliProgress('mixing audio…');
    if (jobs.length){
      const wav = await renderWavMix(inT, outT, jobs);
      if (wav){
        const r = await D.proExportAudio({ buffer: wav.buffer, sampleRate: wav.sampleRate });
        if (r && r.ok) audioPath = r.path;
      }
    }
    const start = await D.proExportStart({
      format: fmt.id, quality: q, fps: P.fps, width: P.width, height: P.height,
      outPath: job.out, audioPath
    });
    if (!start.ok){ D.cliDone({ ok: false, error: start.error }); return; }

    if (fmt.video){
      const frames = Math.max(1, Math.round(dur * P.fps));
      const t0 = performance.now();
      for (let i = 0; i < frames; i++){
        await Engine.renderReady(inT + i / P.fps);
        const blob = await new Promise(r => Engine.program.toBlob(r, 'image/jpeg', 0.93));
        const buf = await blob.arrayBuffer();
        const w = await D.proExportFrame(buf);
        if (!w.ok){ D.cliDone({ ok: false, error: w.error || 'pipe error' }); return; }
        if (i % Math.max(1, Math.round(frames / 40)) === 0 || i === frames - 1){
          const pct = ((i + 1) / frames * 100).toFixed(0);
          const fps = ((i + 1) / ((performance.now() - t0) / 1000)).toFixed(1);
          D.cliProgress(`frame ${i + 1}/${frames} (${pct}%) — ${fps} fps`);
        }
      }
    }
    const res = await D.proExportFinish();
    State.useProxies = prevProxies;
    D.cliDone(res);
  } catch(err){
    State.useProxies = prevProxies;
    try { await D.proExportCancel(); await D.proExportFinish(); } catch(e){}
    D.cliDone({ ok: false, error: String(err && err.message || err) });
  }
};

})();
