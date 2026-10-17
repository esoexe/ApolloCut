/* ApolloCut — CMX3600 EDL interchange (cut lists).
   Export: the base video track (+ optional audio tracks) as an industry-standard EDL
   that Premiere / DaVinci / broadcast systems open natively.
   Import: parse an EDL back into clips (matched to pool media by clip-name comment,
   offline placeholders otherwise — the desktop relinker recovers them). */
'use strict';
const EDL = {};
window.EDL = EDL;

/* ---------- timecode ---------- */
EDL.framesToTc = function(fr, fps){
  fr = Math.max(0, Math.round(fr));
  const f = fr % fps, s = Math.floor(fr / fps) % 60, m = Math.floor(fr / (fps * 60)) % 60, h = Math.floor(fr / (fps * 3600));
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
};
EDL.tcToFrames = function(tc, fps){
  const m = String(tc).trim().match(/^(\d\d):(\d\d):(\d\d)[:;](\d\d)$/);
  if (!m) return 0;
  return (((+m[1] * 60) + +m[2]) * 60 + +m[3]) * fps + +m[4];
};

/* ---------- export ---------- */
EDL.generate = function(videoTrack, audioTracks, title, fps, startTcFrames){
  const lines = [];
  const stf = startTcFrames || 0;
  lines.push(`TITLE: ${(title || 'APOLLOCUT').toUpperCase().slice(0, 70)}`);
  lines.push('FCM: NON-DROP FRAME');
  const tcs = f => EDL.framesToTc(f, fps);
  let ev = 0;
  const emit = (clip, type, reel) => {
    ev++;
    const sin = Math.round(clip.offset * fps);
    const sout = Math.round((clip.offset + clip.duration * clip.speed) * fps);
    const rin = Math.round((clip.start) * fps) + stf;
    const rout = Math.round((clip.start + clip.duration) * fps) + stf;
    lines.push(`${String(ev).padStart(3, '0')}  ${reel.padEnd(8, ' ').slice(0, 8)} ${type.padEnd(4, ' ')} C        ${tcs(sin)} ${tcs(sout)} ${tcs(rin)} ${tcs(rout)} `);
    return ev;
  };
  if (videoTrack){
    const clips = videoTrack.clips.slice().sort((a, b) => a.start - b.start).filter(c => c.type === 'video' || c.type === 'image');
    for (const c of clips){
      const media = c.mediaId ? Media.get(c.mediaId) : null;
      const reel = media ? media.name.replace(/\.[a-z0-9]{2,4}$/i, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'AX' : 'AX';
      emit(c, 'V', reel);
      if (media) lines.push(`* FROM CLIP NAME: ${media.name}`);
      if (c.speed && c.speed !== 1) lines.push(`* SPEED: ${c.speed} (recut in ApolloCut)`);
      if (c.label) lines.push(`* CLIP LABEL: ${c.label}`);
    }
  }
  for (const tr of audioTracks || []){
    for (const c of tr.clips.slice().sort((a, b) => a.start - b.start)){
      const media = c.mediaId ? Media.get(c.mediaId) : null;
      const reel = media ? media.name.replace(/\.[a-z0-9]{2,4}$/i, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'AA' : 'AA';
      emit(c, 'AA', reel);
      if (media) lines.push(`* FROM CLIP NAME: ${media.name}`);
    }
  }
  return lines.join('\n') + '\n';
};

EDL.exportDialog = function(){
  const P = State.project;
  const vts = P.tracks.filter(t => t.type === 'video');
  const ats = P.tracks.filter(t => t.type === 'audio');
  if (!vts.length){ UI.toast('No video track', 'err'); return; }
  UI.dialog({
    title: '📼 Export EDL (CMX3600)',
    body: `
      <div class="dlg-row"><label>Video track</label><select name="vt">
        ${vts.map((t, i) => `<option value="${i}"${i === vts.length - 1 ? ' selected' : ''}>${Util.esc(t.name)} (${t.clips.length} clips)</option>`).join('')}
      </select></div>
      <div class="fx-check"><input type="checkbox" name="au" checked><label>Include audio tracks (${ats.length})</label></div>
      <p class="fx-note">Industry-standard cut list — opens in Premiere Pro, DaVinci Resolve and broadcast conform tools.
      Record timecode starts at 01:00:00:00. Effects/keyframes aren't representable in EDL (they're ApolloCut-side fidelity).</p>`,
    ok: 'Save .edl',
    onOk: async v => {
      const vt = vts[+v.vt] || vts[vts.length - 1];
      const fps = Math.round(P.fps) || 30;
      const text = EDL.generate(vt, v.au ? ats : [], P.name, fps, fps * 3600);
      if (window.desktop && window.desktop.isDesktop){
        const p = await window.desktop.saveExportDialog({ defName: (P.name || 'sequence').replace(/\W+/g, '-') + '.edl', ext: 'edl', filterName: 'EDL' });
        if (!p) return;
        const r = await window.desktop.fileWrite(p, text);
        UI.toast(r.ok ? 'EDL exported: ' + p : 'EDL write failed', r.ok ? 'ok' : 'err');
      } else {
        const b = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = (P.name || 'sequence') + '.edl'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    }
  });
};

/* ---------- import ---------- */
EDL.parse = function(text, fps, project){
  const events = [];
  const comment = {};
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)){
    const line = raw.trim();
    const cm = line.match(/^(\d{3,6})\s+(\S+)\s+(V|AA|A|AX|B)\s+(C|D|W|K)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (cm){
      cur = { n: +cm[1], reel: cm[2], type: cm[3], transition: cm[4],
              sin: EDL.tcToFrames(cm[5], fps) / fps, sout: EDL.tcToFrames(cm[6], fps) / fps,
              rin: EDL.tcToFrames(cm[7], fps) / fps, rout: EDL.tcToFrames(cm[8], fps) / fps, name: null };
      events.push(cur);
      continue;
    }
    const fn = line.match(/^\*\s*FROM CLIP NAME:\s*(.+)$/i);
    if (fn && cur) cur.name = fn[1].trim();
  }
  return events;
};

EDL.importDialog = function(){
  UI.dialog({
    title: '📼 Import EDL (CMX3600)',
    body: `<p class="fx-note">Paste EDL text, or pick a .edl file. Cut events become clips on new tracks;
    sources are matched to pool media by filename (unmatched become offline placeholders — re-import those files to relink).</p>
      <div class="dlg-row"><label>EDL text</label><textarea name="txt" rows="8" style="width:100%;font-family:var(--mono);font-size:11px" placeholder="TITLE: MY CUT&#10;FCM: NON-DROP FRAME&#10;001  AX       V    C        00:00:01:00 00:00:09:00 01:00:00:00 01:00:08:00 &#10;* FROM CLIP NAME: shot.mp4"></textarea></div>
      <div class="fx-row"><button class="btn" id="edl-open-file" type="button">Open .edl file…</button></div>`,
    ok: 'Import to Timeline',
    onOk: v => EDL.apply(v.txt, 'dialog')
  });
  const btn = document.getElementById('edl-open-file');
  if (btn) btn.addEventListener('click', () => { const i = document.getElementById('edl-file-input') || mkInput(); i.click(); });
};
function mkInput(){
  const i = document.createElement('input');
  i.type = 'file'; i.id = 'edl-file-input'; i.accept = '.edl,.txt'; i.hidden = true;
  i.addEventListener('change', async () => {
    if (i.files[0]) EDL.apply(await i.files[0].text(), 'file');
  });
  document.body.appendChild(i);
  return i;
}

EDL.apply = function(text, src){
  if (!text || !/\d{3,6}\s+\S+\s+(V|AA|A)/.test(text)){ UI.toast('No EDL events found', 'err'); return; }
  const fps = Math.round(State.project.fps) || 30;
  // detect sequence start TC (record) — shift so first event lands at 0
  const events = EDL.parse(text, fps, State.project);
  if (!events.length){ UI.toast('No EDL events found', 'err'); return; }
  const base = Math.min(...events.map(e => e.rin));
  const P = State.project;
  State.mutate('Import EDL', () => {
    let vtrack = P.tracks.find(t => t.type === 'video');
    if (!vtrack){ vtrack = State.mkTrack('V1 (EDL)', 'video'); P.tracks.unshift(vtrack); }
    let atrack = P.tracks.find(t => t.type === 'audio');
    if (!atrack){ atrack = State.mkTrack('A1 (EDL)', 'audio'); P.tracks.push(atrack); }
    let placed = 0;
    for (const e of events){
      const isV = e.type === 'V' || e.type === 'AX';
      const name = e.name || e.reel;
      let media = [...State.pool.values()].find(m => m.name === name);
      if (!media && name){
        media = Media.addOffline({ name, type: isV ? (/\.(jpe?g|png|webp|gif)$/i.test(name) ? 'image' : 'video') : 'audio' });
      }
      const clip = State.makeClip(media || null, {
        type: isV ? (media && media.type === 'image' ? 'image' : 'video') : 'audio',
        mediaId: media ? media.id : undefined,
        start: Util.round(e.rin - base, 3),
        offset: Util.round(e.sin, 3),
        duration: Util.round(Math.max(0.04, e.rout - e.rin), 3),
        label: name
      });
      const track = isV ? vtrack : atrack;
      clip.trackId = track.id;
      track.clips.push(clip);
      placed++;
    }
    P.tracks.forEach(State.sortTrack);
  });
  UI.toast(`EDL imported: ${events.length} events (base record TC ${EDL.framesToTc(Math.round(base * fps), fps)})`, 'ok');
  State.setTime(0);
};
