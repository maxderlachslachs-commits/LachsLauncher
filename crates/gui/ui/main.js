(function() {
  const TAU = window.__TAURI__ || {};
  const core = TAU.core || {};
  const invoke = core.invoke || (async (cmd) => { throw new Error("Tauri not available: " + cmd); });
  const convertFileSrc = core.convertFileSrc || (p => p);

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg) {
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.remove("hidden");
    setTimeout(() => t.classList.add("hidden"), 3200);
  }

  function switchView(name) {
    $$(".view").forEach(v => v.classList.remove("active"));
    const el = $("#view-" + name); if (el) el.classList.add("active");
    $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.view === name));
  }

  $$(".nav").forEach(n => n.addEventListener("click", () => switchView(n.dataset.view)));

  const btnMin = $("#btn-min"); if (btnMin) btnMin.addEventListener("click", () => invoke("minimize_window").catch(e => toast("Err: " + e)));
  const btnMax = $("#btn-max"); if (btnMax) btnMax.addEventListener("click", () => invoke("maximize_window").catch(e => toast("Err: " + e)));
  const btnClose = $("#btn-close"); if (btnClose) btnClose.addEventListener("click", () => invoke("close_window").catch(e => toast("Err: " + e)));

  async function loadInstances() {
    try {
      const insts = await invoke("list_instances");
      const grid = $("#instance-grid");
      if (!grid) return;
      grid.innerHTML = "";
      for (const i of insts) {
        const card = document.createElement("div");
        card.className = "card glass";
        card.innerHTML = `
          <h2>${escapeHtml(i.name)}</h2>
          <div class="meta">
            <span class="badge accent">${escapeHtml(i.mc_version)}</span>
            <span class="badge">${escapeHtml(i.loader)}</span>
            ${i.modpack ? `<span class="badge">${escapeHtml(i.modpack)}</span>` : ""}
          </div>
          <div class="card-actions">
            <button class="btn primary" data-action="launch" data-name="${escapeAttr(i.name)}">${i.running ? "Läuft…" : "Starten"}</button>
            <button class="btn ghost" data-action="stop" data-name="${escapeAttr(i.name)}">Stop</button>
          </div>`;
        grid.appendChild(card);
      }
      grid.querySelectorAll("button").forEach(b => {
        b.addEventListener("click", async () => {
          const name = b.dataset.name;
          if (b.dataset.action === "launch") {
            try { await invoke("launch_instance", { name }); toast("Gestartet: " + name); loadInstances(); }
            catch (e) { toast("Fehler: " + e); }
          } else {
            try { await invoke("stop_instance", { name }); toast("Gestoppt: " + name); loadInstances(); }
            catch (e) { toast("Fehler: " + e); }
          }
        });
      });
    } catch (e) { console.error("loadInstances:", e); toast("Fehler: " + e); }
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s){ return escapeHtml(s); }

  const btnScan = $("#btn-scan"); if (btnScan) btnScan.addEventListener("click", async () => {
    try { const n = await invoke("scan_curseforge"); toast(n + " Instanzen importiert"); loadInstances(); }
    catch (e) { toast("Fehler: " + e); }
  });

  const btnImport = $("#btn-import"); if (btnImport) btnImport.addEventListener("click", () => { const m = $("#modal-import"); if (m) m.classList.remove("hidden"); });
  const btnCancel = $("#btn-import-cancel"); if (btnCancel) btnCancel.addEventListener("click", () => { const m = $("#modal-import"); if (m) m.classList.add("hidden"); });
  const btnImportOk = $("#btn-import-ok"); if (btnImportOk) btnImportOk.addEventListener("click", async () => {
    const target = $("#import-target").value.trim();
    const name = $("#import-name").value.trim() || null;
    const st = $("#import-status"); if (st) st.textContent = "Installiere…";
    try {
      const res = await invoke("install_modpack", { target, name });
      if (st) st.textContent = "Fertig: " + res;
      toast("Installiert: " + res);
      const m = $("#modal-import"); if (m) m.classList.add("hidden");
      loadInstances();
    } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
  });

  const btnSearch = $("#btn-search"); if (btnSearch) btnSearch.addEventListener("click", async () => {
    const q = $("#search-q").value.trim();
    if (!q) return;
    const res = $("#discover-results");
    if (res) res.innerHTML = "<p style='color:var(--muted)'>Suche über CurseForge-CLI: lachslauncher install &lt;url&gt;</p>";
  });

  const btnSave = $("#btn-save-settings"); if (btnSave) btnSave.addEventListener("click", async () => {
    try {
      await invoke("set_config", { update: {
        username: $("#s-username").value || null,
        memory_mb: $("#s-memory").value ? parseInt($("#s-memory").value) : null,
        api_key: $("#s-apikey").value || null,
        discord_client_id: $("#s-discord").value || null,
        webhook_url: $("#s-webhook").value || null,
      }});
      toast("Gespeichert");
    } catch (e) { toast("Fehler: " + e); }
  });

  const btnSkin = $("#btn-skin-fetch"); if (btnSkin) btnSkin.addEventListener("click", async () => {
    const name = $("#skin-name").value.trim();
    if (!name) return;
    const st = $("#skin-status"); if (st) st.textContent = "Lade…";
    try {
      const path = await invoke("fetch_skin", { username: name });
      if (st) st.textContent = "Gespeichert: " + path;
      const src = convertFileSrc(path);
      const preview = $("#skin-preview");
      if (preview) preview.innerHTML = `<img src="${src}" width="128" height="128" style="border-radius:12px;border:1px solid var(--border);" />`;
      toast("Skin OK");
    } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
  });

  const btnLogin = $("#btn-login"); if (btnLogin) btnLogin.addEventListener("click", async () => {
    const st = $("#login-status"); if (st) st.textContent = "Login läuft… (siehe Konsole für Link+Code)";
    try {
      const r = await invoke("login");
      if (st) st.textContent = "Eingeloggt: " + r;
      toast("Login OK: " + r);
    } catch (e) { if (st) st.textContent = "Fehler: " + e; toast("Fehler: " + e); }
  });

  async function loadSettings() {
    try {
      const c = await invoke("get_config");
      const su = $("#s-username"); if (su) su.value = c.auth?.username || "";
      const sm = $("#s-memory"); if (sm) sm.value = c.default_memory_mb || "";
      const sa = $("#s-apikey"); if (sa) sa.value = c.curseforge_api_key || "";
      const sd = $("#s-discord"); if (sd) sd.value = c.discord?.client_id || "";
      const sw = $("#s-webhook"); if (sw) sw.value = c.discord?.webhook_url || "";
    } catch (e) { console.error("loadSettings:", e); }
  }

  // Init
  try { loadInstances(); loadSettings(); } catch (e) { console.error("init:", e); toast("Init-Fehler: " + e); }
})();
