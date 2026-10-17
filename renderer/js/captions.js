/* ApolloCut — captions: SRT/VTT parse & serialize, caption clips, export, burn-in hook. */
(function(){
'use strict';

const Captions = {};
window.Captions = Captions;

/* ---------------- parsing ---------------- */
function toSec(s){
  s = s.trim().replace(',', '.');
  const m = s.match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.](\d{1,3})/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + parseInt(m[2]) * 60 + parseFloat(m[3] + '.' + (m[4] || '0').padEnd(3, '0').slice(0, 3));
}
function toSrt(t){
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60;
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0');
}

Captions.parse = function(text){
  const cues = [];
  text = text.replace(/^\uFEFF/, '').replace(/WEBVTT[^\n]*(\n|$)/, '').trim();
  const blocks = text.split(/\n\s*\n/);
  for (const b of blocks){
    const lines = b.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let i = lines[0].match(/^\d+$/) ? 1 : 0;
    const tm = lines[i] && lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!tm) continue;
    cues.push({ start: toSec(tm[1]), end: toSec(tm[2]), text: lines.slice(i + 1).join('\n') });
  }
  return cues.filter(c => c.end > c.start);
};

Captions.serialize = function(cues){
  return cues.map((c, i) => `${i + 1}\n${toSrt(c.start)} --> ${toSrt(c.end)}\n${c.text}`).join('\n\n') + '\n';
};

/* caption styling (Premiere-style: bottom-anchored, boxed optional) */
Captions.STYLE = {
  fontFamily: 'system-ui, sans-serif', size: 84, weight: 700,
  color: '#ffffff', bg: true, bgColor: '#000000a6', stroke: 0, strokeColor: '#000000'
};

Captions.getTrack = function(create = true){
  let tr = State.project.tracks.find(t => t.name === 'CC');
  if (!tr && create){
    tr = State.mkTrack('CC', 'video');
    State.project.tracks.unshift(tr);
  }
  return tr;
};

Captions.importCues = function(cues, opts = {}){
  if (!cues.length){ UI.toast('No captions found', 'err'); return 0; }
  const base = opts.at ?? State.playhead;
  const minStart = Math.min(...cues.map(c => c.start));
  let n = 0;
  State.mutate('Import Captions', () => {
    const tr = Captions.getTrack(true);
    cues.forEach((c, i) => {
      const clip = State.makeClip(null, {
        type: 'text',
        start: Math.max(0, base + (c.start - minStart)),
        duration: c.end - c.start,
        label: 'CC ' + (i + 1)
      });
      clip.isCaption = true;
      clip.text = Object.assign({}, Captions.STYLE, { content: c.text });
      clip.y = 42;   // near bottom safe area
      clip.trackId = tr.id;
      tr.clips.push(clip);
      n++;
    });
    State.sortTrack(tr);
  });
  UI.toast(`Imported ${n} captions on CC track`, 'ok');
  return n;
};

Captions.importDialog = async function(){
  const readAndImport = (name, text) => {
    try { Captions.importCues(Captions.parse(text)); }
    catch(e){ UI.toast('Could not parse ' + name, 'err'); }
  };
  if (window.desktop && window.desktop.isDesktop){
    const r = await window.desktop.openTextDialog({ title: 'Import Captions', extensions: ['srt', 'vtt', 'txt'] });
    if (r && !r.error) readAndImport(r.path, r.content);
    else if (r && r.error) UI.toast(r.error, 'err');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.srt,.vtt,.txt';
  input.onchange = async () => { const f = input.files[0]; if (f) readAndImport(f.name, await f.text()); };
  input.click();
};

Captions.collect = function(inT = 0, outT = Infinity){
  const cues = [];
  State.eachClip(clip => {
    if (!clip.isCaption) return;
    if (clip.start >= outT || clip.start + clip.duration <= inT) return;
    cues.push({ start: clip.start - inT, end: clip.start + clip.duration - inT, text: clip.text.content });
  });
  return cues.sort((a, b) => a.start - b.start);
};

Captions.exportDialog = async function(){
  const cues = Captions.collect();
  if (!cues.length){ UI.toast('No caption clips (import or generate captions first)'); return; }
  const srt = Captions.serialize(cues);
  const name = (State.project.name || 'captions').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
  if (window.desktop && window.desktop.isDesktop){
    const p = await window.desktop.saveExportDialog({ defName: name + '.srt', ext: 'srt', filterName: 'SubRip SRT' });
    if (!p) return;
    const r = await window.desktop.fileWrite(p, srt);
    UI.toast(r.ok ? 'Captions saved: ' + p : ('Save failed: ' + r.error), r.ok ? 'ok' : 'err');
  } else {
    Util.download(name + '.srt', new Blob([srt], { type: 'text/plain' }));
  }
};

/* used by exporter-pro burn-in */
Captions.writeTempSrt = async function(inT, outT){
  const cues = Captions.collect(inT, outT);
  if (!cues.length) return null;
  if (!window.desktop) return null;
  const r = await window.desktop.fileWriteTemp('burn.srt', Captions.serialize(cues));
  return r && r.ok ? r.path : null;
};

})();
