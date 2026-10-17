/* ApolloCut — render engine: pro export (CPU + GPU), proxies, encoder detection. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function resolveFfmpeg(app){
  let p = null;
  try { p = require('ffmpeg-static'); } catch(e) { p = null; }
  if (!p) return null;
  if (app && app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked');
  try { return fs.existsSync(p) ? p : null; } catch(e) { return null; }
}

/* GPU encoder map (auto-detected from `ffmpeg -encoders`) */
const HW = {
  nvenc: {
    label: 'NVIDIA (NVENC)',
    h264: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '19', '-b:v', '0'],
    hevc: ['-c:v', 'hevc_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0']
  },
  qsv: {
    label: 'Intel QuickSync',
    h264: ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '19'],
    hevc: ['-c:v', 'hevc_qsv', '-preset', 'medium', '-global_quality', '23']
  },
  amf: {
    label: 'AMD (AMF)',
    h264: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19'],
    hevc: ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']
  },
  videotoolbox: {
    label: 'Apple VideoToolbox',
    h264: ['-c:v', 'h264_videotoolbox', '-b:v', '15M'],
    hevc: ['-c:v', 'hevc_videotoolbox', '-b:v', '12M', '-tag:v', 'hvc1']
  }
};

let S = null;                   // active export session
let detectedEncoders = null;    // encoders probe cache
const proxySessions = new Map();

const AUDIO_ONLY = new Set(['audio-wav', 'audio-mp3']);

function buildArgs(opts, audioPath){
  const { format, quality = {}, fps = 30, outPath } = opts;
  const preset = quality.preset || 'slow';
  const crf = quality.crf ?? 18;

  if (AUDIO_ONLY.has(format)){
    const args = ['-y', '-i', audioPath];
    if (format === 'audio-wav') args.push('-vn', '-c:a', 'pcm_s16le');
    else args.push('-vn', '-c:a', 'libmp3lame', '-b:a', '320k');
    args.push(outPath);
    return { args, cwd: null };
  }

  const args = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0'];
  if (audioPath) args.push('-i', audioPath);

  const isH264 = format === 'mp4-h264', isH265 = format === 'mp4-h265';
  const hw = (isH264 || isH265) && opts.engine && HW[opts.engine] ? HW[opts.engine] : null;

  let videoArgs;
  if (hw){
    videoArgs = (isH264 ? hw.h264 : hw.hevc).slice();
    if (!videoArgs.includes('-pix_fmt') && opts.engine !== 'videotoolbox') videoArgs.push('-pix_fmt', 'yuv420p');
  } else if (isH265){
    videoArgs = ['-c:v', 'libx265', '-preset', quality.preset || 'medium', '-crf', String(quality.crf ?? 24), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
  } else if (format === 'mov-prores'){
    videoArgs = ['-c:v', 'prores_ks', '-profile:v', '3'];
  } else if (format === 'webm-vp9'){
    videoArgs = ['-c:v', 'libvpx-vp9', '-crf', String(quality.crf ?? 32), '-b:v', '0', '-row-mt', '1'];
  } else {
    videoArgs = ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  }

  // optional subtitle burn-in (file lives in cwd to dodge filter escaping)
  let cwd = null;
  if (opts.subtitlesPath && !AUDIO_ONLY.has(format)){
    cwd = path.dirname(opts.subtitlesPath);
    videoArgs.push('-vf', 'subtitles=' + path.basename(opts.subtitlesPath));
  }

  if (audioPath){
    if (format === 'mov-prores') videoArgs.push('-c:a', 'pcm_s16le');
    else if (format === 'webm-vp9') videoArgs.push('-c:a', 'libopus', '-b:a', '160k');
    else videoArgs.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push(...videoArgs);
  if (audioPath) args.push('-shortest');
  args.push(outPath);
  return { args, cwd };
}

function register(ipcMain, getWindow, app){
  const bin = resolveFfmpeg(app);
  const send = (ch, data) => { const w = getWindow(); if (w) w.webContents.send(ch, data); };

  ipcMain.handle('export:pro:available', () => ({ available: !!bin, path: bin }));

  /* ---- GPU encoder detection ---- */
  ipcMain.handle('export:pro:encoders', async () => {
    if (!bin) return { available: false, engines: [] };
    if (detectedEncoders) return detectedEncoders;
    detectedEncoders = await new Promise(resolve => {
      const p = spawn(bin, ['-hide_banner', '-encoders']);
      let out = '';
      p.stdout.on('data', d => out += d.toString());
      p.stderr.on('data', d => out += d.toString());
      p.on('error', () => resolve({ available: true, engines: [] }));
      p.on('exit', () => {
        const engines = [];
        for (const [id, def] of Object.entries(HW)){
          const probe = id === 'videotoolbox' ? 'h264_videotoolbox' : ('h264_' + id);
          if (out.includes(probe)) engines.push({ id, label: def.label });
        }
        resolve({ available: true, engines });
      });
    });
    return detectedEncoders;
  });

  ipcMain.handle('export:pro:audio', (e, { buffer }) => {
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollocut-'));
      const p = path.join(dir, 'mix.wav');
      fs.writeFileSync(p, Buffer.from(buffer));
      return { ok: true, path: p, dir };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('export:pro:start', async (e, opts) => {
    if (S) return { ok: false, error: 'An export is already running.' };
    if (!bin) return { ok: false, error: 'FFmpeg binary not found.' };
    const isAudioOnly = AUDIO_ONLY.has(opts.format);
    if (isAudioOnly && !opts.audioPath) return { ok: false, error: 'No audio to export.' };

    const { args, cwd } = buildArgs(opts, opts.audioPath);
    S = {
      proc: null, outPath: opts.outPath,
      tmpDir: opts.audioPath ? path.dirname(opts.audioPath) : (opts.subtitlesPath ? path.dirname(opts.subtitlesPath) : null),
      cancelled: false, err: '', done: null, isAudioOnly
    };
    try {
      S.proc = spawn(bin, args, { stdio: isAudioOnly ? ['ignore', 'ignore', 'pipe'] : ['pipe', 'ignore', 'pipe'], cwd: cwd || undefined });
    } catch (err) { S = null; return { ok: false, error: err.message }; }

    S.done = new Promise(resolve => {
      S.proc.on('error', err => { S.err = String(err); resolve(-1); });
      S.proc.on('exit', code => resolve(code));
    });
    S.proc.stderr.on('data', d => {
      const s = d.toString();
      S.err = (S.err + s).slice(-4000);
      const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m) send('export:pro:progress', { phase: 'encode', seconds: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) });
    });
    return { ok: true };
  });

  ipcMain.handle('export:pro:frame', async (e, buf) => {
    if (!S || !S.proc || S.cancelled || !S.proc.stdin.writable) return { ok: false };
    try {
      await new Promise((resolve, reject) => S.proc.stdin.write(Buffer.from(buf), err => err ? reject(err) : resolve()));
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('export:pro:finish', async () => {
    if (!S) return { ok: false, error: 'No export session.' };
    const sess = S;
    try { if (!sess.isAudioOnly && sess.proc.stdin.writable) sess.proc.stdin.end(); } catch(e){}
    const code = await sess.done;
    S = null;
    const ok = code === 0 && !sess.cancelled;
    let size = 0;
    if (ok){ try { size = fs.statSync(sess.outPath).size; } catch(e){} }
    try { if (sess.tmpDir) fs.rmSync(sess.tmpDir, { recursive: true, force: true }); } catch(e){}
    return { ok, cancelled: sess.cancelled, size, outPath: sess.outPath,
      error: ok ? null : (sess.err.split('\n').filter(Boolean).slice(-2).join(' ') || 'ffmpeg exited with code ' + code) };
  });

  ipcMain.handle('export:pro:cancel', () => {
    if (!S) return true;
    S.cancelled = true;
    try { if (S.proc && !S.isAudioOnly && S.proc.stdin.writable) S.proc.stdin.destroy(); } catch(e){}
    try { if (S.proc) S.proc.kill('SIGKILL'); } catch(e){}
    return true;
  });

  /* ---------------- proxies ---------------- */
  function proxyDir(){ const d = path.join(app.getPath('userData'), 'proxies'); fs.mkdirSync(d, { recursive: true }); return d; }

  ipcMain.handle('proxy:start', async (e, { srcPath }) => {
    if (!bin) return { ok: false, error: 'ffmpeg missing' };
    let st;
    try { st = fs.statSync(srcPath); } catch(err){ return { ok: false, error: 'source missing' }; }
    const key = crypto.createHash('sha1').update(srcPath + ':' + st.size + ':' + st.mtimeMs).digest('hex').slice(0, 16);
    const outPath = path.join(proxyDir(), 'px-' + key + '.mp4');
    if (fs.existsSync(outPath)) return { ok: true, path: outPath, cached: true };
    if (proxySessions.has(key)) return { ok: true, running: true, key, path: outPath };

    // probe duration for progress
    let duration = 0;
    await new Promise(resolve => {
      const p = spawn(bin, ['-hide_banner', '-i', srcPath, '-f', 'null', '-']);
      let err = '';
      p.stderr.on('data', d => err += d.toString());
      p.stderr.on('data', d => { const m = String(d).match(/Duration: (\d+):(\d+):([\d.]+)/); if (m && !duration) duration = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]); });
      setTimeout(() => { try { p.kill(); } catch(e2){} resolve(); }, 4000);
      p.on('exit', () => resolve());
    });

    const tmp = outPath + '.part';
    const proc = spawn(bin, ['-y', '-i', srcPath, '-vf', "scale=-2:540", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp]);
    const sess = { proc, outPath, tmp, cancelled: false };
    proxySessions.set(key, sess);
    proc.stderr.on('data', d => {
      const m = String(d).match(/time=(\d+):(\d+):([\d.]+)/);
      if (m && duration) send('proxy:progress', { key, pct: Math.min(1, ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) / duration) });
    });
    proc.on('exit', code => {
      proxySessions.delete(key);
      if (code === 0 && !sess.cancelled){
        try { fs.renameSync(tmp, outPath); } catch(e2){}
        send('proxy:done', { key, path: outPath, ok: true });
      } else {
        try { fs.unlinkSync(tmp); } catch(e2){}
        send('proxy:done', { key, ok: false, cancelled: sess.cancelled });
      }
    });
    proc.on('error', () => { proxySessions.delete(key); send('proxy:done', { key, ok: false }); });
    return { ok: true, running: true, key, path: outPath };
  });

  ipcMain.handle('proxy:stat', (e, p) => { try { return { exists: fs.existsSync(p) }; } catch(err){ return { exists: false }; } });
}

module.exports = { register };
