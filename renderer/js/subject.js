/* ApolloCut — subject detection (fully local, no models, no cloud).
   Fuses two priors on the same low-res frames the analyzers already sample:
     1. skin-tone saliency blob (YCbCr range, connected-component, head-biased centroid)
        → finds people in STATIC shots too (talking heads, presenters)
     2. motion-difference centroid (frame diff)
        → dominates whenever real motion exists
   Returns {cx, cy, conf, kind:'motion'|'person'|'none'} in SOURCE pixel space. */
'use strict';
const Subject = {};
window.Subject = Subject;

function skinMask(id){
  const d = id.data, w = id.width, h = id.height;
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++){
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y < 60 || y > 245) continue;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) m[p] = 1;
  }
  return m;
}

/* coarse occupancy grid + connected components → best person-ish blob */
Subject.center = function(id, prev, srcW, srcH){
  // motion first (cheap, strong when present)
  const mo = window.Analyze ? Analyze.motionCentroid(id, prev, srcW, srcH) : null;
  if (mo && mo.energy > 0.006){
    return { cx: mo.cx, cy: mo.cy, conf: Math.min(1, mo.energy * 60), kind: 'motion' };
  }

  const w = id.width, h = id.height;
  const mask = skinMask(id);
  const gw = 24, gh = 18;                     // grid cells
  const cw = Math.max(1, w / gw) | 0, ch = Math.max(1, h / gh) | 0;
  const cell = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++){
    for (let x = 0; x < gw; x++){
      let hit = 0, tot = 0;
      for (let yy = y * ch; yy < Math.min(h, (y + 1) * ch); yy++){
        const row = yy * w;
        for (let xx = x * cw; xx < Math.min(w, (x + 1) * cw); xx++){ tot++; if (mask[row + xx]) hit++; }
      }
      cell[y * gw + x] = tot ? hit / tot : 0;
    }
  }
  // BFS components on cells ≥ 30% skin, 8-connectivity
  const seen = new Uint8Array(gw * gh);
  const blobs = [];
  for (let i = 0; i < gw * gh; i++){
    if (seen[i] || cell[i] < 0.3) continue;
    const q = [i]; seen[i] = 1;
    let minx = gw, miny = gh, maxx = 0, maxy = 0, cells = 0, sum = 0;
    while (q.length){
      const c = q.pop(); const cx0 = c % gw, cy0 = (c / gw) | 0;
      cells++; sum += cell[c];
      if (cx0 < minx) minx = cx0; if (cx0 > maxx) maxx = cx0;
      if (cy0 < miny) miny = cy0; if (cy0 > maxy) maxy = cy0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        if (!dx && !dy) continue;
        const nx = cx0 + dx, ny = cy0 + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const k = ny * gw + nx;
        if (!seen[k] && cell[k] >= 0.3){ seen[k] = 1; q.push(k); }
      }
    }
    if (cells >= 3) blobs.push({ minx, miny, maxx, maxy, cells, score: cells * (sum / cells) });
  }
  if (!blobs.length) return { cx: srcW / 2, cy: srcH / 2, conf: 0, kind: 'none' };

  blobs.sort((a, b) => b.score - a.score);
  const bx = blobs[0];
  const bw = (bx.maxx - bx.minx + 1) * (srcW / gw), bh = (bx.maxy - bx.miny + 1) * (srcH / gh);
  const aspect = bw / Math.max(1, bh);
  if (aspect < 0.15 || aspect > 6) return { cx: srcW / 2, cy: srcH / 2, conf: 0, kind: 'none' };
  // head-bias: face lives in the upper third of a person blob
  const cx = (bx.minx + 0.5 + (bx.maxx - bx.minx) / 2) * (srcW / gw);
  const cy = (bx.miny + 0.5 + (bx.maxy - bx.miny) * 0.33) * (srcH / gh);
  const areaF = bx.cells / (gw * gh);
  return { cx, cy, conf: Math.min(1, areaF * 9 + 0.25), kind: 'person' };
};

/* convenience: same call-signature as the motion sampler callbacks expect */
Subject.probe = function(id, prev, srcW, srcH){ return Subject.center(id, prev, srcW, srcH); };
