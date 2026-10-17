/* ApolloCut — preload bridge: safe, explicit desktop APIs for the renderer */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  /* media */
  openMediaDialog: () => ipcRenderer.invoke('dialog:openMedia'),
  pathToMediaUrl: p => ipcRenderer.invoke('file:pathToUrl', p),
  getPathForFile: file => { try { return webUtils.getPathForFile(file); } catch(e){ return null; } },
  stat: p => ipcRenderer.invoke('file:stat', p),

  /* project & text IO */
  saveProjectDialog: (json, defName) => ipcRenderer.invoke('dialog:saveProject', { json, defName }),
  openProjectDialog: () => ipcRenderer.invoke('dialog:openProject'),
  openTextDialog: opts => ipcRenderer.invoke('dialog:openText', opts || {}),
  fileWrite: (path, content) => ipcRenderer.invoke('file:write', { path, content }),
  fileWriteTemp: (name, content) => ipcRenderer.invoke('file:writeTemp', { name, content }),

  /* export */
  saveExportDialog: opts => ipcRenderer.invoke('dialog:saveExport', opts),
  showItem: p => ipcRenderer.invoke('shell:showItem', p),
  openPath: p => ipcRenderer.invoke('shell:openPath', p),

  /* pro (ffmpeg) export */
  proExportAvailable: () => ipcRenderer.invoke('export:pro:available'),
  proExportEncoders: () => ipcRenderer.invoke('export:pro:encoders'),
  proExportStart:   opts => ipcRenderer.invoke('export:pro:start', opts),
  proExportAudio:   payload => ipcRenderer.invoke('export:pro:audio', payload),
  proExportFrame:   buf => ipcRenderer.invoke('export:pro:frame', buf),
  proExportFinish:  () => ipcRenderer.invoke('export:pro:finish'),
  proExportCancel:  () => ipcRenderer.invoke('export:pro:cancel'),
  onProProgress: cb => {
    const fn = (e, d) => cb(d);
    ipcRenderer.on('export:pro:progress', fn);
    return () => ipcRenderer.removeListener('export:pro:progress', fn);
  },

  /* proxies */
  proxyStart: srcPath => ipcRenderer.invoke('proxy:start', { srcPath }),
  proxyStat: p => ipcRenderer.invoke('proxy:stat', p),
  onProxyEvent: cb => {
    const fns = ['proxy:progress', 'proxy:done'].map(ch => {
      const f = (e, d) => cb(ch.replace('proxy:', ''), d);
      ipcRenderer.on(ch, f);
      return [ch, f];
    });
    return () => fns.forEach(([ch, f]) => ipcRenderer.removeListener(ch, f));
  },

  /* AI tools */
  aiSceneDetect: (filePath, threshold, duration) => ipcRenderer.invoke('ai:sceneDetect', { filePath, threshold, duration }),
  aiSilenceDetect: (filePath, noiseDb, minDur) => ipcRenderer.invoke('ai:silenceDetect', { filePath, noiseDb, minDur }),
  aiWhisperStatus: () => ipcRenderer.invoke('ai:whisperStatus'),
  aiModelDownload: model => ipcRenderer.invoke('ai:modelDownload', { model }),
  aiTranscribe: (filePath, model, lang) => ipcRenderer.invoke('ai:transcribe', { filePath, model, lang }),
  onAIProgress: cb => {
    const fn = (e, d) => cb(d);
    ipcRenderer.on('ai:progress', fn);
    return () => ipcRenderer.removeListener('ai:progress', fn);
  },

  /* LUTs */
  lutImport: () => ipcRenderer.invoke('lut:import'),
  lutList: () => ipcRenderer.invoke('lut:list'),
  lutRead: name => ipcRenderer.invoke('lut:read', name),
  lutDelete: name => ipcRenderer.invoke('lut:delete', name),

  /* plugins */
  pluginsDir: () => ipcRenderer.invoke('plugins:dir'),
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsRead: name => ipcRenderer.invoke('plugins:read', name),

  /* native menu & app */
  onMenuAction: cb => { ipcRenderer.on('menu:action', (e, id) => cb(id)); },
  setTitle: t => ipcRenderer.send('app:set-title', t),

  /* CLI (headless render) */
  cliJob: () => ipcRenderer.invoke('cli:getJob'),
  cliProgress: line => ipcRenderer.send('cli:progress', line),
  cliDone: res => ipcRenderer.send('cli:done', res)
});
