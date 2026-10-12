# Pitchary

Schlankes, lokales Single-User-CRM für Kunden, Ansprechpartner, Dienstleistungen und eigenständige Vertriebsangebote. Dashboard, Kunden, Dienstleistungen, Pipeline, Aktivitäten und Analytics sind vollständig mit der SQLite-Datenbank verbunden.

## Start

Node.js **26** und npm werden benötigt. Es gibt keinen Frontend-Build und keinen Bundler.

```sh
npm install
npm run dev
```

Öffne **http://127.0.0.1:3031**. Für den normalen Betrieb ohne Watch-Modus: `npm start`. `PORT=3032 npm start` verwendet einen anderen Port. Der Server bindet immer ausschließlich an `127.0.0.1`; eine öffentliche HOST-Konfiguration wird verweigert. v1 hat keine Mehrbenutzer-Authentifizierung und ist ausschließlich für lokalen Betrieb vorgesehen.

Beim ersten Start entsteht eine **leere** Datenbank in `data/pitchary.sqlite`. Migrationen laufen automatisch und transaktional. Ein expliziter Lauf ist mit `npm run migrate` möglich. `DATABASE_PATH=/absoluter/pfad/crm.sqlite` wählt eine separate Datenbank. Datenbanken, WAL/SHM-Dateien, Backups und Testartefakte sind in Git ausgeschlossen.

## Erste Schritte

1. Unter **Kunden** einen Kunden und dessen Mitarbeiter anlegen.
2. Unter **Dienstleistungen** einen wiederverwendbaren Leistungstyp anlegen.
3. Ein **neues Angebot** erstellen: Kunde, Dienstleistung, Ansprechpartner, Preis, Währung, Abrechnung und ursprünglichen Pitch-Kanal auswählen.
4. In der Pipeline oder Angebotsdetailansicht **Pitch erfassen**, Kontakte protokollieren, den Preis verhandeln und **Zusage erfassen** oder **Ablehnen** wählen.
5. Gewonnene Aufträge als erledigt markieren. Ein neues Projekt bekommt ein neues Angebot; ein Follow-up bleibt im bestehenden Vorgang.

Alle Änderungen werden serverseitig geprüft. Fehler erscheinen im Formular, ohne dessen Eingaben zu verwerfen. Ein Kunden- oder Dienstleistungsarchiv entfernt keine Beziehungen. Mitarbeiter und Angebote können ebenfalls archiviert und wiederhergestellt werden. Historische Ansprechpartner bleiben lesbar; archivierte Mitarbeiter sind für neue Zuweisungen nicht auswählbar.

## Demo-Daten (optional)

```sh
npm run seed
```

Der Seed enthält ausschließlich fiktive Firmen und `example.com`-Kontakte. Er verweigert eine bereits gefüllte Datenbank und überschreibt keine Datensätze. Für eine vollständig getrennte Demo:

```sh
DATABASE_PATH=./data/demo.sqlite npm run seed
DATABASE_PATH=./data/demo.sqlite npm run dev
```

Der Seed wird **niemals** beim Installieren oder beim normalen Start ausgeführt.

## Architektur und Designsystem

| Schicht           | Ort                       | Verantwortung                                                                                |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Database          | `src/database/`           | SQLite-Verbindung, versionierte SQL-Migrationen, parametrisierte Repositories, Transaktionen |
| Business          | `src/business/`           | Validierung, erlaubte Statuswechsel, Preisereignisse, Kontaktzuordnung, Analytics            |
| API               | `src/api/`, `src/server/` | Fastify, REST, JSON-Fehler, lokale Zugriffsbeschränkung, statische Dateien                   |
| Frontend          | `public/js/`              | Native ES Modules, DOM-Aufbau, Navigation, Formulare, API-Aufrufe                            |
| Betriebswerkzeuge | `scripts/`                | Migration, expliziter Seed, Asset-Sync, Backup, Wiederherstellung                            |

Die Oberfläche nutzt das per npm installierte [oj-designsystem](https://github.com/oliverjessner/oj-designsystem), derzeit fest auf **0.2.0** gesetzt. README, AI-AGENTS, COMPONENTS und JS-API wurden als Integrationsvertrag verwendet. Buttons, Felder, Tabellen, Navigation, Kennzahlen, Dialoge, Meldungen und Details verwenden dessen dokumentierte Komponenten. Eigene CSS-Regeln betreffen Anwendungslayout und Vertriebs-Timeline. Alle Schriften und Font-Awesome-Icons liegen lokal vor.

Pitchary verwendet Kobaltblau (`#4D8DFF`) als Produktakzent über `--oj-accent` in `public/app.css`; das Favicon verwendet dieselbe Farbe.

`npm install` synchronisiert über `postinstall` die unveränderten gebauten CSS-/ESM-/Font-/Icon-Assets und Lizenzen nach `public/vendor/oj-designsystem/`. Der reproduzierbare Sync kann mit `npm run sync:designsystem` erneut ausgeführt werden; `package-lock.json` fixiert die Paketversion. Bei Installation mit `--ignore-scripts` ist dieser Befehl vor dem Start erforderlich. Das Designsystem wird nicht verändert. Jede dynamische View und jeder Dialog besitzt einen `initOJ()`-Cleanup, der vor dem Entfernen der Oberfläche aufgerufen wird.

## Datenmodell und fachliche Regeln

Die sechs fachlichen Tabellen sind `customers`, `employees`, `services`, `customer_services`, `customer_service_status_history` und `activities`. Schema-Versionen werden in `PRAGMA user_version` geführt; es gibt keine zusätzliche fachliche Tabelle. Migration 001 erstellt die Tabellen, Indizes und Integritätstrigger; 002 ergänzt die Angebotsarchivierung.

- IDs sind UUIDs. Kunden besitzen beliebig viele Mitarbeiter. Dienstleistungen können ohne Kunden existieren.
- Ein Angebot ist genau eine Kunden-Dienstleistungs-Beziehung. **Kein UNIQUE-Constraint** auf Kunde/Dienstleistung: wiederholte Aufträge sind unabhängig.
- Kontaktzuordnungen werden fachlich und über zusammengesetzte Foreign Keys bzw. einen Aktivitätstrigger abgesichert. Ein Mitarbeiter kann ausschließlich zum Kunden des Angebots gehören.
- Status: `open → pitched → accepted → done` oder `pitched → rejected`. `rejected → pitched` ist mit einer Wiederaufnahmebegründung erlaubt. `done` ist abgeschlossen. Andere Übergänge werden verweigert; ein neuer Auftrag erhält eine neue Beziehung.
- Bereits beim Anlegen wird `open` historisiert. Status und Historieneintrag werden gemeinsam in `BEGIN IMMEDIATE`/`COMMIT` gespeichert; Fehler rollen beide zurück. `status_since` markiert den Beginn der aktuellen Phase. Optional rückdatierte Statusereignisse dürfen nicht vor der aktuellen Phase oder in der Zukunft liegen.
- Der erste tatsächliche Pitch hält den zu diesem Zeitpunkt angebotenen Preis in `first_pitched_price_minor` fest. Vor dem Pitch ist dieses Feld NULL. Verhandlungen ändern nur den aktuellen Angebotspreis und erzeugen strukturierte `price_change`-Aktivitäten mit Preisfeld, altem und neuem Betrag.
- Die Zusage speichert separat `accepted_price_minor`; auch dessen Erfassung und spätere Änderungen werden protokolliert. Nach Zusage wird eine Preisänderung am vereinbarten Preis durchgeführt.
- Geld wird ausschließlich als nichtnegative **Integer-Cent** gespeichert. v1 unterstützt EUR, USD und GBP (je zwei Nachkommastellen), bis 1.000.000.000.000 Cent je Preis. Eingaben wie `1200,50` werden anhand der Ziffern verarbeitet. Währung, Abrechnungsmodell und ursprünglicher Pitch-Kanal sind nach dem ersten Pitch festgeschrieben.
- Abrechnung: `one_time`, `monthly`, `yearly`, `hourly`, `daily`. Kanäle: `linkedin`, `email`, `phone`, `meeting`, `other`.
- Absagegründe werden als JSON mit `code` und optionaler `note` gespeichert: `budget`, `timing`, `competitor`, `no_need`, `no_response`, `other`. Die jeweilige Absage bleibt in der Historie erhalten, auch nach Wiederaufnahme.
- Kontaktaktivitäten: `pitch`, `follow_up`, `call`, `meeting`, `note`. Sie ändern keinen Status. Ein initialer Pitch ist zuerst über die Statusaktion zu erfassen. Zeitpunkte sind ISO-8601 mit Zeitzone, Speicherung in UTC, Anzeige in der Browser-Zeitzone.
- Historie und Aktivitäten sind append-only und zusätzlich durch SQLite-Trigger gegen reguläres UPDATE/DELETE geschützt. Archivierung erhält alle Geschäftsdaten. Foreign Keys, WAL und Busy Timeout (5 Sekunden) sind aktiv.

## Analytics-Definitionen

Filter beziehen sich auf eine **Angebotskohorte nach Anlagedatum in UTC**, einschließlich archivierter Vorgänge. Kunden, Dienstleistungen und ursprünglicher Pitch-Kanal sind zusätzlich filterbar. Der Aktivitätsbereich verwendet stattdessen den tatsächlichen Aktivitätszeitpunkt.

| Kennzahl                     | Definition                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Angelegt                     | Anzahl eigenständiger Angebote der Kohorte                                                                                    |
| Gepitcht                     | Mindestens ein `pitched`-Historieneintrag; ein Vorgang zählt einmal                                                           |
| Gewonnen                     | Aktueller Status `accepted` oder `done`                                                                                       |
| Abgelehnt                    | Aktueller Status `rejected`                                                                                                   |
| Unentschieden                | Aktueller Status `open` oder `pitched`                                                                                        |
| Abschlussquote               | Gewonnen / (gewonnen + abgelehnt); ohne Entscheidungen NULL/„–“                                                               |
| Pitch → Zusage               | Durchschnitt vom ersten Pitch bis zur ersten Zusage, in Kalendertagen; nur Vorgänge mit beiden Ereignissen                    |
| Pitch → Entscheidung         | Durchschnitt vom ersten Pitch bis zur ersten Zusage oder Absage; nach Wiederaufnahme bleibt die erste Entscheidung maßgeblich |
| Angebotene Werte             | Summe der aktuellen Angebotspreise aller Angebote der Kohorte                                                                 |
| Ursprünglich gepitchte Werte | Summe der ursprünglichen Preise aller tatsächlich gepitchten Angebote                                                         |
| Vereinbarte Werte            | Summe der vereinbarten Preise aktuell gewonnener Angebote                                                                     |
| Ablehnungsgründe             | Aktueller Absagegrund aktuell abgelehnter Angebote; einmal pro Vorgang                                                        |

Performance je Kunde, Dienstleistung und Pitch-Kanal verwendet dieselben Zählregeln. Alle Werte werden **je Währung und Abrechnungsmodell getrennt** angezeigt. Monats-/Jahresbeträge sind Periodenwerte; Stunden-/Tagessätze werden nicht als Projektumsatz hochgerechnet. Wiederholte Statuswechsel vervielfachen keine Kennzahl. Definitionen sind auch direkt in Analytics einsehbar.

## API

Siehe [docs/API.md](docs/API.md) für Endpunkte, Beispiele und Fehlercodes. SQL befindet sich ausschließlich im Database Layer; Fachregeln liegen im Business Layer. Das Frontend baut dynamische Inhalte mit sicheren DOM-APIs statt HTML-Interpolation auf. CSP, Host-Validierung (gegen DNS-Rebinding), Origin-/Cross-Site-Prüfung und lokale Bindung schützen den Single-User-Betrieb. Keine CORS-Freigabe und keine externen Frontend-Anfragen.

## Backup und Wiederherstellung

SQLite im WAL-Modus nicht durch Kopieren nur der Hauptdatei sichern. Der Backup-Befehl nutzt die SQLite-Backup-API für einen konsistenten Snapshot, auch bei laufendem Server:

```sh
npm run backup
npm run backup -- ./backups/meine-sicherung.sqlite
```

Existierende Ziele werden nicht überschrieben. Backups liegen standardmäßig in `backups/`. Für externe/verschlüsselte Sicherungskopien ist der Betreiber verantwortlich.

Wiederherstellung: Server stoppen, Backup in eine **neue** Datei zurückspielen und diese anschließend auswählen:

```sh
npm run restore -- ./backups/meine-sicherung.sqlite ./data/wiederhergestellt.sqlite
DATABASE_PATH=./data/wiederhergestellt.sqlite npm start
```

Restore prüft SQLite-Integrität, Foreign Keys und die Pitchary-Tabelle, bevor geschrieben wird. Ein existierendes Ziel wird verweigert. Die bisherige Datenbank bleibt erhalten. Vor dem Wechsel prüfen, dass Kunden, Angebote und Timeline vorhanden sind. Keine Migration rückwärts auf eine ältere App-Version durchführen. Siehe auch [Betriebsbefehle](docs/CLI.md).

## Tests und Browserprüfung

```sh
npm test
npx playwright install chromium webkit
npm run test:ui
npm run format:check
```

Die Node-Tests prüfen Mehrfachangebote, separate Historien, erzwungene Transaktionsfehler, Originalpreis, Ansprechpartner-Zuordnung (auch direkt in SQLite), Wiederaufnahme, ungültige Übergänge, Archive, Batch-Atomizität, Analytics, Filter, Persistenz nach Neustart, API-Schutz und Backup/Restore.

Browser-Tests verwenden separate temporäre SQLite-Datenbanken. Eine zweite unveränderte Demo-Fixture erzeugt reproduzierbare Ansichten mit festen UUIDs, fester Zeit für Verweildauern und definierter Zeitzone; produktive Daten werden nie verwendet. Chromium und WebKit prüfen den vollständigen UI-Ablauf, Suche/Filter, Mehrfachzuweisung, XSS-Text, Dialog-/Tastaturfokus, 1440px-/390px-Layouts und Axe-WCAG-Prüfungen aller sechs Bereiche und Detailansichten. Berichte, Screenshots und Fehler-Traces liegen unter `artifacts/`. Die lokale CI-Konfiguration führt dieselben Prüfungen aus.

## Umfang von v1

Keine PDF-Erstellung, E-Mail-Anbindung, LinkedIn-Automatisierung, Rechnungsstellung, externes CRM-Syncing, komplexe Aufgabenverwaltung oder automatischen Wiedervorlagen. Externe Links zu manuell gepflegten Ansprechpartnerprofilen bleiben normale Links.
