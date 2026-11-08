---
name: minecraft-launcher
description: Start Minecraft instances/modpacks via LachsLauncher (Rust launcher) by name. Use when the user asks to start/launch/open a Minecraft instance, modpack, or world.
---

# LachsLauncher (Rust)

CLI: `/home/lachs/Projekte/LachsLauncher/target/debug/lachslauncher` (or release build).

Commands:
- `lachslauncher list --json` — list registered instances
- `lachslauncher launch "Instance Name"` — launch (detaches, logs to instance/logs/lachslauncher.log)
- `lachslauncher stop "Instance Name"` — stop
- `lachslauncher import-cf --scan` — import all CurseForge instances
- `lachslauncher install <url|id|code|zip>` — install a CurseForge modpack
- `lachslauncher serve` — start HTTP control API on 127.0.0.1:17321 (Deckboard)
- `lachslauncher mcp` — stdio MCP server

MCP: registered as `lachslauncher` in opencode config. Tools: list_instances, launch_instance, stop_instance, status.

Notes:
- Instances are imported from CurseForge without copying (path points at existing CF instance).
- Java is auto-detected from /mnt/games/Curseforge/Install/java and system.
- Shared libraries/assets are symlinked from the CurseForge install.
- Discord Rich Presence uses config discord.client_id; webhook notifications use discord.webhook_url.