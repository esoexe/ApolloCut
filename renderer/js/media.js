/* ApolloCut — media import, probing, thumbnails, waveforms, audio graph */
(function(){
'use strict';
const Media = {};
window.Media = Media;

let actx = null;
Media.ctx = () => {
  try {
    if (!actx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume().catch(()=>{});
    return actx;
  } catch(e){ return null; }
};

Media.get = id => State.pool.get(id);

const VID_EXT = ['mp4','mov','mkv','webm','avi','m4v','m2ts'];
const AUD_EXT = ['mp3','wav','ogg','oga','m4a','aac','flac','weba'];
const IMG_EXT = ['png','jpg','jpeg','gif','webp','bmp','svg','avif'];

function typeOf(file){
  if (file.type){
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('image/')) return 'image';
  }
  const e = (file.name.split('.').pop() || '').toLowerCase();
  if (VID_EXT.includes(e)) return 'video';
  if (AUD_EXT.includes(e)) return 'audio';
  if (IMG_EXT.includes(e)) return 'image';
  return null;
}

/* ---------- import ---------- */
Media.importFiles = async function(files){
  // Desktop: prefer real file paths — big files stream from disk instead of
  // being copied into renderer memory.
  if (window.desktop && window.desktop.isDesktop && window.desktopUrlFromPath){
    const mapped = [...files].map(f => {
      let p = null;
      try { p = window.desktop.getPathForFile(f) || null; } catch(e){}
      return p ? { path: p, name: f.name, size: f.size || 0 } : null;
    });
    if (mapped.length && mapped.every(Boolean)) return Media.importPaths(mapped);
  }
  const list = [...files];
  let added = 0;
  for (const f of list){
    try { await importOne(f); added++; }
    catch(err){ console.warn(err); if (window.UI) UI.toast('Could not import: ' + f.name, 'err'); }
  }
  if (added){
    Events.emit('pool');
    State.markDirty();
    if (window.UI) UI.toast(`Imported ${added} file${added>1?'s':''}`, 'ok');
  }
  return added;
};

/* path-based import (desktop) */
/* create an offline placeholder (EDL import, missing sources) — relinkable later */
Media.addOffline = function(o){
  let m = [...State.pool.values()].find(x => x.name === o.name && x.type === o.type);
  if (m) return m;
  m = {
    id: Util.uid('m'), name: o.name, type: o.type,
    url: null, path: o.path || null, size: 0,
    duration: o.duration || 6, w: o.w || 0, h: o.h || 0,
    thumb: [], wave: null, offline: true, created: Date.now()
  };
  State.pool.set(m.id, m);
  Events.emit('pool');
  return m;
};

Media.importPaths = async function(list){
  let added = 0;
  for (const it of list){
    try { await importPathMedia(it); added++; }
    catch(err){ console.warn(err); if (window.UI) UI.toast('Could not import: ' + it.name, 'err'); }
  }
  if (added){
    Events.emit('pool');
    State.markDirty();
    if (window.UI) UI.toast(`Imported ${added} file${added>1?'s':''}`, 'ok');
  }
  return added;
};

function kickExtras(media){
  if (media.type === 'video'){
    makeThumbs(media).then(()=>{ Events.emit('pool'); Events.emit('structure'); }).catch(()=>{});
    makeWave(media).then(()=>{ Events.emit('pool'); Events.emit('structure'); }).catch(()=>{});
  }
  if (media.type === 'audio'){
    makeWave(media).then(()=>{ Events.emit('pool'); Events.emit('structure'); }).catch(()=>{});
  }
}

async function importPathMedia(it){
  const type = typeOf({ name: it.name, type: '' });
  if (!type) throw new Error('unknown type');
  const url = window.desktopUrlFromPath(it.path);
  const offline = [...State.pool.values()].find(m => m.offline && m.name === it.name && m.type === type);
  if (offline){
    offline.url = url; offline.path = it.path; offline.size = it.size; offline.offline = false;
    await probe(offline);
    kickExtras(offline);
    Events.emit('structure'); Events.emit('pool');
    return offline;
  }
  const media = {
    id: Util.uid('md'), name: it.name, type, url, path: it.path,
    size: it.size, duration: type === 'image' ? 5 : 0,
    w: 0, h: 0, thumb: [], wave: null, offline: false
  };
  State.pool.set(media.id, media);
  await probe(media);
  Events.emit('pool');
  kickExtras(media);
  return media;
}

/* re-link an offline media entry to a path that exists on disk (desktop) */
Media.tryRelink = async function(media, p){
  try {
    const st = await window.desktop.stat(p);
    if (!st) return false;
    media.url = window.desktopUrlFromPath(p);
    media.path = p;
    media.size = st.size || media.size;
    media.offline = false;
    await probe(media);
    kickExtras(media);
    return true;
  } catch(e){ return false; }
};

async function importOne(file){
  const type = typeOf(file);
  if (!type) throw new Error('unknown type');
  const url = URL.createObjectURL(file);

  // relink an offline placeholder with the same name?
  const offline = [...State.pool.values()].find(m => m.offline && m.name === file.name && m.type === type);
  if (offline){
    offline.url = url; offline.size = file.size; offline.offline = false;
    await probe(offline);
    if (offline.type === 'video'){ makeThumbs(offline).then(()=>Events.emit('pool')).catch(()=>{}); makeWave(offline).then(()=>{Events.emit('pool');Events.emit('structure');}).catch(()=>{}); }
    if (offline.type === 'audio'){ makeWave(offline).then(()=>{Events.emit('pool');Events.emit('structure');}).catch(()=>{}); }
    Events.emit('structure'); Events.emit('pool');
    return offline;
  }
  const media = {
    id: Util.uid('md'), name: file.name, type, url,
    size: file.size, duration: type === 'image' ? 5 : 0,
    w: 0, h: 0, thumb: [], wave: null, offline: false
  };
  State.pool.set(media.id, media);
  await probe(media);
  Events.emit('pool');
  if (type === 'video'){
    makeThumbs(media).then(()=>{ Events.emit('pool'); Events.emit('structure'); }).catch(()=>{});
    makeWave(media).then(()=>{ Events.emit('pool'); Events.emit('structure'); }).catch(()=>{});
  }
  if (type === 'audio'){
    makeWave(media).then(()=>{ Events.emit('pool'); Events.emit('structure'); }).catch(()=>{});
  }
  return media;
}
Media.importOne = importOne;

function probe(media){
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('probe timeout')), 20000);
    if (media.type === 'image'){
      const img = new Image();
      img.onload = () => {
        clearTimeout(to);
        media.w = img.naturalWidth; media.h = img.naturalHeight;
        media.img = img;
        try {
          const c = document.createElement('canvas'); c.width = 160; c.height = 90;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#000'; ctx.fillRect(0,0,160,90);
          const f = Util.fit(media.w || 1, media.h || 1, 160, 90);
          ctx.drawImage(img, (160-f.w)/2, (90-f.h)/2, f.w, f.h);
          media.thumb = [c.toDataURL('image/jpeg', .72)];
        } catch(e){}
        resolve();
      };
      img.onerror = () => { clearTimeout(to); reject(new Error('image decode failed')); };
      img.src = media.url;
    } else {
      const el = document.createElement(media.type === 'video' ? 'video' : 'audio');
      el.preload = 'metadata';
      el.src = media.url;
      el.onloadedmetadata = () => {
        clearTimeout(to);
        media.duration = (el.duration && isFinite(el.duration)) ? el.duration : 0;
        media.w = el.videoWidth || 0; media.h = el.videoHeight || 0;
        media.el = el;
        el.preload = 'auto';
        resolve();
      };
      el.onerror = () => { clearTimeout(to); reject(new Error('media decode failed')); };
    }
  });
}
Media.probe = probe;

async function makeThumbs(media){
  if (!media.el || !media.duration) return;
  const el = media.el, W = 160, H = 90;
  const fr = [0.08, 0.5, 0.92];
  const out = [];
  for (const f of fr){
    await new Promise(res => {
      const done = () => { el.removeEventListener('seeked', done); res(); };
      el.addEventListener('seeked', done, { once:true });
      setTimeout(done, 1500); // don't hang
      try { el.currentTime = Math.min(media.duration - 0.05, media.duration * f); } catch(e){ done(); }
    });
    try {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
      if (el.readyState >= 2){
        const ft = Util.fit(el.videoWidth || 1, el.videoHeight || 1, W, H);
        ctx.drawImage(el, (W-ft.w)/2, (H-ft.h)/2, ft.w, ft.h);
      }
      out.push(c.toDataURL('image/jpeg', .62));
    } catch(e){}
  }
  media.thumb = out;
  try { el.currentTime = 0; } catch(e){}
}

async function makeWave(media){
  const ctx = Media.ctx();
  if (!ctx) return;
  const res = await fetch(media.url);
  const buf = await res.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  if (audio.duration <= 1800) media._ab = audio; // cache for pro-export mixing (memory guard)
  media.wave = Util.peaks(audio, 260);
}

/* ---------- removal ---------- */
Media.remove = function(id){
  const m = State.pool.get(id);
  if (!m) return;
  State.mutate('Remove Media', () => {
    State.project.tracks.forEach(t => { t.clips = t.clips.filter(c => c.mediaId !== id); });
    State.pool.delete(id);
    if (m.url && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
  });
  Events.emit('pool');
};

/* ---------- audio graph: element -> gain -> destination (+ export tap) ---------- */
Media.ensureGraph = function(media){
  if (!media || !media.el) return null;
  if (media._graph) return media._graph;
  const ctx = Media.ctx();
  if (!ctx) return null;
  try {
    const src = ctx.createMediaElementSource(media.el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(ctx.destination);
    media._graph = { src, gain };
    return media._graph;
  } catch(e){ console.warn('audio graph', e); return null; }
};

})();
