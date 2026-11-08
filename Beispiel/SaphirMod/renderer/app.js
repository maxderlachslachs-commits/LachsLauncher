const $ = s => document.querySelector(s);
const LOADER = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: 'Vanilla' };
const TYPES = [['mod', 'Mods'], ['modpack', 'Modpacks'], ['resourcepack', 'Texturepacks'], ['datapack', 'Datenpakete'], ['shader', 'Shader']];
const KINDS = TYPES.filter(t => t[0] !== 'modpack');
const SORTS = [['downloads', 'Beliebteste'], ['relevance', 'Relevanz'], ['updated', 'Zuletzt aktualisiert'], ['newest', 'Neueste']];
const HINT = {
  shader: 'Shader benötigen Iris (Fabric/Quilt) oder Oculus (Forge) im Modpack.',
  datapack: 'Datenpakete werden in die gewählte Welt installiert.',
  resourcepack: 'Texturepacks aktivierst du im Spiel unter Optionen › Ressourcenpakete.'
};
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7.5 5v14L19 12z"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9z"/></svg>',
  compass: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/></svg>',
  players: '<svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.5"/><path d="M3 20c0-3.6 3-6 7-6 1.2 0 2.3.2 3.3.6"/><circle cx="17" cy="16.5" r="3"/><path d="M19.2 18.7L21.5 21"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/></svg>'
};
const LIBSORTS = [['recent', 'Zuletzt gespielt'], ['name', 'Name'], ['time', 'Spielzeit']];
let insts = [];
let cur = localStorage.getItem('inst');
let view = 'home';
let dtype = 'mod';
let dsort = 'downloads';
let dcat = '';
let dworld = null;
let ikind = 'mod';
let itab = 'content';
let instQ = '';
let instFilter = 'all';
let instSort = localStorage.getItem('instSort') || 'name';
let instItems = [];
const INSTSORTS = [['name', 'Name'], ['new', 'Zuletzt geändert'], ['size', 'Größe']];
let ids = new Set();
let results = [];
let total = 0;
let updates = [];
let detail = null;
let account = null;
let libQ = '';
let libFilter = localStorage.getItem('libFilter') || 'all';
let libSort = localStorage.getItem('libSort') || 'recent';
let dq = '';
let timer;
let reqId = 0;
const running = new Set();
const catCache = {};

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' Mio' : n >= 1e3 ? Math.round(n / 1e3) + ' Tsd' : n);
const BUSY = /…$|^(Starte|Bereite|Entpacke|Lade|Installiere|Importiere|Exportiere|Suche|Wende|Verschiebe|Anmeldung|Dupliziere)/;
function status(t) {
  $('#status').textContent = t;
  const p = $('#prog');
  const m = String(t).match(/(\d+)\/(\d+)$/);
  p.className = '';
  p.firstElementChild.style.transform = '';
  if (m && +m[2]) {
    p.className = 'on det';
    p.firstElementChild.style.transform = `scaleX(${Math.min(1, m[1] / m[2])})`;
  } else if (BUSY.test(t)) p.className = 'on busy';
  if (/^Fehler/.test(t)) toast(t, 'error', 5200);
  return t;
}
const err = e => status('Fehler: ' + e.message.replace(/^Error invoking remote method '[\w:]+': (Error: )?/, ''));
const hue = s => 205 + ([...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 50);
const tile = (i, c = 'm') => i.coverUrl
  ? `<div class="tile ${c}"><img src="${esc(i.coverUrl)}"></div>`
  : `<div class="tile ${c}" style="background:linear-gradient(145deg,hsl(${hue(i.name)} 75% 52%),hsl(${hue(i.name) + 15} 70% 24%))"><b>${esc(i.name.trim().charAt(0).toUpperCase())}</b></div>`;
const pic = m => (m.icon ? `<img class="ico" src="${esc(m.icon)}">` : tile({ name: m.title }));
const meta = i => `${LOADER[i.loader] || i.loader} ${esc(i.mc)}`;
const label = k => (TYPES.find(t => t[0] === k) || [0, k])[1];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
const ago = t => {
  if (!t) return 'Noch nie gespielt';
  const d = Math.floor((Date.now() - t) / 864e5);
  return d < 1 ? 'Heute gespielt' : d === 1 ? 'Gestern gespielt' : `Vor ${d} Tagen gespielt`;
};
const byId = id => insts.find(i => i.id === id);
const fmtTime = ms => {
  const m = Math.round(ms / 6e4);
  return m < 1 ? '< 1 Min' : m < 60 ? m + ' Min' : Math.floor(m / 60) + ' Std' + (m % 60 ? ' ' + (m % 60) + ' Min' : '');
};
const sortedInsts = () => [...insts].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');

function syncPlay() {
  document.querySelectorAll('[data-play]').forEach(b => {
    const r = running.has(b.dataset.play);
    b.disabled = r;
    b.classList.toggle('is-running', r);
    if (b.classList.contains('fab')) return;
    (b.querySelector('.lt') || b).textContent = r ? 'Läuft' : 'Spielen';
  });
  document.querySelectorAll('[data-kill],[data-restart]').forEach(b => {
    b.hidden = !running.has(b.dataset.kill || b.dataset.restart);
  });
  document.querySelectorAll('.card[data-open]').forEach(c => c.classList.toggle('running', running.has(c.dataset.open)));
  if (view === 'library' && libFilter === 'run' && $('#grid')) {
    const vis = document.querySelectorAll('#grid .card').length;
    if (vis !== running.size) $('#grid').innerHTML = gridHtml();
  }
  const n = running.size;
  const chip = $('#runchip');
  chip.classList.toggle('on', n > 0);
  chip.firstElementChild.nextElementSibling.textContent = n ? `${n} läuft` : 'Keine Instanz';
}

function setAccount(name) {
  account = name;
  $('#acct-name').textContent = name || 'Anmelden';
  if (Soc.open) {
    $('#soc-name').textContent = name || 'Nicht angemeldet';
    paintSocAvatar();
  }
  paintAvatar();
}

async function refresh() {
  insts = await api.instances();
  if (!byId(cur)) cur = insts.length ? insts[0].id : null;
  if (cur) localStorage.setItem('inst', cur);
  renderSide();
}

function renderSide() {
  $('#navlist').innerHTML = `
    <button class="nav${view === 'home' ? ' on' : ''}" data-go="home" title="Start">${ICON.home}</button>
    <button class="nav${view === 'library' ? ' on' : ''}" data-go="library" title="Bibliothek">${ICON.grid}</button>
    <button class="nav${view === 'discover' ? ' on' : ''}" data-go="discover" title="Entdecken">${ICON.compass}</button>
    <button class="nav${view === 'skins' ? ' on' : ''}" data-go="skins" title="Skins">${ICON.user}</button>
    <button class="nav${view === 'players' ? ' on' : ''}" data-go="players" title="Spielersuche">${ICON.players}</button>
    <hr>
    ${sortedInsts().map(i => `<button class="nav${view === 'inst' && cur === i.id ? ' on' : ''}" data-open="${esc(i.id)}" title="${esc(i.name)}">${tile(i, '')}</button>`).join('')}
    <button class="nav" data-new title="Neues Modpack (Strg + N)">${ICON.plus}</button>
    <span class="sp"></span>
    <button class="nav${view === 'settings' ? ' on' : ''}" data-go="settings" title="Einstellungen">${ICON.gear}</button>`;
  moveNavInd();
}

let navInit = false;
function moveNavInd() {
  const ind = $('#navind');
  const on = $('#navlist .nav.on');
  if (!on) {
    ind.style.opacity = 0;
    return;
  }
  if (!navInit) {
    ind.style.transition = 'none';
    requestAnimationFrame(() => requestAnimationFrame(() => (ind.style.transition = '')));
    navInit = true;
  }
  ind.style.opacity = 1;
  ind.style.height = on.offsetHeight - 24 + 'px';
  ind.style.transform = `translateY(${on.offsetTop + 12}px)`;
}

const hist = [];
let hi = -1;
function syncNav() {
  $('#hback').disabled = hi <= 0;
  $('#hfwd').disabled = hi >= hist.length - 1;
}
function pushHist(v, id) {
  const e = v + '|' + (id || '');
  if (hist[hi] === e) return;
  hist.splice(hi + 1);
  hist.push(e);
  hi = hist.length - 1;
  syncNav();
}
function histGo(d) {
  const n = hi + d;
  if (n < 0 || n >= hist.length) return;
  hi = n;
  const [v, id] = hist[n].split('|');
  go(v, id || undefined, true);
  syncNav();
}

function go(v, id, fromHist, tab) {
  view = v;
  if (v === 'inst') {
    itab = tab || 'content';
    instQ = '';
    instFilter = 'all';
  }
  if (id) {
    cur = id;
    localStorage.setItem('inst', id);
  }
  if (!fromHist) pushHist(v, v === 'inst' ? cur : '');
  pendingEnter = true;
  renderSide();
  render();
}

function gridHtml() {
  const q = libQ.toLowerCase();
  const by = { name: (a, b) => a.name.localeCompare(b.name), recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0), time: (a, b) => (b.playtime || 0) - (a.playtime || 0) }[libSort];
  const l = insts.filter(i => i.name.toLowerCase().includes(q) && (libFilter === 'fav' ? i.fav : libFilter === 'run' ? running.has(i.id) : true)).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || by(a, b) || a.name.localeCompare(b.name));
  if (!l.length) return `<div class="empty">${libFilter === 'fav' && !libQ ? 'Noch keine Favoriten. Klicke auf den Stern eines Modpacks.' : libFilter === 'run' && !libQ ? 'Aktuell läuft kein Modpack.' : 'Keine Modpacks gefunden.'}</div>`;
  return l.map(i => `
    <div class="card" data-open="${esc(i.id)}">
      <div class="cw">${tile(i, 'big')}<button class="star${i.fav ? ' on' : ''}" data-fav="${esc(i.id)}" title="Favorit">${ICON.star}</button><button class="fab" data-play="${esc(i.id)}" title="Spielen">${ICON.play}</button></div>
      <h3>${esc(i.name)}</h3><p>${meta(i)}${i.playtime ? ' · ' + fmtTime(i.playtime) : ''}</p>
    </div>`).join('');
}

function launchBarHtml() {
  const i = byId(cur);
  if (!i) {
    return `<div class="welcome"><h2>Los geht's</h2><p>Erstelle dein erstes Modpack oder importiere eine Modpack-Datei (.mrpack oder CurseForge-ZIP).</p></div>
      <div class="ctas"><button class="chip play" data-new>Neues Modpack</button><button class="chip btn" data-imp>Importieren</button></div>`;
  }
  const sub = ago(i.lastPlayed) + (i.playtime ? ' · ' + fmtTime(i.playtime) + ' Spielzeit' : '');
  return `<div class="split"><button class="launch" data-play="${esc(i.id)}"><b class="lt">Spielen</b><span class="ls">${esc(i.name)} · ${meta(i)}</span></button>
    <button class="launch-dd" data-ddinst data-menu-anchor="1" title="Modpack wählen"><svg viewBox="0 0 12 8"><path d="M1 1l5 5 5-5"/></svg></button></div>
    <p class="hint2">${sub}</p>
    <div class="killrow"><button class="chip danger sm" data-kill="${esc(i.id)}" hidden>Beenden erzwingen</button><button class="chip btn sm" data-restart="${esc(i.id)}" hidden>Neustart</button></div>`;
}

function refreshHome() {
  if (view !== 'home' || !$('#plname')) return;
  $('#plname').textContent = account || (insts.length ? 'Willkommen' : 'SaphirMod');
  $('#launchbar').innerHTML = launchBarHtml();
  syncPlay();
  loadHomeSkin();
}

function renderHome() {
  $('#view').innerHTML = `<div class="home">
    <h1 class="plname" id="plname"></h1>
    <div id="stagehost" class="stagehost"></div>
    <div class="launchbar" id="launchbar"></div></div>`;
  mountStage($('#stagehost'), { dist: 74, auto: CFG.spin, pose: 'idle' });
  refreshHome();
}

function renderLibrary() {
  if (!insts.length) {
    $('#view').innerHTML = `<div class="empty"><h2>Deine Bibliothek ist leer</h2>Erstelle dein erstes Modpack oder importiere eine Modpack-Datei (.mrpack oder CurseForge-ZIP).
      <div class="toolbar"><button class="chip play" data-new>Neues Modpack</button><button class="chip btn" data-imp>Importieren</button></div></div>`;
    return;
  }
  $('#view').innerHTML = `
    <h2>Bibliothek</h2>
    <div class="toolbar">
      <input id="libq" class="search" placeholder="Modpacks durchsuchen" value="${esc(libQ)}">
      <div class="seg" id="libf">${[['all', 'Alle'], ['fav', 'Favoriten'], ['run', 'Läuft']].map(([k, n]) => `<button data-lf="${k}" class="${libFilter === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <select id="libsort" class="chip">${opts(LIBSORTS, libSort)}</select>
      <button class="chip btn" data-imp>Importieren</button>
      <button class="chip play" data-new>Neues Modpack</button>
    </div>
    <div class="grid stag" id="grid">${gridHtml()}</div>`;
  $('#libq').oninput = e => {
    libQ = e.target.value;
    $('#grid').innerHTML = gridHtml();
    syncPlay();
  };
  $('#libf').onclick = e => {
    const b = e.target.closest('[data-lf]');
    if (!b) return;
    libFilter = b.dataset.lf;
    localStorage.setItem('libFilter', libFilter);
    document.querySelectorAll('#libf button').forEach(x => x.classList.toggle('on', x === b));
    $('#grid').innerHTML = gridHtml();
    syncPlay();
  };
  $('#libsort').onchange = e => {
    libSort = e.target.value;
    localStorage.setItem('libSort', libSort);
    $('#grid').innerHTML = gridHtml();
    syncPlay();
  };
  syncPlay();
}

async function toggleFav(id) {
  const i = byId(id);
  if (!i) return;
  await api.updateInstance({ id, patch: { fav: !i.fav } });
  await refresh();
  if (view === 'library') {
    $('#grid').innerHTML = gridHtml();
    syncPlay();
  } else if (view === 'inst') renderInst();
}


function updatesHtml() {
  if (!updates.length) return '';
  return `<div class="panel pad"><div class="set"><div><h3>${updates.length} Update${updates.length > 1 ? 's' : ''} verfügbar</h3><p>${updates.map(u => esc(u.title)).join(', ')}</p></div>
    <div class="ctl"><button class="chip play sm" data-applyupd>Alle aktualisieren</button></div></div></div>`;
}

async function renderInst() {
  const i = byId(cur);
  if (!i) return go('home');
  const head = `
    <button class="back" data-go="home">‹ Zurück</button>
    <div class="hero">${tile(i, 'xl')}<div><h1>${esc(i.name)}</h1><p>${meta(i)} · ${ago(i.lastPlayed)}${i.playtime ? ' · ' + fmtTime(i.playtime) + ' Spielzeit' : ''}</p></div><div class="grow"></div>
      <button class="chip btn${i.fav ? ' fav-on' : ''}" data-fav="${esc(i.id)}" title="Als Favorit markieren">${ICON.star}Favorit</button>
      <button class="chip danger" data-kill="${esc(i.id)}" hidden title="Minecraft sofort beenden">Beenden</button>
      <button class="chip btn" data-restart="${esc(i.id)}" hidden title="Beenden und neu starten">Neustart</button>
      <button class="chip play" data-play="${esc(i.id)}">Spielen</button></div>
    <div class="toolbar" style="margin-top:18px"><div class="seg">
      <button class="${itab === 'content' ? 'on' : ''}" data-itab="content">Inhalt</button>
      <button class="${itab === 'logs' ? 'on' : ''}" data-itab="logs">Logs</button>
      <button class="${itab === 'settings' ? 'on' : ''}" data-itab="settings">Einstellungen</button></div></div>`;
  if (itab === 'logs') {
    $('#view').innerHTML = head + logsShellHtml();
    initLogs();
    return syncPlay();
  }
  if (itab === 'settings') {
    const [s, sys] = await Promise.all([api.getSettings(), api.sysInfo()]);
    if (view !== 'inst' || cur !== i.id) return;
    const maxRam = clamp(Math.floor(sys.totalGB), 4, 64);
    const gram = clamp(+s.ram || 4, 1, maxRam);
    const useG = !+i.ram;
    const iram = clamp(+i.ram || gram, 1, maxRam);
    $('#view').innerHTML = head + `
      <div class="panel">
        <div class="set"><div><h3>Name</h3><p>Anzeigename des Modpacks</p></div>
          <div class="ctl"><input class="search" data-iset="name" value="${esc(i.name)}"></div></div>
        <div class="set"><div><h3>Cover</h3><p>Bild für Karte und Seitenleiste</p></div>
          <div class="ctl"><button class="chip btn sm" data-cover>Ändern</button>${i.coverUrl ? '<button class="chip btn sm" data-uncover>Entfernen</button>' : ''}</div></div>
        <div class="set"><div><h3>Arbeitsspeicher</h3><p id="iramtxt">${useG ? `Nutzt die globale Einstellung (${gram} GB)` : 'Eigener Wert für dieses Modpack'} · System: ${Math.round(sys.totalGB)} GB</p></div>
          <div class="ctl"><span class="swl">Global</span><label class="switch"><input type="checkbox" id="iramg"${useG ? ' checked' : ''}><i></i></label>
          <div id="iramw"${useG ? ' class="dis"' : ''}>${rangeHtml(`min="1" max="${maxRam}" step="0.5" value="${iram}" id="iram" data-iset="ram"${useG ? ' disabled' : ''}`, ' GB')}</div></div></div>
        <div class="set"><div><h3>JVM-Argumente</h3><p>Leer lassen für die globalen Argumente</p></div>
          <div class="ctl"><input class="search" data-iset="jvmArgs" placeholder="${esc(s.jvmArgs || '-XX:+UseG1GC')}" value="${esc(i.jvmArgs)}"></div></div>
        <div class="set"><div><h3>Java-Pfad</h3><p>Leer lassen für automatische Auswahl (passende Java-Version wird gefunden bzw. geladen)</p></div>
          <div class="ctl"><input class="search" data-iset="javaPath" placeholder="Automatisch" value="${esc(i.javaPath)}"></div></div>
        <div class="set"><div><h3>Modpack-Ordner</h3><p>Mods, Welten und Einstellungen dieses Modpacks</p></div>
          <div class="ctl"><button class="chip btn sm" data-instfolder>Öffnen</button><button class="chip btn sm" data-dup>Duplizieren</button><button class="chip btn sm" data-export>Exportieren</button></div></div>
        <div class="set"><div><h3>Modpack löschen</h3><p>Entfernt alle Dateien dieses Modpacks unwiderruflich</p></div>
          <div class="ctl"><button class="chip danger sm" data-del>Löschen</button></div></div>
      </div>`;
    document.querySelectorAll('[data-iset]').forEach(el => {
      el.onchange = async () => {
        try {
          await api.updateInstance({ id: cur, patch: { [el.dataset.iset]: el.value } });
          await refresh();
          status('Gespeichert');
          if (el.dataset.iset === 'name') renderInst();
        } catch (e) {
          err(e);
        }
      };
    });
    const g = $('#iramg');
    if (g) g.onchange = async () => {
      const rng = $('#iram');
      try {
        await api.updateInstance({ id: cur, patch: { ram: g.checked ? '' : rng.value } });
        await refresh();
        status('Gespeichert');
      } catch (e) {
        err(e);
      }
      $('#iramw').classList.toggle('dis', g.checked);
      rng.disabled = g.checked;
      $('#iramtxt').textContent = (g.checked ? `Nutzt die globale Einstellung (${gram} GB)` : 'Eigener Wert für dieses Modpack') + ` · System: ${Math.round(sys.totalGB)} GB`;
    };
    return syncPlay();
  }
  const r = await api.installed({ instId: cur, kind: ikind });
  if (view !== 'inst' || cur !== i.id) return;
  instItems = r.items;
  $('#view').innerHTML = head + `
    <div class="toolbar kinds"><div class="seg">${KINDS.map(([k, l]) => `<button class="${ikind === k ? 'on' : ''}" data-ikind="${k}">${l}</button>`).join('')}</div>
      <span class="grow"></span>
      ${ikind === 'mod' ? '<button class="chip btn sm" data-check>Updates prüfen</button>' : ''}
      <button class="chip play sm" data-add>Hinzufügen</button></div>
    <div class="toolbar">
      <input id="instq" class="search" placeholder="In ${esc(label(ikind))} suchen…" value="${esc(instQ)}" autocomplete="off" spellcheck="false">
      ${ikind === 'mod' ? `<div class="seg">${[['all', 'Alle'], ['on', 'Aktiv'], ['off', 'Deaktiviert']].map(([k, l]) => `<button class="${instFilter === k ? 'on' : ''}" data-ifilter="${k}">${l}</button>`).join('')}</div>` : ''}
      <select id="instsort" class="chip">${opts(INSTSORTS, instSort)}</select>
    </div>
    <div id="upd">${ikind === 'mod' ? updatesHtml() : ''}</div>
    <p class="hint" id="instcount"></p>
    <div class="rows stag" id="instrows"></div>`;
  refreshInstRows();
  $('#instq').oninput = e => {
    instQ = e.target.value;
    refreshInstRows();
  };
  $('#instsort').onchange = e => {
    instSort = e.target.value;
    localStorage.setItem('instSort', instSort);
    refreshInstRows();
  };
  document.querySelectorAll('[data-ifilter]').forEach(b => {
    b.onclick = () => {
      instFilter = b.dataset.ifilter;
      document.querySelectorAll('[data-ifilter]').forEach(x => x.classList.toggle('on', x === b));
      refreshInstRows();
    };
  });
  syncPlay();
}

const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 0 ? Math.max(1, Math.round(n / 1024)) + ' KB' : '');
const INSTSORT = {
  name: (a, b) => a.title.localeCompare(b.title),
  new: (a, b) => (b.mtime || 0) - (a.mtime || 0),
  size: (a, b) => (b.size || 0) - (a.size || 0)
};

function instMatch(m) {
  if (instFilter === 'on' && m.disabled) return false;
  if (instFilter === 'off' && !m.disabled) return false;
  const q = instQ.trim().toLowerCase();
  return !q || `${m.title} ${m.file} ${m.description || ''}`.toLowerCase().includes(q);
}

function refreshInstRows() {
  const box = $('#instrows');
  if (!box) return;
  const l = instItems.filter(instMatch).sort(INSTSORT[instSort] || INSTSORT.name);
  const off = instItems.filter(m => m.disabled).length;
  $('#instcount').textContent = instItems.length ? `${l.length} von ${instItems.length}${off ? ` · ${off} deaktiviert` : ''}` : '';
  if (!instItems.length) {
    box.innerHTML = `<div class="empty">Noch keine Einträge in ${esc(label(ikind))}.</div>`;
    return;
  }
  box.innerHTML = l.length ? l.map(m => `
      <div class="row-i${m.disabled ? ' off' : ''}">${pic(m)}
        <div class="info"><h3>${esc(m.title)}${m.disabled ? ' <span class="tag">Deaktiviert</span>' : ''}${m.size ? ` <span class="tag dim">${fmtSize(m.size)}</span>` : ''}</h3><p>${esc(m.description)}</p></div>
        <div class="btns">
          ${ikind === 'mod' ? `<button class="act sec" data-toggle="${esc(m.file)}" data-dir="${esc(m.dir)}">${m.disabled ? 'Aktivieren' : 'Deaktivieren'}</button>` : ''}
          <button class="act rm" data-rm="${esc(m.file)}" data-dir="${esc(m.dir)}">Entfernen</button>
        </div></div>`).join('') : '<div class="empty">Keine Treffer.</div>';
}

async function renderDiscover() {
  let worlds = [];
  if (dtype === 'datapack' && cur) {
    worlds = await api.worlds(cur);
    if (!worlds.includes(dworld)) dworld = worlds[0] || null;
  }
  if (!catCache[dtype]) catCache[dtype] = await api.categories(dtype).catch(() => []);
  if (view !== 'discover') return;
  $('#view').innerHTML = `
    <h2>Entdecken</h2>
    <div class="toolbar"><div class="seg">${TYPES.map(([k, l]) => `<button class="${dtype === k ? 'on' : ''}" data-dtype="${k}">${l}</button>`).join('')}</div></div>
    <div class="toolbar">
      ${dtype !== 'modpack' && insts.length ? `<select id="target" class="chip">${insts.map(i => `<option value="${esc(i.id)}"${i.id === cur ? ' selected' : ''}>${esc(i.name)} (${meta(i)})</option>`).join('')}</select>` : ''}
      ${dtype === 'datapack' && worlds.length ? `<select id="world" class="chip">${opts(worlds.map(w => [w, w]), dworld)}</select>` : ''}
      <select id="cat" class="chip"><option value="">Alle Kategorien</option>${opts(catCache[dtype].map(c => [c, cap(c)]), dcat)}</select>
      <select id="sort" class="chip">${opts(SORTS, dsort)}</select>
      <input id="dq" class="search" placeholder="Suchen" value="${esc(dq)}">
    </div>
    ${HINT[dtype] ? `<p class="hint">${HINT[dtype]}</p>` : ''}
    <div class="rows stag-live" id="results"></div>`;
  $('#dq').oninput = e => {
    dq = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => loadResults(), 300);
  };
  $('#sort').onchange = e => {
    dsort = e.target.value;
    loadResults();
  };
  $('#cat').onchange = e => {
    dcat = e.target.value;
    loadResults();
  };
  const t = $('#target');
  if (t) t.onchange = e => {
    cur = e.target.value;
    localStorage.setItem('inst', cur);
    renderDiscover();
  };
  const w = $('#world');
  if (w) w.onchange = e => {
    dworld = e.target.value;
    loadResults();
  };
  loadResults();
}

function resultsHtml() {
  if (dtype !== 'modpack' && !cur) return '<div class="empty">Erstelle zuerst ein Modpack.<button class="chip play" data-new>Neues Modpack</button></div>';
  if (dtype === 'datapack' && !dworld) return '<div class="empty">Keine Welt gefunden. Starte das Modpack und erstelle zuerst eine Welt.</div>';
  if (!results.length) return '<div class="empty">Nichts gefunden.</div>';
  return results.map((m, i) => {
    const has = dtype !== 'modpack' && ids.has(m.id);
    return `<div class="row-i"><div class="clk" data-detail="${i}">${pic(m)}
      <div class="info"><h3>${esc(m.title)} <span class="tag">${fmt(m.downloads)} Downloads</span></h3><p>${esc(m.description)}</p></div></div>
      <button class="act${has ? ' rm' : ''}" data-act="${i}">${has ? 'Entfernen' : 'Installieren'}</button></div>`;
  }).join('') + (results.length < total ? '<div class="more"><button class="chip btn" data-more>Mehr laden</button></div>' : '');
}

async function loadResults(append) {
  const box = $('#results');
  if (!box) return;
  const my = ++reqId;
  if ((dtype !== 'modpack' && !cur) || (dtype === 'datapack' && !dworld)) {
    results = [];
    box.innerHTML = resultsHtml();
    return;
  }
  if (!append) box.innerHTML = '<div class="empty"><i class="spinner"></i>Lade…</div>';
  try {
    const inst = dtype === 'modpack' ? { ids: [] } : await api.installed({ instId: cur, kind: dtype, world: dworld });
    const r = await api.search({ query: dq, type: dtype, instId: cur, sort: dsort, category: dcat, offset: append ? results.length : 0 });
    if (my !== reqId || !$('#results')) return;
    ids = new Set(inst.ids);
    results = append ? results.concat(r.items) : r.items;
    total = r.total;
    box.classList.toggle('static', !!append);
    $('#results').innerHTML = resultsHtml();
  } catch {
    if (my === reqId && $('#results')) $('#results').innerHTML = '<p class="empty">Modrinth nicht erreichbar.</p>';
  }
}

async function installResult(m, versionId) {
  if (dtype === 'modpack') {
    status('Installiere Modpack…');
    const inst = await api.installPack({ id: m.id, icon: m.icon, versionId });
    await refresh();
    status(inst.name + ' installiert');
    closeDetail();
    return go('inst', inst.id);
  }
  status('Installiere ' + m.title);
  const deps = await api.install({ mod: m, instId: cur, kind: dtype, world: dworld, versionId });
  ids.add(m.id);
  status(m.title + ' installiert' + (deps ? ` (+${deps} Abhängigkeit${deps > 1 ? 'en' : ''})` : ''));
}

async function act(i, btn) {
  const m = results[i];
  btn.disabled = true;
  try {
    if (dtype !== 'modpack' && ids.has(m.id)) {
      await api.remove({ instId: cur, projectId: m.id, kind: dtype, world: dworld });
      ids.delete(m.id);
      status(m.title + ' entfernt');
    } else await installResult(m);
  } catch (e) {
    err(e);
  }
  reflowResults();
}

function reflowResults() {
  const b = $('#results');
  if (!b) return;
  b.classList.add('static');
  b.innerHTML = resultsHtml();
}

async function openDetail(i) {
  const m = results[i];
  showEl($('#pmodal'));
  $('#pbox').innerHTML = '<div class="empty"><i class="spinner"></i>Lade…</div>';
  try {
    detail = { p: await api.project({ id: m.id, type: dtype, instId: cur }), m };
    renderDetail();
  } catch {
    $('#pbox').innerHTML = '<p class="empty">Details konnten nicht geladen werden.</p>';
  }
}

function renderDetail() {
  const { p } = detail;
  const links = Object.entries(p.links).filter(([, u]) => u);
  $('#pbox').innerHTML = `
    <div class="dh">${p.icon ? `<img src="${esc(p.icon)}">` : tile({ name: p.title })}<div><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p></div></div>
    <div class="stats"><span>${fmt(p.downloads)} Downloads</span><span>${fmt(p.followers)} Follower</span>${p.license ? `<span>Lizenz: ${esc(p.license)}</span>` : ''}</div>
    <div class="tags">${p.categories.map(c => `<span>${esc(cap(c))}</span>`).join('')}</div>
    ${p.gallery.length ? `<div class="gal">${p.gallery.map(u => `<img src="${esc(u)}">`).join('')}</div>` : ''}
    <div class="links"><button class="chip btn sm" data-url="https://modrinth.com/${esc(p.type)}/${esc(p.slug)}">Auf Modrinth öffnen</button>
      ${links.map(([n, u]) => `<button class="chip btn sm" data-url="${esc(u)}">${n}</button>`).join('')}</div>
    <h2 style="margin:6px 0 0">Versionen</h2>
    <div class="vlist">${p.versions.length ? p.versions.map((v, i) => `
      <div class="row-i"><div class="info"><h3>${esc(v.name)} <span class="vtype ${esc(v.type)}">${esc(v.type)}</span></h3>
      <p>${esc(v.number)} · ${esc(v.mc.join(', '))} · ${esc(v.loaders.join(', '))} · ${esc(v.date.slice(0, 10))}</p></div>
      <button class="act" data-vinst="${i}">Installieren</button></div>`).join('') : '<div class="empty">Keine passenden Versionen für dieses Modpack.</div>'}</div>
    <div class="row"><button class="chip btn" data-pclose>Schließen</button></div>`;
}

function closeDetail() {
  hideEl($('#pmodal'));
  detail = null;
}

async function renderSettings() {
  const [s, folder, sys, logoUrl] = await Promise.all([api.getSettings(), api.getFolder(), api.sysInfo(), api.getLogo()]);
  if (view !== 'settings') return;
  const maxRam = clamp(Math.floor(sys.totalGB), 4, 64);
  const ram = clamp(+s.ram || 4, 1, maxRam);
  const sw = (k, on) => `<label class="switch"><input type="checkbox" data-set="${k}"${on ? ' checked' : ''}><i></i></label>`;
  $('#view').innerHTML = `
    <h2>Einstellungen</h2>
    <div class="panel">
      <div class="set"><div><h3>Konto</h3><p>${account ? 'Angemeldet als ' + esc(account) + ' (bleibt gespeichert)' : 'Nicht angemeldet'}</p></div>
        <div class="ctl">${account ? '<button class="chip btn sm" data-logout>Abmelden</button>' : '<button class="chip play sm" data-login>Anmelden</button>'}</div></div>
      <div class="set"><div><h3>Arbeitsspeicher</h3><p>Maximaler RAM für Minecraft · dein System hat ${Math.round(sys.totalGB)} GB</p></div>
        <div class="ctl">${rangeHtml(`min="1" max="${maxRam}" step="0.5" value="${ram}" data-set="ram"`, ' GB')}</div></div>
      <div class="set"><div><h3>Java automatisch verwalten</h3><p>Lädt bei Bedarf die passende Java-Version für jedes Modpack herunter (empfohlen)</p></div><div class="ctl">${sw('javaAuto', s.javaAuto !== false)}</div></div>
      <div class="set"><div><h3>Eigener Java-Pfad</h3><p>Optional: wird genutzt, wenn die Version zum Modpack passt</p></div>
        <div class="ctl"><input class="search" data-set="javaPath" placeholder="java" value="${esc(s.javaPath)}"></div></div>
      <div class="set"><div><h3>Fenstergröße</h3><p>Auflösung beim Start</p></div>
        <div class="ctl"><input class="search num" type="number" data-set="width" value="${esc(s.width)}"><input class="search num" type="number" data-set="height" value="${esc(s.height)}">
        <label class="chk"><input type="checkbox" data-set="fullscreen"${s.fullscreen ? ' checked' : ''}> Vollbild</label></div></div>
      <div class="set"><div><h3>JVM-Argumente</h3><p>Zusätzliche Java-Argumente, durch Leerzeichen getrennt</p></div>
        <div class="ctl"><input class="search" data-set="jvmArgs" placeholder="-XX:+UseG1GC" value="${esc(s.jvmArgs)}"></div></div>
      <div class="set"><div><h3>Spielordner</h3><p class="path">${esc(folder)}</p></div>
        <div class="ctl"><button class="chip btn sm" data-folder>Öffnen</button><button class="chip btn sm" data-move>Verschieben</button></div></div>
    </div>
    <h2>Verhalten</h2>
    <div class="panel">
      <div class="set"><div><h3>Launcher beim Spielstart minimieren</h3><p>Nach dem Beenden von Minecraft wird das Fenster wieder angezeigt</p></div><div class="ctl">${sw('minimize', !!s.minimize)}</div></div>
      <div class="set"><div><h3>Spiel-Einstellungen zurücksetzen</h3><p>RAM, Java-Pfad, Fenstergröße und JVM-Argumente auf Standard</p></div><div class="ctl"><button class="chip btn sm" id="resetgame">Zurücksetzen</button></div></div>
    </div>
    <h2>Leistung &amp; Animationen</h2>
    <div class="panel">
      <div class="set"><div><h3>Animationen</h3><p>Übergänge, Einblendungen und Bewegung in der Oberfläche</p></div><div class="ctl">${sw('anim', s.anim !== false)}</div></div>
      <div class="set"><div><h3>Hintergrund-Effekte</h3><p>Sanft bewegter Leuchtverlauf hinter der Oberfläche</p></div><div class="ctl">${sw('fx', s.fx !== false)}</div></div>
      <div class="set"><div><h3>Skin automatisch drehen</h3><p>Der 3D-Skin auf dem Startscreen dreht sich langsam</p></div><div class="ctl">${sw('spin', !!s.spin)}</div></div>
    </div>
    <h2>Sound</h2>
    <div class="panel">
      <div class="set"><div><h3>Klick-Sounds</h3><p>Weiche Töne bei Klicks, Menüs, Schaltern und Benachrichtigungen</p></div><div class="ctl">${sw('sound', s.sound !== false)}</div></div>
      <div class="set"><div><h3>Lautstärke</h3><p>Lautstärke der Oberflächen-Sounds</p></div><div class="ctl">${rangeHtml(`min="0" max="100" step="5" value="${s.soundVol == null ? 50 : +s.soundVol}" data-set="soundVol"`, ' %')}</div></div>
    </div>
    <h2>App-Logo</h2>
    <div class="panel">
      <div class="set"><div><h3>Eigenes Logo</h3><p>Fenster- und Taskleisten-Symbol sowie Kopfleiste (PNG, JPG, WebP, GIF oder ICO)</p></div>
        <div class="ctl">${logoUrl ? `<img class="logoprev" src="${esc(logoUrl)}" alt="">` : ''}<button class="chip btn sm" data-logopick>Logo wählen</button>${logoUrl ? '<button class="chip btn sm" data-logoclear>Entfernen</button>' : ''}</div></div>
    </div>
    <h2>Discord Rich Presence</h2>
    <div class="panel">
      <div class="set"><div><h3>Aktivieren</h3><p>Zeigt in Discord, dass du SaphirMod nutzt oder Minecraft spielst</p></div><div class="ctl">${sw('discord', !!s.discord)}</div></div>
      <div class="set"><div><h3>Application-ID</h3><p>Im Discord Developer Portal eine Anwendung anlegen (ihr Name steht später bei „Spielt …“) und die ID hier einfügen</p></div>
        <div class="ctl"><input class="search" data-set="discordId" placeholder="123456789012345678" maxlength="22" value="${esc(s.discordId)}"><button class="chip btn sm" data-url="https://discord.com/developers/applications">Portal</button></div></div>
      <div class="set"><div><h3>Modpack-Name anzeigen</h3><p>Aus: Discord zeigt nur „Spielt Minecraft“</p></div><div class="ctl">${sw('discordPack', s.discordPack !== false)}</div></div>
      <div class="set"><div><h3>Bild-Schlüssel</h3><p>Name des Bildes unter „Rich Presence › Art Assets“ in deiner Discord-Anwendung</p></div>
        <div class="ctl"><input class="search" data-set="discordImage" placeholder="logo" value="${esc(s.discordImage)}"></div></div>
      <div class="set"><div><h3>Status</h3><p id="dstat" class="dstat">Prüfe…</p></div><div class="ctl"><button class="chip btn sm" data-dconnect>Verbinden</button></div></div>
    </div>
    <h2>CurseForge</h2>
    <div class="panel">
      <div class="set"><div><h3>API-Key</h3><p>Nötig zum Importieren von CurseForge-Modpacks. Kostenlos im CurseForge-Developer-Portal erstellen.</p></div>
        <div class="ctl"><input class="search" type="password" data-set="cfKey" placeholder="$2a$10$…" value="${esc(s.cfKey)}" autocomplete="off"><button class="chip btn sm" data-url="https://console.curseforge.com/">Portal</button></div></div>
    </div>
    ${appearanceHtml(s)}`;
  api.discordStatus().then(showDiscord);
  bindAppearance(s);
  $('#resetgame').onclick = async () => {
    if (!(await ask('Einstellungen zurücksetzen', 'RAM, Java-Pfad, Fenstergröße und JVM-Argumente werden auf Standard gesetzt.', 'Zurücksetzen'))) return;
    await api.setSettings({ ram: 4, javaPath: '', javaAuto: true, width: 854, height: 480, fullscreen: false, jvmArgs: '' });
    toast('Zurückgesetzt', 'ok');
    renderSettings();
  };
  document.querySelectorAll('[data-set]').forEach(el => {
    el.onchange = async () => {
      const k = el.dataset.set;
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? +el.value : el.value;
      const n = await api.setSettings({ [k]: v });
      if (k === 'anim' || k === 'fx' || k === 'spin' || k === 'sound' || k === 'soundVol') applyUi(n);
      if (k.startsWith('discord')) setTimeout(() => api.discordStatus().then(showDiscord), 1800);
      status('Gespeichert');
    };
  });
}

function render() {
  if (view === 'home') renderHome();
  else if (view === 'library') renderLibrary();
  else if (view === 'inst') {
    updates = [];
    renderInst();
  } else if (view === 'settings') renderSettings();
  else if (view === 'skins') renderSkins();
  else if (view === 'players') renderPlayers();
  else renderDiscover();
}

async function login() {
  try {
    status('Anmeldung läuft');
    setAccount(await api.login());
    status('Angemeldet als ' + account);
    clearSkin();
    if (view === 'settings') renderSettings();
    if (view === 'home') refreshHome();
  } catch {
    status('Anmeldung abgebrochen');
  }
}

async function logout() {
  await api.logout();
  setAccount(null);
  clearSkin();
  status('Abgemeldet');
  if (view === 'settings') renderSettings();
  else if (view === 'home') refreshHome();
}

function accountMenu() {
  if (!account) return login();
  openMenu($('#acct'), [
    { label: 'Skins verwalten', act: () => go('skins') },
    { label: 'Einstellungen', act: () => go('settings') },
    '-',
    { label: 'Abmelden', danger: true, act: logout }
  ], { align: 'right' });
}

function warnSkipped(inst) {
  if (inst && inst.skipped) toast(`${inst.skipped} Mod(s) ließen sich nicht laden – Liste: skipped-mods.txt im Modpack-Ordner`, 'error', 8000);
}

function applyLogoUi(url) {
  const el = $('#applogo');
  if (url) el.src = url;
  el.hidden = !url;
}

function showDiscord(st) {
  const el = $('#dstat');
  if (!el) return;
  el.textContent = st.connected ? 'Verbunden' : st.enabled ? st.error || 'Verbinde…' : st.error || 'Aus';
  el.classList.toggle('ok', !!st.connected);
}

async function importDropped(p) {
  try {
    status('Importiere…');
    const inst = await api.importPath(p);
    await refresh();
    toast(inst.name + ' importiert', 'ok');
    warnSkipped(inst);
    status(inst.name + ' importiert');
    go('inst', inst.id);
  } catch (e) {
    err(e);
  }
}

async function play(id) {
  if (running.has(id)) return;
  if (!account) await login();
  if (!account) return;
  try {
    await api.launch({ instId: id });
    await refresh();
    if (view === 'home') renderHome();
  } catch (e) {
    err(e);
  }
}

async function killInst(id) {
  const i = byId(id);
  if (!(await ask('Minecraft beenden', `${i ? i.name : 'Minecraft'} wird sofort beendet. Nicht gespeicherter Fortschritt geht verloren.`, 'Beenden'))) return false;
  await api.kill(id);
  status('Beende Minecraft…');
  return true;
}

async function restartInst(id) {
  if (!(await killInst(id))) return;
  for (let n = 0; n < 150 && running.has(id); n++) await new Promise(r => setTimeout(r, 100));
  if (running.has(id)) return toast('Minecraft lässt sich nicht beenden', 'error');
  play(id);
}

async function createFromModal() {
  const name = $('#m-name').value.trim();
  if (!name) {
    $('#m-name').focus();
    return status('Bitte einen Namen eingeben');
  }
  try {
    const inst = await api.create({ name, mc: $('#m-ver').value, loader: newLoader, cover: newCover });
    hideEl($('#modal'));
    await refresh();
    status(name + ' erstellt');
    toast(name + ' erstellt', 'ok');
    go('inst', inst.id);
  } catch (e) {
    err(e);
  }
}

async function importPack() {
  try {
    status('Importiere…');
    const inst = await api.importFile();
    if (!inst) return status('Bereit');
    await refresh();
    status(inst.name + ' importiert');
    toast(inst.name + ' importiert', 'ok');
    warnSkipped(inst);
    go('inst', inst.id);
  } catch (e) {
    err(e);
  }
}

const SEL = '[data-play],[data-go],[data-open],[data-new],[data-imp],[data-add],[data-del],[data-rm],[data-dtype],[data-ikind],[data-act],[data-login],[data-logout],[data-folder],[data-detail],[data-vinst],[data-pclose],[data-url],[data-more],[data-cover],[data-uncover],[data-export],[data-check],[data-applyupd],[data-toggle],[data-move],[data-itab],[data-instfolder],[data-fav],[data-dup],[data-ddinst],[data-logopick],[data-logoclear],[data-dconnect],[data-kill],[data-restart]';

document.addEventListener('click', async e => {
  const t = e.target.closest(SEL);
  if (!t) return;
  const d = t.dataset;
  const has = a => t.hasAttribute('data-' + a);
  try {
    if (d.play) {
      e.stopPropagation();
      return play(d.play);
    }
    if (d.kill) {
      e.stopPropagation();
      return killInst(d.kill);
    }
    if (d.restart) {
      e.stopPropagation();
      return restartInst(d.restart);
    }
    if (d.fav) {
      e.stopPropagation();
      return toggleFav(d.fav);
    }
    if (has('dup')) {
      status('Dupliziere…');
      const c = await api.duplicate(cur);
      await refresh();
      toast('Modpack dupliziert', 'ok');
      return go('inst', c.id);
    }
    if (has('ddinst')) {
      return openMenu(t, [
        ...sortedInsts().map(i => ({
          label: i.name,
          sub: meta(i),
          active: i.id === cur,
          act: () => {
            cur = i.id;
            localStorage.setItem('inst', cur);
            $('#launchbar').innerHTML = launchBarHtml();
            syncPlay();
          }
        })),
        '-',
        { label: 'Neues Modpack…', act: openNewModal }
      ], { up: true, align: 'center', minWidth: 300 });
    }
    if (has('logopick')) {
      const u = await api.pickLogo();
      if (u) {
        applyLogoUi(u);
        status('Logo gespeichert');
        renderSettings();
      }
      return;
    }
    if (has('logoclear')) {
      await api.clearLogo();
      applyLogoUi(null);
      status('Logo entfernt (Taskleisten-Symbol ändert sich nach dem Neustart)');
      return renderSettings();
    }
    if (has('dconnect')) {
      status('Verbinde mit Discord…');
      const st = await api.discordApply();
      showDiscord(st);
      return status(st.connected ? 'Discord verbunden' : 'Discord: ' + (st.error || 'nicht verbunden'));
    }
    if (d.go) return go(d.go);
    if (d.open) return go('inst', d.open);
    if (has('new')) return openNewModal();
    if (has('imp')) return importPack();
    if (has('add')) {
      dtype = ikind;
      dcat = '';
      return go('discover');
    }
    if (has('del')) {
      if (!(await ask('Modpack löschen', 'Alle Dateien dieses Modpacks werden unwiderruflich gelöscht.', 'Löschen'))) return;
      await api.deleteInstance(cur);
      sfx('del');
      await refresh();
      return go('home');
    }
    if (has('cover')) {
      if (await api.setCover(cur)) {
        await refresh();
        renderInst();
      }
      return;
    }
    if (has('uncover')) {
      await api.clearCover(cur);
      await refresh();
      return renderInst();
    }
    if (has('export')) {
      status('Exportiere…');
      const p = await api.exportPack(cur);
      return status(p ? 'Exportiert: ' + p : 'Bereit');
    }
    if (has('check')) {
      status('Suche Updates…');
      updates = await api.checkUpdates(cur);
      status(updates.length ? `${updates.length} Updates verfügbar` : 'Alle Mods sind aktuell');
      $('#upd').innerHTML = updatesHtml();
      return;
    }
    if (has('applyupd')) {
      t.disabled = true;
      await api.applyUpdates({ instId: cur, updates });
      updates = [];
      status('Mods aktualisiert');
      return renderInst();
    }
    if (d.toggle) {
      await api.toggle({ instId: cur, dir: d.dir, file: d.toggle });
      return renderInst();
    }
    if (d.rm) {
      t.disabled = true;
      await api.remove({ instId: cur, file: d.rm, dir: d.dir });
      status('Entfernt');
      return renderInst();
    }
    if (d.itab) {
      itab = d.itab;
      return renderInst();
    }
    if (has('instfolder')) return api.openInstFolder(cur);
    if (d.dtype) {
      dtype = d.dtype;
      dcat = '';
      return renderDiscover();
    }
    if (d.ikind) {
      ikind = d.ikind;
      instQ = '';
      instFilter = 'all';
      return renderInst();
    }
    if (d.act) return act(+d.act, t);
    if (has('more')) {
      t.disabled = true;
      return loadResults(true);
    }
    if (d.detail) return openDetail(+d.detail);
    if (has('pclose')) return closeDetail();
    if (d.url) return api.openUrl(d.url);
    if (d.vinst) {
      t.disabled = true;
      await installResult(detail.m, detail.p.versions[+d.vinst].id);
      t.disabled = false;
      reflowResults();
      return;
    }
    if (has('login')) return login();
    if (has('logout')) return logout();
    if (has('move')) {
      status('Zielordner wählen…');
      const dir = await api.moveFolder();
      if (!dir) return status('Bereit');
      await refresh();
      status('Verschoben nach ' + dir);
      return renderSettings();
    }
    if (has('folder')) return api.openFolder();
  } catch (er) {
    err(er);
    if (t.disabled) t.disabled = false;
  }
});

async function init() {
  api.getSettings().then(applyTheme);
  api.sysInfo().then(i => ($('#ver').textContent = 'v' + i.version));
  api.getLogo().then(applyLogoUi);
  initViewFx();
  initPalette();
  initFocusFix();
  initSocial();
  pendingEnter = true;
  await refresh();
  const vs = await api.versions().catch(() => ['1.21.1', '1.20.1']);
  $('#m-ver').innerHTML = vs.map(v => `<option>${v}</option>`).join('');
  enhanceSelects($('#modal'));
  refreshSelect($('#m-ver'));
  $('#acct').onclick = accountMenu;
  $('#close').onclick = () => api.win('close');
  $('#min').onclick = () => api.win('min');
  $('#max').onclick = () => api.win('max');
  $('#hback').onclick = () => histGo(-1);
  $('#hfwd').onclick = () => histGo(1);
  $('#runchip').onclick = () => {
    const id = [...running][0];
    if (!id) return status('Aktuell läuft keine Instanz');
    go('inst', id, false, 'logs');
  };
  $('#runchip').oncontextmenu = async e => {
    e.preventDefault();
    if (!running.size) return;
    if (!(await ask('Alle beenden', `${running.size} laufende Instanz${running.size > 1 ? 'en werden' : ' wird'} sofort beendet.`, 'Alle beenden'))) return;
    await api.killAll();
    status('Beende Minecraft…');
  };
  $('#m-cancel').onclick = () => hideEl($('#modal'));
  $('#m-ok').onclick = createFromModal;
  $('#m-name').onkeydown = e => {
    if (e.key === 'Enter') createFromModal();
  };
  $('#m-name').addEventListener('pointerdown', () => {
    if (!document.hasFocus()) api.focus();
  });
  $('#modal').onclick = e => {
    if (e.target.id === 'modal') hideEl($('#modal'));
  };
  $('#r-name').addEventListener('pointerdown', () => {
    if (!document.hasFocus()) api.focus();
  });
  $('#pmodal').onclick = e => {
    if (e.target.id === 'pmodal') closeDetail();
  };
  api.onStatus(status);
  api.onRunning(l => {
    const ended = [...running].filter(x => !l.includes(x));
    running.clear();
    l.forEach(x => running.add(x));
    syncPlay();
    if (ended.length) {
      refresh().then(() => {
        if (view === 'home') $('#launchbar').innerHTML = launchBarHtml();
        if (view === 'library') $('#grid').innerHTML = gridHtml();
        syncPlay();
      });
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const modalOpen = ['#modal', '#pmodal', '#cmodal', '#rmodal'].some(q => $(q) && !$(q).classList.contains('hide'));
      if (modalOpen) return;
      if (k === 'n') {
        e.preventDefault();
        return openNewModal();
      }
      if (k === 'i') {
        e.preventDefault();
        return importPack();
      }
      if (k === 'f' && view === 'library' && $('#libq')) {
        e.preventDefault();
        $('#libq').focus();
        return $('#libq').select();
      }
    }
    if (e.key !== 'Escape') return;
    if (!$('#cmodal').classList.contains('hide')) return $('#c-no').click();
    if (!$('#pmodal').classList.contains('hide')) closeDetail();
    else if (!$('#modal').classList.contains('hide')) hideEl($('#modal'));
    else if (view !== 'home') go('home');
  });
  api.onCrashed(({ id, code }) => {
    const i = byId(id);
    toast(`${i ? i.name : 'Minecraft'} ist abgestürzt (Code ${code}). Klicke, um die Logs zu öffnen.`, 'error', 10000, () => {
      if (i) go('inst', id, false, 'logs');
    });
  });
  render();
  syncNav();
  pushHist('home', '');
  api.session().then(n => {
    if (n) {
      setAccount(n);
      status('Angemeldet als ' + n);
      if (view === 'home') refreshHome();
    }
  });
}
init();
