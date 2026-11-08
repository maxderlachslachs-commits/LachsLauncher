/* Lokale Freundesliste (Social-Panel) */
const Soc = { open: false, list: [], q: '', fold: JSON.parse(localStorage.getItem('socFold') || '{}') };
const SOC_GROUPS = [['fav', 'Favoriten'], ['friends', 'Freunde'], ['blocked', 'Blockiert']];

function socGroup(f) { return f.blocked ? 'blocked' : f.fav ? 'fav' : 'friends'; }

function socHtml() {
  const q = Soc.q.toLowerCase();
  const l = Soc.list.filter(f => f.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!Soc.list.length) return '<div class="socempty">Noch keine Freunde.<br>Füge Spieler mit ihrem Minecraft-Namen hinzu.</div>';
  return SOC_GROUPS.map(([k, label]) => {
    const g = l.filter(f => socGroup(f) === k);
    if (!g.length && q) return '';
    const open = !Soc.fold[k];
    return `<div class="sgrp${open ? ' open' : ''}"><button class="sgh" data-sfold="${k}"><b>${g.length}</b><span>${label}</span><svg viewBox="0 0 8 12"><path d="M1.5 1.5l5 4.5-5 4.5"/></svg></button>
      ${open ? `<div class="sgb">${g.map(f => `<div class="sfr${f.blocked ? ' blk' : ''}" data-sid="${esc(f.id)}">
        ${f.avatar ? `<img src="${f.avatar}" alt="">` : `<i class="sph">${esc(f.name[0])}</i>`}<span>${esc(f.name)}</span>
        <button class="sdots" data-smenu="${esc(f.id)}" data-menu-anchor="1" title="Optionen">···</button></div>`).join('') || '<div class="sge">Leer</div>'}</div>` : ''}</div>`;
  }).join('');
}

function paintSoc() { qs('#soc-list').innerHTML = socHtml(); }

async function loadSoc() {
  qs('#soc-list').innerHTML = '<div class="socempty"><i class="spinner"></i></div>';
  try { Soc.list = await api.friendsList(); } catch (e) { Soc.list = []; err(e); }
  paintSoc();
}

function openSocial(v) {
  Soc.open = v;
  qs('#social').classList.toggle('closed', !v);
  if (v) {
    qs('#soc-name').textContent = account || 'Nicht angemeldet';
    paintSocAvatar();
    loadSoc();
  }
}

async function paintSocAvatar() {
  const c = qs('#soc-av'), x = c.getContext('2d');
  x.clearRect(0, 0, 40, 40);
  x.imageSmoothingEnabled = false;
  const src = homeSkin ? homeSkin.skin : (cachedSkin() || {}).skin;
  if (!account || !src) return;
  const img = await loadImg(src.dataUrl);
  x.drawImage(img, 8, 8, 8, 8, 0, 0, 40, 40);
  x.drawImage(img, 40, 8, 8, 8, 0, 0, 40, 40);
}

async function addFriend() {
  const inp = qs('#soc-in');
  const name = inp.value.trim();
  if (!name) return inp.focus();
  qs('#soc-go').disabled = true;
  try {
    const f = await api.friendAdd(name);
    inp.value = '';
    toast(f.name + ' hinzugefügt', 'ok');
    qs('#soc-addrow').classList.add('hide');
    await loadSoc();
  } catch (e) {
    err(e);
  }
  qs('#soc-go').disabled = false;
}

function initSocial() {
  qs('#fbtn').onclick = () => openSocial(!Soc.open);
  qs('#soc-close').onclick = () => openSocial(false);
  qs('#soc-add').onclick = () => {
    const r = qs('#soc-addrow');
    r.classList.toggle('hide');
    if (!r.classList.contains('hide')) setTimeout(() => qs('#soc-in').focus(), 30);
  };
  qs('#soc-go').onclick = addFriend;
  qs('#soc-in').onkeydown = e => {
    if (e.key === 'Enter') addFriend();
  };
  qs('#soc-q').oninput = e => { Soc.q = e.target.value; paintSoc(); };
  qs('#soc-copy').onclick = async () => {
    await api.copyText(Soc.list.map(f => f.name).join('\n'));
    toast('Namen kopiert', 'ok');
  };
  qs('#soc-list').onclick = e => {
    const fold = e.target.closest('[data-sfold]');
    if (fold) {
      Soc.fold[fold.dataset.sfold] = !Soc.fold[fold.dataset.sfold];
      localStorage.setItem('socFold', JSON.stringify(Soc.fold));
      return paintSoc();
    }
    const m = e.target.closest('[data-smenu]');
    if (!m) return;
    const f = Soc.list.find(x => x.id === m.dataset.smenu);
    const upd = async patch => { await api.friendUpdate({ id: f.id, patch }); await loadSoc(); };
    openMenu(m, [
      { label: f.fav ? 'Favorit entfernen' : 'Als Favorit', act: () => upd({ fav: !f.fav }) },
      { label: 'Profil ansehen', act: () => plOpen(f.name) },
      { label: 'Name kopieren', act: () => api.copyText(f.name) },
      { label: f.blocked ? 'Entblocken' : 'Blockieren', act: () => upd({ blocked: !f.blocked }) },
      '-',
      { label: 'Entfernen', danger: true, act: async () => { await api.friendRemove(f.id); await loadSoc(); } }
    ], { align: 'right' });
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && Soc.open && !document.querySelector('.menu')) openSocial(false); });
}
