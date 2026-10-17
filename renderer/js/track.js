/* ApolloCut — motion tracking (attach graphics to a moving subject).
   Select one VIDEO clip (the tracked source) plus an overlay clip (title/image) —
   the overlay gets x/y keyframes that follow the motion centroid of the source,
   evaluated in canvas space so it works through zoom/rotation via source transform. */
'use strict';
const MotionTrack = {};
window.MotionTrack = MotionTrack;

MotionTrack.dialog = function(){
  const sel = State.selectionClips();
  const vids = sel.filter(s => (s.clip.type === 'video' || s.clip.type === 'image') && s.clip.mediaId);
  const texts = sel.filter(s => s.clip.type === 'text' || (s.clip.type === 'image' && !vids.includes(s)));
  if (!vids.length){ UI.toast('Select the video clip to track (plus a title/image to stick on)', 'err'); return; }
  const src = vids[0];
  const allowed = sel.filter(s => s !== src && (s.clip.type === 'text' || s.clip.type === 'image'));
  if (!allowed.length){ UI.toast('Also select the title or image that should follow the motion', 'err'); return; }
  const fol = allowed[0];
  UI.dialog({
    title: '⌖ Motion Track',
    body: `<p class="fx-note">Track <b>${Util.esc((src.clip.label || (Media.get(src.clip.mediaId) || {}).name) || 'video')}</b>
      and attach <b>${Util.esc(fol.clip.label || 'overlay')}</b> to its moving subject.
      Analysis is local frame-difference (fast, private). The overlay gets smooth x/y keyframes.</p>
      <div class="dlg-row"><label>Smoothing</label><select name="sm">
        <option value="0.7">Light (snappy)</option><option value="0.85" selected>Medium</option><option value="0.94">Heavy (floaty)</option>
      </select></div>`,
    ok: 'Track',
    onOk: v => MotionTrack.run(src, fol, parseFloat(v.sm))
  });
};

MotionTrack.run = async function(src, fol, smooth){
  const media = Media.get(src.clip.mediaId);
  if (!media || media.offline){ UI.toast('Source is offline', 'err'); return; }
  const P = State.project;
  const sw = media.w || 1280, sh = media.h || 720;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal"><h2>⌖ Tracking motion…</h2><div class="body">
    <div class="ai-label">Sampling frames…</div><div class="progress"><div style="width:1%"></div></div></div></div>`;
  document.getElementById('modal-root').appendChild(modal);
  const bar = modal.querySelector('.progress > div'), lab = modal.querySelector('.ai-label');

  const path = [];
  const from = src.clip.offset, to = Math.min(media.duration, src.clip.offset + src.clip.duration * src.clip.speed);
  await Analyze.sampleVideo(media, { from, to, step: 1 / Math.max(8, P.fps / 3), w: 96, max: 300 }, (id, t, i, n, prev) => {
    const s = window.Subject ? Subject.center(id, prev, sw, sh) : null;
    const m = s && s.kind !== 'none' ? s : (Analyze.motionCentroid(id, prev, sw, sh) || { cx: sw / 2, cy: sh / 2 });
    path.push({ t: src.clip.start + (t - src.clip.offset) / src.clip.speed, cx: m.cx, cy: m.cy, e: s ? s.conf : 0 });
    bar.style.width = Math.round(i / n * 80) + '%';
  });
  if (path.length < 3){ modal.remove(); UI.toast('Track failed — not enough frames', 'err'); return; }

  // temporal EMA smoothing
  lab.textContent = 'Smoothing path…';
  let fx = path[0].cx, fy = path[0].cy;
  const pts = path.map(p => {
    fx = smooth * fx + (1 - smooth) * p.cx;
    fy = smooth * fy + (1 - smooth) * p.cy;
    return { t: p.t, x: fx, y: fy };
  });
  bar.style.width = '90%';

  // canvas-space conversion using the source clip's own transform at that time
  const clampT = Util.clamp(fol.clip.start, src.clip.start, src.clip.start + src.clip.duration);
  const kfs = [];
  for (const p of pts){
    if (p.t < fol.clip.start - 0.001 || p.t > fol.clip.start + fol.clip.duration + 0.001) continue;
    const tl = p.t - src.clip.start;
    const g = srcOf(src.clip, tl, P.width, P.height);
    // source-pixel (x,y) → canvas px using the g transform (contain-fit + scale + position)
    const sc = g.scale;
    const px = g.cx + (p.x / sw - 0.5) * g.dw;
    const py = g.cy + (p.y / sh - 0.5) * g.dh;
    kfs.push({ t: Util.round(p.t - fol.clip.start, 3), x: Util.round(px / P.width * 100, 2), y: Util.round(py / P.height * 100, 2) });
  }
  if (kfs.length < 2){ modal.remove(); UI.toast('Follower is outside the tracked range — overlap them on the timeline', 'err'); return; }

  State.mutate('Motion Track', () => {
    fol.clip.kf = fol.clip.kf || {};
    fol.clip.kf.x = kfs.map(k => ({ t: k.t, v: k.x }));
    fol.clip.kf.y = kfs.map(k => ({ t: k.t, v: k.y }));
  });
  modal.remove();
  Engine.render(State.playhead);
  UI.toast(`Tracked ${kfs.length} keyframes onto "${fol.clip.label || 'overlay'}"`, 'ok');
};

/* replicate the engine's frame placement math for a clip at local time tl */
function srcOf(clip, tl, W, H){
  const sx = State.valueAt(clip, 'x', tl), sy = State.valueAt(clip, 'y', tl);
  const sc = State.valueAt(clip, 'scale', tl) / 100;
  const media = clip.mediaId ? Media.get(clip.mediaId) : null;
  const sw = media ? media.w : W, sh = media ? media.h : H;
  const fit = Util.fit(sw || 1, sh || 1, W, H);
  return { scale: sc, cx: W / 2 + W * sx / 100, cy: H / 2 + H * sy / 100, dw: fit.w * sc, dh: fit.h * sc };
}
MotionTrack._srcOf = srcOf;
