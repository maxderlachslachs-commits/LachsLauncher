/* Spielersuche: öffentliche Infos zu beliebigen Minecraft-Spielern */
const Pl = { q: '', data: null, items: [], sel: 0, loading: false, err: '', tok: 0, recent: [] };
try { Pl.recent = JSON.parse(localStorage.getItem('plRecent') || '[]'); } catch {}

const plDate = t => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const plDays = ms => Math.max(0, Math.round(ms / 864e5)) + 'd';
const plCopyBtn = t => `<button class="plcp" data-plcopy="${esc(t)}" title="Kopieren"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg></button>`;

function plRemember(name) {
  Pl.recent = [name, ...Pl.recent.filter(n => n.toLowerCase() !== name.toLowerCase())].slice(0, 8);
  localStorage.setItem('plRecent', JSON.stringify(Pl.recent));
}

function plRecentHtml() {
  if (!Pl.recent.length) return '';
  return `<span class="lbl">Zuletzt:</span>${Pl.recent.map(n => `<button class="chip btn sm" data-plsearch="${esc(n)}">${esc(n)}</button>`).join('')}<button class="chip btn sm" data-plclear title="Verlauf löschen">✕</button>`;
}

function plNamesHtml(d) {
  if (!d.names.length) {
    return `<div class="plrow single"><b>1</b><span>${esc(d.name)}</span></div>
      <p class="hint">${d.labyOk ? 'Keine Namensänderungen bekannt.' : 'Namensverlauf nicht verfügbar (laby.net nicht erreichbar).'}</p>`;
  }
  const asc = [...d.names].sort((a, b) => (a.changedAt ?? -Infinity) - (b.changedAt ?? -Infinity));
  const now = Date.now();
  return asc.map((n, i) => {
    const next = asc[i + 1];
    const dur = n.changedAt != null ? plDays((next && next.changedAt != null ? next.changedAt : now) - n.changedAt) : '';
    return `<div class="plrow"><b>${i + 1}</b><span data-plsearch="${esc(n.name)}" class="plname" title="Diesen Namen suchen">${esc(n.name)}</span>
      ${n.changedAt != null ? `<em${n.accurate ? '' : ' class="warn" title="Datum ungenau"'}>${n.accurate ? '' : '⚠ '}${plDate(n.changedAt)}</em><i>${dur}</i>` : '<em>Ursprünglicher Name</em>'}</div>`;
  }).reverse().join('');
}

function plBuildItems(d) {
  const it = [];
  if (d.skin) it.push({ dataUrl: d.skin.dataUrl, variant: d.skin.variant, label: 'Aktuell' });
  d.skins.forEach(s => it.push({ dataUrl: s.dataUrl, variant: null, label: s.first ? plDate(s.first).split(',')[0] : 'Früher' }));
  return it;
}

/* Slim-Erkennung für Verlaufs-Skins: rechte Arm-Rückseite (x 54–55) ist bei Slim leer */
async function plVariant(it) {
  if (it.variant) return it.variant;
  try {
    const img = await loadImg(it.dataUrl);
    if (img.height < 64) return (it.variant = 'classic');
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    it.variant = x.getImageData(55, 24, 1, 1).data[3] === 0 ? 'slim' : 'classic';
  } catch { it.variant = 'classic'; }
  return it.variant;
}

function plPaintHead(canvas, url) {
  loadImg(url).then(img => {
    const c = canvas.getContext('2d');
    canvas.width = canvas.height = 48;
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 8, 8, 8, 8, 0, 0, 48, 48);
    if (img.height >= 32) c.drawImage(img, 40, 8, 8, 8, 0, 0, 48, 48);
  });
}

function plPaintCape(canvas, url) {
  loadImg(url).then(img => {
    const k = img.width / 64, c = canvas.getContext('2d');
    canvas.width = 40;
    canvas.height = 64;
    c.imageSmoothingEnabled = false;
    c.drawImage(img, k, k, 10 * k, 16 * k, 0, 0, 40, 64);
  });
}

function plResultHtml(d) {
  const it = Pl.items;
  const cur = it[Pl.sel];
  const capes = [...(d.cape ? [{ dataUrl: d.cape.dataUrl, label: 'Aktuell' }] : []), ...d.capes.map(c => ({ dataUrl: c.dataUrl, label: c.first ? plDate(c.first).split(',')[0] : 'Früher' }))];
  const giveNew = `/give @p minecraft:player_head[profile="${d.name}"]`;
  const giveOld = `/give @p minecraft:player_head{SkullOwner:"${d.name}"}`;
  const avatar = `https://laby.net/texture/profile/head/${d.dashed}.png`;
  return `<div class="pllayout">
    <div class="skinprev">
      ${cur ? '<div id="stagehost" class="stagehost mini"></div>' : '<div class="empty">Kein Skin verfügbar.</div>'}
      <h3>${esc(d.name)}</h3>
      ${cur ? `<p class="hint" id="plvar" style="text-align:center;margin:0">${cur.label} · ${cur.variant === 'slim' ? 'Slim' : cur.variant === 'classic' ? 'Classic' : ''}</p>` : ''}
      <div class="btns2">
        ${cur ? '<button class="chip btn sm" data-plspin>Drehen: An</button><button class="chip btn sm" data-plreset>Zurücksetzen</button>' : ''}
      </div>
      <div class="btns2">
        <button class="chip play sm" data-pladd="${esc(d.name)}">Freund hinzufügen</button>
        ${d.skin ? `<button class="chip btn sm" data-plimport="${esc(d.name)}">Skin importieren</button>` : ''}
      </div>
    </div>
    <div class="plcol">
      ${d.limited ? '<div class="plwarn">Skin/Cape konnten gerade nicht von Mojang geladen werden (Rate-Limit). Bitte in einer Minute erneut versuchen.</div>' : ''}
      <section class="plbox"><h4>Profil</h4>
        <div class="plkv"><span>Name</span><code>${esc(d.name)}</code>${plCopyBtn(d.name)}</div>
        <div class="plkv"><span>UUID</span><code>${esc(d.dashed)}</code>${plCopyBtn(d.dashed)}</div>
        <div class="plkv"><span>UUID (kurz)</span><code>${esc(d.id)}</code>${plCopyBtn(d.id)}</div>
        <div class="plkv"><span>Offline-UUID</span><code>${esc(d.offline)}</code>${plCopyBtn(d.offline)}</div>
      </section>
      <section class="plbox"><h4>Namenshistorie</h4>${plNamesHtml(d)}</section>
      ${it.length ? `<section class="plbox"><h4>Skin-Verlauf <small>(${it.length})</small></h4>
        <div class="plthumbs">${it.map((s, i) => `<button class="plth${i === Pl.sel ? ' on' : ''}" data-plsel="${i}" title="${esc(s.label)}"><canvas data-plh="${i}"></canvas></button>`).join('')}</div>
        ${d.labyOk ? '' : '<p class="hint">Frühere Skins sind nur mit laby.net verfügbar (aktuell nicht erreichbar).</p>'}</section>` : ''}
      <section class="plbox"><h4>Capes <small>(${capes.length})</small></h4>
        ${capes.length ? `<div class="plthumbs">${capes.map((c, i) => `<div class="plcape" title="${esc(c.label)}"><canvas data-plc="${i}"></canvas><span>${esc(c.label)}</span></div>`).join('')}</div>` : '<p class="hint">Dieser Spieler hat kein Cape.</p>'}
      </section>
      <section class="plbox"><h4>Befehle &amp; API</h4>
        <div class="lbl">Spielerkopf (1.21+)</div>
        <div class="plkv"><code>${esc(giveNew)}</code>${plCopyBtn(giveNew)}</div>
        <div class="lbl">Spielerkopf (bis 1.20.4)</div>
        <div class="plkv"><code>${esc(giveOld)}</code>${plCopyBtn(giveOld)}</div>
        <div class="lbl">Avatar-URL</div>
        <div class="plkv"><code>${esc(avatar)}</code>${plCopyBtn(avatar)}</div>
        <div class="btns2" style="justify-content:flex-start;margin-top:6px">
          <button class="chip btn sm" data-url="https://laby.net/@${esc(d.name)}">laby.net</button>
          <button class="chip btn sm" data-url="https://namemc.com/profile/${esc(d.id)}">NameMC</button>
          <button class="chip btn sm" data-url="https://sessionserver.mojang.com/session/minecraft/profile/${esc(d.id)}">Mojang API</button>
        </div>
      </section>
    </div>
  </div>`;
}

function paintPl() {
  const host = $('#plres');
  if (!host) return;
  if (Pl.loading) return void (host.innerHTML = '<div class="empty"><i class="spinner"></i>Suche…</div>');
  if (Pl.err) return void (host.innerHTML = `<div class="empty">${esc(Pl.err)}</div>`);
  if (!Pl.data) return void (host.innerHTML = '<div class="empty">Gib einen Minecraft-Namen oder eine UUID ein,<br>um Skin, Cape, Namenshistorie und mehr zu sehen.</div>');
  host.innerHTML = plResultHtml(Pl.data);
  Pl.items.forEach((s, i) => plPaintHead(host.querySelector(`canvas[data-plh="${i}"]`), s.dataUrl));
  const capes = [...(Pl.data.cape ? [Pl.data.cape] : []), ...Pl.data.capes];
  capes.forEach((c, i) => plPaintCape(host.querySelector(`canvas[data-plc="${i}"]`), c.dataUrl));
  if ($('#stagehost')) {
    mountStage($('#stagehost'), { dist: 88, auto: true, pose: 'idle' });
    plShowSkin();
  }
}

async function plShowSkin() {
  const it = Pl.items[Pl.sel];
  if (!it) return;
  const variant = await plVariant(it);
  if (view !== 'players' || Pl.items[Pl.sel] !== it) return;
  setStageSkin({ dataUrl: it.dataUrl, variant, name: Pl.data.name });
  const v = $('#plvar');
  if (v) v.textContent = `${it.label} · ${variant === 'slim' ? 'Slim' : 'Classic'}`;
}

async function plSearch(q) {
  q = String(q != null ? q : ($('#plq') || {}).value || '').trim();
  if (!q) return $('#plq') && $('#plq').focus();
  Pl.q = q;
  if ($('#plq')) $('#plq').value = q;
  Pl.loading = true;
  Pl.err = '';
  paintPl();
  const tok = ++Pl.tok;
  try {
    const d = await api.playerLookup(q);
    if (tok !== Pl.tok) return;
    Pl.data = d;
    Pl.items = plBuildItems(d);
    Pl.sel = 0;
    plRemember(d.name);
  } catch (e) {
    if (tok !== Pl.tok) return;
    Pl.data = null;
    Pl.items = [];
    Pl.err = cleanMsg(e);
  }
  Pl.loading = false;
  if (view !== 'players') return;
  if ($('#plrecent')) $('#plrecent').innerHTML = plRecentHtml();
  paintPl();
}

function plOpen(name) {
  Pl.q = name;
  go('players');
  plSearch(name);
}

function renderPlayers() {
  $('#view').innerHTML = `
    <h2>Spielersuche</h2>
    <div class="toolbar">
      <input id="plq" class="search" placeholder="Minecraft-Name oder UUID" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(Pl.q)}">
      <button class="chip play" data-plgo>Suchen</button>
    </div>
    <div class="plrecent" id="plrecent">${plRecentHtml()}</div>
    <div id="plres"></div>`;
  $('#plq').onkeydown = e => { if (e.key === 'Enter') plSearch(); };
  if (Pl.data && !Pl.loading) paintPl();
  else if (Pl.loading) paintPl();
  else { paintPl(); setTimeout(() => $('#plq') && $('#plq').focus(), 30); }
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-plgo],[data-plsearch],[data-plclear],[data-plcopy],[data-plsel],[data-plspin],[data-plreset],[data-pladd],[data-plimport]');
  if (!t) return;
  const d = t.dataset;
  const has = a => t.hasAttribute('data-' + a);
  try {
    if (has('plgo')) return plSearch();
    if (d.plsearch) return plSearch(d.plsearch);
    if (has('plclear')) {
      Pl.recent = [];
      localStorage.removeItem('plRecent');
      $('#plrecent').innerHTML = '';
      return;
    }
    if (d.plcopy) {
      await api.copyText(d.plcopy);
      return toast('Kopiert', 'ok', 1800);
    }
    if (d.plsel != null && t.matches('[data-plsel]')) {
      Pl.sel = +d.plsel;
      document.querySelectorAll('.plth').forEach((b, i) => b.classList.toggle('on', i === Pl.sel));
      return plShowSkin();
    }
    if (has('plspin')) {
      Stage.auto = !Stage.auto;
      Stage.dirty = true;
      t.textContent = 'Drehen: ' + (Stage.auto ? 'An' : 'Aus');
      return;
    }
    if (has('plreset')) {
      Object.assign(Stage, { yaw: -0.6, pitch: 0.1, dist: 88, dirty: true });
      return;
    }
    if (d.pladd) {
      const f = await api.friendAdd(d.pladd);
      return toast(f.name + ' hinzugefügt', 'ok');
    }
    if (d.plimport) {
      t.disabled = true;
      status('Importiere Skin…');
      const s = await api.skinImport(d.plimport);
      t.disabled = false;
      skinLoaded = false;
      status('Skin von ' + s.name + ' importiert');
      return toast('Skin in deiner Bibliothek gespeichert', 'ok');
    }
  } catch (er) {
    err(er);
    if (t.disabled) t.disabled = false;
  }
});
