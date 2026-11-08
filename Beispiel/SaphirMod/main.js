const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const AdmZip = require('adm-zip');
const { Rpc } = require('./discord');
const makeCurseforge = require('./curseforge');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const UA = { 'User-Agent': 'SaphirMod/1.0 (github.com/saphirmod)' };
const API = 'https://api.modrinth.com/v2';
const enc = v => encodeURIComponent(JSON.stringify(v));
let win;
let auth = null;
let authAt = 0;
let root, instRoot, instFile;
const running = new Set();
const liveLogs = {};
const procs = new Map();
const killReq = new Set();
const killed = new Set();
const killProc = c => {
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else c.kill('SIGKILL');
  } catch {}
};
const pushLog = (id, line) => {
  const a = liveLogs[id] || (liveLogs[id] = []);
  a.push(...String(line).replace(/(--accessToken\s+)\S+/g, '$1***').split(/\r?\n/).filter(Boolean));
  if (a.length > 3000) a.splice(0, a.length - 3000);
};
const refocus = () => setTimeout(() => {
  if (!win || win.isDestroyed()) return;
  if (!win.isFocused()) win.focus();
  win.webContents.focus();
}, 60);
const openDialog = async o => {
  const r = await dialog.showOpenDialog(win, o);
  refocus();
  return r;
};
const saveDialog = async o => {
  const r = await dialog.showSaveDialog(win, o);
  refocus();
  return r;
};
const locFile = () => path.join(app.getPath('userData'), 'location.json');
const dataBase = () => {
  try {
    const d = JSON.parse(fs.readFileSync(locFile(), 'utf8')).dir;
    if (d && fs.existsSync(d)) return d;
  } catch {}
  return app.getPath('userData');
};
const applyBase = b => {
  root = path.join(b, 'minecraft');
  instRoot = path.join(b, 'instances');
};

const loadInst = () => {
  try { return JSON.parse(fs.readFileSync(instFile, 'utf8')); } catch { return []; }
};
const saveInst = l => fs.writeFileSync(instFile, JSON.stringify(l));
const instDir = id => path.join(instRoot, id);
const addPlaytime = (id, ms) => saveInst(loadInst().map(i => (i.id === id ? { ...i, playtime: (i.playtime || 0) + ms } : i)));
const getInst = id => loadInst().find(i => i.id === id);
const idir = id => {
  if (!getInst(id)) throw new Error('Modpack nicht gefunden');
  return instDir(id);
};
const safe = (id, ...p) => {
  const base = path.resolve(idir(id));
  const t = path.resolve(base, ...p);
  if (!t.startsWith(base + path.sep)) throw new Error('Ungültiger Pfad');
  return t;
};
const metaPath = id => path.join(instDir(id), 'saphirmod-mods.json');
const readMeta = id => {
  try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return {}; }
};
const writeMeta = (id, m) => fs.writeFileSync(metaPath(id), JSON.stringify(m));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
const send = (ch, d) => win && !win.isDestroyed() && win.webContents.send(ch, d);
const hashFile = (p, alg) => crypto.createHash(alg).update(fs.readFileSync(p)).digest('hex');
const loadersFor = inst => (inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]);
const LABEL = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

const getJson = async url => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' bei ' + url);
  return r.json();
};
const postJson = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
const getBuffer = async url => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('Download fehlgeschlagen: ' + url);
  return Buffer.from(await r.arrayBuffer());
};
const download = async (url, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, await getBuffer(url));
};

const COVER = /^cover\.(png|jpe?g|webp|gif)$/i;
const withCover = i => {
  try {
    const d = instDir(i.id);
    const f = fs.readdirSync(d).find(x => COVER.test(x));
    if (f) {
      const p = path.join(d, f);
      return { ...i, coverUrl: pathToFileURL(p).href + '?v=' + Math.round(fs.statSync(p).mtimeMs) };
    }
  } catch {}
  return i;
};
const clearCover = id => {
  const d = idir(id);
  for (const f of fs.readdirSync(d)) if (/^cover\./i.test(f)) fs.unlinkSync(path.join(d, f));
};
const coverFromUrl = async (id, url) => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    await download(url, path.join(instDir(id), 'cover' + (/^\.(png|jpe?g|webp|gif)$/.test(ext) ? ext : '.png')));
  } catch {}
};

function createInstance({ name, mc, loader, loaderVersion }) {
  const inst = { id: slug(name) + '-' + Date.now().toString(36), name, mc, loader, loaderVersion };
  fs.mkdirSync(path.join(instDir(inst.id), 'mods'), { recursive: true });
  saveInst([...loadInst(), inst]);
  return inst;
}
const removeInstance = id => {
  saveInst(loadInst().filter(i => i.id !== id));
  fs.rmSync(instDir(id), { recursive: true, force: true });
};

const OPENS = ['java.lang.invoke', 'java.lang', 'java.lang.reflect', 'java.util', 'java.net', 'java.io', 'java.nio', 'sun.nio.ch', 'jdk.internal.misc'];
// MCLC ignoriert "arguments.jvm" der Forge/NeoForge-Version-JSON (Modulpfad, --add-opens, --add-modules ...).
// Ohne diese Argumente scheitert modernes Forge (1.17+) mit "module java.base does not opens java.lang.invoke".
const loaderJvmArgs = custom => {
  try {
    const f = path.join(root, 'versions', custom, custom + '.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const raw = (j.arguments && j.arguments.jvm) || [];
    const sep = process.platform === 'win32' ? ';' : ':';
    const lib = path.join(root, 'libraries');
    const out = [];
    for (const a of raw) {
      if (typeof a !== 'string') continue;
      const v = a
        .replace(/\$\{library_directory\}/g, lib)
        .replace(/\$\{classpath_separator\}/g, sep)
        .replace(/\$\{version_name\}/g, custom);
      if (v.includes('${')) continue;
      out.push(v);
    }
    return out;
  } catch {
    return [];
  }
};
const javaCache = new Map();
const javaJobs = new Map();

const guessJava = mc => {
  const p = String(mc).split('.').map(n => parseInt(n, 10) || 0);
  if (p[0] >= 26) return 25;
  if (p[0] === 1) {
    if (p[1] <= 16) return 8;
    if (p[1] < 20 || (p[1] === 20 && p[2] < 5)) return 17;
  }
  return 21;
};

const requiredJava = async mc => {
  if (javaCache.has(mc)) return javaCache.get(mc);
  let major = 0;
  try {
    const man = await getJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    const v = man.versions.find(x => x.id === mc);
    if (v) {
      const j = await getJson(v.url);
      major = j.javaVersion ? j.javaVersion.majorVersion : 8;
    }
  } catch {}
  if (!major) major = guessJava(mc);
  if (major === 16) major = 17;
  javaCache.set(mc, major);
  return major;
};

const javaMajorOnce = bin => new Promise(resolve => {
  execFile(bin, ['-version'], { timeout: 20000, windowsHide: true }, (e, so, se) => {
    const t = /version "(\d+)(?:\.(\d+))?/.exec(String(se || '') + String(so || ''));
    if (!t) return resolve(0);
    resolve(+t[1] === 1 ? +t[2] : +t[1]);
  });
});
const javaMajor = async bin => (await javaMajorOnce(bin)) || (await javaMajorOnce(bin));

// Java gilt nur als nutzbar, wenn die Version passt und die Installation vollständig ist
// (Java 9+ braucht lib/tzdb.dat; fehlt sie, stürzt Forge mit FileNotFoundException ab).
const javaOk = async (bin, major) => {
  if ((await javaMajor(bin)) !== major) return false;
  if (bin === 'java' || major < 9) return true;
  return fs.existsSync(path.join(path.dirname(bin), '..', 'lib', 'tzdb.dat'));
};

// Bereits installierte Javas suchen (JAVA_HOME + übliche Installationsordner)
const systemJavaCandidates = () => {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const out = [];
  if (process.env.JAVA_HOME) out.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  const roots = process.platform === 'win32'
    ? ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(k => process.env[k]).filter(Boolean).flatMap(b => ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'Programs\\Eclipse Adoptium'].map(d => path.join(b, d)))
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', path.join(os.homedir(), '.sdkman/candidates/java')];
  for (const r of roots) {
    try {
      for (const e of fs.readdirSync(r, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const b = findJava(path.join(r, e.name), 2);
        if (b) out.push(b);
      }
    } catch {}
  }
  return out;
};

const findJava = (dir, depth = 5) => {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const direct = path.join(dir, 'bin', exe);
  if (fs.existsSync(direct)) return direct;
  if (depth <= 0 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = findJava(path.join(dir, e.name), depth - 1);
    if (r) return r;
  }
  return null;
};

const downloadProgress = async (url, dest, label) => {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error('Download fehlgeschlagen (HTTP ' + r.status + ')');
  const total = +r.headers.get('content-length') || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest);
  const reader = r.body.getReader();
  let got = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(value)) await new Promise(res => out.once('drain', res));
    got += value.length;
    if (Date.now() - last > 200) {
      last = Date.now();
      send('status', total ? `${label} ${Math.round((got / total) * 100)} %` : label);
    }
  }
  await new Promise((res, rej) => out.end(e => (e ? rej(e) : res())));
};

const adoptiumUrl = major => {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64', ia32: 'x86-32' }[process.arch];
  if (!os || !arch) throw new Error('Diese Plattform wird für den Java-Download nicht unterstützt');
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
};

async function installJava(major) {
  const dir = path.join(root, 'runtime', 'java-' + major);
  const have = findJava(dir);
  if (have && (await javaOk(have, major))) return have;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const win = process.platform === 'win32';
  const arc = path.join(root, 'runtime', `java-${major}${win ? '.zip' : '.tar.gz'}`);
  try {
    await downloadProgress(adoptiumUrl(major), arc, `Lade Java ${major}`);
    send('status', `Entpacke Java ${major}…`);
    if (win) new AdmZip(arc).extractAllTo(dir, true);
    else {
      await new Promise((res, rej) => {
        spawn('tar', ['-xzf', arc, '-C', dir]).on('error', rej).on('close', c => (c === 0 ? res() : rej(new Error('Entpacken fehlgeschlagen'))));
      });
    }
  } finally {
    fs.rmSync(arc, { force: true });
  }
  const bin = findJava(dir);
  if (!bin) throw new Error('Java-Installation unvollständig');
  if (!win) {
    try { fs.chmodSync(bin, 0o755); } catch {}
  }
  if (!(await javaOk(bin, major))) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('Heruntergeladene Java-Version ist nicht lauffähig');
  }
  return bin;
}

async function resolveJava(inst) {
  const s = getSettings();
  const custom = String(s.javaPath || '').trim();
  const major = await requiredJava(inst.mc);
  // Manuell nur, wenn wirklich ein Pfad eingetragen ist (sonst würde die System-Java genutzt)
  const own = String(inst.javaPath || '').trim();
  if (own) {
    if (!(await javaMajor(own))) throw new Error('Java-Pfad dieses Modpacks ist ungültig: ' + own);
    return own;
  }
  if (s.javaAuto === false && custom) return custom;
  if (custom && (await javaOk(custom, major))) return custom;
  const managed = findJava(path.join(root, 'runtime', 'java-' + major));
  if (managed && (await javaOk(managed, major))) return managed;
  for (const c of systemJavaCandidates()) {
    if (await javaOk(c, major)) return c;
  }
  if ((await javaMajor('java')) === major) return 'java';
  const key = String(major);
  if (!javaJobs.has(key)) javaJobs.set(key, installJava(major).finally(() => javaJobs.delete(key)));
  try {
    const bin = await javaJobs.get(key);
    send('status', `Java ${major} bereit`);
    return bin;
  } catch (e) {
    // Bewusst kein Fallback auf eine andere Java-Version: z. B. Forge 1.20.1 startet mit Java 25 nicht.
    throw new Error(`Java ${major} für Minecraft ${inst.mc} konnte nicht geladen werden: ${e.message}`);
  }
}

const runInstaller = (jar, javaBin) => new Promise((resolve, reject) => {
  const lp = path.join(root, 'launcher_profiles.json');
  if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {} }));
  const p = spawn(javaBin || 'java', ['-jar', jar, '--installClient', root], { cwd: root, windowsHide: true });
  let errText = '';
  p.stderr.on('data', d => { errText += d; });
  p.stdout.on('data', () => send('status', 'Installiere Loader…'));
  p.on('error', () => reject(new Error('Java konnte nicht gestartet werden')));
  p.on('close', c => {
    if (c === 0) return resolve();
    const tail = errText.trim().split('\n').slice(-2).join(' ');
    reject(new Error('Loader-Installer fehlgeschlagen' + (tail ? ': ' + tail : '')));
  });
});

const loaderBase = l => (l === 'fabric' ? 'https://meta.fabricmc.net/v2/versions/loader' : 'https://meta.quiltmc.org/v3/versions/loader');

async function loaderVersion(inst) {
  if (inst.loaderVersion) return inst.loaderVersion;
  const { mc, loader } = inst;
  let v;
  if (loader === 'fabric' || loader === 'quilt') {
    const l = await getJson(`${loaderBase(loader)}/${mc}`);
    if (!l.length) throw new Error(`${LABEL[loader]} für ${mc} nicht verfügbar`);
    v = l[0].loader.version;
  } else if (loader === 'forge') {
    const p = await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    v = p.promos[mc + '-recommended'] || p.promos[mc + '-latest'];
    if (!v) throw new Error('Forge für ' + mc + ' nicht verfügbar');
  } else {
    const parts = mc.split('.');
    const prefix = `${parts[1]}.${parts[2] || 0}.`;
    const r = await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    const c = r.versions.filter(x => x.startsWith(prefix) && !x.includes('beta'));
    if (!c.length) throw new Error('NeoForge für ' + mc + ' nicht verfügbar');
    v = c[c.length - 1];
  }
  inst.loaderVersion = v;
  saveInst(loadInst().map(i => (i.id === inst.id ? { ...i, loaderVersion: v } : i)));
  return v;
}

async function ensureLoader(inst) {
  const { mc, loader } = inst;
  if (loader === 'vanilla') return null;
  const v = await loaderVersion(inst);
  if (loader === 'fabric' || loader === 'quilt') {
    const profile = await getJson(`${loaderBase(loader)}/${mc}/${v}/profile/json`);
    const dir = path.join(root, 'versions', profile.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, profile.id + '.json'), JSON.stringify(profile));
    return profile.id;
  }
  const id = loader === 'forge' ? `${mc}-forge-${v}` : `neoforge-${v}`;
  const url = loader === 'forge'
    ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${v}/forge-${mc}-${v}-installer.jar`
    : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;
  if (!fs.existsSync(path.join(root, 'versions', id, id + '.json'))) {
    const jar = path.join(root, 'installers', path.basename(url));
    send('status', 'Lade Loader-Installer');
    await download(url, jar);
    await runInstaller(jar, await resolveJava(inst));
    if (!fs.existsSync(path.join(root, 'versions', id, id + '.json'))) throw new Error('Loader-Version nicht gefunden: ' + id);
  }
  return id;
}

async function importMrpack(buf, iconUrl) {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new Error('Keine gültige .mrpack-Datei');
  const idx = JSON.parse(entry.getData().toString('utf8'));
  const d = idx.dependencies || {};
  if (!d.minecraft) throw new Error('Pack enthält keine Minecraft-Version');
  const map = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };
  const key = Object.keys(map).find(k => d[k]);
  const inst = createInstance({
    name: idx.name || 'Modpack',
    mc: d.minecraft,
    loader: key ? map[key] : 'vanilla',
    loaderVersion: key ? d[key] : undefined
  });
  try {
    const dir = path.resolve(instDir(inst.id));
    const files = (idx.files || []).filter(f => !f.env || f.env.client !== 'unsupported');
    let next = 0;
    let done = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < files.length) {
        const f = files[next++];
        const dest = path.resolve(dir, f.path);
        if (!dest.startsWith(dir + path.sep)) continue;
        await download(f.downloads[0], dest);
        send('status', `Pack-Dateien ${++done}/${files.length}`);
      }
    }));
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const en of zip.getEntries()) {
        if (en.isDirectory || !en.entryName.startsWith(prefix)) continue;
        const dest = path.resolve(dir, en.entryName.slice(prefix.length));
        if (!dest.startsWith(dir + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, en.getData());
      }
    }
    if (iconUrl) await coverFromUrl(inst.id, iconUrl);
  } catch (e) {
    removeInstance(inst.id);
    throw e;
  }
  return inst;
}

const cf = makeCurseforge({ getSettings: () => getSettings(), UA, download, createInstance, removeInstance, instDir, send, path, fs });
async function importAny(buf, icon) {
  const zip = new AdmZip(buf);
  if (zip.getEntry('modrinth.index.json')) return importMrpack(buf, icon);
  if (zip.getEntry('manifest.json')) return cf.importCurseforge(zip);
  throw new Error('Unbekanntes Modpack-Format (erwartet .mrpack oder CurseForge-ZIP)');
}

const DEF = { ram: 4, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', javaAuto: true, minimize: false, bg: 'saphir', c1: '#243e75', c2: '#0b1630', dim: 55, blur: 0, accent: '#2f5fe0', anim: true, fx: true, spin: false, sound: true, soundVol: 50, discord: false, discordId: '', discordPack: true, discordImage: 'logo', cfKey: '' };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settingsCache = null;
const getSettings = () => {
  if (!settingsCache) {
    try { settingsCache = { ...DEF, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settingsCache = { ...DEF }; }
  }
  return { ...settingsCache };
};
const authFile = () => path.join(app.getPath('userData'), 'auth.bin');
const writeToken = t => {
  try {
    const e = safeStorage.isEncryptionAvailable();
    const data = e ? safeStorage.encryptString(t) : Buffer.from(t);
    fs.writeFileSync(authFile(), Buffer.concat([Buffer.from([e ? 1 : 0]), data]), { mode: 0o600 });
  } catch {}
};
const readToken = () => {
  try {
    const b = fs.readFileSync(authFile());
    const d = b.subarray(1);
    return b[0] === 1 ? safeStorage.decryptString(d) : d.toString('utf8');
  } catch { return null; }
};
async function finishAuth(xbox) {
  const mc = await xbox.getMinecraft();
  auth = mc.mclc();
  authAt = Date.now();
  writeToken(xbox.save());
  return mc.profile.name;
}
const refreshAuth = async () => {
  const t = readToken();
  if (!t) return null;
  return finishAuth(await new Auth('select_account').refresh(t));
};

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    icon: logoFile() || undefined,
    backgroundColor: '#0b1630',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => win.webContents.focus());
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F12') win.webContents.toggleDevTools();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  applyBase(dataBase());
  instFile = path.join(app.getPath('userData'), 'instances.json');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(instRoot, { recursive: true });
  createWindow();
  presence();
});
app.on('before-quit', () => rpc.stop());
app.on('window-all-closed', () => app.quit());

const KIND = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const worldsOf = id => {
  const d = path.join(idir(id), 'saves');
  return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : [];
};
const relDir = (kind, world) => {
  if (kind !== 'datapack') return KIND[kind];
  if (!world || /[\\/]|\.\./.test(world)) throw new Error('Bitte zuerst eine Welt wählen');
  return path.join('saves', world, 'datapacks');
};

async function pickVersion(inst, projectId, kind, versionId) {
  if (versionId) return getJson(`${API}/version/${versionId}`);
  const q = [`game_versions=${enc([inst.mc])}`];
  if (kind === 'mod' && inst.loader !== 'vanilla') q.push(`loaders=${enc(loadersFor(inst))}`);
  const vs = await getJson(`${API}/project/${projectId}/version?${q.join('&')}`);
  if (!vs.length) throw new Error('Keine passende Version');
  return vs[0];
}

async function installVersion(instId, v, info, kind, rel, inst, seen) {
  seen.add(v.project_id);
  const file = v.files.find(f => f.primary) || v.files[0];
  await download(file.url, path.join(instDir(instId), rel, file.filename));
  const meta = readMeta(instId);
  meta[`${v.project_id}|${rel}`] = { ...info, id: v.project_id, file: file.filename, dir: rel, versionId: v.id };
  writeMeta(instId, meta);
  if (kind !== 'mod') return;
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id || seen.has(dep.project_id)) continue;
    if (readMeta(instId)[`${dep.project_id}|${rel}`]) continue;
    try {
      const dv = await pickVersion(inst, dep.project_id, kind, dep.version_id);
      const p = await getJson(`${API}/project/${dep.project_id}`);
      await installVersion(instId, dv, { title: p.title, description: p.description, icon: p.icon_url, author: '' }, kind, rel, inst, seen);
    } catch {}
  }
}

ipcMain.handle('win', (_, a) => {
  if (a === 'close') win.close();
  if (a === 'min') win.minimize();
  if (a === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
});
ipcMain.handle('sysInfo', () => ({ totalGB: os.totalmem() / 2 ** 30, version: app.getVersion() }));
ipcMain.handle('openUrl', (_, u) => (/^https:\/\//.test(u) ? shell.openExternal(u) : null));
ipcMain.handle('versions', async () => {
  const m = await getJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  return m.versions.filter(v => v.type === 'release').slice(0, 40).map(v => v.id);
});

ipcMain.handle('instances', () => loadInst().map(withCover));
let pendingCover = null;
ipcMain.handle('pickCover', async (_, reset) => {
  if (reset) {
    pendingCover = null;
    return null;
  }
  const r = await openDialog({ filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  pendingCover = r.filePaths[0];
  return path.basename(pendingCover);
});
ipcMain.handle('create', (_, o) => {
  if (!['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'].includes(o.loader)) throw new Error('Ungültiger Loader');
  const inst = createInstance({ name: String(o.name).slice(0, 40), mc: String(o.mc), loader: o.loader });
  if (o.cover && pendingCover) {
    try { fs.copyFileSync(pendingCover, path.join(instDir(inst.id), 'cover' + path.extname(pendingCover).toLowerCase())); } catch {}
  }
  pendingCover = null;
  return inst;
});
ipcMain.handle('focus', () => {
  refocus();
});
ipcMain.handle('deleteInstance', (_, id) => {
  idir(id);
  removeInstance(id);
  return true;
});
ipcMain.handle('setCover', async (_, id) => {
  idir(id);
  const r = await openDialog({ filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'] });
  if (r.canceled) return false;
  clearCover(id);
  fs.copyFileSync(r.filePaths[0], path.join(instDir(id), 'cover' + path.extname(r.filePaths[0]).toLowerCase()));
  return true;
});
ipcMain.handle('clearCover', (_, id) => {
  clearCover(id);
  return true;
});

ipcMain.handle('importFile', async () => {
  const r = await openDialog({ filters: [{ name: 'Modpack (Modrinth / CurseForge)', extensions: ['mrpack', 'zip'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  return importAny(fs.readFileSync(r.filePaths[0]));
});

ipcMain.handle('importPath', async (_, p) => {
  if (typeof p !== 'string' || !/\.(mrpack|zip)$/i.test(p) || !fs.existsSync(p)) throw new Error('Bitte eine .mrpack- oder CurseForge-ZIP-Datei verwenden');
  return importAny(fs.readFileSync(p));
});
ipcMain.handle('duplicate', async (_, id) => {
  const src = getInst(id);
  const base = idir(id);
  const copy = { ...src, id: slug(src.name) + '-' + Date.now().toString(36), name: (src.name + ' (Kopie)').slice(0, 40), playtime: 0, fav: false };
  delete copy.lastPlayed;
  await fs.promises.cp(base, instDir(copy.id), { recursive: true });
  saveInst([...loadInst(), copy]);
  return withCover(copy);
});

ipcMain.handle('installPack', async (_, { id, icon, versionId }) => {
  const v = versionId ? await getJson(`${API}/version/${versionId}`) : (await getJson(`${API}/project/${id}/version`))[0];
  if (!v) throw new Error('Keine Pack-Version gefunden');
  const file = v.files.find(f => f.primary) || v.files[0];
  send('status', 'Lade Modpack');
  return importMrpack(await getBuffer(file.url), icon);
});

ipcMain.handle('exportPack', async (_, id) => {
  const inst = getInst(id);
  const base = idir(id);
  const r = await saveDialog({ defaultPath: `${inst.name}.mrpack`, filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }] });
  if (r.canceled) return null;
  const zip = new AdmZip();
  const modsDir = path.join(base, 'mods');
  const jars = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')) : [];
  const byHash = {};
  for (const f of jars) byHash[hashFile(path.join(modsDir, f), 'sha1')] = f;
  const known = jars.length ? await postJson(`${API}/version_files`, { hashes: Object.keys(byHash), algorithm: 'sha1' }) : {};
  const files = [];
  for (const [h, f] of Object.entries(byHash)) {
    const full = path.join(modsDir, f);
    const v = known[h];
    const vf = v && v.files.find(x => x.hashes.sha1 === h);
    if (vf) {
      files.push({
        path: 'mods/' + f,
        hashes: { sha1: h, sha512: vf.hashes.sha512 || hashFile(full, 'sha512') },
        env: { client: 'required', server: 'required' },
        downloads: [vf.url],
        fileSize: vf.size
      });
    } else zip.addLocalFile(full, 'overrides/mods');
  }
  for (const dname of ['config', 'resourcepacks', 'shaderpacks']) {
    const p = path.join(base, dname);
    if (fs.existsSync(p)) zip.addLocalFolder(p, 'overrides/' + dname);
  }
  for (const fname of ['options.txt', 'servers.dat']) {
    const p = path.join(base, fname);
    if (fs.existsSync(p)) zip.addLocalFile(p, 'overrides');
  }
  const deps = { minecraft: inst.mc };
  if (inst.loader !== 'vanilla') {
    const key = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[inst.loader];
    deps[key] = await loaderVersion(inst);
  }
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: inst.name, files, dependencies: deps })));
  zip.writeZip(r.filePath);
  return r.filePath;
});

ipcMain.handle('worlds', (_, id) => worldsOf(id));

let cats = null;
ipcMain.handle('categories', async (_, type) => {
  if (!cats) cats = await getJson(`${API}/tag/category`);
  return [...new Set(cats.filter(c => c.project_type === type).map(c => c.name))];
});

ipcMain.handle('search', async (_, { query, type, instId, sort, category, offset }) => {
  const facets = [[`project_type:${type}`]];
  if (type !== 'modpack') {
    const inst = getInst(instId);
    if (!inst) return { items: [], total: 0 };
    facets.push([`versions:${inst.mc}`]);
    if (type === 'mod') {
      if (inst.loader === 'quilt') facets.push(['categories:quilt', 'categories:fabric']);
      else if (inst.loader !== 'vanilla') facets.push([`categories:${inst.loader}`]);
    }
  }
  if (category) facets.push([`categories:${category}`]);
  const url = `${API}/search?limit=30&offset=${+offset || 0}&index=${sort || 'downloads'}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const r = await getJson(url);
  return {
    total: r.total_hits,
    items: r.hits.map(h => ({ id: h.project_id, title: h.title, description: h.description, icon: h.icon_url, author: h.author, downloads: h.downloads }))
  };
});

ipcMain.handle('project', async (_, { id, type, instId }) => {
  const p = await getJson(`${API}/project/${id}`);
  const inst = instId ? getInst(instId) : null;
  const q = [];
  if (type !== 'modpack' && inst) {
    q.push(`game_versions=${enc([inst.mc])}`);
    if (type === 'mod' && inst.loader !== 'vanilla') q.push(`loaders=${enc(loadersFor(inst))}`);
  }
  const vs = await getJson(`${API}/project/${id}/version${q.length ? '?' + q.join('&') : ''}`);
  return {
    id: p.id,
    slug: p.slug,
    type: p.project_type,
    title: p.title,
    description: p.description,
    icon: p.icon_url,
    categories: p.categories,
    downloads: p.downloads,
    followers: p.followers,
    license: p.license && p.license.id,
    links: { Quellcode: p.source_url, Issues: p.issues_url, Wiki: p.wiki_url, Discord: p.discord_url },
    gallery: (p.gallery || []).slice(0, 6).map(g => g.url),
    versions: vs.slice(0, 25).map(v => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published, mc: v.game_versions.slice(-3), loaders: v.loaders }))
  };
});

ipcMain.handle('installed', (_, { instId, kind, world }) => {
  const meta = Object.values(readMeta(instId));
  const dirs = kind === 'datapack'
    ? (world ? [relDir(kind, world)] : worldsOf(instId).map(w => relDir(kind, w)))
    : [relDir(kind)];
  const items = [];
  for (const rel of dirs) {
    const abs = path.join(idir(instId), rel);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.startsWith('.') || (kind === 'mod' && !/\.jar(\.disabled)?$/.test(f))) continue;
      const m = meta.find(x => x.file === f && (x.dir || 'mods') === rel);
      let st = { mtimeMs: 0, size: 0 };
      try { st = fs.statSync(path.join(abs, f)); } catch {}
      items.push({
        id: f,
        file: f,
        dir: rel,
        disabled: f.endsWith('.disabled'),
        title: m ? m.title : f.replace(/\.disabled$/, ''),
        description: kind === 'datapack' ? 'Welt: ' + rel.split(path.sep)[1] : m ? m.description : 'Manuell oder aus Modpack hinzugefügt',
        icon: m && m.icon,
        author: m ? m.author : '',
        projectId: m && m.id,
        mtime: st.mtimeMs,
        size: st.size
      });
    }
  }
  return { ids: items.filter(i => i.projectId).map(i => i.projectId), items };
});

ipcMain.handle('install', async (_, { mod, instId, kind, world, versionId }) => {
  const inst = getInst(instId);
  if (!inst) throw new Error('Modpack nicht gefunden');
  const rel = relDir(kind, world);
  const v = await pickVersion(inst, mod.id, kind, versionId);
  const seen = new Set();
  await installVersion(instId, v, { title: mod.title, description: mod.description, icon: mod.icon, author: mod.author }, kind, rel, inst, seen);
  return seen.size - 1;
});

ipcMain.handle('remove', (_, { instId, file, dir, projectId, kind, world }) => {
  const meta = readMeta(instId);
  let f = file;
  let rel = dir;
  if (projectId) {
    rel = relDir(kind, world);
    const e = meta[`${projectId}|${rel}`] || meta[projectId];
    if (!e) return true;
    f = e.file;
  }
  fs.rmSync(safe(instId, rel, f), { recursive: true, force: true });
  for (const k of Object.keys(meta)) if (meta[k].file === f && (meta[k].dir || 'mods') === rel) delete meta[k];
  writeMeta(instId, meta);
  return true;
});

ipcMain.handle('toggle', (_, { instId, dir, file }) => {
  const from = safe(instId, dir, file);
  const nf = file.endsWith('.disabled') ? file.slice(0, -9) : file + '.disabled';
  fs.renameSync(from, safe(instId, dir, nf));
  const meta = readMeta(instId);
  for (const k of Object.keys(meta)) if (meta[k].file === file && (meta[k].dir || 'mods') === dir) meta[k].file = nf;
  writeMeta(instId, meta);
  return true;
});

ipcMain.handle('checkUpdates', async (_, instId) => {
  const inst = getInst(instId);
  const dir = path.join(idir(instId), 'mods');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jar')) : [];
  if (!files.length) return [];
  const hashes = {};
  for (const f of files) hashes[hashFile(path.join(dir, f), 'sha1')] = f;
  const res = await postJson(`${API}/version_files/update`, {
    hashes: Object.keys(hashes),
    algorithm: 'sha1',
    loaders: inst.loader === 'vanilla' ? ['fabric', 'forge', 'neoforge', 'quilt'] : loadersFor(inst),
    game_versions: [inst.mc]
  });
  const out = [];
  for (const [h, v] of Object.entries(res)) {
    if (v.files.some(f => f.hashes.sha1 === h)) continue;
    out.push({ file: hashes[h], projectId: v.project_id, versionId: v.id });
  }
  if (!out.length) return [];
  const ps = await getJson(`${API}/projects?ids=${enc(out.map(o => o.projectId))}`);
  return out.map(o => ({ ...o, title: (ps.find(p => p.id === o.projectId) || {}).title || o.file }));
});

ipcMain.handle('applyUpdates', async (_, { instId, updates }) => {
  const dir = path.join(idir(instId), 'mods');
  let n = 0;
  for (const u of updates) {
    const v = await getJson(`${API}/version/${u.versionId}`);
    const p = await getJson(`${API}/project/${u.projectId}`);
    const file = v.files.find(f => f.primary) || v.files[0];
    await download(file.url, path.join(dir, file.filename));
    if (file.filename !== u.file) fs.rmSync(safe(instId, 'mods', u.file), { force: true });
    const meta = readMeta(instId);
    for (const k of Object.keys(meta)) if (meta[k].file === u.file && (meta[k].dir || 'mods') === 'mods') delete meta[k];
    meta[`${u.projectId}|mods`] = { title: p.title, description: p.description, icon: p.icon_url, author: '', id: u.projectId, file: file.filename, dir: 'mods', versionId: v.id };
    writeMeta(instId, meta);
    send('status', `Aktualisiert ${++n}/${updates.length}`);
  }
  return n;
});

ipcMain.handle('updateInstance', (_, { id, patch }) => {
  idir(id);
  const clean = {};
  if (typeof patch.name === 'string' && patch.name.trim()) clean.name = patch.name.trim();
  if ('ram' in patch) clean.ram = patch.ram ? Math.min(64, Math.max(1, +patch.ram)) : undefined;
  if (typeof patch.jvmArgs === 'string') clean.jvmArgs = patch.jvmArgs.trim();
  if (typeof patch.javaPath === 'string') clean.javaPath = patch.javaPath.trim().replace(/^"|"$/g, '');
  if ('fav' in patch) clean.fav = !!patch.fav;
  saveInst(loadInst().map(i => (i.id === id ? { ...i, ...clean } : i)));
  return true;
});
ipcMain.handle('openInstFolder', (_, id) => shell.openPath(idir(id)));
ipcMain.handle('getSettings', () => getSettings());
ipcMain.handle('setSettings', (_, s) => {
  const n = { ...getSettings(), ...s };
  fs.writeFileSync(settingsFile(), JSON.stringify(n));
  settingsCache = n;
  presence();
  return { ...n };
});
ipcMain.handle('openFolder', () => shell.openPath(instRoot));
ipcMain.handle('getFolder', () => path.dirname(root));
ipcMain.handle('moveFolder', async () => {
  if (running.size) throw new Error('Bitte zuerst Minecraft beenden');
  const r = await openDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  const oldBase = path.resolve(path.dirname(root));
  const target = path.resolve(r.filePaths[0], 'SaphirMod');
  if (target === oldBase) return null;
  if (target.startsWith(oldBase + path.sep) || oldBase.startsWith(target + path.sep)) throw new Error('Zielordner darf nicht im alten Ordner liegen');
  const names = ['minecraft', 'instances'];
  for (const n of names) {
    const dst = path.join(target, n);
    if (fs.existsSync(dst) && fs.readdirSync(dst).length) throw new Error('Zielordner enthält bereits Daten');
  }
  fs.mkdirSync(target, { recursive: true });
  send('status', 'Verschiebe Dateien…');
  for (const n of names) {
    const src = path.join(oldBase, n);
    const dst = path.join(target, n);
    if (!fs.existsSync(src)) continue;
    try {
      await fs.promises.rename(src, dst);
    } catch {
      await fs.promises.cp(src, dst, { recursive: true });
      await fs.promises.rm(src, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(locFile(), JSON.stringify({ dir: target }));
  applyBase(target);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(instRoot, { recursive: true });
  return target;
});
ipcMain.handle('running', () => [...running]);
ipcMain.handle('kill', (_, instId) => {
  if (!running.has(instId)) return false;
  const c = procs.get(instId);
  if (!c) {
    killReq.add(instId); // Start läuft noch (Download/Java) – wird beendet, sobald der Prozess existiert
    send('status', 'Start wird abgebrochen…');
    return 'pending';
  }
  killed.add(instId);
  killProc(c);
  return true;
});
ipcMain.handle('killAll', () => {
  let n = 0;
  for (const id of running) {
    const c = procs.get(id);
    if (c) {
      killed.add(id);
      killProc(c);
    } else killReq.add(id);
    n++;
  }
  return n;
});

ipcMain.handle('login', async () => {
  try {
    return await finishAuth(await new Auth('select_account').launch('electron'));
  } finally {
    refocus();
  }
});
ipcMain.handle('session', async () => {
  try { return await refreshAuth(); } catch { return null; }
});
ipcMain.handle('logout', () => {
  auth = null;
  try { fs.unlinkSync(authFile()); } catch {}
  return true;
});

ipcMain.handle('launch', async (_, { instId }) => {
  if (running.has(instId)) throw new Error('Modpack läuft bereits');
  if (!auth || Date.now() - authAt > 36e5) {
    try { await refreshAuth(); } catch {}
  }
  if (!auth) throw new Error('Bitte zuerst anmelden');
  const inst = getInst(instId);
  if (!inst) throw new Error('Modpack nicht gefunden');
  running.add(instId);
  send('running', [...running]);
  playing.set(instId, { name: inst.name, mc: inst.mc, loader: inst.loader, since: Date.now() });
  presence();
  const stop = msg => {
    running.delete(instId);
    procs.delete(instId);
    killReq.delete(instId);
    killed.delete(instId);
    playing.delete(instId);
    presence();
    send('running', [...running]);
    if (msg) send('status', msg);
  };
  try {
    saveInst(loadInst().map(i => (i.id === instId ? { ...i, lastPlayed: Date.now() } : i)));
    send('status', 'Bereite Loader vor');
    send('status', 'Prüfe Java…');
    const custom = await ensureLoader(inst);
    liveLogs[instId] = [];
    const javaBin = await resolveJava(inst);
    const javaVer = await javaMajor(javaBin);
    const need = await requiredJava(inst.mc);
    pushLog(instId, `[Launcher] Java: ${javaBin} (Java ${javaVer || '?'}, benötigt: Java ${need} für Minecraft ${inst.mc})`);
    const version = { number: inst.mc, type: 'release' };
    if (custom) version.custom = custom;
    const s = getSettings();
    const ram = +inst.ram || +s.ram;
    const mb = Math.round(ram * 1024);
    const opts = {
      authorization: auth,
      root,
      version,
      memory: { max: mb + 'M', min: Math.min(2048, mb) + 'M' },
      overrides: { gameDirectory: instDir(instId) },
      window: { width: +s.width || 854, height: +s.height || 480, fullscreen: !!s.fullscreen }
    };
    opts.javaPath = javaBin;
    const jvmArgs = (inst.jvmArgs || s.jvmArgs || '').trim().split(/\s+/).filter(Boolean);
    if (custom && (inst.loader === 'forge' || inst.loader === 'neoforge')) {
      const la = loaderJvmArgs(custom);
      jvmArgs.unshift(...la);
      pushLog(instId, `[Launcher] Loader-JVM-Argumente: ${la.length}`);
    }
    const jm = javaVer;
    if (jm && jm !== need) {
      pushLog(instId, `[Launcher] Warnung: Java ${jm} statt Java ${need}`);
      send('status', `Warnung: Java ${jm} statt Java ${need}`);
      if (need >= 17 && jm > need) for (const p of OPENS) jvmArgs.unshift(`--add-opens=java.base/${p}=ALL-UNNAMED`);
    }
    if (jvmArgs.length) opts.customArgs = jvmArgs;
    const launcher = new Client();
    let started = false;
    const t0 = Date.now();
    launcher.on('debug', d => pushLog(instId, '[Launcher] ' + d));
    launcher.on('progress', p => send('status', `Lade ${p.type} ${p.task}/${p.total}`));
    launcher.on('package-extract', () => send('status', 'Entpacke Dateien'));
    launcher.on('data', d => {
      pushLog(instId, d);
      if (!started) {
        started = true;
        send('status', 'Minecraft läuft');
        if (s.minimize && win && !win.isDestroyed()) win.minimize();
      }
    });
    launcher.on('close', code => {
      if (started) addPlaytime(instId, Date.now() - t0);
      if (s.minimize && win && !win.isDestroyed()) {
        win.restore();
        win.show();
        refocus();
      }
      const wasKilled = killed.has(instId);
      if (code && started && !wasKilled) send('crashed', { id: instId, code });
      stop(wasKilled ? 'Minecraft beendet' : code ? `Minecraft beendet (Code ${code})` : 'Minecraft beendet');
    });
    send('status', 'Starte…');
    launcher.launch(opts).then(c => {
      if (!c) return stop('Start fehlgeschlagen, bitte Java prüfen');
      procs.set(instId, c);
      if (killReq.delete(instId)) {
        killed.add(instId);
        killProc(c);
      }
    }).catch(e => stop('Fehler: ' + e.message));
  } catch (e) {
    pushLog(instId, '[Launcher] Fehler: ' + e.message);
    stop();
    throw e;
  }
  return true;
});

const skinsDir = () => path.join(app.getPath('userData'), 'skins');
const skinsFile = () => path.join(skinsDir(), 'skins.json');
const loadSkins = () => {
  try { return JSON.parse(fs.readFileSync(skinsFile(), 'utf8')); } catch { return []; }
};
const saveSkins = l => {
  fs.mkdirSync(skinsDir(), { recursive: true });
  fs.writeFileSync(skinsFile(), JSON.stringify(l));
};
const toDataUrl = buf => 'data:image/png;base64,' + buf.toString('base64');
const pngOk = b => b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(16) === 64 && [32, 64].includes(b.readUInt32BE(20));
const withSkinData = s => ({ ...s, dataUrl: toDataUrl(fs.readFileSync(path.join(skinsDir(), s.file))) });
const needAuth = async () => {
  if (!auth || Date.now() - authAt > 36e5) {
    try { await refreshAuth(); } catch {}
  }
  if (!auth) throw new Error('Bitte zuerst anmelden');
  return { Authorization: 'Bearer ' + auth.access_token };
};
const mcProfile = async () => {
  const h = await needAuth();
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { ...UA, ...h } });
  if (!r.ok) throw new Error('Profil konnte nicht geladen werden (HTTP ' + r.status + ')');
  return r.json();
};
const activeSkin = async p => {
  const s = (p.skins || []).find(x => x.state === 'ACTIVE') || (p.skins || [])[0];
  if (!s) return null;
  return { variant: String(s.variant || '').toUpperCase() === 'SLIM' ? 'slim' : 'classic', buf: await getBuffer(s.url) };
};
const addSkin = (name, variant, buf) => {
  if (!pngOk(buf)) throw new Error('Ungültige Skin-Datei (PNG mit 64x64 oder 64x32)');
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  fs.mkdirSync(skinsDir(), { recursive: true });
  fs.writeFileSync(path.join(skinsDir(), id + '.png'), buf);
  const e = { id, name: String(name).slice(0, 32), variant, file: id + '.png' };
  saveSkins([...loadSkins(), e]);
  return withSkinData(e);
};

ipcMain.handle('skinProfile', async () => {
  const p = await mcProfile();
  const sk = await activeSkin(p);
  return {
    name: p.name,
    id: p.id,
    skin: sk ? { dataUrl: toDataUrl(sk.buf), variant: sk.variant } : null,
    capes: (p.capes || []).map(c => ({ id: c.id, alias: c.alias, active: c.state === 'ACTIVE' }))
  };
});
ipcMain.handle('skinLibrary', () => loadSkins().filter(s => fs.existsSync(path.join(skinsDir(), s.file))).map(withSkinData));
ipcMain.handle('skinAdd', async () => {
  const r = await openDialog({ filters: [{ name: 'Skin (PNG)', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const f = r.filePaths[0];
  return addSkin(path.basename(f, path.extname(f)), 'classic', fs.readFileSync(f));
});
ipcMain.handle('skinImport', async (_, name) => {
  const n = String(name || '').trim();
  if (!/^\w{1,16}$/.test(n)) throw new Error('Ungültiger Spielername');
  let u;
  try { u = await getJson(`https://api.mojang.com/users/profiles/name/${n}`); } catch { throw new Error('Spieler nicht gefunden'); }
  const prof = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${u.id}`);
  const prop = (prof.properties || []).find(x => x.name === 'textures');
  const tex = prop && JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures.SKIN;
  if (!tex) throw new Error('Spieler hat keinen Skin');
  return addSkin(prof.name, tex.metadata && tex.metadata.model === 'slim' ? 'slim' : 'classic', await getBuffer(tex.url));
});
ipcMain.handle('skinSaveCurrent', async () => {
  const p = await mcProfile();
  const sk = await activeSkin(p);
  if (!sk) throw new Error('Kein aktiver Skin vorhanden');
  return addSkin(p.name, sk.variant, sk.buf);
});
ipcMain.handle('skinApply', async (_, id) => {
  const e = loadSkins().find(s => s.id === id);
  if (!e) throw new Error('Skin nicht gefunden');
  const h = await needAuth();
  const fd = new FormData();
  fd.append('variant', e.variant);
  fd.append('file', new Blob([fs.readFileSync(path.join(skinsDir(), e.file))], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { ...UA, ...h }, body: fd });
  if (!r.ok) throw new Error('Skin konnte nicht gesetzt werden (HTTP ' + r.status + ')');
  return true;
});
ipcMain.handle('skinDelete', (_, id) => {
  const l = loadSkins();
  const e = l.find(s => s.id === id);
  if (e) {
    try { fs.unlinkSync(path.join(skinsDir(), e.file)); } catch {}
    saveSkins(l.filter(s => s.id !== id));
  }
  return true;
});
ipcMain.handle('skinUpdate', (_, { id, variant }) => {
  if (variant === 'slim' || variant === 'classic') saveSkins(loadSkins().map(s => (s.id === id ? { ...s, variant } : s)));
  return true;
});
ipcMain.handle('capeSet', async (_, capeId) => {
  const h = await needAuth();
  const url = 'https://api.minecraftservices.com/minecraft/profile/capes/active';
  const r = capeId
    ? await fetch(url, { method: 'PUT', headers: { ...UA, ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) })
    : await fetch(url, { method: 'DELETE', headers: { ...UA, ...h } });
  if (!r.ok) throw new Error('Cape konnte nicht gesetzt werden (HTTP ' + r.status + ')');
  return true;
});

const BG = /^background\.(png|jpe?g|webp|gif)$/i;
const clearBg = () => {
  const d = app.getPath('userData');
  for (const f of fs.readdirSync(d)) if (BG.test(f)) fs.unlinkSync(path.join(d, f));
};
const bgUrl = () => {
  const d = app.getPath('userData');
  const f = fs.readdirSync(d).find(x => BG.test(x));
  if (!f) return null;
  const p = path.join(d, f);
  return pathToFileURL(p).href + '?v=' + Math.round(fs.statSync(p).mtimeMs);
};
ipcMain.handle('getBackground', () => bgUrl());
ipcMain.handle('pickBackground', async () => {
  const r = await openDialog({ filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  clearBg();
  fs.copyFileSync(r.filePaths[0], path.join(app.getPath('userData'), 'background' + path.extname(r.filePaths[0]).toLowerCase()));
  return bgUrl();
});
ipcMain.handle('clearBackground', () => {
  clearBg();
  return true;
});

/* ───────── Freundesliste (lokal) ───────── */
const friendsFile = () => path.join(app.getPath('userData'), 'friends.json');
const friendsAvDir = () => path.join(app.getPath('userData'), 'friends');
const loadFriends = () => { try { return JSON.parse(fs.readFileSync(friendsFile(), 'utf8')); } catch { return []; } };
const saveFriends = l => fs.writeFileSync(friendsFile(), JSON.stringify(l));
const avPath = id => path.join(friendsAvDir(), id + '.png');
async function fetchAvatar(f) {
  for (const url of [`https://crafatar.com/avatars/${f.id}?size=64&overlay`, `https://minotar.net/helm/${f.name}/64.png`]) {
    try {
      const b = await getBuffer(url);
      fs.mkdirSync(friendsAvDir(), { recursive: true });
      fs.writeFileSync(avPath(f.id), b);
      return;
    } catch {}
  }
}
const withAvatar = f => ({ ...f, avatar: fs.existsSync(avPath(f.id)) ? 'data:image/png;base64,' + fs.readFileSync(avPath(f.id)).toString('base64') : null });
ipcMain.handle('friendsList', async () => {
  const l = loadFriends();
  await Promise.all(l.filter(f => !fs.existsSync(avPath(f.id))).map(fetchAvatar));
  return l.map(withAvatar);
});
ipcMain.handle('friendAdd', async (_, name) => {
  name = String(name || '').trim();
  if (!/^\w{3,16}$/.test(name)) throw new Error('Ungültiger Minecraft-Name');
  const r = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name), { headers: UA });
  if (r.status === 404 || r.status === 204) throw new Error('Spieler "' + name + '" existiert nicht');
  if (!r.ok) throw new Error('Mojang nicht erreichbar (HTTP ' + r.status + ')');
  const p = await r.json();
  const l = loadFriends();
  if (l.some(f => f.id === p.id)) throw new Error(p.name + ' ist bereits in deiner Liste');
  const f = { id: p.id, name: p.name, fav: false, blocked: false };
  saveFriends([...l, f]);
  await fetchAvatar(f);
  return withAvatar(f);
});
ipcMain.handle('friendUpdate', (_, { id, patch }) => {
  const clean = {};
  if ('fav' in patch) clean.fav = !!patch.fav;
  if ('blocked' in patch) clean.blocked = !!patch.blocked;
  saveFriends(loadFriends().map(f => (f.id === id ? { ...f, ...clean } : f)));
  return true;
});
ipcMain.handle('friendRemove', (_, id) => {
  saveFriends(loadFriends().filter(f => f.id !== id));
  try { fs.unlinkSync(avPath(id)); } catch {}
  return true;
});

/* ───────── Spielersuche ───────── */
const dashUuid = h => h.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const offlineUuid = name => {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return dashUuid(h.toString('hex'));
};
const fetchT = (url, ms = 8000) => fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
const imgData = async url => { try { return toDataUrl(await getBuffer(url)); } catch { return null; } };
const texImg = async hash => {
  if (!/^[0-9a-f]{16,128}$/i.test(String(hash || ''))) return null;
  try {
    const b = Buffer.from(await (await fetchT('https://textures.minecraft.net/texture/' + hash)).arrayBuffer());
    return b.length > 8 && b.readUInt32BE(0) === 0x89504e47 ? toDataUrl(b) : null;
  } catch { return null; }
};
const asTime = v => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

ipcMain.handle('playerLookup', async (_, query) => {
  const q = String(query || '').trim();
  let id, name;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(q)) {
    id = q.replace(/-/g, '').toLowerCase();
  } else if (/^\w{1,16}$/.test(q)) {
    let r;
    try { r = await fetchT('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(q)); } catch { throw new Error('Mojang nicht erreichbar'); }
    if (r.status === 404 || r.status === 204) throw new Error('Spieler "' + q + '" existiert nicht');
    if (!r.ok) throw new Error('Mojang nicht erreichbar (HTTP ' + r.status + ')');
    const p = await r.json();
    id = p.id;
    name = p.name;
  } else {
    throw new Error('Bitte einen gültigen Minecraft-Namen oder eine UUID eingeben');
  }

  /* Mojang: aktueller Skin + Cape */
  let prof = null;
  try {
    const r = await fetchT('https://sessionserver.mojang.com/session/minecraft/profile/' + id);
    if (r.ok) prof = await r.json();
  } catch {}
  if (!name && !prof) throw new Error('Spieler nicht gefunden');
  name = (prof && prof.name) || name;

  let tex = {};
  try {
    const prop = prof && (prof.properties || []).find(x => x.name === 'textures');
    if (prop) tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures || {};
  } catch {}
  const hashOf = u => (u ? String(u).split('/').pop() : null);
  const [skinUrl, capeUrl] = [tex.SKIN && tex.SKIN.url, tex.CAPE && tex.CAPE.url];
  const skin = skinUrl ? await imgData(skinUrl) : null;
  const cape = capeUrl ? await imgData(capeUrl) : null;

  /* laby.net: Namensverlauf + Skin-/Cape-Verlauf (optional, kann ausfallen) */
  let laby = null;
  try {
    const r = await fetchT('https://laby.net/api/v3/user/' + id + '/profile', 8000);
    if (r.ok) laby = await r.json();
  } catch {}

  const names = laby && Array.isArray(laby.name_history)
    ? laby.name_history.map(n => ({ name: n.name || n.username, changedAt: asTime(n.changed_at), accurate: n.accurate !== false })).filter(n => n.name)
    : [];
  const hist = key => {
    const l = laby && laby.textures && Array.isArray(laby.textures[key]) ? laby.textures[key] : [];
    return l
      .map(t => ({ hash: t.image_hash || t.hash, first: asTime(t.first_seen_at), last: asTime(t.last_seen_at) }))
      .filter(t => t.hash)
      .sort((a, b) => (b.first || 0) - (a.first || 0))
      .slice(0, 12);
  };
  const curSkinHash = hashOf(skinUrl);
  const curCapeHash = hashOf(capeUrl);
  const skins = (await Promise.all(hist('SKIN').filter(t => t.hash !== curSkinHash).map(async t => ({ ...t, dataUrl: await texImg(t.hash) })))).filter(t => t.dataUrl);
  const capes = (await Promise.all(hist('CAPE').filter(t => t.hash !== curCapeHash).map(async t => ({ ...t, dataUrl: await texImg(t.hash) })))).filter(t => t.dataUrl);

  return {
    id,
    dashed: dashUuid(id),
    name,
    offline: offlineUuid(name),
    skin: skin ? { dataUrl: skin, variant: tex.SKIN.metadata && tex.SKIN.metadata.model === 'slim' ? 'slim' : 'classic', hash: curSkinHash } : null,
    cape: cape ? { dataUrl: cape, hash: curCapeHash } : null,
    names,
    skins,
    capes,
    labyOk: !!laby,
    limited: !prof
  };
});

/* ───────── App-Logo ───────── */
const LOGO = /^applogo\.(png|jpe?g|webp|ico|gif)$/i;
function logoFile() {
  try {
    const d = app.getPath('userData');
    const f = fs.readdirSync(d).find(x => LOGO.test(x));
    return f ? path.join(d, f) : null;
  } catch { return null; }
}
const logoUrl = () => {
  const p = logoFile();
  return p ? pathToFileURL(p).href + '?v=' + Math.round(fs.statSync(p).mtimeMs) : null;
};
const clearLogoFiles = () => {
  const d = app.getPath('userData');
  for (const f of fs.readdirSync(d)) if (LOGO.test(f)) fs.unlinkSync(path.join(d, f));
};
ipcMain.handle('getLogo', () => logoUrl());
ipcMain.handle('pickLogo', async () => {
  const r = await openDialog({ filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'gif'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const src = r.filePaths[0];
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) throw new Error('Diese Bilddatei konnte nicht gelesen werden');
  clearLogoFiles();
  fs.copyFileSync(src, path.join(app.getPath('userData'), 'applogo' + path.extname(src).toLowerCase()));
  if (win && !win.isDestroyed()) win.setIcon(img);
  return logoUrl();
});
ipcMain.handle('clearLogo', () => {
  clearLogoFiles();
  return true;
});

/* ───────── Discord Rich Presence ───────── */
const rpc = new Rpc();
const launcherStart = Date.now();
const playing = new Map();
function presence() {
  const s = getSettings();
  if (!s.discord) return rpc.stop();
  rpc.start(s.discordId);
  const assets = s.discordImage ? { large_image: s.discordImage, large_text: 'SaphirMod' } : undefined;
  const p = [...playing.values()][0];
  rpc.setActivity(p
    ? { details: s.discordPack ? 'Spielt ' + p.name : 'Spielt Minecraft', state: `${LABEL[p.loader] || 'Vanilla'} ${p.mc}`, timestamps: { start: p.since }, assets }
    : { details: 'Im Launcher', state: loadInst().length + ' Modpacks', timestamps: { start: launcherStart }, assets });
}
ipcMain.handle('discordStatus', () => rpc.status());
ipcMain.handle('discordApply', async () => {
  rpc.stop();
  presence();
  await new Promise(r => setTimeout(r, 1500));
  return rpc.status();
});

ipcMain.handle('logFiles', (_, id) => {
  const base = idir(id);
  const out = [];
  for (const [dir, re] of [['logs', /\.(log|txt|gz)$/], ['crash-reports', /\.txt$/]]) {
    const d = path.join(base, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!re.test(f)) continue;
      out.push({ id: dir + '/' + f, label: (dir === 'crash-reports' ? 'Crash: ' : '') + f, t: fs.statSync(path.join(d, f)).mtimeMs, latest: f === 'latest.log' });
    }
  }
  out.sort((a, b) => (b.latest - a.latest) || (b.t - a.t));
  return [{ id: 'live', label: 'Launcher-Ausgabe (live)' }, ...out.map(({ id: i, label }) => ({ id: i, label }))];
});
ipcMain.handle('readLog', (_, { instId, file }) => {
  if (file === 'live') return (liveLogs[instId] || []).join('\n');
  const [dir, ...rest] = String(file).split('/');
  const name = rest.join('/');
  if (!['logs', 'crash-reports'].includes(dir) || !name) throw new Error('Ungültige Log-Datei');
  let buf = fs.readFileSync(safe(instId, dir, name));
  if (name.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  const max = 400 * 1024;
  if (buf.length > max) buf = buf.subarray(buf.length - max);
  return buf.toString('utf8');
});
ipcMain.handle('openLogs', (_, id) => {
  const d = path.join(idir(id), 'logs');
  fs.mkdirSync(d, { recursive: true });
  return shell.openPath(d);
});
ipcMain.handle('copyText', (_, t) => {
  clipboard.writeText(String(t).slice(0, 2e6));
  return true;
});
