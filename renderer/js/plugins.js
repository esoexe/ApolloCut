/* ApolloCut — plugin API: postprocess effects applied to the final composite.
   A plugin is a .js file calling registerPlugin({id, name, type, apply(ctx,W,H,time)}).
   Desktop: drop files in the plugins folder. Web: load .js files manually. */
(function(){
'use strict';

const Plugins = { registry: new Map(), broken: new Set() };
window.Plugins = Plugins;

function registerPlugin(def){
  if (!def || !def.id || typeof def.apply !== 'function') throw new Error('invalid plugin');
  Plugins.registry.set(def.id, def);
}

function evalCode(name, code){
  try {
    const fn = new Function('registerPlugin', '"use strict";\n' + code);
    fn(registerPlugin);
    return true;
  } catch(e){
    console.error('plugin failed: ' + name, e);
    Plugins.broken.add(name);
    return false;
  }
}

Plugins.enabled = function(){
  return (State.project && State.project.enabledPlugins) || [];
};

Plugins.toggle = function(id, on){
  State.mutate('Toggle Plugin', () => {
    const cur = new Set(Plugins.enabled());
    on ? cur.add(id) : cur.delete(id);
    State.project.enabledPlugins = [...cur];
  });
  Engine.render(State.playhead);
};

/* called by the renderer every frame after LUT application */
Plugins.runPost = function(ctx, W, H, t){
  const on = Plugins.enabled();
  if (!on.length) return;
  for (const id of on){
    const p = Plugins.registry.get(id);
    if (!p) continue;
    try { p.apply(ctx, W, H, t, { project: State.project, time: t }); }
    catch(e){
      console.error('plugin ' + id, e);
      State.project.enabledPlugins = on.filter(x => x !== id); // self-disable on error
      UI.toast('Plugin crashed and was disabled: ' + id, 'err');
    }
  }
};

/* ---------------- loading ---------------- */
Plugins.refresh = async function(announce){
  Plugins.registry.clear();
  Plugins.broken.clear();
  if (window.desktop && window.desktop.isDesktop){
    const files = await window.desktop.pluginsList().catch(() => []);
    for (const f of files){
      const r = await window.desktop.pluginsRead(f);
      if (r && r.ok) evalCode(f, r.code);
    }
    if (announce) UI.toast(`Loaded ${Plugins.registry.size} plugin${Plugins.registry.size === 1 ? '' : 's'}`, 'ok');
  }
  buildPanel();
};

Plugins.loadViaInput = function(){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.js'; input.multiple = true;
  input.onchange = async () => {
    for (const f of input.files){
      try { evalCode(f.name, await f.text()); } catch(e){}
    }
    buildPanel();
    UI.toast(`Loaded ${Plugins.registry.size} plugin(s)`, 'ok');
  };
  input.click();
};

Plugins.openFolder = async function(){
  if (!window.desktop || !window.desktop.isDesktop){ Plugins.loadViaInput(); return; }
  const dir = await window.desktop.pluginsDir();
  window.desktop.openPath(dir);
};

/* ---------------- panel ---------------- */
function buildPanel(){
  const host = document.getElementById('plugins-list');
  if (!host) return;
  host.innerHTML = '';
  const en = new Set(Plugins.enabled());
  if (!Plugins.registry.size){
    host.innerHTML = `<div class="fx-empty">No plugins loaded.<br><br>
      ${window.desktop ? 'Drop <code>.js</code> files in your plugins folder, then reload.' : 'Load plugin <code>.js</code> files to extend ApolloCut.'}
      <br><br><button class="btn" id="pl-open">${window.desktop ? 'Open folder' : 'Load files'}</button></div>`;
    const b = document.getElementById('pl-open');
    if (b) b.addEventListener('click', () => Plugins.openFolder());
    return;
  }
  for (const [id, p] of Plugins.registry){
    const row = document.createElement('div');
    row.className = 'plugin-row';
    row.innerHTML = `
      <label class="fx-check" style="flex:1">
        <input type="checkbox" ${en.has(id) ? 'checked' : ''}> ${Util.esc(p.name || id)}
      </label>
      <span class="tag dim">${Util.esc(p.type || 'fx')}</span>`;
    row.querySelector('input').addEventListener('change', ev => Plugins.toggle(id, ev.target.checked));
    host.appendChild(row);
  }
  const hint = document.createElement('div');
  hint.className = 'fx-note';
  hint.innerHTML = 'Plugins run on the final composite (after LUTs) and are included in every export.<br>Write your own: <code>registerPlugin({id, name, type, apply(ctx,W,H,time)})</code>';
  host.appendChild(hint);
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.style.marginTop = '8px';
  btn.textContent = window.desktop ? 'Open plugins folder' : 'Load more…';
  btn.addEventListener('click', () => Plugins.openFolder());
  host.appendChild(btn);
}

Plugins.init = function(){
  const reload = document.getElementById('plugins-reload');
  const folder = document.getElementById('plugins-folder');
  if (reload) reload.addEventListener('click', () => Plugins.refresh(true));
  if (folder) folder.addEventListener('click', () => Plugins.openFolder());
  if (window.desktop && window.desktop.isDesktop) Plugins.refresh(false);
  else buildPanel();
};

})();
