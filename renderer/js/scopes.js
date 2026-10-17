/* ApolloCut — broadcast scopes: waveform, RGB parade, vectorscope, histogram.
   Subsamples the program canvas into a small analysis buffer a few times a second. */
(function(){
'use strict';

const Scopes = { mode: 'waveform', timer: null };
window.Scopes = Scopes;

let canvas, ctx, small, sctx;
const SW = 160, SH = 90;

Scopes.init = function(){
  canvas = document.getElementById('scopes-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  small = document.createElement('canvas');
  small.width = SW; small.height = SH;
  sctx = small.getContext('2d', { willReadFrequently: true });
  document.querySelectorAll('#tab-scopes .scope-btn').forEach(b => {
    b.addEventListener('click', () => {
      Scopes.mode = b.dataset.mode;
      document.querySelectorAll('#tab-scopes .scope-btn').forEach(x => x.classList.toggle('active', x === b));
      Scopes.draw();
    });
  });
  Scopes.timer = setInterval(() => {
    const pane = document.getElementById('tab-scopes');
    if (!pane || pane.classList.contains('hidden')) return;
    Scopes.draw();
  }, 180);
};

function grab(){
  const src = Engine.program;
  if (!src || !src.width) return null;
  try {
    sctx.drawImage(src, 0, 0, SW, SH);
    return sctx.getImageData(0, 0, SW, SH).data;
  } catch(e){ return null; }
}

const GRID = '#2a2a36', TRACE = '#7dff9a';

function frame(){
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0a0a10'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++){ ctx.moveTo(0, H * i / 4 + .5); ctx.lineTo(W, H * i / 4 + .5); }
  ctx.moveTo(W/2 + .5, 0); ctx.lineTo(W/2 + .5, H);
  ctx.stroke();
  return { W, H };
}

function luma(r, g, b){ return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

Scopes.draw = function(){
  if (!canvas) return;
  const d = grab();
  if (!d) return;
  const { W, H } = frame();
  ctx.imageSmoothingEnabled = true;

  if (Scopes.mode === 'waveform'){
    const cols = new Array(SW).fill(0).map(() => ({ min: 255, max: 0, sum: 0, n: 0 }));
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++){
      const i = (y * SW + x) * 4;
      const L = luma(d[i], d[i+1], d[i+2]);
      const c = cols[x];
      if (L < c.min) c.min = L;
      if (L > c.max) c.max = L;
      c.sum += L; c.n++;
    }
    ctx.fillStyle = 'rgba(125,255,154,.16)';
    ctx.strokeStyle = TRACE;
    ctx.beginPath();
    for (let x = 0; x < SW; x++){
      const c = cols[x], X = x / SW * W;
      const yMax = H - (c.max / 255) * H, yMin = H - (c.min / 255) * H;
      ctx.fillRect(X - 0.5, yMax, W / SW + 1.5, Math.max(1, yMin - yMax));
      const ya = H - (c.sum / c.n / 255) * H;
      x === 0 ? ctx.moveTo(X, ya) : ctx.lineTo(X, ya);
    }
    ctx.stroke();
  }

  else if (Scopes.mode === 'parade'){
    const cols = ['#ff5b5b', '#5bff5b', '#5b6bff'];
    for (let x = 0; x < SW; x++){
      const acc = [0, 0, 0];
      for (let y = 0; y < SH; y++){
        const i = (y * SW + x) * 4;
        acc[0] += d[i]; acc[1] += d[i+1]; acc[2] += d[i+2];
      }
      const X = x / SW * W;
      for (let ch = 0; ch < 3; ch++){
        const v = acc[ch] / SH;
        ctx.fillStyle = cols[ch] + 'aa';
        ctx.fillRect(X - 0.5, H - (v / 255) * H, W / SW + 0.5, 2);
      }
    }
  }

  else if (Scopes.mode === 'vectorscope'){
    const cx = W/2, cy = H/2, R = Math.min(W, H)/2 - 6;
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // skin tone line (approx 11 o'clock)
    ctx.strokeStyle = '#4a4a5e';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - R * 0.5, cy - R * 0.85); ctx.stroke();
    ctx.fillStyle = 'rgba(160,220,255,.5)';
    for (let y = 0; y < SH; y += 2) for (let x = 0; x < SW; x += 2){
      const i = (y * SW + x) * 4;
      const r = d[i], g = d[i+1], b = d[i+2];
      const cb = (b - luma(r, g, b)) / 255, cr = (r - luma(r, g, b)) / 255;
      const px = cx + cr * R * 1.6, py = cy - cb * R * 1.6;
      if ((px - cx) ** 2 + (py - cy) ** 2 < R * R) ctx.fillRect(px, py, 1.4, 1.4);
    }
  }

  else if (Scopes.mode === 'histogram'){
    const bins = new Array(64).fill(0);
    for (let i = 0; i < d.length; i += 4) bins[Math.min(63, (luma(d[i], d[i+1], d[i+2]) / 256 * 64) | 0)]++;
    const max = Math.max(...bins, 1);
    ctx.fillStyle = 'rgba(125,255,154,.55)';
    for (let b = 0; b < 64; b++){
      const h = Math.pow(bins[b] / max, 0.5) * (H - 8);
      ctx.fillRect(b / 64 * W + 1, H - h, W / 64 - 2, h);
    }
    ctx.fillStyle = '#666a'; ctx.font = '9px monospace';
    ctx.fillText('0', 3, H - 2); ctx.fillText('255', W - 24, H - 2);
  }
};

})();
