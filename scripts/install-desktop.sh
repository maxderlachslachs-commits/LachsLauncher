#!/usr/bin/env bash
set -e
ROOT="${1:-$HOME/.local}"
BIN="$ROOT/bin"
DESK="$ROOT/share/applications"
ICON="$ROOT/share/icons/hicolor/256x256/apps"
mkdir -p "$BIN" "$DESK" "$ICON"
cp target/release/LachsLauncher "$BIN/" 2>/dev/null || cp target/debug/LachsLauncher "$BIN/" 2>/dev/null || true
cp crates/gui/icons/icon.png "$ICON/lachslauncher.png"
cat > "$DESK/lachslauncher.desktop" <<EOF
[Desktop Entry]
Name=LachsLauncher
Comment=Minecraft Launcher mit CurseForge, Discord & Deckboard
Exec=$BIN/LachsLauncher
Icon=lachslauncher
Type=Application
Categories=Game;
StartupWMClass=LachsLauncher
Terminal=false
EOF
update-desktop-database "$DESK" 2>/dev/null || true
echo "installed"