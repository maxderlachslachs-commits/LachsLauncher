# Deckboard integration

1. Start the control API: `lachslauncher serve` (or run the GUI, which starts it automatically).
2. In Deckboard, add buttons using the "Open URL" action pointing at:
   - `http://127.0.0.1:17321/api/v1/instances`
   - POST endpoints via Deckboard's HTTP action or the bundled extension in `extension/`.
3. For in-game functions, use Deckboard's keystroke/macro actions mapped to Minecraft keys (F1, F3, chat, etc.).

Endpoints:
- GET `/api/v1/status`
- GET `/api/v1/instances`
- POST `/api/v1/instances/{name}/launch`
- POST `/api/v1/instances/{name}/stop`
- POST `/api/v1/modpack/install` body `{"target":"..."}`