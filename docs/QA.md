# Lokale Verifikation

Geprüft am 12. Oktober 2026 auf macOS mit Node.js 26.10.0.

- `npm test`: **23 Tests bestanden**, keine Fehler oder übersprungenen Tests.
- `npm run test:ui`: **6 Tests bestanden**, je drei Abläufe in Chromium und WebKit.
- `npm run format:check` und `git diff --check`: bestanden.
- Desktop (1440px) und Mobil (390px): sechs Hauptansichten, Kunden-, Dienstleistungs- und Angebotsdetails sowie ein Aktivitätsdialog. **38 aktuelle Fixture-Screenshots** in `artifacts/screenshots/`.
- Axe-Prüfungen für WCAG 2 A/AA und 2.1 AA: keine gemeldeten Verstöße in den geprüften Ansichten/Dialogen. Keine JavaScript- oder fehlgeschlagenen Asset-Anfragen im geprüften Browserablauf.
- Vollständiger UI-Ablauf: Stammdaten/Kontakt anlegen, Angebot erstellen, Pitch, Preisverhandlung, Follow-up, Absage, Wiederaufnahme, Zusage, Abschluss, Reload, Archivierung und Wiederherstellung.
- Zusätzlich: Mehrfachzuweisung, Suche und Filter, sichere Textdarstellung, Dialogfokus und Escape.
- SQLite-Backup bei offener WAL-Verbindung und Restore in neue Datei geprüft; vorhandene Ziele und fremde Datenbanken werden verweigert.

Der Browserbericht liegt in [artifacts/browser-report/index.html](../artifacts/browser-report/index.html). Alle Tests verwenden temporäre oder In-Memory-Datenbanken. Der normale Datenbestand wurde nicht mit Demo-Daten gefüllt.

Die GitHub-Actions-Konfiguration ist angelegt; ein entfernter CI-Lauf wurde in dieser Sitzung nicht ausgeführt. Axe-Checks und diese Viewports beschreiben den geprüften Umfang und sind keine vollständige WCAG-Zertifizierung.
