/* ApolloCut — AI tools: scene detect, silence detect, whisper speech-to-text.
   Scene & silence use the bundled FFmpeg; whisper uses the open-source
   whisper.cpp binary (bundled in resources/ai, user-installed in userData/ai,
   or from the system PATH) with models downloaded from huggingface. */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELS = ['tiny', 'base', 'small', 'medium'];

let ffmpegBin = null;
function bin(){ return ffmpegBin; }

function aiDir(app){ const d = path.join(app.getPath('userData'), 'ai'); fs.mkdirSync(d, { recursive: true }); return d; }
function modelsDir(app){ const d = path.join(aiDir(app), 'models'); fs.mkdirSync(d, { recursive: true }); return d; }

function findWhisper(app){
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const candidates = [
    path.join(aiDir(app), exe),
    path.join(process.resourcesPath || '', 'ai', exe),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'resources', 'ai', exe)
  ];
  for (const c of candidates){ try { if (c && fs.existsSync(c)) return c; } catch(e){} }
  for (const name of ['whisper-cli', 'whisper', 'main']){
    try {
      const r = spawnSync(name, ['--help'], { stdio: 'ignore', timeout: 4000 });
      if (!r.error) return name;
    } catch(e){}
  }
  return null;
}

function download(url, dest, onProgress, redirects = 0){
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
        if (redirects > 6) return reject(new Error('too many redirects'));
        return resolve(download(res.headers.location, dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', chunk => { got += chunk.length; if (onProgress && total) onProgress(got / total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

function runProc(cmd, args, onStderr){
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn(cmd, args);
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => { err += d.toString(); if (onStderr) onStderr(d.toString()); });
    p.on('error', e => resolve({ code: -1, out, err: err + String(e) }));
    p.on('exit', code => resolve({ code, out, err }));
  });
}

function register(ipcMain, getWindow, app, ffmpegPath){
  ffmpegBin = ffmpegPath;
  const send = (ch, data) => { const w = getWindow(); if (w) w.webContents.send(ch, data); };

  /* ---------- scene detect ---------- */
  ipcMain.handle('ai:sceneDetect', async (e, { filePath, threshold = 0.35, duration = 0 }) => {
    const th = Math.min(0.95, Math.max(0.05, threshold));
    const r = await runProc(bin(), ['-hide_banner', '-i', filePath, '-vf', `select='gt(scene,${th})',metadata=print:file=-`, '-an', '-f', 'null', '-'],
      s => {
        if (duration > 0){
          const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
          if (m) send('ai:progress', { phase: 'scene', pct: Math.min(1, ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) / duration) });
        }
      });
    const times = [];
    const re = /pts_time:([\d.]+)/g;
    let m;
    while ((m = re.exec(r.out)) !== null){ const t = parseFloat(m[1]); if (isFinite(t)) times.push(t); }
    return { ok: r.code === 0, times: [...new Set(times)].sort((a, b) => a - b) };
  });

  /* ---------- silence detect ---------- */
  ipcMain.handle('ai:silenceDetect', async (e, { filePath, noiseDb = -35, minDur = 0.4 }) => {
    const r = await runProc(bin(), ['-hide_banner', '-i', filePath, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-vn', '-f', 'null', '-']);
    const silences = [];
    let start = null;
    const lines = r.err.split('\n');
    for (const line of lines){
      const s = line.match(/silence_start: ([\d.]+)/);
      if (s){ start = parseFloat(s[1]); continue; }
      const en = line.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
      if (en && start != null){ silences.push({ start, end: parseFloat(en[1]) }); start = null; }
    }
    return { ok: r.code === 0 || silences.length > 0, silences };
  });

  /* ---------- whisper ---------- */
  ipcMain.handle('ai:whisperStatus', () => {
    const b = findWhisper(app);
    let models = [];
    try {
      models = fs.readdirSync(modelsDir(app)).filter(f => /^ggml-.*\.bin$/.test(f)).map(f => f.replace(/^ggml-|\.bin$/g, ''));
    } catch(e){}
    return { binary: b, models, dir: aiDir(app), modelsDir: modelsDir(app) };
  });

  ipcMain.handle('ai:modelDownload', async (e, { model }) => {
    const m = MODELS.includes(model) ? model : 'tiny';
    const dest = path.join(modelsDir(app), `ggml-${m}.bin`);
    try {
      await download(`${HF}/ggml-${m}.bin`, dest, pct => send('ai:progress', { phase: 'model', pct }));
      return { ok: true, path: dest };
    } catch (err) { try { fs.unlinkSync(dest); } catch(e2){} return { ok: false, error: String(err) }; }
  });

  ipcMain.handle('ai:transcribe', async (e, { filePath, model = 'tiny', lang = 'auto' }) => {
    const b = findWhisper(app);
    if (!b) return { ok: false, error: 'whisper-cli binary not found' };
    const modelPath = path.join(modelsDir(app), `ggml-${model}.bin`);
    if (!fs.existsSync(modelPath)) return { ok: false, error: 'model not downloaded: ' + model };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apollocut-stt-'));
    const wav = path.join(tmp, 'audio.wav');
    const conv = await runProc(bin(), ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    if (conv.code !== 0){ try { fs.rmSync(tmp, { recursive: true, force: true }); } catch(e2){} return { ok: false, error: 'audio extraction failed' }; }

    const outBase = path.join(tmp, 'caps');
    send('ai:progress', { phase: 'transcribe', pct: -1 });
    const r = await runProc(b, ['-m', modelPath, '-f', wav, '--output-srt', '-of', outBase, '-l', lang || 'auto']);
    let srt = null;
    try { srt = fs.readFileSync(outBase + '.srt', 'utf8'); } catch(e2){}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch(e3){}
    if (srt) return { ok: true, srt };
    return { ok: false, error: (r.err.split('\n').filter(Boolean).slice(-2).join(' ') || 'transcription failed') };
  });
}

module.exports = { register };
