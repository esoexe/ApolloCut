/* ApolloCut — Effect Controls panel, preset library, history panel */
(function(){
'use strict';

const EffectsUI = {};
window.EffectsUI = EffectsUI;

const DEFAULTS = {
  x:0, y:0, scale:100, rotation:0, opacity:100,
  brightness:100, contrast:100, saturate:100, hue:0, grayscale:0, sepia:0, blur:0,
  volume:100, fadeIn:0, fadeOut:0, speed:1
};

const DEFS = [
  { group: 'Motion', types: ['video','image','text','seq'], props: [
    { k:'x',        label:'Position X', min:-100, max:100,  step:0.1, unit:'%', kf:true },
    { k:'y',        label:'Position Y', min:-100, max:100,  step:0.1, unit:'%', kf:true },
    { k:'scale',    label:'Scale',      min:1,    max:500,  step:0.1, unit:'%', kf:true },
    { k:'rotation', label:'Rotation',   min:-360, max:360,  step:0.1, unit:'°', kf:true },
    { k:'opacity',  label:'Opacity',    min:0,    max:100,  step:0.1, unit:'%', kf:true }
  ]},
  { group: 'Strength', types: ['adjustment'], props: [
    { k:'opacity',  label:'Strength', min:0, max:100,  step:0.1, unit:'%', kf:true },
    { k:'fadeIn',   label:'Fade In',  min:0, max:30,   step:0.1, unit:'s', kf:false },
    { k:'fadeOut',  label:'Fade Out', min:0, max:30,   step:0.1, unit:'s', kf:false }
  ]},
  { group: 'Color', types: ['video','image','adjustment','seq'], props: [
    { k:'brightness', label:'Brightness', min:0,   max:300,  step:1,   unit:'%', kf:true },
    { k:'contrast',   label:'Contrast',   min:0,   max:300,  step:1,   unit:'%', kf:true },
    { k:'saturate',   label:'Saturation', min:0,   max:400,  step:1,   unit:'%', kf:true },
    { k:'hue',        label:'Hue Rotate', min:-180,max:180,  step:1,   unit:'°', kf:true },
    { k:'grayscale',  label:'Grayscale',  min:0,   max:100,  step:1,   unit:'%', kf:true },
    { k:'sepia',      label:'Sepia',      min:0,   max:100,  step:1,   unit:'%', kf:true },
    { k:'blur',       label:'Blur',       min:0,   max:60,   step:0.1, unit:'px',kf:true }
  ]},
  { group: 'Audio', types: ['video','audio','seq'], props: [
    { k:'volume',  label:'Volume',   min:0, max:400, step:1,   unit:'%', kf:true  },
    { k:'fadeIn',  label:'Fade In',  min:0, max:30,  step:0.1, unit:'s', kf:false },
    { k:'fadeOut', label:'Fade Out', min:0, max:30,  step:0.1, unit:'s', kf:false }
  ]},
  { group: 'Speed', types: ['video','audio','image','text'], props: [
    { k:'speed', label:'Speed', min:10, max:800, step:1, unit:'%', kf:false, pct:true }
  ]}
];

const PRESETS = [
  { group:'Color Looks' },
  { name:'Cinematic',   tag:'look',  sw:'linear-gradient(90deg,#2c3e50,#4a69bd)', set:{ contrast:118, saturate:88, brightness:97, sepia:8 } },
  { name:'Vivid',       tag:'look',  sw:'linear-gradient(90deg,#f7971e,#ffd200)', set:{ saturate:150, contrast:112 } },
  { name:'Noir (B&W)',  tag:'look',  sw:'linear-gradient(90deg,#111,#999)', set:{ grayscale:100, contrast:120, brightness:102 } },
  { name:'Warm',        tag:'look',  sw:'linear-gradient(90deg,#cb356b,#bd3f32)', set:{ sepia:28, saturate:112, brightness:103 } },
  { name:'Cold',        tag:'look',  sw:'linear-gradient(90deg,#2193b0,#6dd5ed)', set:{ hue:12, saturate:92, contrast:106, brightness:100 } },
  { name:'Vintage',     tag:'look',  sw:'linear-gradient(90deg,#8e6e3d,#d3b98c)', set:{ sepia:45, contrast:88, brightness:105, saturate:85 } },
  { name:'Faded Film',  tag:'look',  sw:'linear-gradient(90deg,#606c88,#3f4c6b)', set:{ brightness:110, saturate:70, contrast:85 } },
  { name:'Soft Blur 8px', tag:'fx',  sw:'linear-gradient(90deg,#485563,#c3cfe2)', set:{ blur:8 } },
  { group:'Transitions' },
  { name:'Fade In 1s',  tag:'trans', apply:(c)=>{ c.fadeIn = Math.min(1, c.duration/2); } },
  { name:'Fade Out 1s', tag:'trans', apply:(c)=>{ c.fadeOut = Math.min(1, c.duration/2); } },
  { name:'Dissolve In+Out', tag:'trans', apply:(c)=>{ c.fadeIn = Math.min(.6, c.duration/2); c.fadeOut = Math.min(.6, c.duration/2); } },
  { name:'Cross Dissolve Pair', tag:'trans', multi:true },
  { group:'Speed & Audio' },
  { name:'Speed ×2',    tag:'speed', apply:(c)=>{ c.speed = 2; } },
  { name:'Slow Motion ½×', tag:'speed', apply:(c)=>{ c.speed = .5; } },
  { name:'Boost Audio 150%', tag:'audio', apply:(c)=>{ c.volume = 150; } },
  { group:'Fix' },
  { name:'Reset All Effects', tag:'reset', apply:(c)=>{ Object.assign(c, Util.deepClone(DEFAULTS)); c.kf = {}; } }
];

let currentRows = [];
let panel = null, nameEl = null, subEl = null;

EffectsUI.init = function(){
  panel = document.getElementById('fx-panel');
  nameEl = document.getElementById('fx-clipname');
  subEl = document.getElementById('fx-sub');
  buildPresets();
  Events.on('selection', () => refresh());
  Events.on('structure', () => refresh());
  Events.on('time', () => updateDynamic());
  Events.on('history', () => renderHistory());
  renderHistory();
};

/* ---------------- clip property application (keyframe aware) ---------------- */
function applyProp(clip, def, val){
  const k = def.k;
  if (def.pct){ clip.speed = Util.clamp(val/100, 0.1, 8); return; }
  const tl = State.playhead - clip.start;
  const inside = tl >= -0.001 && tl <= clip.duration + 0.001;
  if (clip.kf[k]){
    if (inside) State.kfUpsert(clip, k, tl, val);
    else clip[k] = val;
  } else clip[k] = val;
}

function currentVal(clip, def){
  const tl = State.playhead - clip.start;
  if (def.pct) return clip.speed * 100;
  return clip.kf[def.k] ? State.valueAt(clip, def.k, tl) : clip[def.k];
}

/* ---------------- panel build ---------------- */
function refresh(){
  const sel = State.selectionClips();
  if (!sel.length){
    nameEl.textContent = 'No clip selected';
    subEl.textContent = '';
    panel.innerHTML = '<div class="fx-empty">Select a clip on the timeline to edit its properties.<br><br>Move · Color · Blur · Audio · Speed — everything is keyframable with ◆</div>';
    currentRows = [];
    return;
  }
  const { clip, track } = sel[0];
  const multi = sel.length > 1 ? ` (+${sel.length-1} more)` : '';
  nameEl.textContent = clip.label + multi;
  subEl.textContent = `${track.name} · ${clip.type} · in ${Util.timecode(clip.start, State.project.fps)} · dur ${Util.fmtDur(clip.duration)}`;

  panel.innerHTML = '';
  currentRows = [];

  // name
  const nameRow = document.createElement('div');
  nameRow.className = 'fx-grid2';
  nameRow.style.marginTop = '6px';
  nameRow.innerHTML = `<label>Clip name<input type="text" id="fx-name" value="${Util.esc(clip.label)}"></label>
    <label>Type<input type="text" value="${clip.type} @ ${Math.round(clip.speed*100)}%" disabled></label>`;
  panel.appendChild(nameRow);
  nameRow.querySelector('#fx-name').addEventListener('change', ev => {
    const v = ev.target.value.trim();
    if (v) State.mutate('Rename Clip', () => { clip.label = v; });
  });

  DEFS.forEach(def => {
    if (!def.types.includes(clip.type)) return;
    const g = document.createElement('div');
    g.className = 'fx-group';
    g.innerHTML = `<div class="fx-group-h">${def.group}<button class="reset" title="Reset ${def.group}">Reset</button></div><div class="fx-group-b"></div>`;
    g.querySelector('.reset').addEventListener('click', () => {
      State.mutate('Reset ' + def.group, () => {
        def.props.forEach(p => { delete clip.kf[p.k]; clip[p.k] = DEFAULTS[p.k]; });
        if (clip.type === 'text'){ clip.fadeIn = 0; clip.fadeOut = 0; }
      });
    });
    const body = g.querySelector('.fx-group-b');
    def.props.forEach(p => body.appendChild(sliderRow(clip, p)));
    panel.appendChild(g);
  });

  if (clip.type === 'text') panel.appendChild(textSection(clip));

  const hint = document.createElement('div');
  hint.className = 'fx-note';
  hint.textContent = 'Tip: enable ⏱ then move the playhead and drag a slider to animate the value over time (keyframes shown as ◆ on the clip).';
  panel.appendChild(hint);

  updateDynamic();
}

function sliderRow(clip, def){
  const row = document.createElement('div');
  row.className = 'fx-row';

  const lab = document.createElement('label');
  lab.textContent = def.label;
  const range = document.createElement('input');
  range.type = 'range'; range.min = def.min; range.max = def.max; range.step = def.step;
  const num = document.createElement('input');
  num.type = 'number'; num.min = def.min; num.max = def.max; num.step = def.step;

  const kfs = document.createElement('div');
  kfs.className = 'fx-kfs';

  let before = null;
  const commitIfChanged = label => {
    if (before !== null && State.snap() !== before){
      State.pushHist(label); State.markDirty(); Events.emit('structure');
    }
    before = null;
  };
  const apply = v => {
    if (isNaN(v)) return;
    v = Util.clamp(v, def.min, def.max);
    applyProp(clip, def, v);
    Engine.render(State.playhead);
    TL.renderSel();
    range.value = v; num.value = Util.round(v, 2);
    updateKfBtns();
  };
  range.addEventListener('pointerdown', () => { before = State.snap(); });
  num.addEventListener('focus', () => { before = State.snap(); });
  range.addEventListener('input', () => apply(parseFloat(range.value)));
  range.addEventListener('change', () => commitIfChanged(def.label));
  num.addEventListener('input', () => apply(parseFloat(num.value)));
  num.addEventListener('change', () => commitIfChanged(def.label));

  if (def.kf){
    const tgl = document.createElement('button'); tgl.textContent = '⏱'; tgl.title = 'Toggle keyframing';
    const add = document.createElement('button'); add.textContent = '◆'; add.title = 'Add/remove keyframe at playhead';
    const prev = document.createElement('button'); prev.textContent = '◀'; prev.title = 'Previous keyframe';
    const next = document.createElement('button'); next.textContent = '▶'; next.title = 'Next keyframe';
    tgl.addEventListener('click', () => {
      const tl = Util.clamp(State.playhead - clip.start, 0, clip.duration);
      State.mutate('Toggle Keyframes', () => {
        if (clip.kf[def.k]){ const v = State.valueAt(clip, def.k, tl); delete clip.kf[def.k]; clip[def.k] = v; }
        else clip.kf[def.k] = [{ t: tl, v: clip[def.k] }];
      });
    });
    add.addEventListener('click', () => {
      const tl = State.playhead - clip.start;
      if (tl < -0.001 || tl > clip.duration + 0.001){ UI.toast('Move the playhead over the clip first'); return; }
      State.mutate('Keyframe', () => {
        const k = clip.kf[def.k] || (clip.kf[def.k] = []);
        const t = Util.round(Util.clamp(tl, 0, clip.duration), 3);
        const ex = k.find(p => Math.abs(p.t - t) < 0.02);
        if (ex){ clip.kf[def.k] = k.filter(p => p !== ex); if (!clip.kf[def.k].length) delete clip.kf[def.k]; }
        else State.kfUpsert(clip, def.k, t, currentVal(clip, def));
      });
    });
    prev.addEventListener('click', () => jumpKf(clip, def.k, -1));
    next.addEventListener('click', () => jumpKf(clip, def.k, 1));
    kfs.append(prev, add, next, tgl);
  }

  row.append(lab, range, num, kfs);
  currentRows.push({ def, clip, range, num, row, updateKfBtns: null });

  function updateKfBtns(){
    if (!def.kf) return;
    const tl = State.playhead - clip.start;
    const enabled = !!clip.kf[def.k];
    tgl.classList.toggle('on', enabled);
    const k = clip.kf[def.k] || [];
    add.classList.toggle('kf-here', k.some(p => Math.abs(p.t - tl) < 0.02));
    add.textContent = k.some(p => Math.abs(p.t - tl) < 0.02) ? '◈' : '◆';
    const inside = tl >= -0.001 && tl <= clip.duration + 0.001;
    row.classList.toggle('disabled', enabled && !inside);
  }
  currentRows[currentRows.length-1].updateKfBtns = updateKfBtns;
  return row;
}

function jumpKf(clip, prop, dir){
  const k = clip.kf[prop];
  if (!k || !k.length) return;
  const tl = State.playhead - clip.start;
  let cand = null;
  if (dir < 0){ for (let i = k.length-1; i >= 0; i--) if (k[i].t < tl - 0.02){ cand = k[i].t; break; } }
  else { for (let i = 0; i < k.length; i++) if (k[i].t > tl + 0.02){ cand = k[i].t; break; } }
  if (cand != null) State.setTime(clip.start + cand);
}

/* live value sync while playing / scrubbing */
function updateDynamic(){
  currentRows.forEach(r => {
    if (!document.body.contains(r.row)) return;
    if (document.activeElement === r.num || document.activeElement === r.range) return;
    const v = currentVal(r.clip, r.def);
    r.range.value = v;
    r.num.value = Util.round(v, 2);
    if (r.updateKfBtns) r.updateKfBtns();
  });
}

/* ---------------- text clip section ---------------- */
function textSection(clip){
  const g = document.createElement('div');
  g.className = 'fx-group';
  const tx = clip.text;
  g.innerHTML = `<div class="fx-group-h">Text</div><div class="fx-group-b fx-text">
    <textarea id="tx-content" spellcheck="false">${Util.esc(tx.content)}</textarea>
    <div class="fx-grid2">
      <label>Font<select id="tx-font">
        <option value="system-ui, sans-serif">System Sans</option>
        <option value="Arial, Helvetica, sans-serif">Arial</option>
        <option value="Georgia, serif">Georgia (Serif)</option>
        <option value="'Times New Roman', serif">Times</option>
        <option value="'Courier New', monospace">Courier (Mono)</option>
        <option value="Impact, sans-serif">Impact (Display)</option>
        <option value="Verdana, sans-serif">Verdana</option>
      </select></label>
      <label>Size (px)<input type="number" id="tx-size" min="8" max="800" step="1" value="${tx.size}"></label>
      <label>Weight<select id="tx-weight">
        <option value="300">Light</option><option value="400">Regular</option>
        <option value="600">SemiBold</option><option value="700">Bold</option><option value="900">Black</option>
      </select></label>
      <label>Stroke px<input type="number" id="tx-stroke" min="0" max="30" step="0.5" value="${tx.stroke}"></label>
    </div>
    <div class="fx-grid2">
      <label>Fill<div class="fx-color"><input type="color" id="tx-color" value="${tx.color}"></div></label>
      <label>Stroke<div class="fx-color"><input type="color" id="tx-strokeColor" value="${tx.strokeColor}"></div></label>
    </div>
    <div class="fx-check"><input type="checkbox" id="tx-bg" ${tx.bg ? 'checked' : ''}><label for="tx-bg">Background box</label>
      <input type="color" id="tx-bgColor" value="${toHex(tx.bgColor)}"></div>
  </div>`;

  const set = (fn, label) => {
    State.mutate(label || 'Text Edit', fn);
    Engine.render(State.playhead);
  };
  let deb = null;
  g.querySelector('#tx-content').addEventListener('input', ev => {
    tx.content = ev.target.value; Engine.render(State.playhead);
    clearTimeout(deb); deb = setTimeout(() => State.commit('Text Edit'), 600);
  });
  g.querySelector('#tx-font').addEventListener('change', ev => set(() => { tx.fontFamily = ev.target.value; }, 'Text Font'));
  g.querySelector('#tx-size').addEventListener('change', ev => set(() => { tx.size = Util.clamp(parseFloat(ev.target.value)||140, 8, 800); }, 'Text Size'));
  g.querySelector('#tx-weight').addEventListener('change', ev => set(() => { tx.weight = parseInt(ev.target.value); }, 'Text Weight'));
  g.querySelector('#tx-color').addEventListener('input', ev => { tx.color = ev.target.value; Engine.render(State.playhead); });
  g.querySelector('#tx-color').addEventListener('change', () => State.commit('Text Color'));
  g.querySelector('#tx-stroke').addEventListener('change', ev => set(() => { tx.stroke = Util.clamp(parseFloat(ev.target.value)||0, 0, 30); }, 'Text Stroke'));
  g.querySelector('#tx-strokeColor').addEventListener('change', ev => set(() => { tx.strokeColor = ev.target.value; }, 'Text Stroke'));
  g.querySelector('#tx-bg').addEventListener('change', ev => set(() => { tx.bg = ev.target.checked; }, 'Text Background'));
  g.querySelector('#tx-bgColor').addEventListener('change', ev => set(() => { tx.bgColor = ev.target.value + 'cc'; }, 'Text Background'));
  return g;
}
function toHex(c){
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = c.match(/^#([0-9a-f]{6})/i);
  return m ? m[0].slice(0,7) : '#000000';
}

EffectsUI.focusText = function(){
  refresh();
  const ta = document.getElementById('tx-content');
  if (ta){ ta.focus(); ta.select(); }
};

/* ---------------- presets tab ---------------- */
function buildPresets(){
  const host = document.getElementById('presets');
  host.innerHTML = '';
  PRESETS.forEach(p => {
    if (p.group){
      const h = document.createElement('div');
      h.className = 'preset-group';
      h.textContent = p.group;
      host.appendChild(h);
      return;
    }
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.innerHTML = `<span>${p.name}</span>${p.sw ? `<span class="preset-swatch" style="background:${p.sw}"></span>` : `<span class="tag">${p.tag}</span>`}`;
    b.addEventListener('click', () => {
      const sel = State.selectionClips();
      if (!sel.length){ UI.toast('Select a clip first'); return; }
      if (p.multi){ crossDissolvePair(sel); return; }
      State.mutate('Preset: ' + p.name, () => {
        sel.forEach(({clip}) => {
          if (p.set){ for (const k in p.set){ delete clip.kf[k]; clip[k] = p.set[k]; } }
          if (p.apply) p.apply(clip);
        });
      });
      UI.toast('Applied: ' + p.name, 'ok');
    });
    host.appendChild(b);
  });
}

function crossDissolvePair(sel){
  if (sel.length < 2){ UI.toast('Select two adjacent clips on the same track'); return; }
  const sorted = sel.slice().sort((a,b) => a.clip.start - b.clip.start);
  const a = sorted[0], b = sorted[1];
  if (a.track !== b.track){ UI.toast('Clips must be on the same track'); return; }
  const x = Math.min(0.75, a.clip.duration/2, b.clip.duration/2);
  State.mutate('Cross Dissolve', () => {
    const overlap = Math.min(x, b.clip.offset / Math.max(b.clip.speed, 1e-6));
    if (overlap > 0){
      b.clip.start -= overlap;
      b.clip.offset -= overlap * b.clip.speed;
      b.clip.duration += overlap;
      a.clip.fadeOut = overlap;
      b.clip.fadeIn = overlap;
    } else {
      a.clip.fadeOut = x; b.clip.fadeIn = x;
    }
    State.sortTrack(a.track);
  });
  UI.toast('Cross dissolve applied', 'ok');
}

/* ---------------- history tab ---------------- */
function renderHistory(){
  const host = document.getElementById('history-list');
  if (!host) return;
  host.innerHTML = '';
  State._hist.forEach((h, i) => {
    const d = document.createElement('div');
    d.className = 'hist-item' + (i === State._hi ? ' cur' : '') + (i > State._hi ? ' future' : '');
    d.textContent = h.label;
    d.title = 'Click to jump here';
    d.addEventListener('click', () => {
      State._hi = i;
      const o = JSON.parse(h.json);
      State.project = o.project; State.inPoint = o.inPoint; State.outPoint = o.outPoint;
      Events.emit('structure'); Events.emit('selection'); Events.emit('history'); Events.emit('time');
      State.markDirty();
    });
    host.appendChild(d);
  });
  const cur = host.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

})();
