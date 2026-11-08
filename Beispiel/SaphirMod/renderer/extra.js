const PRESETS = [
  ['saphir', 'Saphir', '#243e75', '#0b1630'],
  ['mitternacht', 'Mitternacht', '#1b1f3b', '#05060f'],
  ['violett', 'Violett', '#4a2d7a', '#140a2b'],
  ['smaragd', 'Smaragd', '#1f6b5a', '#06201b'],
  ['rubin', 'Rubin', '#7a2b3d', '#25080f'],
  ['grafit', 'Grafit', '#3a4150', '#0e1016']
];
let homeSkin = null;
let skinSel = 'current';
let skinData = { profile: null, lib: [], error: '' };
let skinLoaded = false;
let skinSpin = false;
let skinWalk = false;
let newLoader = 'fabric';
let newCover = false;
const skinImgs = {};
const cleanMsg = e => e.message.replace(/^Error invoking remote method '[\w:]+': (Error: )?/, '');

async function applyTheme(s) {
  applyUi(s);
  const root = document.documentElement.style;
  let c1 = s.c1;
  let c2 = s.c2;
  const p = PRESETS.find(x => x[0] === s.bg);
  if (p) {
    c1 = p[2];
    c2 = p[3];
  }
  root.setProperty('--bg1', c1 || '#243e75');
  root.setProperty('--bg2', c2 || '#0b1630');
  const img = document.querySelector('#bgimg');
  const dim = document.querySelector('#bgdim');
  if (s.bg === 'image') {
    const url = await api.getBackground();
    if (url) {
      img.style.cssText = `display:block;background:url("${url}") center/cover no-repeat;filter:blur(${+s.blur || 0}px);transform:scale(1.06)`;
      dim.style.cssText = `display:block;background:rgba(5,10,25,${(+s.dim || 0) / 100})`;
      return;
    }
  }
  img.style.display = 'none';
  dim.style.display = 'none';
}

const trig = (key, val) => `<button type="button" class="cp-trigger" data-theme="${key}" data-value="${esc(val)}" style="--c:${esc(val)}" title="Farbe wählen"><i></i></button>`;

function appearanceHtml(s) {
  const sw = PRESETS.map(([id, l, a, b]) => `<button class="sw${s.bg === id ? ' on' : ''}" data-bg="${id}" title="${l}" style="background:linear-gradient(145deg,${a},${b})"></button>`).join('');
  return `<h2>Darstellung</h2><div class="panel">
    <div class="set"><div><h3>Akzentfarbe</h3><p>Buttons, Hervorhebungen und Leuchteffekte</p></div><div class="ctl">${trig('accent', s.accent)}<button class="chip btn sm" data-accreset>Zurücksetzen</button></div></div>
    <div class="set"><div><h3>Vorlagen</h3><p>Farbverläufe für den Hintergrund</p></div><div class="ctl swatches">${sw}</div></div>
    <div class="set"><div><h3>Eigene Farben</h3><p>Verlauf aus zwei Farben</p></div><div class="ctl">${trig('c1', s.c1)}${trig('c2', s.c2)}</div></div>
    <div class="set"><div><h3>Eigenes Bild</h3><p>PNG, JPG, WebP oder GIF</p></div><div class="ctl"><button class="chip btn sm" data-bgpick>Bild wählen</button>${s.bg === 'image' ? '<button class="chip btn sm" data-bgclear>Entfernen</button>' : ''}</div></div>
    <div class="set"><div><h3>Abdunkeln</h3><p>Für bessere Lesbarkeit über dem Bild</p></div><div class="ctl">${rangeHtml(`min="0" max="90" value="${+s.dim}" data-theme="dim"`, '%')}</div></div>
    <div class="set"><div><h3>Weichzeichnen</h3><p>Unschärfe des Hintergrundbilds</p></div><div class="ctl">${rangeHtml(`min="0" max="20" value="${+s.blur}" data-theme="blur"`, ' px')}</div></div>
  </div>`;
}

function bindAppearance(s) {
  const state = { ...s };
  const save = () => api.setSettings({ bg: state.bg, c1: state.c1, c2: state.c2, dim: state.dim, blur: state.blur, accent: state.accent });
  const setTrig = (key, val) => {
    const el = document.querySelector(`.cp-trigger[data-theme="${key}"]`);
    if (el) {
      el.dataset.value = val;
      el.style.setProperty('--c', val);
    }
  };
  const clearPreset = () => document.querySelectorAll('.sw.on').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('[data-theme]').forEach(el => {
    const k = el.dataset.theme;
    if (el.classList.contains('cp-trigger')) {
      el.addEventListener('colorinput', e => {
        state[k] = e.detail;
        if (k !== 'accent') {
          state.bg = 'custom';
          clearPreset();
        }
        applyTheme(state);
      });
      el.addEventListener('colorchange', async () => {
        await save();
        status('Gespeichert');
      });
      return;
    }
    el.oninput = () => {
      state[k] = +el.value;
      applyTheme(state);
    };
    el.onchange = async () => {
      await save();
      status('Gespeichert');
    };
  });
  document.querySelectorAll('[data-bg]').forEach(b => {
    b.onclick = async () => {
      const p = PRESETS.find(x => x[0] === b.dataset.bg);
      state.bg = b.dataset.bg;
      if (p) {
        state.c1 = p[2];
        state.c2 = p[3];
        setTrig('c1', p[2]);
        setTrig('c2', p[3]);
      }
      clearPreset();
      b.classList.add('on');
      await save();
      applyTheme(state);
    };
  });
  const reset = document.querySelector('[data-accreset]');
  if (reset) reset.onclick = async () => {
    state.accent = '#2f5fe0';
    setTrig('accent', state.accent);
    applyTheme(state);
    await save();
    status('Akzentfarbe zurückgesetzt');
  };
  const pick = document.querySelector('[data-bgpick]');
  if (pick) pick.onclick = async () => {
    try {
      if (await api.pickBackground()) {
        state.bg = 'image';
        await save();
        await applyTheme(state);
        renderSettings();
      }
    } catch (e) {
      err(e);
    }
  };
  const clr = document.querySelector('[data-bgclear]');
  if (clr) clr.onclick = async () => {
    await api.clearBackground();
    state.bg = 'saphir';
    state.c1 = '#243e75';
    state.c2 = '#0b1630';
    await save();
    await applyTheme(state);
    renderSettings();
  };
}

function ask(title, text, okLabel) {
  return new Promise(res => {
    $('#c-title').textContent = title;
    $('#c-text').textContent = text;
    $('#c-yes').textContent = okLabel;
    const m = $('#cmodal');
    showEl(m);
    const done = v => {
      hideEl(m);
      $('#c-yes').onclick = null;
      $('#c-no').onclick = null;
      res(v);
    };
    $('#c-yes').onclick = () => done(true);
    $('#c-no').onclick = () => done(false);
  });
}

function setLoaderSeg() {
  document.querySelectorAll('#m-loader button').forEach(b => b.classList.toggle('on', b.dataset.loader === newLoader));
}

async function openNewModal() {
  newLoader = 'fabric';
  newCover = false;
  api.pickCover(true);
  const inp = $('#m-name');
  inp.disabled = false;
  inp.readOnly = false;
  inp.value = '';
  $('#m-covname').textContent = 'Kein Bild';
  setLoaderSeg();
  showEl($('#modal'));
  requestAnimationFrame(() => inp.focus());
}

function loadImg(url) {
  if (!skinImgs[url]) skinImgs[url] = new Promise(res => {
    const i = new Image();
    i.onload = () => res(i);
    i.src = url;
  });
  return skinImgs[url];
}

function drawSkin(canvas, img, slim, back, s) {
  const c = canvas.getContext('2d');
  canvas.width = 16 * s;
  canvas.height = 32 * s;
  c.imageSmoothingEnabled = false;
  const legacy = img.height < 64;
  const aw = slim ? 3 : 4;
  const P = (sx, sy, w, h, dx, dy, flip) => {
    c.save();
    if (flip) {
      c.translate((dx + w) * s, dy * s);
      c.scale(-1, 1);
      c.drawImage(img, sx, sy, w, h, 0, 0, w * s, h * s);
    } else c.drawImage(img, sx, sy, w, h, dx * s, dy * s, w * s, h * s);
    c.restore();
  };
  const sides = back ? ['L', 'R'] : ['R', 'L'];
  const limbs = overlay => sides.forEach((sd, k) => {
    const isL = sd === 'L';
    if (overlay && legacy) return;
    const arm = overlay ? (isL ? [48, 48] : [40, 32]) : (isL && !legacy ? [32, 48] : [40, 16]);
    const leg = overlay ? (isL ? [0, 48] : [0, 32]) : (isL && !legacy ? [16, 48] : [0, 16]);
    const flip = !overlay && isL && legacy;
    P(arm[0] + (back ? 8 + aw : 4), arm[1] + 4, aw, 12, k === 0 ? 4 - aw : 12, 8, flip);
    P(leg[0] + (back ? 12 : 4), leg[1] + 4, 4, 12, k === 0 ? 4 : 8, 20, flip);
  });
  limbs(false);
  P(back ? 32 : 20, 20, 8, 12, 4, 8);
  P(back ? 24 : 8, 8, 8, 8, 4, 0);
  if (!legacy) {
    limbs(true);
    P(back ? 32 : 20, 36, 8, 12, 4, 8);
  }
  P(back ? 56 : 40, 8, 8, 8, 4, 0);
}

async function paintSkin(canvas, url, slim, back, s) {
  if (!canvas) return;
  drawSkin(canvas, await loadImg(url), slim, back, s);
}


/* ───────── Skin auf dem Startscreen + Avatar im Header ───────── */
const cachedSkin = () => {
  try { return JSON.parse(localStorage.getItem('skinCache')); } catch { return null; }
};
function setHomeSkin(p) {
  homeSkin = p;
  try { localStorage.setItem('skinCache', JSON.stringify({ name: p.name, skin: p.skin })); } catch {}
  paintAvatar();
}
function clearSkin() {
  homeSkin = null;
  skinLoaded = false;
  localStorage.removeItem('skinCache');
  paintAvatar();
}
async function getHomeSkin() {
  if (!homeSkin) setHomeSkin(await api.skinProfile());
  return homeSkin;
}
async function paintAvatar() {
  const c = $('#acct-av');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 20, 20);
  ctx.imageSmoothingEnabled = false;
  const src = homeSkin ? homeSkin.skin : (cachedSkin() || {}).skin;
  if (!account || !src) return;
  const img = await loadImg(src.dataUrl);
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 20, 20);
  ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 20, 20);
}
async function loadHomeSkin() {
  const host = $('#stagehost');
  if (!host) return;
  if (!account) {
    setStageSkin(null);
    return stageMsg(host, '<span>Melde dich an, um deinen Skin zu sehen.</span><button class="chip play" data-login>Anmelden</button>');
  }
  stageMsg(host, '');
  const c = cachedSkin();
  const hasCache = !!(c && c.skin);
  if (hasCache && !homeSkin) setStageSkin({ dataUrl: c.skin.dataUrl, variant: c.skin.variant, name: c.name });
  try {
    const p = await getHomeSkin();
    if (view !== 'home') return;
    setStageSkin(p.skin ? { dataUrl: p.skin.dataUrl, variant: p.skin.variant, name: p.name } : null);
    stageMsg($('#stagehost'), p.skin ? '' : 'Dieses Konto hat keinen Skin.');
  } catch (e) {
    if (view === 'home' && !hasCache) stageMsg($('#stagehost'), esc(cleanMsg(e)));
  }
}

async function renderSkins(refresh = true) {
  if (refresh || !skinLoaded) {
    $('#view').innerHTML = '<div class="empty"><i class="spinner"></i>Lade…</div>';
    const [lib, prof] = await Promise.all([api.skinLibrary(), api.skinProfile().catch(e => ({ error: cleanMsg(e) }))]);
    if (view !== 'skins') return;
    skinData = { lib, profile: prof.error ? null : prof, error: prof.error || '' };
    skinLoaded = true;
    if (skinData.profile) setHomeSkin(skinData.profile);
  }
  const { lib } = skinData;
  const p = skinData.profile;
  const items = [];
  if (p && p.skin) items.push({ key: 'current', name: p.name + ' (aktuell)', dataUrl: p.skin.dataUrl, variant: p.skin.variant, current: true });
  lib.forEach(s => items.push({ key: s.id, name: s.name, dataUrl: s.dataUrl, variant: s.variant }));
  if (!items.find(i => i.key === skinSel)) skinSel = items.length ? items[0].key : null;
  const sel = items.find(i => i.key === skinSel);
  $('#view').innerHTML = `
    <h2>Skins</h2>
    ${p ? '' : `<p class="hint">${esc(skinData.error)}</p>`}
    <div class="toolbar">
      <button class="chip play sm" data-skinadd>Skin hochladen</button>
      <input id="skinname" class="search sm" placeholder="Spielername" maxlength="16">
      <button class="chip btn sm" data-skinimport>Importieren</button>
      ${p ? '<button class="chip btn sm" data-skinsave>Aktuellen Skin sichern</button>' : ''}
    </div>
    <div class="skinlayout">
      <div class="skinprev">${sel ? `
        <div id="stagehost" class="stagehost mini"></div>
        <h3>${esc(sel.name)}</h3>
        <div class="btns2"><button class="chip btn sm" data-stage="spin">Drehen: ${skinSpin ? 'An' : 'Aus'}</button><button class="chip btn sm" data-stage="walk">Laufen: ${skinWalk ? 'An' : 'Aus'}</button><button class="chip btn sm" data-stage="reset">Zurücksetzen</button></div>
        <div class="seg"><button class="${sel.variant === 'classic' ? 'on' : ''}" data-skinvar="classic"${sel.current ? ' disabled' : ''}>Classic</button><button class="${sel.variant === 'slim' ? 'on' : ''}" data-skinvar="slim"${sel.current ? ' disabled' : ''}>Slim</button></div>
        <div class="btns2">${p && !sel.current ? '<button class="chip play" data-skinapply>Anwenden</button>' : ''}${sel.current ? '' : '<button class="chip danger" data-skindel>Löschen</button>'}</div>
        ${p && p.capes.length ? `<label class="lbl">Cape<select id="cape" class="chip"><option value="">Kein Cape</option>${p.capes.map(c => `<option value="${esc(c.id)}"${c.active ? ' selected' : ''}>${esc(c.alias)}</option>`).join('')}</select></label>` : ''}`
        : '<div class="empty">Noch keine Skins. Lade einen hoch oder importiere einen Spieler.</div>'}
      </div>
      <div class="skingrid stag">${items.map(i => `<div class="scard${i.key === skinSel ? ' on' : ''}" data-skinsel="${esc(i.key)}"><canvas data-k="${esc(i.key)}"></canvas><p>${esc(i.name)}</p></div>`).join('')}</div>
    </div>`;
  items.forEach(i => paintSkin(document.querySelector(`canvas[data-k="${CSS.escape(i.key)}"]`), i.dataUrl, i.variant === 'slim', false, 3));
  if (sel) {
    mountStage($('#stagehost'), { dist: 88, auto: skinSpin, pose: skinWalk ? 'walk' : 'idle' });
    setStageSkin({ dataUrl: sel.dataUrl, variant: sel.variant, name: sel.name });
  }
  const cp = $('#cape');
  if (cp) cp.onchange = async () => {
    try {
      await api.capeSet(cp.value || null);
      status('Cape gesetzt');
    } catch (e) {
      err(e);
    }
  };
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-logcopy],[data-logfolder],[data-skinadd],[data-skinimport],[data-skinsave],[data-skinsel],[data-skinvar],[data-skinapply],[data-skindel],[data-loader],[data-stage],#m-cover');
  if (!t) return;
  const d = t.dataset;
  const has = a => t.hasAttribute('data-' + a);
  try {
    if (has('logcopy')) {
      await api.copyText(logState.text);
      return status('Log kopiert');
    }
    if (has('logfolder')) return api.openLogs(cur);
    if (d.loader) {
      newLoader = d.loader;
      return setLoaderSeg();
    }
    if (t.id === 'm-cover') {
      const n = await api.pickCover();
      newCover = !!n;
      $('#m-covname').textContent = n || 'Kein Bild';
      return;
    }
    if (d.stage === 'spin') {
      skinSpin = !skinSpin;
      Stage.auto = skinSpin;
      Stage.dirty = true;
      t.textContent = 'Drehen: ' + (skinSpin ? 'An' : 'Aus');
      return;
    }
    if (d.stage === 'walk') {
      skinWalk = !skinWalk;
      Stage.pose = skinWalk ? 'walk' : 'idle';
      t.textContent = 'Laufen: ' + (skinWalk ? 'An' : 'Aus');
      return;
    }
    if (d.stage === 'reset') {
      Object.assign(Stage, { yaw: -0.6, pitch: 0.1, dist: 88, dirty: true });
      return;
    }
    if (has('skinadd')) {
      const s = await api.skinAdd();
      if (s) {
        skinSel = s.id;
        status('Skin hinzugefügt');
        renderSkins();
      }
      return;
    }
    if (has('skinimport')) {
      status('Importiere Skin…');
      const s = await api.skinImport($('#skinname').value);
      skinSel = s.id;
      status('Skin von ' + s.name + ' importiert');
      return renderSkins();
    }
    if (has('skinsave')) {
      const s = await api.skinSaveCurrent();
      skinSel = s.id;
      status('Skin gesichert');
      return renderSkins();
    }
    if (d.skinsel) {
      skinSel = d.skinsel;
      return renderSkins(false);
    }
    if (d.skinvar) {
      await api.skinUpdate({ id: skinSel, variant: d.skinvar });
      skinData.lib = await api.skinLibrary();
      return renderSkins(false);
    }
    if (has('skinapply')) {
      t.disabled = true;
      status('Wende Skin an…');
      await api.skinApply(skinSel);
      clearSkin();
      status('Skin angewendet');
      toast('Skin angewendet', 'ok');
      skinSel = 'current';
      return renderSkins();
    }
    if (has('skindel')) {
      if (!(await ask('Skin löschen', 'Dieser Skin wird aus deiner Bibliothek entfernt.', 'Löschen'))) return;
      await api.skinDelete(skinSel);
      skinSel = 'current';
      return renderSkins();
    }
  } catch (er) {
    err(er);
    if (t.disabled) t.disabled = false;
  }
});

/* ───────── 3D-Bühne (eine Instanz, wird in Startscreen / Skin-Seite eingehängt) ───────── */
const Stage = {
  r: null, scene: null, camera: null, pivot: null, model: null, canvas: null, ro: null,
  skin: null, loaded: null, raf: 0, last: 0, t: 0, k: 1, intro: 1,
  yaw: -0.6, pitch: 0.1, dist: 88, drag: null, auto: false, pose: 'idle',
  look: { x: 0, y: 0 }, dirty: true
};

function stageMsg(host, html) {
  if (!host) return;
  let m = host.querySelector('.stagemsg');
  if (!m) {
    m = document.createElement('div');
    m.className = 'stagemsg';
    host.appendChild(m);
  }
  m.innerHTML = html || '';
  m.hidden = !html;
}

function mirror(c, src, sx, sy, w, h, dx, dy) {
  c.save();
  c.translate(dx + w, dy);
  c.scale(-1, 1);
  c.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  c.restore();
}

function legacyLimb(c, src, ox, oy, nx, ny) {
  mirror(c, src, ox + 4, oy, 4, 4, nx + 4, ny);
  mirror(c, src, ox + 8, oy, 4, 4, nx + 8, ny);
  mirror(c, src, ox + 8, oy + 4, 4, 12, nx, ny + 4);
  mirror(c, src, ox + 4, oy + 4, 4, 12, nx + 4, ny + 4);
  mirror(c, src, ox, oy + 4, 4, 12, nx + 8, ny + 4);
  mirror(c, src, ox + 12, oy + 4, 4, 12, nx + 12, ny + 4);
}

function skinTexture(img) {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(img, 0, 0);
  if (img.height < 64) {
    legacyLimb(c, img, 0, 16, 16, 48);
    legacyLimb(c, img, 40, 16, 32, 48);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function faceUV(geo, f, x, y, w, h) {
  const uv = geo.attributes.uv;
  const u0 = x / 64;
  const u1 = (x + w) / 64;
  const v0 = 1 - y / 64;
  const v1 = 1 - (y + h) / 64;
  const i = f * 4;
  uv.setXY(i, u0, v0);
  uv.setXY(i + 1, u1, v0);
  uv.setXY(i + 2, u0, v1);
  uv.setXY(i + 3, u1, v1);
}

function boxUV(geo, u, v, w, h, d) {
  faceUV(geo, 0, u + d + w, v + d, d, h);
  faceUV(geo, 1, u, v + d, d, h);
  faceUV(geo, 2, u + d, v, w, d);
  faceUV(geo, 3, u + d + w, v, w, d);
  faceUV(geo, 4, u + d, v + d, w, h);
  faceUV(geo, 5, u + d + w + d, v + d, w, h);
  geo.attributes.uv.needsUpdate = true;
}


function buildModel(img, slim) {
  const tex = skinTexture(img);
  const legacy = img.height < 64;
  const aw = slim ? 3 : 4;
  const root = new THREE.Group();
  const parts = {};
  const box = (w, h, d, u, v, grow) => {
    const geo = new THREE.BoxGeometry(w + grow, h + grow, d + grow);
    boxUV(geo, u, v, w, h, d);
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
  };
  const joint = (name, x, y, list) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    list.forEach(([w, h, d, u, v, grow, dy]) => {
      const m = box(w, h, d, u, v, grow);
      m.position.y = dy;
      g.add(m);
    });
    root.add(g);
    parts[name] = g;
  };
  const ov = (on, def) => (on && !legacy ? [def] : []);
  joint('head', 0, 24, [[8, 8, 8, 0, 0, 0, 4], [8, 8, 8, 32, 0, 1, 4]]);
  joint('body', 0, 18, [[8, 12, 4, 16, 16, 0, 0], ...ov(true, [8, 12, 4, 16, 32, 0.5, 0])]);
  joint('armR', -(4 + aw / 2), 24, [[aw, 12, 4, 40, 16, 0, -6], ...ov(true, [aw, 12, 4, 40, 32, 0.5, -6])]);
  joint('armL', 4 + aw / 2, 24, [[aw, 12, 4, 32, 48, 0, -6], ...ov(true, [aw, 12, 4, 48, 48, 0.5, -6])]);
  joint('legR', -2, 12, [[4, 12, 4, 0, 16, 0, -6], ...ov(true, [4, 12, 4, 0, 32, 0.5, -6])]);
  joint('legL', 2, 12, [[4, 12, 4, 16, 48, 0, -6], ...ov(true, [4, 12, 4, 0, 48, 0.5, -6])]);
  root.position.y = -16;
  root.userData = { tex, parts };
  return root;
}

function disposeModel(m) {
  m.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  if (m.userData.tex) m.userData.tex.dispose();
}


function fitStage() {
  const h = Stage.canvas && Stage.canvas.parentElement;
  if (!h) return;
  const w = h.clientWidth;
  const ht = h.clientHeight;
  if (!w || !ht) return;
  Stage.r.setSize(w, ht, false);
  Stage.camera.aspect = w / ht;
  Stage.camera.updateProjectionMatrix();
  Stage.dirty = true;
}

function ensureStage() {
  if (Stage.r) return Stage;
  if (typeof THREE === 'undefined') return null;
  const canvas = document.createElement('canvas');
  let r;
  try {
    r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 500);
  camera.position.set(0, 4, 88);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dl = new THREE.DirectionalLight(0xffffff, 0.5);
  dl.position.set(20, 40, 60);
  scene.add(dl);
  const pivot = new THREE.Group();
  scene.add(pivot);
  Object.assign(Stage, { r, scene, camera, pivot, canvas });
  canvas.addEventListener('pointerdown', ev => {
    Stage.drag = { x: ev.clientX, y: ev.clientY };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', ev => {
    const b = canvas.getBoundingClientRect();
    Stage.look.x = clamp(((ev.clientX - b.left) / b.width) * 2 - 1, -1, 1);
    Stage.look.y = clamp(((ev.clientY - b.top) / b.height) * 2 - 1, -1, 1);
    if (!Stage.drag) return;
    Stage.yaw += (ev.clientX - Stage.drag.x) * 0.012;
    Stage.pitch = clamp(Stage.pitch + (ev.clientY - Stage.drag.y) * 0.008, -0.9, 0.9);
    Stage.drag = { x: ev.clientX, y: ev.clientY };
    Stage.dirty = true;
  });
  const end = () => (Stage.drag = null);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => {
    Stage.look.x = 0;
    Stage.look.y = 0;
  });
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    Stage.dist = clamp(Stage.dist + ev.deltaY * 0.05, 45, 140);
    Stage.dirty = true;
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    const prev = Stage.pose;
    Stage.pose = 'walk';
    setTimeout(() => {
      if (prev !== 'walk' && Stage.pose === 'walk') Stage.pose = 'idle';
    }, 2800);
  });
  document.addEventListener('visibilitychange', startStage);
  return Stage;
}

function animateModel(dt) {
  const m = Stage.model;
  const P = m && m.userData.parts;
  if (!P) return;
  const t = Stage.t;
  const a = CFG.anim ? 1 : 0;
  const k = Math.min(1, dt * 10);
  const walk = Stage.pose === 'walk';
  const to = (o, ax, v) => { o.rotation[ax] += (v - o.rotation[ax]) * k; };
  const sw = Math.sin(t * 5.5) * 0.75;
  const br = Math.sin(t * 1.7) * a;
  to(P.armR, 'x', walk ? sw : 0);
  to(P.armL, 'x', walk ? -sw : 0);
  to(P.legR, 'x', walk ? -sw : 0);
  to(P.legL, 'x', walk ? sw : 0);
  to(P.armR, 'z', -0.05 - br * 0.04);
  to(P.armL, 'z', 0.05 + br * 0.04);
  to(P.head, 'y', Stage.look.x * 0.55 * a + Math.sin(t * 0.8) * 0.1 * a);
  to(P.head, 'x', Stage.look.y * 0.3 * a);
  m.position.y = -16 + (walk ? Math.abs(Math.sin(t * 5.5)) * 0.8 : br * 0.25);
}

function tick(now) {
  const S = Stage;
  if (!S.r || !S.canvas.isConnected || document.hidden) {
    S.raf = 0;
    return;
  }
  const dt = Math.min(0.05, S.last ? (now - S.last) / 1000 : 0.016);
  S.last = now;
  const live = CFG.anim || S.auto || S.pose === 'walk' || S.drag || S.intro < 1;
  if (live || S.dirty) {
    S.t += dt;
    if (S.intro < 1) S.intro = Math.min(1, S.intro + dt / 0.9);
    if (S.auto && !S.drag) S.yaw += dt * 0.55;
    S.k += ((S.drag || S.auto || !CFG.anim ? 0 : 1) - S.k) * Math.min(1, dt * 4);
    const e = CFG.anim ? 1 - Math.pow(1 - S.intro, 3) : 1;
    S.pivot.rotation.y = S.yaw + Math.sin(S.t * 0.6) * 0.32 * S.k - (1 - e) * 2.4;
    S.pivot.rotation.x = S.pitch;
    S.camera.position.z = S.dist;
    if (S.model) {
      animateModel(dt);
      S.model.scale.setScalar(0.85 + 0.15 * e);
    }
    S.r.render(S.scene, S.camera);
    S.dirty = false;
  }
  S.raf = requestAnimationFrame(tick);
}

function startStage() {
  if (Stage.r && !Stage.raf && Stage.canvas.isConnected && !document.hidden) {
    Stage.last = 0;
    Stage.raf = requestAnimationFrame(tick);
  }
}

async function loadModel() {
  const S = ensureStage();
  if (!S) return;
  const sk = S.skin;
  if (S.model) {
    S.pivot.remove(S.model);
    disposeModel(S.model);
    S.model = null;
  }
  S.loaded = null;
  S.dirty = true;
  if (!sk) return;
  const img = await loadImg(sk.dataUrl);
  if (Stage.skin !== sk) return;
  S.model = buildModel(img, sk.variant === 'slim');
  S.pivot.add(S.model);
  S.loaded = sk;
  S.intro = CFG.anim ? 0 : 1;
  S.dirty = true;
  startStage();
}

function setStageSkin(sk) {
  const L = Stage.loaded;
  if (sk && L && sk.dataUrl === L.dataUrl && sk.variant === L.variant) {
    Stage.skin = L;
    return;
  }
  Stage.skin = sk;
  if (Stage.canvas && Stage.canvas.isConnected) loadModel();
}

function mountStage(host, o = {}) {
  const S = ensureStage();
  if (!S) {
    stageMsg(host, '3D wird von deinem System nicht unterstützt.');
    return false;
  }
  host.prepend(S.canvas);
  Object.assign(S, { dist: o.dist || 88, auto: !!o.auto, pose: o.pose || 'idle', yaw: -0.6, pitch: 0.1, intro: CFG.anim ? 0 : 1, dirty: true });
  if (S.ro) S.ro.disconnect();
  S.ro = new ResizeObserver(fitStage);
  S.ro.observe(host);
  fitStage();
  if (S.skin !== S.loaded) loadModel();
  startStage();
  return true;
}

/* Beim Zurückkehren ins Fenster: Cursor-Position im Eingabefeld neu setzen */
function initFocusFix() {
  window.addEventListener('focus', () => {
    const a = document.activeElement;
    if (a && a.matches && a.matches('input')) {
      a.blur();
      a.focus();
    }
  });
}

const logState = { file: 'live', text: '', timer: 0, fresh: true };

function logsShellHtml() {
  return `<div class="toolbar" style="margin-top:6px">
      <select id="logfile" class="chip"></select>
      <input id="logfilter" class="search" placeholder="Filtern, z. B. ERROR">
      <label class="chk"><input type="checkbox" id="logauto" checked> Live</label>
      <button class="chip btn sm" data-logcopy>Kopieren</button>
      <button class="chip btn sm" data-logfolder>Ordner öffnen</button>
    </div>
    <pre id="logview" class="logview"></pre>`;
}

function logClass(l) {
  if (/\b(ERROR|FATAL)\b|Exception|Caused by|^\s+at /.test(l)) return 'e';
  if (/\bWARN/.test(l)) return 'w';
  if (/\b(DEBUG|TRACE)\b/.test(l)) return 'd';
  return '';
}

function paintLog() {
  const box = document.querySelector('#logview');
  if (!box) return;
  const f = (document.querySelector('#logfilter').value || '').toLowerCase();
  let lines = logState.text.split(/\r?\n/);
  if (f) lines = lines.filter(l => l.toLowerCase().includes(f));
  lines = lines.slice(-2500);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = lines.length && logState.text
    ? lines.map(l => `<span class="${logClass(l)}">${esc(l) || ' '}</span>`).join('')
    : '<span class="d">Noch keine Logs. Starte das Modpack, dann erscheinen sie hier.</span>';
  if (atBottom || logState.fresh) box.scrollTop = box.scrollHeight;
  logState.fresh = false;
}

async function loadLog() {
  if (view !== 'inst' || itab !== 'logs') return;
  try {
    logState.text = await api.readLog({ instId: cur, file: logState.file });
  } catch {
    logState.text = '';
  }
  paintLog();
}

async function initLogs() {
  clearInterval(logState.timer);
  const files = await api.logFiles(cur);
  const sel = document.querySelector('#logfile');
  if (!sel) return;
  logState.file = running.has(cur) ? 'live' : files.find(f => f.id === 'logs/latest.log') ? 'logs/latest.log' : 'live';
  sel.innerHTML = files.map(f => `<option value="${esc(f.id)}"${f.id === logState.file ? ' selected' : ''}>${esc(f.label)}</option>`).join('');
  sel.onchange = () => {
    logState.file = sel.value;
    logState.fresh = true;
    loadLog();
  };
  document.querySelector('#logfilter').oninput = paintLog;
  logState.fresh = true;
  await loadLog();
  logState.timer = setInterval(() => {
    if (view !== 'inst' || itab !== 'logs') return clearInterval(logState.timer);
    const a = document.querySelector('#logauto');
    if (a && a.checked) loadLog();
  }, 1500);
}
