# Lokale Befehle

Node.js 26 wird benötigt. Abhängigkeiten und lokale Designsystem-Assets installieren:

```sh
npm install
```

Auf die neueste veröffentlichte OJ-Designsystem-Version aktualisieren, einschließlich Lockfile und lokaler Browser-Assets:

```sh
npm run update:designsystem
```

Details zur Einbindung stehen in [vendor/README.md](../vendor/README.md).

MCP für eine vorhandene Pitchary-Datenbank starten:

```sh
npm run mcp -- --database /absoluter/pfad/pitchary.sqlite
```

MCP-Clients starten `node src/mcp/server.js` direkt, damit npm-Ausgaben das stdio-Protokoll nicht stören. Werkzeuge und Client-Konfiguration stehen in [MCP.md](MCP.md).

Generierte Dateien prüfen und bei Bedarf entfernen:

```sh
npm run cleanup -- --dry-run
npm run cleanup
```

Erfolgreiches `npm run publish` führt das Cleanup automatisch aus. Die betroffenen Pfade und das Verhalten bei Fehlern sind in [cleanup.md](cleanup.md) dokumentiert.

Prüfungen:

```sh
npm run format:check
npm test
npm run test:ui
```
