(function() {
  const TAU = window.__TAURI__ || {};
  const core = TAU.core || {};
  const invoke = core.invoke || (async (cmd) => { throw new Error("Tauri not available: " + cmd); });
  const convertFileSrc = core.convertFileSrc || (p => p);

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    const c = $("#toasts"); if (c) c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function setStatus(msg) { const s = $("#status"); if (s) s.textContent = msg; }

  // Nav
  const views = [
    { id: "library", label: "Bibliothek", icon: "📚" },
    { id: "discover", label: "Entdecken", icon: "🔍" },
    { id: "skins", label: "Skins", icon: "🎨" },
    { id: "deckboard", label: "Deckboard", icon: "🎮" },
    { id: "settings", label: "Einstellungen", icon: "⚙️" },
  ];
  let currentView = "library";
  const navlist = $("#navlist");
  if (navlist) {
    for (const v of views) {
      const btn = document.createElement("button");
      btn.className = "nav" + (v.id === "library" ? " on" : "");
      btn.title = v.label;
      btn.textContent = v.icon;
      btn.addEventListener("click", () => switchView(v.id));
      navlist.appendChild(btn);
    }
  }

  function switchView(name) {
    currentView = name;
    $$("#navlist .nav").forEach((b, i) => b.classList.toggle("on", views[i].id === name));
    renderView(name);
  }

  async function renderView(name) {
    const view = $("#view"); if (!view) return;
    if (name === "library") await renderLibrary(view);
    else if (name === "discover") renderDiscover(view);
    else if (name === "skins") renderSkins(view);
    else if (name === "deckboard") renderDeckboard(view);
    else if (name === "settings") await renderSettings(view);
  }

  async function renderLibrary(view) {
    view.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h1 style="font-size:20px;font-weight:600;">Instanzen</h1>
      <div style="display:flex;gap:6px;">
        <button class="chip btn sm" id="btn-scan">CurseForge scannen</button>
        <button class="chip btn sm" id="btn-create">Instanz erstellen</button>
        <button class="chip play sm" id="btn-import">Modpack hinzufügen</button>
      </div>
    </div><div id="instance-grid" class="grid"></div>`;
    document.getElementById("btn-scan").addEventListener("click", async () => {
      try { const n = await invoke("scan_curseforge"); toast(n + " Instanzen importiert"); renderLibrary(view); }
      catch (e) { toast("Fehler: " + e); }
    });
    document.getElementById("btn-create").addEventListener("click", async () => {
      const name = prompt("Instanz-Name:");
      if (!name) return;
      const mc = prompt("Minecraft-Version (z.B. 1.21.4):", "1.21.4");
      if (!mc) return;
      try { const id = await invoke("create_instance", { name, mcVersion: mc }); toast("Erstellt: " + id); renderLibrary(view); }
      catch (e) { toast("Fehler: " + e); }
    });
    document.getElementById("btn-import").addEventListener("click", () => { const m = $("#modal-import"); if (m) m.classList.remove("hide"); m.classList.add("show"); });
    await loadInstancesInto(view);
  }

  async function loadInstancesInto(view) {
    try {
      const insts = await invoke("list_instances");
      const grid = document.getElementById("instance-grid");
      if (!grid) return;
      grid.innerHTML = "";
      for (const i of insts) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <h2>${esc(i.name)}</h2>
          <div class="meta">
            <span class="tag">${esc(i.mc_version)}</span>
            <span class="tag">${esc(i.loader)}</span>
            ${i.modpack ? `<span class="tag">${esc(i.modpack)}</span>` : ""}
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;">
            <button class="chip play sm" data-action="launch" data-name="${esc(i.name)}">${i.running ? "Läuft…" : "Starten"}</button>
            <button class="chip btn sm" data-action="stop" data-name="${esc(i.name)}">Stop</button>
            <button class="chip btn sm" data-action="edit" data-name="${esc(i.name)}">Bearbeiten</button>
            <button class="chip btn sm" data-action="rename" data-name="${esc(i.name)}" style="font-size:10px;">✎</button>
            <button class="chip btn sm" data-action="delete" data-name="${esc(i.name)}" style="color:var(--danger);font-size:10px;">✕</button>
          </div>`;
        grid.appendChild(card);
      }
      grid.querySelectorAll("button").forEach(b => {
        b.addEventListener("click", async () => {
          const name = b.dataset.name;
          if (b.dataset.action === "launch") {
            try { await invoke("launch_instance", { name }); toast("Gestartet: " + name); loadInstancesInto(view); }
            catch (e) { toast("Fehler: " + e); }
          } else if (b.dataset.action === "stop") {
            try { await invoke("stop_instance", { name }); toast("Gestoppt: " + name); loadInstancesInto(view); }
            catch (e) { toast("Fehler: " + e); }
          } else if (b.dataset.action === "edit") {
            openModsModal(name);
          } else if (b.dataset.action === "rename") {
            const newName = prompt("Neuer Name:", name);
            if (!newName || newName === name) return;
            try { await invoke("rename_instance", { instance: name, newName }); toast("Umbenannt"); loadInstancesInto(view); }
            catch (e) { toast("Fehler: " + e); }
          } else if (b.dataset.action === "delete") {
            if (!confirm("Instanz wirklich löschen? (Dateien bleiben erhalten)")) return;
            try { await invoke("delete_instance", { instance: name }); toast("Gelöscht"); loadInstancesInto(view); }
            catch (e) { toast("Fehler: " + e); }
          }
        });
      });
    } catch (e) { console.error("loadInstances:", e); toast("Fehler: " + e); }
  }

  function renderDiscover(view) {
    view.innerHTML = `<h1 style="font-size:20px;font-weight:600;margin-bottom:16px;">Modpacks entdecken</h1>
      <div style="display:flex;gap:6px;margin-bottom:16px;">
        <input id="search-q" class="search" placeholder="Suche nach Modpacks…" style="flex:1;" />
        <button id="btn-search" class="chip play sm">Suchen</button>
      </div>
      <div id="discover-results" class="grid"></div>`;
  }

  function renderSkins(view) {
    view.innerHTML = `<h1 style="font-size:20px;font-weight:600;margin-bottom:16px;">Skins</h1>
      <div class="card" style="max-width:400px;">
        <label style="font-size:12px;color:var(--mut);">Minecraft-Benutzername<input id="skin-name" class="search" placeholder="z.B. Notch" style="margin-top:4px;" /></label>
        <button id="btn-skin-fetch" class="chip play sm" style="margin-top:8px;">Skin laden</button>
        <div id="skin-preview" style="margin-top:12px;"></div>
        <div id="skin-status" class="status" style="margin-top:6px;"></div>
      </div>`;
    document.getElementById("btn-skin-fetch").addEventListener("click", async () => {
      const name = document.getElementById("skin-name").value.trim();
      if (!name) return;
      const st = document.getElementById("skin-status"); if (st) st.textContent = "Lade…";
      try {
        const path = await invoke("fetch_skin", { username: name });
        if (st) st.textContent = "Gespeichert: " + path;
        const src = convertFileSrc(path);
        const preview = document.getElementById("skin-preview");
        if (preview) preview.innerHTML = `<img src="${src}" width="128" height="128" style="border-radius:12px;border:1px solid var(--line);" />`;
        toast("Skin OK");
      } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
    });
  }

  function renderDeckboard(view) {
    view.innerHTML = `<h1 style="font-size:20px;font-weight:600;margin-bottom:16px;">Deckboard</h1>
      <div class="card">
        <h2 style="font-size:14px;font-weight:600;margin-bottom:6px;">HTTP-API</h2>
        <p style="color:var(--mut);font-size:13px;margin-bottom:8px;">Der Launcher hört auf <code>http://localhost:17321</code>.</p>
        <pre class="code">GET  /api/v1/instances
POST /api/v1/instances/{name}/launch
POST /api/v1/instances/{name}/stop
POST /api/v1/modpack/install  {"target":"url-oder-code"}</pre>
      </div>`;
  }

  async function renderSettings(view) {
    view.innerHTML = `<h1 style="font-size:20px;font-weight:600;margin-bottom:16px;">Einstellungen</h1>
      <div class="card" style="max-width:500px;">
        <label style="font-size:12px;color:var(--mut);display:block;margin-bottom:10px;">Benutzername<input id="s-username" class="search" style="margin-top:4px;" /></label>
        <label style="font-size:12px;color:var(--mut);display:block;margin-bottom:10px;">RAM (MB)<input id="s-memory" class="search" type="number" style="margin-top:4px;" /></label>
        <label style="font-size:12px;color:var(--mut);display:block;margin-bottom:10px;">CurseForge API-Key<input id="s-apikey" class="search" type="password" placeholder="optional" style="margin-top:4px;" /></label>
        <label style="font-size:12px;color:var(--mut);display:block;margin-bottom:10px;">Discord Client-ID<input id="s-discord" class="search" placeholder="optional" style="margin-top:4px;" /></label>
        <label style="font-size:12px;color:var(--mut);display:block;margin-bottom:10px;">Discord Webhook<input id="s-webhook" class="search" placeholder="optional" style="margin-top:4px;" /></label>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="btn-save-settings" class="chip play sm">Speichern</button>
          <button id="btn-login" class="chip btn sm">Minecraft Login</button>
        </div>
        <div id="login-status" class="status" style="margin-top:6px;"></div>
      </div>`;
    try {
      const c = await invoke("get_config");
      document.getElementById("s-username").value = c.auth?.username || "";
      document.getElementById("s-memory").value = c.default_memory_mb || "";
      document.getElementById("s-apikey").value = c.curseforge_api_key || "";
      document.getElementById("s-discord").value = c.discord?.client_id || "";
      document.getElementById("s-webhook").value = c.discord?.webhook_url || "";
    } catch (e) { console.error("loadSettings:", e); }
    document.getElementById("btn-save-settings").addEventListener("click", async () => {
      try {
        await invoke("set_config", { update: {
          username: document.getElementById("s-username").value || null,
          memory_mb: document.getElementById("s-memory").value ? parseInt(document.getElementById("s-memory").value) : null,
          api_key: document.getElementById("s-apikey").value || null,
          discord_client_id: document.getElementById("s-discord").value || null,
          webhook_url: document.getElementById("s-webhook").value || null,
        }});
        toast("Gespeichert");
      } catch (e) { toast("Fehler: " + e); }
    });
    document.getElementById("btn-login").addEventListener("click", async () => {
      const st = document.getElementById("login-status"); if (st) st.textContent = "Login läuft…";
      try {
        const r = await invoke("login");
        if (st) st.textContent = "Eingeloggt: " + r;
        toast("Login OK: " + r);
      } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
    });
  }

  // Mod modal
  async function openModsModal(name) {
    const modal = document.getElementById("modal-mods"); if (!modal) return;
    const title = document.getElementById("mods-title"); if (title) title.textContent = "Mods: " + name;
    modal.classList.remove("hide");
    await refreshModsList(name);
  }
  async function refreshModsList(name) {
    const list = document.getElementById("mods-list"); if (!list) return;
    list.innerHTML = "Lade…";
    try {
      const mods = await invoke("list_mods", { instance: name });
      list.innerHTML = "";
      for (const m of mods) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);";
        row.innerHTML = `<span style="font-size:12px;${m.disabled?'opacity:0.4;text-decoration:line-through;':''}">${esc(m.file)}</span>
          <div style="display:flex;gap:4px;">
            <button class="chip btn sm" data-toggle="${esc(m.file)}" data-dir="${esc(m.dir)}">${m.disabled?'Aktivieren':'Deaktivieren'}</button>
            <button class="chip btn sm" data-remove="${esc(m.file)}" data-dir="${esc(m.dir)}" style="color:var(--danger);">Entfernen</button>
          </div>`;
        list.appendChild(row);
      }
      list.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", async () => {
        try { await invoke("toggle_mod_cmd", { instance: name, dir: b.dataset.dir, file: b.dataset.toggle }); refreshModsList(name); toast("Getoggelt"); }
        catch (e) { toast("Fehler: " + e); }
      }));
      list.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
        if (!confirm("Mod entfernen?")) return;
        try { await invoke("remove_mod", { instance: name, dir: b.dataset.dir, file: b.dataset.remove }); refreshModsList(name); toast("Entfernt"); }
        catch (e) { toast("Fehler: " + e); }
      }));
    } catch (e) { list.innerHTML = "Fehler: " + e; }
  }

  // Window controls
  document.getElementById("min").addEventListener("click", () => invoke("minimize_window").catch(e => toast("Err: " + e)));
  document.getElementById("max").addEventListener("click", () => invoke("maximize_window").catch(e => toast("Err: " + e)));
  document.getElementById("close").addEventListener("click", () => invoke("close_window").catch(e => toast("Err: " + e)));

  // Account button
  document.getElementById("acct").addEventListener("click", async () => {
    try {
      const loggedIn = await invoke("is_logged_in");
      if (!loggedIn) {
        const r = await invoke("login");
        toast("Login OK: " + r);
        document.getElementById("acct-name").textContent = r.split(" ")[0];
      } else {
        const c = await invoke("get_config");
        document.getElementById("acct-name").textContent = c.auth?.username || "Anmelden";
      }
    } catch (e) { toast("Fehler: " + e); }
  });

  // Login gate
  async function checkLogin() {
    try {
      const loggedIn = await invoke("is_logged_in");
      const gate = document.getElementById("login-gate");
      if (loggedIn) { if (gate) gate.classList.add("hidden"); return true; }
      if (gate) gate.classList.remove("hidden");
      return false;
    } catch (e) { return false; }
  }

  const btnLoginGate = document.getElementById("btn-login-gate");
  if (btnLoginGate) btnLoginGate.addEventListener("click", async () => {
    const st = document.getElementById("login-gate-status"); if (st) st.textContent = "Login läuft… (Link+Code in Konsole)";
    try {
      const r = await invoke("login");
      if (st) st.textContent = "Eingeloggt: " + r;
      const gate = document.getElementById("login-gate"); if (gate) gate.classList.add("hidden");
      renderView("library");
      toast("Login OK");
    } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
  });

  const btnOfflineGate = document.getElementById("btn-offline-gate");
  if (btnOfflineGate) btnOfflineGate.addEventListener("click", async () => {
    try {
      await invoke("set_config", { update: { username: "Player", has_logged_in: true } });
      const gate = document.getElementById("login-gate"); if (gate) gate.classList.add("hidden");
      renderView("library");
      toast("Offline-Modus aktiv");
    } catch (e) { toast("Fehler: " + e); }
  });

  const btnModsClose = document.getElementById("btn-mods-close");
  if (btnModsClose) btnModsClose.addEventListener("click", () => { const m = document.getElementById("modal-mods"); if (m) m.classList.add("hide"); });

  const btnModSearch = document.getElementById("btn-mod-search");
  if (btnModSearch) btnModSearch.addEventListener("click", async () => {
    const q = document.getElementById("mod-search").value.trim();
    if (!q) return;
    const res = document.getElementById("mod-search-results"); if (res) res.innerHTML = "Suche…";
    try {
      const mods = await invoke("search_mods", { query: q });
      if (res) {
        res.innerHTML = "";
        for (const m of mods) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);";
          row.innerHTML = `<span style="font-size:12px;">${esc(m.name)}</span><button class="chip btn sm" data-install="${m.id}" style="font-size:11px;">Installieren</button>`;
          res.appendChild(row);
        }
        res.querySelectorAll("[data-install]").forEach(b => b.addEventListener("click", async () => {
          const currentInst = document.getElementById("mods-title").textContent.replace("Mods: ", "");
          try { const f = await invoke("install_mod", { instance: currentInst, projectId: parseInt(b.dataset.install) }); toast("Installiert: " + f); refreshModsList(currentInst); }
          catch (e) { toast("Fehler: " + e); }
        }));
      }
    } catch (e) { if (res) res.innerHTML = "Fehler: " + e; }
  });

  const btnImportCancel = document.getElementById("m-cancel");
  if (btnImportCancel) btnImportCancel.addEventListener("click", () => { const m = document.getElementById("modal-import"); if (m) m.classList.add("hide"); });
  const btnImportOk = document.getElementById("m-ok");
  if (btnImportOk) btnImportOk.addEventListener("click", async () => {
    const target = document.getElementById("import-target").value.trim();
    const name = document.getElementById("import-name").value.trim() || null;
    const st = document.getElementById("import-status"); if (st) st.textContent = "Installiere…";
    try {
      const res = await invoke("install_modpack", { target, name });
      if (st) st.textContent = "Fertig: " + res;
      toast("Installiert: " + res);
      const m = document.getElementById("modal-import"); if (m) m.classList.add("hide");
      renderView("library");
    } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
  });
  const btnImport = document.getElementById("btn-import") || null;
  // handled in renderLibrary

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  // Drag & drop import
  if (TAU.event && TAU.event.listen) {
    TAU.event.listen("tauri://drag-drop", async (e) => {
      const paths = e.payload?.paths || [];
      for (const p of paths) {
        const ext = p.split('.').pop().toLowerCase();
        if (ext === "zip" || ext === "mrpack") {
          try { const name = await invoke("import_path", { path: p }); toast("Importiert: " + name); renderView("library"); }
          catch (err) { toast("Fehler: " + err); }
        }
      }
    });
  }

  // Init
  (async () => {
    const ok = await checkLogin();
    if (ok) renderView("library");
  })();
})();
