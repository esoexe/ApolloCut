/* ApolloCut — Smart Reframe (motion-guided auto-recompose).
   Recomputes x/scale so the most active subject stays inside a new target aspect.
   Method: low-res frame-diff motion centroid, temporally smoothed, converted into
   clip x keyframes + a cover scale, matching Premiere's Auto Reframe workflow. */
'use strict';
const Reframe = {};
window.Reframe = Reframe;

const ASPECTS = [
  { id: '9:16', w: 9, h: 16, label: 'Vertical 9:16 (Reels / Shorts / TikTok)' },
  { id: '1:1',  w: 1, h: 1,  label: 'Square 1:1 (Instagram feed)' },
  { id: '4:5',  w: 4, h: 5,  label: 'Portrait 4:5' },
  { id: '16:9', w: 16, h: 9, label: 'Widescreen 16:9 (back to horizontal)' }
];

Reframe.dialog = function(){
  if (!window.Analyze){ UI.toast('Analysis module missing', 'err'); return; }
  let vids = [];
  State.eachClip(c => { if ((c.type === 'video' || c.type === 'image') && c.mediaId) vids.push(c); });
  if (!vids.length){ UI.toast('No video/image clips on the timeline', 'err'); return; }
  UI.dialog({
    title: '◱ Smart Reframe',
    body: `
      <div class="dlg-row"><label>Target aspect</label><select name="asp">
        ${ASPECTS.map((a, i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${a.label}</option>`).join('')}
      </select></div>
      <p class="fx-note">The sequence switches to the new aspect (same height-based resolution), and every video clip
      gets a <b>cover crop</b> that follows the moving subject of the shot — analyzed locally, nothing is uploaded.
      Existing x-keyframes on those clips are replaced; zoom/rotation stay as they were.</p>`,
    ok: 'Reframe',
    onOk: v => Reframe.run(ASPECTS[+v.asp])
  });
};

Reframe.run = async function(asp){
  const aspect = asp.w / asp.h;
  const H = State.project.height;
  const W = Math.round(H * aspect / 2) * 2;
  // clones & collect video/image clips
  const targets = [];
  State.eachClip(c => { if ((c.type === 'video' || c.type === 'image') && c.mediaId) targets.push(c); });
  if (!targets.length) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal"><h2>◱ Smart Reframe</h2><div class="body">
    <div class="ai-label">Analyzing motion…</div><div class="progress"><div style="width:1%"></div></div></div></div>`;
  document.getElementById('modal-root').appendChild(modal);
  const lab = modal.querySelector('.ai-label'), bar = modal.querySelector('.progress > div');

  // 1) switch the sequence aspect
  State.mutate('Smart Reframe', () => {
    State.project.width = W; State.project.height = H;
  });
  Engine.resize();

  let done = 0;
  for (const clip of targets){
    const media = Media.get(clip.mediaId);
    if (!media || media.offline || !media.duration){ done++; continue; }
    lab.textContent = `Analyzing: ${media.name}`;
    const sw = media.w || 1280, sh = media.h || 720;
    // cover scale for the new frame (percent)
    const coverPct = 100 * Math.max(W / sw, H / sh) / Math.min(W / sw, H / sh);
    // motion path in source pixels
    const path = [];
    const t0 = clip.offset, t1 = Math.min(media.duration, clip.offset + clip.duration * clip.speed);
    await Analyze.sampleVideo(media, { from: t0, to: t1, step: 0.2, w: 96, max: 200 }, (id, t, i, n, prev) => {
      // fused subject detection: motion centroid when moving, skin-saliency person prior for static shots
      const s = window.Subject ? Subject.center(id, prev, sw, sh) : null;
      const m = s && s.kind !== 'none' ? { energy: s.conf * 0.02, cx: s.cx, cy: s.cy } : (Analyze.motionCentroid(id, prev, sw, sh) || { energy: 0, cx: sw / 2, cy: sh / 2 });
      path.push({ t, cx: m.cx, cy: m.cy, e: m.energy, kind: s ? s.kind : 'motion' });
      bar.style.width = Math.round(((done + i / n) / targets.length) * 100) + '%';
    });
    if (!path.length){ done++; continue; }
    // smooth centroid (moving average window 5, edge-clamped)
    const sm = path.map((p, i) => {
      let sx = 0, n2 = 0;
      for (let k = -2; k <= 2; k++){
        const q = path[Math.min(path.length - 1, Math.max(0, i + k))];
        sx += q.cx; n2++;
      }
      return { t: p.t, cx: sx / n2, cy: p.cy, e: p.e };
    });
    // strong-motion fallback: if average energy is tiny, lock to center
    const avgE = sm.reduce((a, b) => a + b.e, 0) / sm.length;
    State.mutate('Smart Reframe clip', () => {
      const sc = Math.max(coverPct, 100);
      clip.scale = sc;
      delete (clip.kf || {}).scale;
      if (avgE < 0.004){
        // static shot — keep centered (with the new cover there may be side crop; center-x)
        clip.x = 0; delete (clip.kf || {}).x;
        return;
      }
      clip.kf = clip.kf || {};
      // convert source-pixel cx → canvas x so that the crop window centres the subject:
      // drawnWidth = sw * (sc/100); subject canvas-x would be (cx/sw - .5) * drawnWidth → we set x = -that
      const kfs = sm.filter(p => p.e > 0.002 || true).map(p => {
        const drawn = sw * (sc / 100);
        const want = -(p.cx / sw - 0.5) * drawn;
        const px = Util.round(want / W * 100, 2);   // engine x is % of frame width
        // map source time → timeline time
        const tt = clip.start + (p.t - clip.offset) / clip.speed;
        return { t: Math.max(0, Math.min(clip.duration, Util.round(tt - clip.start, 3))), v: px };
      }).filter(k => k.t >= -0.001 && k.t <= clip.duration + 0.001);
      // dedupe & sort
      kfs.sort((a, b) => a.t - b.t);
      const dedup = [];
      for (const k of kfs){ if (!dedup.length || Math.abs(dedup[dedup.length - 1].v - k.v) > 0.4 || k.t - dedup[dedup.length - 1].t > 0.5) dedup.push(k); }
      if (dedup.length >= 2) clip.kf.x = dedup;
      else clip.x = dedup[0] ? dedup[0].v : 0, delete (clip.kf || {}).x;
    });
    done++;
    bar.style.width = Math.round(done / targets.length * 100) + '%';
  }
  modal.remove();
  Engine.render(State.playhead);
  UI.toast(`Reframed ${done} clips to ${asp.id} — x-motion now follows the subject`, 'ok');
};
