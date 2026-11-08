# LachsLauncher — Handoff

## Overview
Minecraft launcher in Rust (Tauri GUI + CLI), supporting vanilla and modded instances (Fabric/Forge/NeoForge/Quilt), CurseForge modpack import (zip/URL/ID/code), reuse of existing CurseForge installs, Discord Rich Presence + webhook, Deckboard HTTP control, MCP server, OpenCode skill.

## Layout
- `crates/core` — library (config, mojang, loaders, curseforge, launch, discord, control)
- `crates/cli` — `lachslauncher` binary (list/launch/stop/import/install/serve/mcp)
- `crates/gui` — Tauri v2 app (glassy UI)
- `skills/minecraft-launcher/SKILL.md` — OpenCode skill
- `deckboard/` — Deckboard extension + docs
- `scripts/install-desktop.sh` — installs .desktop + icon

## Build
```
export PATH="$HOME/.cargo/bin:$PATH"
cargo build -p lachslauncher -p LachsLauncher          # debug
cargo build --release -p lachslauncher -p LachsLauncher # release
```
Tauri needs webkit2gtk-4.1 dev (present on this machine).

## Run
- CLI: `./target/debug/lachslauncher list`
- Launch: `./target/debug/lachslauncher launch "Horizont 3"`
- GUI: `./target/debug/LachsLauncher`
- Control API: `./target/debug/lachslauncher serve` (port 17321)
- MCP: `./target/debug/lachslauncher mcp` (stdio)

## Config
`~/.local/share/lachslauncher/config.json`. CurseForge API key via env `CURSEFORGE_API_KEY` or config. Discord client_id/webhook_url configurable. Java auto-detected (CF install + system). Shared libraries/assets symlinked from `/mnt/games/Curseforge/Install` if present.

## Verified
- Imported 20+ existing CurseForge instances (2026-11-08).
- Launched Fabric instance "Waylandcraft" (26.1.2) successfully.
- Launched Forge instance "Horizont 3" (1.20.1) successfully.
- MCP server registered and responding in OpenCode.
- GUI builds.

## Known limitations / next steps
- Microsoft (online) auth not implemented (offline UUID only).
- Forge/NeoForge installer path (downloading new packs) not tested end-to-end (only existing embedded profiles).
- CurseForge zip import requires API key for file resolution; CDN fallback best-effort.
- Discord Rich Presence needs a real application client_id (user must create one) and logo asset upload.
- Deckboard extension is a skeleton; needs testing against Deckboard's extension API.
- No in-game command bridge mod (client-side); in-game actions rely on Deckboard keystrokes.
- Java auto-download (Adoptium) not implemented; relies on installed Javas.
- Release build not yet produced; update MCP path in opencode.jsonc if switching to release binary.

## Notes for next agent
- Funnels logo folder was not found; placeholder SVG logo used. Drop `assets/branding/logo.png` + update icons to override.
- The CurseForge API key in `~/.config/opencode/opencode.jsonc` is for dev; do not commit.
- Shared memory target: run `opencode-db-sync push` at session end.