/* Sanfte UI-Sounds (WebAudio-Synth, keine Audiodateien) + Ripple + Karten-Spotlight */
const sfx = (() => {
  let ctx = null, master = null, wet = null;
  const last = {};

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    master = ctx.createGain();
    master.connect(comp);
    comp.connect(ctx.destination);
    /* dezenter Raumklang: Delay mit Feedback + Tiefpass */
    const d = ctx.createDelay(), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    d.delayTime.value = 0.06;
    fb.gain.value = 0.28;
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    wet = ctx.createGain();
    wet.gain.value = 0.22;
    wet.connect(d);
    d.connect(lp);
    lp.connect(fb);
    fb.connect(d);
    lp.connect(master);
    return ctx;
  }

  function tone({ f, to, t = 0.12, g = 0.2, type = 'sine', at = 0, a = 0.008, lp = 4200 }) {
    const t0 = ctx.currentTime + at + 0.005;
    const o = ctx.createOscillator(), v = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + t);
    fl.type = 'lowpass';
    fl.frequency.value = lp;
    v.gain.setValueAtTime(0.0001, t0);
    v.gain.exponentialRampToValueAtTime(g, t0 + a);
    v.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    o.connect(fl);
    fl.connect(v);
    v.connect(master);
    v.connect(wet);
    o.start(t0);
    o.stop(t0 + t + 0.05);
  }

  const P = {
    click: () => { tone({ f: 760, to: 560, t: 0.075 }); tone({ f: 1520, to: 1100, t: 0.05, g: 0.06 }); },
    nav: () => tone({ f: 520, to: 700, t: 0.1 }),
    tab: () => tone({ f: 640, to: 760, t: 0.07, g: 0.16 }),
    on: () => { tone({ f: 600, t: 0.09, g: 0.18 }); tone({ f: 900, t: 0.14, g: 0.18, at: 0.055 }); },
    off: () => { tone({ f: 820, t: 0.09, g: 0.16 }); tone({ f: 560, t: 0.14, g: 0.16, at: 0.055 }); },
    menu: () => tone({ f: 380, to: 540, t: 0.1, g: 0.16 }),
    open: () => { tone({ f: 420, to: 640, t: 0.16, g: 0.18 }); tone({ f: 900, to: 1100, t: 0.14, g: 0.07, at: 0.03 }); },
    close: () => tone({ f: 560, to: 340, t: 0.12, g: 0.15 }),
    ok: () => [659, 831, 988].forEach((f, i) => { tone({ f, t: 0.34, g: 0.15, at: i * 0.07 }); tone({ f: f * 2, t: 0.2, g: 0.04, at: i * 0.07, type: 'triangle' }); }),
    err: () => { tone({ f: 240, to: 190, t: 0.2, g: 0.2, type: 'triangle', lp: 1200 }); tone({ f: 240, to: 170, t: 0.26, g: 0.18, type: 'triangle', lp: 1200, at: 0.11 }); },
    info: () => tone({ f: 700, to: 760, t: 0.12, g: 0.14 }),
    play: () => { tone({ f: 330, to: 660, t: 0.4 }); tone({ f: 495, to: 990, t: 0.4, g: 0.12, at: 0.04 }); tone({ f: 1318, t: 0.3, g: 0.08, at: 0.22 }); },
    fav: () => { tone({ f: 1047, t: 0.14, g: 0.16 }); tone({ f: 1568, t: 0.24, g: 0.14, at: 0.06 }); },
    del: () => tone({ f: 200, to: 80, t: 0.22, g: 0.28 }),
    tick: v => tone({ f: 700 + (v || 0) * 700, t: 0.035, g: 0.12, a: 0.003 })
  };

  return function sfx(name, arg) {
    try {
      if (CFG.sound === false || !(CFG.soundVol > 0) || !P[name]) return;
      const now = performance.now();
      if (last[name] && now - last[name] < (name === 'tick' ? 60 : 45)) return;
      last[name] = now;
      if (!init()) return;
      master.gain.value = Math.pow(CFG.soundVol / 100, 1.6);
      P[name](arg);
    } catch {}
  };
})();

function sfxKind(e) {
  const el = e.target.closest('button,a,.card,.scard,.row-i .clk,[data-open],[data-go],.sw');
  if (!el || el.disabled || el.closest('.switch,.chk')) return null;
  if (el.matches('[data-play]')) return 'play';
  if (el.matches('[data-fav]')) return 'fav';
  if (el.matches('.nav,[data-go],.card,[data-open]')) return 'nav';
  if (el.matches('[data-itab],.seg button,[data-dtype],[data-ikind],[data-lf]')) return 'tab';
  return 'click';
}

document.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const k = sfxKind(e);
  if (k) sfx(k);
  /* Ripple */
  if (CFG.anim === false) return;
  const el = e.target.closest('.chip,.act,.fab,.launch,.launch-dd,.seg button,.mi');
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2;
  const rip = document.createElement('span');
  rip.className = 'rip';
  rip.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  el.appendChild(rip);
  rip.addEventListener('animationend', () => rip.remove());
  setTimeout(() => rip.remove(), 900);
}, true);

document.addEventListener('change', e => {
  const i = e.target;
  if (i && i.type === 'checkbox') sfx(i.checked ? 'on' : 'off');
}, true);

document.addEventListener('input', e => {
  const i = e.target;
  if (!i || i.type !== 'range') return;
  if (i.dataset.set === 'soundVol') CFG.soundVol = +i.value;
  sfx('tick', (i.value - i.min) / ((i.max - i.min) || 1));
}, true);

/* Spotlight, das der Maus auf Karten/Zeilen folgt */
let spotRaf = 0;
document.addEventListener('pointermove', e => {
  if (spotRaf) return;
  const x = e.clientX, y = e.clientY, tg = e.target;
  spotRaf = requestAnimationFrame(() => {
    spotRaf = 0;
    const c = tg.closest && tg.closest('.card,.row-i');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', x - r.left + 'px');
    c.style.setProperty('--my', y - r.top + 'px');
  });
}, { passive: true });
