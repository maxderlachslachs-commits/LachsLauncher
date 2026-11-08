const { invoke } = window.__TAURI__.core;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3200);
}

function switchView(name) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.view === name));
}

$$(".nav").forEach(n => n.addEventListener("click", () => switchView(n.dataset.view)));

$("#btn-min").addEventListener("click", () => invoke("minimize_window"));
$("#btn-max").addEventListener("click", () => invoke("maximize_window"));
$("#btn-close").addEventListener("click", () => invoke("close_window"));

async function loadInstances() {
  try {
    const insts = await invoke("list_instances");
    const grid = $("#instance-grid");
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
  } catch (e) { console.error(e); }
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

$("#btn-scan").addEventListener("click", async () => {
  try { const n = await invoke("scan_curseforge"); toast(n + " Instanzen importiert"); loadInstances(); }
  catch (e) { toast("Fehler: " + e); }
});

$("#btn-import").addEventListener("click", () => $("#modal-import").classList.remove("hidden"));
$("#btn-import-cancel").addEventListener("click", () => $("#modal-import").classList.add("hidden"));
$("#btn-import-ok").addEventListener("click", async () => {
  const target = $("#import-target").value.trim();
  const name = $("#import-name").value.trim() || null;
  $("#import-status").textContent = "Installiere…";
  try {
    const res = await invoke("install_modpack", { target, name });
    $("#import-status").textContent = "Fertig: " + res;
    toast("Installiert: " + res);
    $("#modal-import").classList.add("hidden");
    loadInstances();
  } catch (e) { $("#import-status").textContent = "Fehler: " + e; }
});

$("#btn-search").addEventListener("click", async () => {
  const q = $("#search-q").value.trim();
  if (!q) return;
  const res = $("#discover-results");
  res.innerHTML = "<p style='color:var(--muted)'>Suche wird über CurseForge-API (CLI) empfohlen: lachslauncher install &lt;url&gt;</p>";
});

$("#btn-skin-fetch").addEventListener("click", async () => {
  const name = $("#skin-name").value.trim();
  if (!name) return;
  $("#skin-status").textContent = "Lade…";
  try {
    const path = await invoke("fetch_skin", { username: name });
    $("#skin-status").textContent = "Gespeichert: " + path;
    const src = window.__TAURI__.core.convertFileSrc(path);
    $("#skin-preview").innerHTML = `<img src="${src}" width="128" height="128" style="border-radius:12px;border:1px solid var(--border);" />`;
  } catch (e) { $("#skin-status").textContent = "Fehler: " + e; }
});

$("#btn-login").addEventListener("click", async () => {
  $("#login-status").textContent = "Login läuft… (siehe Konsole für Link+Code)";
  try {
    const r = await invoke("login");
    $("#login-status").textContent = "Eingeloggt: " + r;
    toast("Login OK: " + r);
  } catch (e) { $("#login-status").textContent = "Fehler: " + e; toast("Login-Fehler: " + e); }
});

$("#btn-save-settings").addEventListener("click", async () => {
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

async function loadSettings() {
  try {
    const c = await invoke("get_config");
    $("#s-username").value = c.auth?.username || "";
    $("#s-memory").value = c.default_memory_mb || "";
    $("#s-apikey").value = c.curseforge_api_key || "";
    $("#s-discord").value = c.discord?.client_id || "";
    $("#s-webhook").value = c.discord?.webhook_url || "";
  } catch (e) {}
}

loadInstances();
loadSettings();