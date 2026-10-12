# Betriebsbefehle

Alle Befehle im Projektverzeichnis mit Node.js 26 ausführen. Eine globale CLI wird nicht installiert.

| Befehl                                                           | Wirkung                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                                                    | Lokaler Server mit Node-Watch-Modus                     |
| `npm start`                                                      | Lokaler Server ohne Watch-Modus                         |
| `npm run migrate`                                                | Fehlende SQL-Migrationen transaktional ausführen        |
| `npm run seed`                                                   | Fiktive Demo nur in leere Datenbank einfügen            |
| `npm run sync:designsystem`                                      | Unveränderte gebaute npm-Assets/Lizenzen lokal kopieren |
| `npm run backup -- ./backups/snapshot.sqlite`                    | Konsistenter SQLite-Snapshot, auch bei laufendem Server |
| `npm run restore -- ./backups/snapshot.sqlite ./data/neu.sqlite` | Geprüfte Wiederherstellung in neue Zieldatei            |
| `npm test`                                                       | Business-, API-, Persistenz- und Betriebswerkzeugtests  |
| `npm run test:ui`                                                | Chromium/WebKit-Abläufe und Screenshots                 |
| `npm run format:check`                                           | Formatierung prüfen                                     |

`DATABASE_PATH` wählt die Datenbank für Start, Migration, Seed und Backup. `PORT` wählt den lokalen Serverport. Kein Werkzeug überschreibt bestehende Backup-/Restore-Ziele. Vor einem Wechsel auf eine wiederhergestellte Datenbank den Server stoppen.
