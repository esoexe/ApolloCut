/* ApolloCut — shared scene-graph builder.
   One source of truth for "what is visible at time t" used by BOTH render engines
   (Canvas2D + WebGL2) and by export/renderReady — so preview and output always match.
   Handles: track order, hidden tracks, adjustment-layer accumulation, track mattes,
   multicam angle resolution and nested sequences (recursion). */
'use strict';
const Graph = {};
window.Graph = Graph;

/* ---- time mapping into a nested sequence clip ---- */
Graph.nestedTime = function(clip, t){
  const d = Graph.clipSeqDuration(clip);
  return Util.clamp(clip.offset + (t - clip.start) * clip.speed, 0, Math.max(0, d - 0.001));
};

Graph.clipSeqDuration = function(clip){
  if (clip.type !== 'seq' || !window.Nested) return clip.duration;
  return Nested.durationOf(clip.seqId) || clip.duration;
};

/* resolve which media + source time a clip shows at time t (multicam-aware) */
Graph.srcOf = function(clip, t){
  const tl = t - clip.start;
  if (clip.mc && window.Multicam){
    const r = Multicam.resolveVideo(clip, tl);
    if (r) return r;
  }
  const media = clip.mediaId ? Media.get(clip.mediaId) : null;
  if (!media) return null;
  return { media, srcT: Util.clamp(clip.offset + tl * clip.speed, 0, Math.max(0, (media.duration || 0) - 0.03)) };
};

/* audio role of a clip (multicam : dedicated audio angle) */
Graph.audioOf = function(clip, t){
  const tl = t - clip.start;
  if (clip.mc && window.Multicam){
    const r = Multicam.resolveAudio(clip, tl);
    if (r) return r;
  }
  const media = clip.mediaId ? Media.get(clip.mediaId) : null;
  if (!media || media.type === 'image') return null;
  return { media, srcT: Util.clamp(clip.offset + tl * clip.speed, 0, Math.max(0, (media.duration || 0) - 0.03)), gain: 1 };
};

/* ---- adjustment accumulation (shared, exact same math as renderer.js) ---- */
function envLocal(clip, tl){
  let a = 1;
  if (clip.fadeIn > 0 && tl < clip.fadeIn) a = tl / clip.fadeIn;
  const dr = clip.start + clip.duration - tl;
  if (clip.fadeOut > 0 && dr < clip.fadeOut) a = Math.min(a, dr / clip.fadeOut);
  return Util.clamp(a, 0, 1);
}

Graph.adjustments = function(vtracks, t){
  const adj = new Array(vtracks.length).fill(null);
  let cur = null;
  for (let i = 0; i < vtracks.length; i++){
    adj[i] = cur;
    const tr = vtracks[i];
    if (tr.hidden) continue;
    const ac = tr.clips.find(c => c.type === 'adjustment' && t >= c.start && t < c.start + c.duration);
    if (ac){
      const tl = t - ac.start;
      const s = Util.clamp(ac.opacity / 100, 0, 1) * envLocal(ac, tl);
      if (!cur) cur = { b:100, c:100, s:100, h:0, g:0, se:0, bl:0 };
      cur.b  *= Util.lerp(100, State.valueAt(ac, 'brightness', tl), s) / 100;
      cur.c  *= Util.lerp(100, State.valueAt(ac, 'contrast', tl), s) / 100;
      cur.s  *= Util.lerp(100, State.valueAt(ac, 'saturate', tl), s) / 100;
      cur.h  += Util.lerp(0, State.valueAt(ac, 'hue', tl), s);
      cur.g   = Math.max(cur.g, Util.lerp(0, State.valueAt(ac, 'grayscale', tl), s));
      cur.se  = Math.max(cur.se, Util.lerp(0, State.valueAt(ac, 'sepia', tl), s));
      cur.bl += Util.lerp(0, State.valueAt(ac, 'blur', tl), s);
    }
  }
  return adj;
};

function activeClip(tr, t){
  return tr.clips.find(c => c.type !== 'adjustment' && t >= c.start && t < c.start + c.duration);
}

/* ---- the draw list: bottom → top, matching the old loop ----
   opts.supportsMatte=false → ignore matte property (2D engine), keep matte clips visible. */
Graph.build = function(tracks, t, opts){
  opts = opts || {};
  const vtracks = tracks.filter(x => x.type === 'video');
  const adj = Graph.adjustments(vtracks, t);
  const supportMatte = !!opts.supportsMatte;

  // map matte relationships
  const matteSrc = new Set();
  const matteOf = new Map();   // clipId -> {clip, mode}
  if (supportMatte){
    vtracks.forEach((tr, i) => {
      if (tr.hidden) return;
      const c = activeClip(tr, t);
      if (!c || !c.matte || c.matte === 'off') return;
      const above = i + 1 < vtracks.length ? activeClip(vtracks[i + 1], t) : null;
      if (above && vtracks[i + 1] && !vtracks[i + 1].hidden){
        matteOf.set(c.id, { clip: above, mode: c.matte });
        matteSrc.add(above.id);
      }
    });
  }

  const ops = [];
  for (let i = vtracks.length - 1; i >= 0; i--){
    const tr = vtracks[i];
    if (tr.hidden) continue;
    const c = activeClip(tr, t);
    if (!c) continue;
    if (matteSrc.has(c.id)){
      // the matte source still enters the op list but flagged — engines may skip direct draw
      continue;
    }
    const m = matteOf.get(c.id);
    ops.push({ clip: c, adj: adj[i], matte: m || null, track: tr });
  }
  return ops;
};

/* ---- audio jobs for the offline export mix (recursive, multicam-aware) ----
   Normalized shape: { clip, media, start, end(ROOT timeline), speed(effective),
   g(rootT)->gain incl envelopes+track mutes+nested gains, srcAt(rootT)->source sec } */
Graph.audioJobs = function(tracks, t0, t1){
  const jobs = [];
  const ident = x => x;
  const walk = (trs, toRoot, fromRoot, gainMul, mutedChain, spd, depth) => {
    if (depth > 4) return;
    for (const tr of trs){
      const muted = mutedChain || !!tr.muted;
      for (const clip of tr.clips){
        const cs = toRoot(clip.start), ce = toRoot(clip.start + clip.duration);
        const a = Math.min(cs, ce), b = Math.max(cs, ce);
        if (b <= t0 || a >= t1) continue;

        const envAt = rt => {
          const lt = fromRoot(rt) - clip.start;
          return (State.valueAt(clip, 'volume', lt) / 100) * (window.Engine ? Engine.env(clip, lt) : 1);
        };

        if (clip.type === 'seq' && window.Nested){
          const inner = Nested.tracksOf(clip.seqId);
          if (!inner) continue;
          const sp = clip.speed || 1;
          const toRoot2 = it => toRoot(clip.start + (it - clip.offset) / sp);
          const fromRoot2 = rt => clip.offset + (fromRoot(rt) - clip.start) * sp;
          walk(inner, toRoot2, fromRoot2, rt => gainMul(rt) * envAt(rt), muted, spd * sp, depth + 1);
          continue;
        }
        if (muted) continue;

        if (clip.mc && window.Multicam){
          const ang = Multicam.audioAngle(clip);
          const media = ang && Media.get(ang.id);
          if (!media || media.offline) continue;
          jobs.push({
            clip, media, start: a, end: b,
            speed: Util.clamp(clip.speed * spd, 0.0625, 16),
            g: rt => Util.clamp(envAt(rt) * gainMul(rt) * (window.Engine ? Engine.master : 1), 0, 4),
            srcAt: rt => Util.clamp((ang.off || 0) + clip.offset + (fromRoot(rt) - clip.start) * clip.speed, 0, 1e9)
          });
          continue;
        }

        const media = clip.mediaId ? Media.get(clip.mediaId) : null;
        if (!media || media.offline || media.type === 'image') continue;
        jobs.push({
          clip, media, start: a, end: b,
          speed: Util.clamp(clip.speed * spd, 0.0625, 16),
          g: rt => Util.clamp(envAt(rt) * gainMul(rt) * (window.Engine ? Engine.master : 1), 0, 4),
          srcAt: rt => Util.clamp(clip.offset + (fromRoot(rt) - clip.start) * clip.speed, 0, 1e9)
        });
      }
    }
  };
  walk(tracks, ident, ident, () => 1, false, 1, 0);
  return jobs;
};

/* ---- media elements that must be seek-ready to draw frame t (renderReady / GL) ---- */
Graph.mediaJobs = function(tracks, t, opts, depth){
  depth = depth || 0;
  const ops = Graph.build(tracks, t, opts);
  const seen = new Map();
  for (const op of ops){
    addClipJobs(op.clip, t, seen);
    if (op.matte) addClipJobs(op.matte.clip, t, seen);
  }
  return [...seen.values()];
  function addClipJobs(clip, tt, out){
    const tl = tt - clip.start;
    if (tl < 0 || tl >= clip.duration) return;
    if (clip.type === 'seq' && window.Nested && depth < 4){
      const inner = Nested.tracksOf(clip.seqId);
      if (!inner) return;
      const nt = Graph.nestedTime(clip, tt);
      for (const j of Graph.mediaJobs(inner, nt, opts, depth + 1)) out.set(j.media.id, j);
      return;
    }
    const r = Graph.srcOf(clip, tt);
    if (r && r.media && r.media.el) out.set(r.media.id, { media: r.media, src: r.srcT });
    if (clip.mc && window.Multicam){
      const ar = Graph.audioOf(clip, tt);
      if (ar && ar.media && ar.media.el) out.set(ar.media.id, { media: ar.media, src: ar.srcT });
    }
  }
};
