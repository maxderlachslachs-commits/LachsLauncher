/* Rechtsklick-Menü für Modpacks (Bibliothek + Seitenleiste) */

async function instChanged() {
  await refresh();
  if (view === 'library') {
    if (!insts.length) return render();
    $('#grid').innerHTML = gridHtml();
    syncPlay();
  } else if (view === 'home') refreshHome();
  else if (view === 'inst') byId(cur) ? renderInst() : go('home');
}

function askRename(oldName) {
  return new Promise(res => {
    const m = $('#rmodal'), inp = $('#r-name');
    inp.value = oldName;
    showEl(m);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = v => {
      hideEl(m);
      $('#r-ok').onclick = $('#r-cancel').onclick = inp.onkeydown = m.onclick = null;
      res(v);
    };
    $('#r-ok').onclick = () => done(inp.value.trim() || null);
    $('#r-cancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); };
    m.onclick = e => { if (e.target === m) done(null); };
  });
}

async function instAction(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg, 'ok');
  } catch (e) {
    err(e);
  }
}

function instMenuItems(i) {
  const id = i.id;
  const run = running.has(id);
  return [
    run
      ? { label: 'Beenden', sub: i.name + ' läuft', act: () => instAction(() => killInst(id)) }
      : { label: 'Spielen', sub: i.name + ' · ' + meta(i), act: () => play(id) },
    ...(run ? [{ label: 'Neustart', act: () => instAction(() => restartInst(id)) }] : []),
    '-',
    { label: 'Verwalten', act: () => go('inst', id) },
    { label: 'Mods & Inhalte hinzufügen', act: () => { cur = id; localStorage.setItem('inst', id); dtype = 'mod'; dcat = ''; go('discover'); } },
    { label: 'Logs ansehen', act: () => go('inst', id, false, 'logs') },
    { label: 'Einstellungen (RAM, Java)', act: () => go('inst', id, false, 'settings') },
    '-',
    { label: i.fav ? 'Favorit entfernen' : 'Als Favorit markieren', act: () => instAction(() => toggleFav(id)) },
    {
      label: 'Umbenennen',
      act: () => instAction(async () => {
        const n = await askRename(i.name);
        if (!n || n === i.name) return;
        await api.updateInstance({ id, patch: { name: n.slice(0, 40) } });
        await instChanged();
        status('Umbenannt in ' + n);
      })
    },
    {
      label: 'Duplizieren',
      act: () => instAction(async () => {
        status('Dupliziere…');
        const c = await api.duplicate(id);
        await instChanged();
        toast(c.name + ' erstellt', 'ok');
      })
    },
    {
      label: 'Exportieren (.mrpack)',
      act: () => instAction(async () => {
        status('Exportiere…');
        const p = await api.exportPack(id);
        status(p ? 'Exportiert: ' + p : 'Bereit');
      })
    },
    { label: 'Ordner öffnen', act: () => api.openInstFolder(id) },
    '-',
    {
      label: 'Cover ändern',
      act: () => instAction(async () => { if (await api.setCover(id)) await instChanged(); })
    },
    ...(i.coverUrl ? [{ label: 'Cover entfernen', act: () => instAction(async () => { await api.clearCover(id); await instChanged(); }) }] : []),
    '-',
    {
      label: 'Löschen',
      danger: true,
      act: () => instAction(async () => {
        if (running.has(id)) return toast('Beende das Modpack zuerst, bevor du es löschst.', 'error');
        if (!(await ask('Modpack löschen', `„${i.name}“ und alle Dateien werden unwiderruflich gelöscht.`, 'Löschen'))) return;
        await api.deleteInstance(id);
        sfx('del');
        await instChanged();
        toast(i.name + ' gelöscht', 'ok');
      })
    }
  ];
}

document.addEventListener('contextmenu', e => {
  const el = e.target.closest('.card[data-open], #navlist [data-open]');
  if (!el) return;
  e.preventDefault();
  const i = byId(el.dataset.open);
  if (!i) return;
  openMenu({ at: { x: e.clientX, y: e.clientY } }, instMenuItems(i), { at: true, cls: 'tall' });
});

/* Menü schließen: Esc (vor der globalen Esc-Navigation), Scrollen, Fokusverlust */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const rm = document.querySelector('#rmodal');
  if (rm && !rm.classList.contains('hide')) {
    e.stopImmediatePropagation();
    return $('#r-cancel').click();
  }
  if (menuEl) {
    e.stopImmediatePropagation();
    closeMenu();
  }
}, true);
document.addEventListener('scroll', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', () => closeMenu());
