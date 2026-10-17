/* ApolloCut — proxy editing engine (desktop).
   Proxies: 540p H.264 copies of source media, used for preview only.
   Exports and sync always come from the originals. */
(function(){
'use strict';
if (!window.desktop || !window.desktop.isDesktop) return;

const D = window.desktop;
const Proxy = { available: true };
window.Proxy = Proxy;

const pending = new Map(); // mediaId -> key
let unsub = null;

Proxy.init = function(){
  State.useProxies = State.useProxies !== false;
  unsub = D.onProxyEvent((kind, data) => {
    if (kind === 'progress'){
      const el = document.querySelector(`[data-proxy-key="${data.key}"]`);
      if (el) el.textContent = Math.round((data.pct || 0) * 100) + '%';
      UI.status(`Proxy: ${Math.round((data.pct || 0) * 100)}%`);
    } else if (kind === 'done'){
      for (const [mediaId, key] of pending){
        if (key !== data.key) continue;
        pending.delete(mediaId);
        const m = State.pool.get(mediaId);
        if (m && data.ok){
          m.proxyPath = data.path;
          attachProxy(m, data.path);
          State.markDirty();
          UI.toast('Proxy ready: ' + m.name, 'ok');
        } else if (!data.cancelled) UI.toast('Proxy failed', 'err');
      }
      UI.status('Ready');
      Events.emit('pool');
    }
  });

  // re-attach proxies after project load / relink
  Events.on('pool', () => {
    State.pool.forEach(m => {
      if (m.proxyPath && !m._proxyUrl && !m._proxyChecking) Proxy.ensure(m);
    });
  });
};

function attachProxy(media, path){
  media._proxyUrl = window.desktopUrlFromPath(path);
  media.proxyPath = path;
  if (State.useProxies !== false && !media._proxyEl){
    const el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.src = media._proxyUrl;
    media._proxyEl = el;
  }
  Events.emit('pool');
}
Proxy.attach = attachProxy;

Proxy.ensure = async function(media){
  if (!media.proxyPath || media._proxyUrl) return;
  media._proxyChecking = true;
  try {
    const st = await D.proxyStat(media.proxyPath);
    if (st && st.exists) attachProxy(media, media.proxyPath);
    else media.proxyPath = null;
  } catch(e){ media.proxyPath = null; }
  media._proxyChecking = false;
};

Proxy.generate = async function(media){
  if (media.type !== 'video' || !media.path){ UI.toast('Proxies are for disk-based video files'); return; }
  if (media.proxyPath || pending.has(media.id)) return;
  UI.status('Generating proxy for ' + media.name + '…');
  const r = await D.proxyStart(media.path);
  if (!r.ok){ UI.toast('Proxy failed: ' + (r.error || ''), 'err'); UI.status('Ready'); return; }
  if (r.cached){ attachProxy(media, r.path); UI.toast('Proxy ready (cached): ' + media.name, 'ok'); UI.status('Ready'); return; }
  pending.set(media.id, r.key);
};

Proxy.generateAll = function(){
  let n = 0;
  State.pool.forEach(m => { if (m.type === 'video' && m.path && !m.proxyPath && !pending.has(m.id)){ Proxy.generate(m); n++; } });
  if (!n) UI.toast('All video already has proxies');
  else UI.toast(`Generating ${n} prox${n > 1 ? 'ies' : 'y'} in background…`);
};

Proxy.toggle = function(){
  State.useProxies = State.useProxies === false ? true : false;
  document.querySelectorAll('.proxy-toggle').forEach(b => b.classList.toggle('active', State.useProxies));
  if (State.useProxies) State.pool.forEach(m => { if (m._proxyUrl && !m._proxyEl) attachProxy(m, m.proxyPath); });
  UI.status('Proxy mode ' + (State.useProxies ? 'ON (540p preview)' : 'OFF (full resolution preview)'));
  Engine.render(State.playhead);
  Events.emit('pool');
};

Proxy.statusFor = function(media){
  if (pending.has(media.id)) return { state: 'working', key: pending.get(media.id) };
  if (media._proxyUrl || media.proxyPath) return { state: 'ready' };
  return { state: 'none' };
};

})();
