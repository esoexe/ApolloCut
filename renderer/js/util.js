/* ApolloCut — small utilities */
(function(){
'use strict';
const Util = {};

Util.uid = (p='id') => p+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
Util.clamp = (v,a,b) => Math.min(b, Math.max(a, v));
Util.lerp = (a,b,t) => a+(b-a)*t;
Util.round = (v,d=2) => { const m = Math.pow(10,d); return Math.round(v*m)/m; };
Util.dpr = () => window.devicePixelRatio || 1;
Util.deepClone = o => JSON.parse(JSON.stringify(o));

const p2 = n => String(n).padStart(2,'0');

Util.timecode = (t, fps=30) => {
  t = Math.max(0, t);
  const h = Math.floor(t/3600), m = Math.floor(t/60)%60, s = Math.floor(t)%60;
  const f = Math.floor((t - Math.floor(t))*fps + 1e-6);
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
};

/* accepts "ss", "ss.f", "mm:ss", "hh:mm:ss", "hh:mm:ss:ff" */
Util.parseTime = (str, fps=30) => {
  str = String(str||'').trim().replace(',', '.').replace(/;/g, ':');
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN) || parts.length < 2 || parts.length > 4) return null;
  let sec = 0;
  if (parts.length === 2) sec = parts[0]*60 + parts[1];
  else if (parts.length === 3) sec = parts[0]*3600 + parts[1]*60 + parts[2];
  else sec = parts[0]*3600 + parts[1]*60 + parts[2] + parts[3]/fps;
  return sec;
};

Util.fmtDur = s => {
  if (s == null || isNaN(s)) return '—';
  if (s < 60) return s.toFixed(1)+'s';
  const m = Math.floor(s/60);
  return `${m}m ${p2(Math.round(s%60))}s`;
};

Util.esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

Util.debounce = (fn, ms) => {
  let id;
  const d = (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(id);
  return d;
};

Util.download = (name, blob) => {
  const a = document.createElement('a');
  a.href = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); if (typeof blob !== 'string') URL.revokeObjectURL(a.href); }, 8000);
};

/* contain-fit */
Util.fit = (sw, sh, dw, dh) => {
  if (!sw || !sh) return { w: dw, h: dh };
  const s = Math.min(dw/sw, dh/sh);
  return { w: sw*s, h: sh*s };
};

/* audio peaks from an AudioBuffer */
Util.peaks = (buffer, buckets=240) => {
  const ch = buffer.getChannelData(0);
  const per = Math.max(1, Math.floor(ch.length/buckets));
  const out = new Array(buckets);
  for (let i=0;i<buckets;i++){
    let m = 0;
    const o = i*per, e = Math.min(ch.length, o+per);
    for (let j=o;j<e;j+=Math.max(1,Math.floor(per/64))){ const v = Math.abs(ch[j]); if (v>m) m=v; }
    out[i] = m;
  }
  return out;
};

window.Util = Util;
})();
