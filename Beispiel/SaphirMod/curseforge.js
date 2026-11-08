/* Import von CurseForge-Modpacks (manifest.json). Benötigt einen CurseForge-API-Key. */
const CF = 'https://api.curseforge.com/v1';
const DIRS = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };
const SKIP_CLASS = new Set([17, 4471]);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

module.exports = function makeCurseforge(ctx) {
  const { getSettings, UA, download, createInstance, removeInstance, instDir, send, path, fs } = ctx;
  const doFetch = ctx.fetch || fetch;

  const post = async (url, body) => {
    const key = (getSettings().cfKey || '').trim();
    if (!key) throw new Error('Für CurseForge-Modpacks brauchst du einen API-Key (Einstellungen › CurseForge)');
    const r = await doFetch(CF + url, { method: 'POST', headers: { ...UA, 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401 || r.status === 403) throw new Error('CurseForge hat den API-Key abgelehnt');
    if (!r.ok) throw new Error('CurseForge nicht erreichbar (HTTP ' + r.status + ')');
    return (await r.json()).data || [];
  };

  async function importCurseforge(zip) {
    const entry = zip.getEntry('manifest.json');
    if (!entry) throw new Error('Keine gültige CurseForge-Datei (manifest.json fehlt)');
    const m = JSON.parse(entry.getData().toString('utf8'));
    if (!m.minecraft || !m.minecraft.version) throw new Error('Pack enthält keine Minecraft-Version');
    const loaders = m.minecraft.modLoaders || [];
    const pl = loaders.find(l => l.primary) || loaders[0];
    let loader = 'vanilla';
    let loaderVersion;
    if (pl) {
      const [k, ...rest] = String(pl.id).split('-');
      if (['forge', 'fabric', 'neoforge', 'quilt'].includes(k)) {
        loader = k;
        loaderVersion = rest.join('-') || undefined;
      }
    }
    const files = m.files || [];
    send('status', 'Frage CurseForge ab…');
    const info = new Map();
    for (const part of chunk([...new Set(files.map(f => f.fileID))], 200)) {
      for (const f of await post('/mods/files', { fileIds: part })) info.set(f.id, f);
    }
    const classes = new Map();
    for (const part of chunk([...new Set(files.map(f => f.projectID))], 200)) {
      for (const p of await post('/mods', { modIds: part })) classes.set(p.id, p.classId);
    }
    const inst = createInstance({ name: m.name || 'Modpack', mc: m.minecraft.version, loader, loaderVersion });
    const skipped = [];
    try {
      const dir = path.resolve(instDir(inst.id));
      const jobs = files.filter(f => !SKIP_CLASS.has(classes.get(f.projectID)));
      let next = 0;
      let done = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < jobs.length) {
          const f = jobs[next++];
          const fi = info.get(f.fileID);
          try {
            if (!fi || !fi.fileName) throw new Error('nicht gefunden');
            const url = fi.downloadUrl || `https://edge.forgecdn.net/files/${Math.floor(fi.id / 1000)}/${fi.id % 1000}/${encodeURIComponent(fi.fileName)}`;
            const dest = path.resolve(dir, DIRS[classes.get(f.projectID)] || 'mods', path.basename(fi.fileName));
            if (!dest.startsWith(dir + path.sep)) throw new Error('Ungültiger Pfad');
            await download(url, dest);
          } catch {
            skipped.push({ name: fi ? fi.fileName : 'Datei ' + f.fileID, projectID: f.projectID });
          }
          send('status', `Pack-Dateien ${++done}/${jobs.length}`);
        }
      }));
      const prefix = (m.overrides || 'overrides').replace(/\/?$/, '/');
      for (const en of zip.getEntries()) {
        if (en.isDirectory || !en.entryName.startsWith(prefix)) continue;
        const dest = path.resolve(dir, en.entryName.slice(prefix.length));
        if (!dest.startsWith(dir + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, en.getData());
      }
      if (skipped.length) {
        fs.writeFileSync(path.join(dir, 'skipped-mods.txt'), 'Diese Dateien konnten nicht geladen werden (Autor erlaubt keinen Download außerhalb von CurseForge).\nLade sie manuell herunter und lege sie in den passenden Ordner:\n\n' + skipped.map(s => `${s.name}  https://www.curseforge.com/projects/${s.projectID}`).join('\n') + '\n');
      }
    } catch (e) {
      removeInstance(inst.id);
      throw e;
    }
    return { ...inst, skipped: skipped.length };
  }

  return { importCurseforge };
};
