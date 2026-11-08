/* SaphirMod UI-Bausteine: Farben, Menüs, Color Picker, Slider, Toasts, Palette */
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CFG = { anim: true, fx: true, spin: false, sound: true, soundVol: 50, accent: '#2f5fe0' };

/* ───────── Farben ───────── */
const hex2rgb = h => {
  h = String(h || '').replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const shade = (hex, dv, ds = 0) => {
  const [h, s, v] = rgb2hsv(...(hex2rgb(hex) || [47, 95, 224]));
  return rgb2hex(...hsv2rgb(h, clamp(s + ds, 0, 1), clamp(v + dv, 0, 1)));
};

/* Akzentfarbe + Animations-Schalter auf die Oberfläche anwenden */
function applyUi(s) {
  Object.assign(CFG, { anim: s.anim !== false, fx: s.fx !== false, spin: !!s.spin, sound: s.sound !== false, soundVol: s.soundVol == null ? 50 : clamp(+s.soundVol || 0, 0, 100), accent: hex2rgb(s.accent) ? s.accent : '#2f5fe0' });
  const h = document.documentElement, st = h.style, a = CFG.accent;
  st.setProperty('--acc', a);
  st.setProperty('--acc-rgb', hex2rgb(a).join(','));
  st.setProperty('--accl', shade(a, 0.25, -0.35));
  st.setProperty('--acc-hi', shade(a, 0.07));
  st.setProperty('--acc-lo', shade(a, -0.12));
  h.classList.toggle('no-anim', !CFG.anim);
  h.classList.toggle('no-fx', !CFG.fx);
  if (typeof Stage !== 'undefined') Stage.dirty = true;
}

/* ───────── Dialoge ein-/ausblenden (mit Animation) ───────── */
const showEl = el => {
  if (el.classList.contains('hide')) sfx('open');
  el.classList.remove('hide', 'closing');
};
const hideEl = el => {
  if (el.classList.contains('hide')) return;
  sfx('close');
  if (!CFG.anim) return el.classList.add('hide');
  el.classList.add('closing');
  setTimeout(() => {
    if (el.classList.contains('closing')) {
      el.classList.add('hide');
      el.classList.remove('closing');
    }
  }, 160);
};

/* ───────── Toasts ───────── */
function toast(msg, kind = 'info', ms = 3800, onClick) {
  const box = qs('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  t.style.setProperty('--ms', ms + 'ms');
  box.appendChild(t);
  sfx(kind === 'ok' ? 'ok' : kind === 'error' ? 'err' : 'info');
  while (box.children.length > 4) box.firstChild.remove();
  const close = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), CFG.anim ? 220 : 0);
  };
  t.onclick = () => {
    close();
    if (onClick) onClick();
  };
  if (onClick) t.style.cursor = 'pointer';
  setTimeout(close, ms);
}

/* ───────── Menü ───────── */
let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  const m = menuEl;
  menuEl = null;
  if (m._anchor) m._anchor.removeAttribute('aria-expanded');
  m.classList.add('out');
  setTimeout(() => m.remove(), CFG.anim ? 120 : 0);
  document.removeEventListener('pointerdown', menuOutside, true);
}
function menuOutside(e) {
  if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-menu-anchor]')) closeMenu();
}
function openMenu(anchor, items, o = {}) {
  if (o.at) {
    const { x, y } = anchor.at;
    anchor = { offsetWidth: 0, getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0 }), setAttribute() {}, removeAttribute() {} };
  }
  if (menuEl && menuEl._anchor === anchor) return closeMenu();
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu' + (o.cls ? ' ' + o.cls : '');
  sfx('menu');
  items.forEach((it, n) => {
    if (it === '-') return m.appendChild(document.createElement('hr'));
    const b = document.createElement('button');
    b.style.setProperty('--n', n);
    b.type = 'button';
    b.className = 'mi' + (it.active ? ' on' : '') + (it.danger ? ' danger' : '');
    b.innerHTML = `<span class="mt">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.active ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>' : ''}`;
    b.onclick = () => {
      closeMenu();
      if (it.act) it.act();
    };
    m.appendChild(b);
  });
  m._anchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  m.style.minWidth = Math.max(o.minWidth || 0, anchor.offsetWidth, 200) + 'px';
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = o.align === 'right' ? r.right - w : o.align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
  const gap = o.at ? 2 : 8, minTop = o.at ? 8 : 62;
  let top = o.up ? r.top - h - 8 : r.bottom + gap;
  if (top < minTop) top = Math.max(minTop, r.bottom + gap);
  if (top + h > innerHeight - 8) top = Math.max(minTop, innerHeight - h - 8);
  m.style.left = clamp(left, 8, innerWidth - w - 8) + 'px';
  m.style.top = top + 'px';
  menuEl = m;
  document.addEventListener('pointerdown', menuOutside, true);
}

/* ───────── Eigene Auswahlfelder (ersetzen <select>) ───────── */
function refreshSelect(sel) {
  const b = sel._btn;
  if (!b) return;
  const o = sel.options[sel.selectedIndex];
  b.firstChild.textContent = o ? o.textContent : '';
  b.disabled = sel.disabled;
}
function enhanceSelects(root = document) {
  qsa('select:not([data-enh])', root).forEach(sel => {
    sel.dataset.enh = '1';
    sel.style.display = 'none';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = sel.className + ' sel';
    b.dataset.menuAnchor = '1';
    b.innerHTML = '<span></span><svg viewBox="0 0 12 8"><path d="M1 1l5 5 5-5"/></svg>';
    sel.after(b);
    sel._btn = b;
    refreshSelect(sel);
    b.onclick = () => openMenu(b, [...sel.options].map(o => ({
      label: o.textContent,
      active: o.value === sel.value,
      act: () => {
        sel.value = o.value;
        refreshSelect(sel);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })));
  });
}

/* ───────── Slider ───────── */
function syncRange(el) {
  const min = +el.min || 0, max = +el.max || 100;
  el.style.setProperty('--p', ((el.value - min) / (max - min)) * 100 + '%');
  const o = el.parentElement.querySelector('output');
  if (o) o.textContent = el.value + (el.dataset.unit || '');
}
const rangeHtml = (attrs, unit = '') => `<div class="rng"><input type="range" ${attrs} data-unit="${unit}"><output></output></div>`;
document.addEventListener('input', e => {
  if (e.target.matches && e.target.matches('input[type=range]')) syncRange(e.target);
});

/* ───────── Color Picker ───────── */
const PALETTE = ['#2f5fe0', '#7aa2ff', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#0ea5e9', '#243e75', '#0b1630', '#1f6b5a', '#7a2b3d', '#3a4150', '#ffffff', '#000000'];
const recentColors = () => { try { return JSON.parse(localStorage.getItem('recentColors') || '[]'); } catch { return []; } };
const addRecent = c => {
  try { localStorage.setItem('recentColors', JSON.stringify([c, ...recentColors().filter(x => x !== c)].slice(0, 8))); } catch {}
};
let cpEl = null;
function closePicker() {
  if (!cpEl) return;
  const el = cpEl;
  cpEl = null;
  document.removeEventListener('pointerdown', cpOutside, true);
  if (el._commit) el._commit();
  el.classList.add('out');
  setTimeout(() => el.remove(), CFG.anim ? 120 : 0);
}
function cpOutside(e) {
  if (cpEl && !cpEl.contains(e.target) && !e.target.closest('.cp-trigger')) closePicker();
}
function openPicker(anchor, color, o = {}) {
  if (cpEl && cpEl._anchor === anchor) return closePicker();
  closePicker();
  let [h, s, v] = rgb2hsv(...(hex2rgb(color) || [47, 95, 224]));
  let cur = rgb2hex(...hsv2rgb(h, s, v));
  let dirty = false;
  const el = document.createElement('div');
  el.className = 'cp';
  el._anchor = anchor;
  const recent = recentColors();
  const sw = [...recent, ...PALETTE.filter(c => !recent.includes(c))].slice(0, 16);
  el.innerHTML = `<div class="cp-sv"><i class="cp-knob"></i></div><div class="cp-hue"><i class="cp-knob"></i></div>
    <div class="cp-row"><i class="cp-prev"></i><input class="cp-hex" maxlength="7" spellcheck="false" aria-label="Hex-Farbe">${window.EyeDropper ? '<button type="button" class="chip btn sm cp-eye">Pipette</button>' : ''}</div>
    <div class="cp-sw">${sw.map(c => `<button type="button" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div>`;
  document.body.appendChild(el);
  const sv = qs('.cp-sv', el), hue = qs('.cp-hue', el), hex = qs('.cp-hex', el), prev = qs('.cp-prev', el);
  const paint = keepHex => {
    cur = rgb2hex(...hsv2rgb(h, s, v));
    sv.style.setProperty('--h', Math.round(h));
    const k = qs('.cp-knob', sv);
    k.style.left = s * 100 + '%';
    k.style.top = (1 - v) * 100 + '%';
    k.style.background = cur;
    const hk = qs('.cp-knob', hue);
    hk.style.left = (h / 360) * 100 + '%';
    hk.style.background = `hsl(${Math.round(h)} 100% 50%)`;
    prev.style.setProperty('--c', cur);
    if (!keepHex) { hex.value = cur; hex.classList.remove('bad'); }
    qsa('.cp-sw button', el).forEach(b => b.classList.toggle('on', b.dataset.c === cur));
  };
  const emit = () => {
    dirty = true;
    if (o.onInput) o.onInput(cur);
  };
  const commit = () => {
    if (!dirty) return;
    dirty = false;
    addRecent(cur);
    if (o.onChange) o.onChange(cur);
  };
  el._commit = commit;
  const drag = (node, fn) => {
    node.addEventListener('pointerdown', e => {
      e.preventDefault();
      node.setPointerCapture(e.pointerId);
      fn(e);
      const mv = ev => fn(ev);
      const up = () => {
        node.removeEventListener('pointermove', mv);
        node.removeEventListener('pointerup', up);
        commit();
      };
      node.addEventListener('pointermove', mv);
      node.addEventListener('pointerup', up);
    });
  };
  drag(sv, e => {
    const r = sv.getBoundingClientRect();
    s = clamp((e.clientX - r.left) / r.width, 0, 1);
    v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    paint(); emit();
  });
  drag(hue, e => {
    const r = hue.getBoundingClientRect();
    h = clamp((e.clientX - r.left) / r.width, 0, 1) * 359.99;
    paint(); emit();
  });
  const setHex = c => {
    const rgb = hex2rgb(c);
    if (!rgb) return false;
    [h, s, v] = rgb2hsv(...rgb);
    return true;
  };
  hex.addEventListener('input', () => {
    const val = hex.value.startsWith('#') ? hex.value : '#' + hex.value;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val) && setHex(val)) { paint(true); emit(); hex.classList.remove('bad'); }
    else hex.classList.add('bad');
  });
  hex.addEventListener('keydown', e => { if (e.key === 'Enter') { paint(); commit(); } });
  hex.addEventListener('blur', () => paint());
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-c]');
    if (b && setHex(b.dataset.c)) { paint(); emit(); commit(); return; }
    if (e.target.closest('.cp-eye')) {
      try {
        const r = await new EyeDropper().open();
        if (setHex(r.sRGBHex)) { paint(); emit(); commit(); }
      } catch {}
    }
  });
  paint();
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, hh = el.offsetHeight;
  let top = r.bottom + 8;
  if (top + hh > innerHeight - 8) top = Math.max(62, r.top - hh - 8);
  el.style.left = clamp(r.right - w, 8, innerWidth - w - 8) + 'px';
  el.style.top = top + 'px';
  cpEl = el;
  document.addEventListener('pointerdown', cpOutside, true);
}
document.addEventListener('click', e => {
  const t = e.target.closest('.cp-trigger');
  if (!t) return;
  openPicker(t, t.dataset.value, {
    onInput: c => {
      t.dataset.value = c;
      t.style.setProperty('--c', c);
      t.dispatchEvent(new CustomEvent('colorinput', { detail: c }));
    },
    onChange: c => t.dispatchEvent(new CustomEvent('colorchange', { detail: c }))
  });
});

/* ───────── Befehlspalette (Strg + K) ───────── */
const Pal = { open: false, sel: 0, items: [] };
function palItems(q) {
  const all = [
    { t: 'Start', s: 'Seite', a: () => go('home') },
    { t: 'Bibliothek', s: 'Seite', a: () => go('library') },
    { t: 'Entdecken', s: 'Seite', a: () => go('discover') },
    { t: 'Skins', s: 'Seite', a: () => go('skins') },
    { t: 'Spielersuche', s: 'Seite', a: () => go('players') },
    { t: 'Einstellungen', s: 'Seite', a: () => go('settings') },
    { t: 'Neues Modpack erstellen', s: 'Aktion', a: () => openNewModal() },
    { t: 'Modpack importieren', s: 'Aktion', a: () => importPack() }
  ];
  insts.forEach(i => {
    all.push({ t: 'Spielen: ' + i.name, s: meta(i), tile: i, a: () => play(i.id) });
    all.push({ t: 'Öffnen: ' + i.name, s: 'Modpack', tile: i, a: () => go('inst', i.id) });
  });
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter(x => words.every(w => (x.t + ' ' + x.s).toLowerCase().includes(w))).slice(0, 9);
}
function renderPal() {
  Pal.items = palItems(qs('#pal-q').value);
  Pal.sel = clamp(Pal.sel, 0, Math.max(0, Pal.items.length - 1));
  qs('#pal-list').innerHTML = Pal.items.length
    ? Pal.items.map((x, i) => `<div class="pi${i === Pal.sel ? ' on' : ''}" data-pi="${i}">${x.tile ? tile(x.tile, '') : ''}<b>${esc(x.t)}</b><span>${esc(x.s)}</span></div>`).join('')
    : '<div class="pe">Nichts gefunden.</div>';
}
function openPalette() {
  if (Pal.open) return;
  Pal.open = true;
  Pal.sel = 0;
  qs('#pal-q').value = '';
  showEl(qs('#pal'));
  renderPal();
  setTimeout(() => qs('#pal-q').focus(), 30);
}
function closePalette() {
  if (!Pal.open) return;
  Pal.open = false;
  hideEl(qs('#pal'));
}
function runPal(i) {
  const it = Pal.items[i];
  if (!it) return;
  closePalette();
  it.a();
}
function initPalette() {
  qs('#pal-q').oninput = () => { Pal.sel = 0; renderPal(); };
  qs('#pal-q').onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Pal.items.length || 1;
      Pal.sel = (Pal.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderPal();
      const on = qs('.pi.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') runPal(Pal.sel);
  };
  qs('#pal-list').onclick = e => {
    const r = e.target.closest('[data-pi]');
    if (r) runPal(+r.dataset.pi);
  };
  qs('#pal').onclick = e => { if (e.target.id === 'pal') closePalette(); };
}

/* Esc schließt zuerst Pop-overs, dann die Palette */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (cpEl) { e.stopPropagation(); return closePicker(); }
    if (menuEl) { e.stopPropagation(); return closeMenu(); }
    if (Pal.open) { e.stopPropagation(); return closePalette(); }
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'k') { e.preventDefault(); Pal.open ? closePalette() : openPalette(); }
    if (k === 'f' && !Pal.open) {
      const el = qs('#instq') || qs('#dq') || qs('#libq');
      if (el) { e.preventDefault(); el.focus(); el.select(); }
    }
    if (k === 'n' && qs('#modal').classList.contains('hide') && !Pal.open) { e.preventDefault(); openNewModal(); }
  }
}, true);

/* ───────── Modpack per Drag & Drop importieren ───────── */
let dragDepth = 0;
const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  dragDepth++;
  qs('#drop').classList.add('on');
});
addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) qs('#drop').classList.remove('on');
});
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  qs('#drop').classList.remove('on');
  const f = [...e.dataTransfer.files].find(x => /\.(mrpack|zip)$/i.test(x.name));
  if (!f) return status('Bitte eine .mrpack- oder CurseForge-ZIP-Datei ablegen');
  importDropped(api.pathFor(f));
});

/* ───────── Ansicht: Einblend-Animation + Bausteine nach jedem Rendern ───────── */
let pendingEnter = false;
function initViewFx() {
  const v = qs('#view');
  new MutationObserver(() => {
    enhanceSelects(v);
    qsa('input[type=range]', v).forEach(syncRange);
    if (pendingEnter && v.firstElementChild) {
      pendingEnter = false;
      v.classList.add('enter');
      clearTimeout(v._t);
      v._t = setTimeout(() => v.classList.remove('enter'), 950);
    }
  }).observe(v, { childList: true });
}

/* ───────── Eingabe-Fallback ─────────
   Falls Electron unter Windows Tastendrücke an ein Textfeld liefert, die Zeichen aber
   nicht einfügt, wird der Text hier manuell eingetragen. Funktioniert die normale
   Eingabe, greift dieser Code nicht ein. */
document.addEventListener('keydown', e => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || !['text', 'search', 'url', 'password', ''].includes(t.type)) return;
  if (e.isComposing || e.defaultPrevented || t.readOnly || t.disabled) return;
  const printable = e.key.length === 1 && ((!e.ctrlKey && !e.metaKey) || e.getModifierState('AltGraph'));
  const del = e.key === 'Backspace' || e.key === 'Delete';
  if (!printable && !del) return;
  const before = t.value, s = t.selectionStart, en = t.selectionEnd;
  setTimeout(() => {
    if (t.value !== before || document.activeElement !== t) return;
    if (printable) {
      if (t.maxLength > 0 && before.length - (en - s) >= t.maxLength) return;
      t.setRangeText(e.key, s, en, 'end');
    } else {
      let a = s, b = en;
      if (a === b) {
        if (e.key === 'Backspace') a = Math.max(0, a - 1);
        else b = Math.min(before.length, b + 1);
      }
      if (a === b) return;
      t.setRangeText('', a, b, 'end');
    }
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, 5);
});
