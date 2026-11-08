// Deckboard extension for LachsLauncher
// Place this folder in Deckboard's extensions directory and restart Deckboard.
const http = require("http");

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "127.0.0.1", port: 17321, path, method, headers: { "Content-Type": "application/json" } }, (res) => {
      let buf = ""; res.on("data", (c) => buf += c); res.on("end", () => resolve(buf));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

class LachsLauncherExtension {
  constructor(api) { this.api = api; }
  getActions() {
    return [
      { name: "List instances", icon: "list", execute: async () => { const r = await request("GET", "/api/v1/instances"); this.api.log(r); } },
      { name: "Launch instance", icon: "play", inputs: [{ type: "text", name: "instance", label: "Instance name" }], execute: async (data) => { const r = await request("POST", "/api/v1/instances/" + encodeURIComponent(data.instance) + "/launch"); this.api.log(r); } },
      { name: "Stop instance", icon: "stop", inputs: [{ type: "text", name: "instance", label: "Instance name" }], execute: async (data) => { const r = await request("POST", "/api/v1/instances/" + encodeURIComponent(data.instance) + "/stop"); this.api.log(r); } },
      { name: "Install modpack", icon: "download", inputs: [{ type: "text", name: "target", label: "CurseForge URL/code/zip" }], execute: async (data) => { const r = await request("POST", "/api/v1/modpack/install", { target: data.target }); this.api.log(r); } },
    ];
  }
}

module.exports = LachsLauncherExtension;