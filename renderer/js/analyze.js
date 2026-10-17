/* ApolloCut — local media analysis toolkit (no cloud, no uploads).
   Provides: sequential low-res frame sampling (motion centroid), and
   audio envelope decode + cross-correlation offset estimation (multicam sync). */
'use strict';
const Analyze = {};
window.Analyze = Analyze;

function urlFor(media){
  if (media.url) return media.url;
  if (media.path && window.desktopUrlFromPath) return window.desktopUrlFromPath(media.path);
  return null;
}

/* sample frames of a video at low resolution.
   cb(ImageData, tSeconds, i, n) — cb may return false to stop early. */
Analyze.sampleVideo = function(media, opts, cb){
  opts = opts || {};
  const w = opts.w || 128;
  const step = opts.step || 0.25;
  const from = Math.max(0, opts.from || 0);
  const to = Math.min(media.duration || 0, opts.to == null ? (media.duration || 0) : opts.to);
  return new Promise(resolve => {
    const url = urlFor(media);
    if (!url || to - from <= 0){ resolve(0); return; }
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    let done = false;
    const finish = n => { if (done) return; done = true; v.removeAttribute('src'); try { v.load(); } catch(e){} resolve(n); };
    v.addEventListener('error', () => finish(0));
    v.src = url;
    const n = Math.max(1, Math.min(opts.max || 400, Math.round((to - from) / step)));
    let i = 0, prev = null;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const next = () => {
      if (i >= n){ finish(i); return; }
      const t = from + (to - from) * (i / Math.max(1, n - 1));
      const onSeek = () => {
        v.removeEventListener('seeked', onSeek);
        try {
          const vw = v.videoWidth || 0, vh = v.videoHeight || 0;
          if (!vw){ i++; return next(); }
          cv.width = w; cv.height = Math.max(2, Math.round(w * vh / vw));
          ctx.drawImage(v, 0, 0, cv.width, cv.height);
          const id = ctx.getImageData(0, 0, cv.width, cv.height);
          const r = cb(id, t, i, n, prev, cv.width, cv.height);
          prev = id;
          if (r === false){ finish(i + 1); return; }
        } catch(e){ /* unreadable frame */ }
        i++;
        next();
      };
      v.addEventListener('seeked', onSeek);
      try { v.currentTime = t; } catch(e){ v.removeEventListener('seeked', onSeek); i++; next(); }
    };
    v.addEventListener('loadeddata', next);
  });
};

/* weighted motion-centroid of frame diff vs previous sample (in SOURCE pixels) */
Analyze.motionCentroid = function(id, prev, srcW, srcH){
  if (!prev) return null;
  const d = id.data, p = prev.data, w = id.width, h = id.height;
  let sx = 0, sy = 0, sw = 0, e = 0;
  for (let y = 0; y < h; y += 2){
    for (let x = 0; x < w; x += 2){
      const k = (y * w + x) * 4;
      const dr = Math.abs(d[k] - p[k]) + Math.abs(d[k+1] - p[k+1]) + Math.abs(d[k+2] - p[k+2]);
      if (dr > 45){
        sx += x * dr; sy += y * dr; sw += dr; e += dr;
      }
    }
  }
  if (sw <= 0) return { energy: 0, cx: srcW / 2, cy: srcH / 2 };
  const norm = (w * h) / (srcW * srcH); // careful: we iterate in sample space — map back
  const cx = (sx / sw) / w * srcW, cy = (sy / sw) / h * srcH;
  const energy = e / ((w * h / 4) * 765); // fraction of max possible diff
  return { energy, cx, cy };
};

/* ---- audio: decode + coarse envelope + cross-correlation ---- */
async function fetchAB(media){
  if (media._ab) return media._ab;
  const url = urlFor(media);
  if (!url) throw new Error('no url');
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + r.status);
  const buf = await r.arrayBuffer();
  media._ab = buf;
  return buf;
}
async function decodeMono(media, maxSec){
  const ab = await fetchAB(media);
  const octx = new OfflineAudioContext(1, 44100, 44100);
  const audio = await octx.decodeAudioData(ab.slice(0));
  const dur = Math.min(maxSec || 30, audio.duration);
  const n = Math.floor(dur * 44100);
  const ch = audio.getChannelData(0);
  const env = [];
  const win = 2205; // 50 ms
  for (let i = 0; i < n; i += win){
    let s = 0;
    const e = Math.min(i + win, n);
    for (let j = i; j < e; j++) s += ch[j] * ch[j];
    env.push(Math.sqrt(s / (e - i)));
  }
  return { env, winSec: win / 44100 };
}

/* offset (seconds) to ADD to b so that b aligns with a (a = master).
   Positive → media b starts LATER in real time and must be delayed... practically we
   return the shift such that b_shifted(t + shift) ≈ a(t). */
Analyze.audioOffset = async function(a, b, maxSec){
  const maxLag = maxSec || 5;
  const A = await decodeMono(a, 40), B = await decodeMono(b, 40);
  const la = A.env.length, lb = B.env.length;
  const winSec = A.winSec;
  const L = Math.min(600, la, lb);
  if (L < 20) return null;
  const lagMax = Math.min(Math.round(maxLag / winSec), L - 10);
  let best = 0, bestV = -1e18;
  for (let lag = -lagMax; lag <= lagMax; lag++){
    let num = 0, da = 0, db = 0, cnt = 0;
    for (let i = 0; i < L; i++){
      const j = i - lag;
      if (j < 0 || j >= lb) continue;
      const x = A.env[i] - 0.0001, y = B.env[j] - 0.0001;
      num += x * y; da += x * x; db += y * y; cnt++;
    }
    const v = cnt > 5 ? num / Math.sqrt(da * db + 1e-9) : -1;
    if (v > bestV){ bestV = v; best = lag; }
  }
  // lag>0 → b(j) matches a(i=lag+j) → b's content is EARLIER: to view in sync with master,
  // b's playback must start at master_time - lag*winSec → offset in our model = lag*winSec.
  const conf = bestV;
  if (conf < 0.25) return null;     // couldn't correlate — fall back to 0 offset
  return best * winSec;
};

/* decode loudness envelope for the silence-killer UI or sync displays */
Analyze.loudness = async function(media, maxSec){
  const A = await decodeMono(media, maxSec || 60);
  return A;
};
