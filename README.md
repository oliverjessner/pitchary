# Pitchary

Schlankes, lokales Single-User-CRM für Kunden, Ansprechpartner, Dienstleistungen und eigenständige Vertriebsangebote. Billlys PDF-Rechnungsverwaltung ergänzt Einnahmen, Ausgaben und Kundenumsatz im selben System. Alle Bereiche verwenden dieselbe SQLite-Datenbank. Aktivitäten werden direkt am jeweiligen Angebot erfasst.

## Start

Node.js **26** und npm werden benötigt. Es gibt keinen Frontend-Build und keinen Bundler.

```sh
npm install
npm run dev
```

Öffne **http://127.0.0.1:3031**. Für den normalen Betrieb ohne Watch-Modus: `npm start`. `PORT=3032 npm start` verwendet einen anderen Port. Der Server bindet immer ausschließlich an `127.0.0.1`; eine öffentliche HOST-Konfiguration wird verweigert. v1 hat keine Mehrbenutzer-Authentifizierung und ist ausschließlich für lokalen Betrieb vorgesehen.

Beim ersten Start entsteht eine **leere** Datenbank in `data/pitchary.sqlite`. Migrationen laufen automatisch und transaktional. Ein expliziter Lauf ist mit `npm run migrate` möglich. `DATABASE_PATH=/absoluter/pfad/crm.sqlite` wählt eine separate Datenbank. Datenbanken, WAL/SHM-Dateien, Backups und Testartefakte sind in Git ausgeschlossen.

## Erste Schritte

1. Unter **Kunden** einen Kunden mit optionaler Website und Logo sowie dessen Mitarbeiter anlegen.
2. Unter **Dienstleistungen** einen wiederverwendbaren Leistungstyp anlegen.
3. Ein **neues Angebot** erstellen: Kunde, Dienstleistung, Ansprechpartner, Preis, Währung, Abrechnung und ursprünglichen Pitch-Kanal auswählen.
4. In der Pipeline oder Angebotsdetailansicht **Pitch erfassen**, Kontakte protokollieren, den Preis verhandeln und **Zusage erfassen** oder **Ablehnen** wählen.
5. Gewonnene Aufträge als erledigt markieren. Ein neues Projekt bekommt ein neues Angebot; ein Follow-up bleibt im bestehenden Vorgang.

Beim Anlegen eines Angebots auf einer Dienstleistungsdetailseite ist die Dienstleistung bereits festgelegt. Die Mehrfachanlage zeigt Kunden mit Logo und Website; größere Listen sind durchsuchbar und unterstützen Sammelauswahl. Bereits ausgewählte Kunden bleiben beim Filtern ausgewählt. Vor dem Speichern zeigt der Dialog die genaue Anzahl der eigenständigen Angebote und den Preis pro Kunde mit Abrechnungsmodell. Zusammenfassung und Aktionen bleiben auch in schmalen oder niedrigen Fenstern sichtbar.

Alle Änderungen werden serverseitig geprüft. Fehler erscheinen im Formular, ohne dessen Eingaben zu verwerfen. Ein Kunden- oder Dienstleistungsarchiv entfernt keine Beziehungen. Mitarbeiter und Angebote können ebenfalls archiviert und wiederhergestellt werden. Historische Ansprechpartner bleiben lesbar; archivierte Mitarbeiter sind für neue Zuweisungen nicht auswählbar.

Websites werden als HTTP-/HTTPS-Adressen gespeichert und öffnen über einen Link in einem neuen Tab. Kundenlogos lassen sich als PNG, JPEG oder WebP (maximal 1 MiB) hochladen, in der Vorschau ansehen, ersetzen und entfernen. Der Upload prüft im Browser die Bildlesbarkeit und maximal 4096 × 4096 Pixel. Kundenliste und Kundendetail zeigen das gespeicherte Logo. Logos liegen als BLOB in derselben SQLite-Datenbank; Backup und Restore enthalten die Bilddaten automatisch. Änderungen an Website und Logo werden gemeinsam mit dem Kunden gespeichert; Abbrechen lässt die gespeicherten Daten unverändert.

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

Beim Anlegen eines Kunden sucht Pitchary mit Fetchary anhand der **Haupt-E-Mail** oder der eingetragenen Firmenwebsite automatisch nach einem Icon und speichert es als Kundenlogo. Ein manuell hochgeladenes Logo hat Vorrang. Die Haupt-E-Mail wird mit dem Rechnungsprofil geteilt und ist durchsuchbar. Details: [Kundenlogos](docs/customer-logos.md).

Die Mitarbeitertabelle in den Kundendetails zeigt E-Mail und LinkedIn in getrennten Spalten. Die Einstellungen sind in **Firma**, **Erkennung** und **Ordnerüberwachung** gegliedert. Ordnerpfade, Überwachungsstatus und manueller Scan stehen im eigenen Tab; Eingaben bleiben beim Tab-Wechsel erhalten.

Die linke Navigation bleibt auf Desktop an ihrer Position und ist auf die Fensterhöhe begrenzt. In niedrigen Fenstern scrollt das Menü intern; auf Mobil wird es oberhalb des Inhalts angezeigt. Der obere Header bleibt beim Scrollen sichtbar. Das Menü enthält Dashboard, Kunden, Dienstleistungen, Pipeline, Analytics, Rechnungen, Umsatz und Einstellungen. Eine zusätzliche Finanz-Subnavigation entfällt. Die Kundentabelle zeigt Name, Logo und den gespeicherten Status „Lead“ oder „Kunde“; die Website bleibt in den Kundendetails und der Bearbeitung verfügbar und kann weiterhin gesucht werden.

Jeder Kunde hat eine gemeinsame Detailansicht unter `#/customers/:id`: Logo, Website und Notizen, aktive/archivierte Ansprechpartner, Angebote mit Beziehungshistorie, Rechnungsprofil, Umsatzkennzahlen je Währung und Rechnungen mit Zahlungsstatus. Alte Finanzkunden-Links führen zu dieser Ansicht. **Umsatz** ist die separate Vergleichsübersicht im Hauptmenü; ihre Kundenlinks öffnen dieselbe Detailansicht. Gesamtumsatz, „Beste Kunden“ und „Höchste Kosten“ stehen auf Desktop in einer Dreierreihe, auf Mobil untereinander. Darunter folgt die Kundentabelle. Der Gesamtumsatz umfasst alle Einnahmenrechnungen über alle Jahre; die Ranglisten folgen dem Jahresfilter. Jede Rangliste enthält höchstens vier Einträge, gemeinsam über alle Währungen und nach Originalbeträgen ohne Umrechnung sortiert. Mehrere Währungen desselben Kunden/Lieferanten werden nominal addiert; gemischte Werte erhalten keinen einzelnen Währungscode, und die ursprüngliche Zusammensetzung bleibt als Tooltip bzw. Hinweis verfügbar.

Das Dashboard nutzt die gesamte Containerbreite. Direkt nach dem Titel steht der Finanzbereich mit Jahr-/Monatsfilter und sechs Finanzkennzahlen in einer Reihe auf Desktop. Das Monatsdiagramm liegt links, die beiden Überfälligkeitskarten rechts untereinander. Offene Einnahmen und Ausgaben stehen nebeneinander; schmale Fenster stapeln die Bereiche. Anschließend folgen die vier Angebotskennzahlen in einer Reihe über die volle Breite und die neuesten Angebote. Auf kompakten Fenstern stehen die Kennzahlen in zwei Spalten, auf Mobil untereinander. „Letzte Kontakte“ entfällt. „Aktuelle Pipeline“ entfällt; die Kennzahlen werden weiterhin aus den gespeicherten Angeboten berechnet. Finanzheader und Import-/Aktualisieren-Buttons entfallen im Dashboard. USD bleibt in den Finanzkennzahlen und im Diagramm ausgeblendet. Die Tabellen „Offene Einnahmen“ und „Offene Ausgaben“ zeigen alle offenen Rechnungen unabhängig von Währung und Rechnungsdatum, mit ihren Originalbeträgen. USD-Rechnungen bleiben auch in der Rechnungsverwaltung und im Umsatzbereich erhalten. Alte `#/finance`-Links führen zum Dashboard.

Die Pipeline nutzt die gesamte verfügbare Containerbreite und einen festen Bedienbereich für Titel, Suche, Tag-Auswahl, Status, Archivansicht und Angebotszähler mit Pfeilbuttons. Das Board scrollt darunter vertikal und horizontal innerhalb des verfügbaren Fensters. In kompakten Fenstern werden Titel und Filter platzsparend angeordnet; bei wenig Höhe bleiben zusätzliche Filter über ihren eigenen Scrollbereich erreichbar. Tag-Dropdowns passen sich dem sichtbaren Fenster an. Statusspalten sind mindestens 336 px breit und verteilen zusätzlichen Platz gleichmäßig, sobald alle sechs Phasen in das Fenster passen. Auf kleinen Mobilfenstern passen sie in die verfügbare Breite; bei Filterung bleibt eine einzelne Spalte 336 px breit. Karten trennen Kunde/Dienstleistung, Preis/Abrechnung und Kontakt/Verweildauer. Pro Karte wird eine nächste Aktion hervorgehoben. Weitere Phasen sind per horizontalem Scrollen oder über die Pfeilbuttons erreichbar; die Angebotsanzahl folgt Suche, Tags und Statusfilter.

Die Pipeline merkt sich Status- und Tagfilter im jeweiligen Browser. Die Auswahl bleibt bei Menüwechseln und nach Neuladen erhalten; gelöschte Tags werden ignoriert. Ein Link mit explizitem Status öffnet weiterhin die angegebene Phase.

`npm install` synchronisiert über `postinstall` die unveränderten gebauten CSS-/ESM-/Font-/Icon-Assets und Lizenzen nach `public/vendor/oj-designsystem/`. Der reproduzierbare Sync kann mit `npm run sync:designsystem` erneut ausgeführt werden; `package-lock.json` fixiert die Paketversion. Bei Installation mit `--ignore-scripts` ist dieser Befehl vor dem Start erforderlich. Das Designsystem wird nicht verändert. Jede dynamische View und jeder Dialog besitzt einen `initOJ()`-Cleanup, der vor dem Entfernen der Oberfläche aufgerufen wird.

## Datenmodell und fachliche Regeln

Billlys Funktionen sind unter **Dashboard**, **Rechnungen** und **Einstellungen** integriert: PDF-Import und Ordnerüberwachung, lokale Text-/OCR-Auslesung, optionale OpenAI-Erkennung, korrigierbare Rechnungsdaten, Zahlungsstatus, Ausgaben-Tags, Finanzübersicht und Kundenumsatz. Kunden und Ansprechpartner werden mit dem CRM geteilt. Migration 008 ergänzt ausschließlich Finanz-Tabellen. Einrichtung und API: [docs/finance.md](docs/finance.md). Vorhandene Daten übernehmen: [docs/billly-import.md](docs/billly-import.md). Interne Kunden-Zusammenführung: [docs/customer-merge.md](docs/customer-merge.md).

Unter **Einstellungen** lässt sich das Erkennungsmodell auswählen: GPT-4o Mini, GPT-4.1 Mini, GPT-4.1, GPT-6 Luna, GPT-6.1 Sol oder GPT-6 Astra. Speichern übernimmt die Auswahl für Rechnungserkennung und Kundenergänzung; „Schlüssel prüfen“ prüft auch eine noch nicht gespeicherte Auswahl. Die Firmenadresse ist ein einzeiliges Eingabefeld. Die Karte „Ordnerüberwachung“ und die Version aus `package.json` bleiben sichtbar; die Datenübernahme-Karte entfällt. Analytics zeigt weiterhin „Pitch → Zusage“, die Karte „Pitch → Entscheidung“ entfällt. In den Angebotsdetails bleiben sämtliche Statusnamen einschließlich „Angenommen“ einzeilig.

Migration 009 ergänzt `customers.customer_type`. Neue Einträge starten als Lead. Sobald eine wirksam zugeordnete Einnahmenrechnung vorhanden ist, wird der Eintrag dauerhaft zum Kunden; Ausgaben zählen nicht. Der Status bleibt nach Löschen oder Neuzuordnung einer Rechnung erhalten. Bestehende Einnahmenrechnungen einschließlich manueller Kategorie-/Kundenkorrekturen werden bei der Migration berücksichtigt. Beim Zusammenführen bleibt der stärkere Kundenstatus erhalten. Transaktionale Importe und Korrekturen klassifizieren anhand des endgültigen Ergebnisses, ohne vorübergehende Zwischenzuordnungen zu befördern.

Die sechs Kerntabellen sind `customers`, `employees`, `services`, `customer_services`, `customer_service_status_history` und `activities`. `pitch_channels` speichert registrierte Kanäle; `service_tags` und `service_tag_assignments` speichern Tags und deren Zuordnung zu Dienstleistungen. Schema-Versionen werden in `PRAGMA user_version` geführt. Migration 001 erstellt die Kerntabellen, Indizes und Integritätstrigger; 002 ergänzt die Angebotsarchivierung; 003 ergänzt `website`, `logo_mime` und `logo_data` bei Kunden. Bestehende Kunden erhalten eine leere Website und kein Logo. Migration 004 erweitert die Status-Constraints um `ghosted` und erhält alle Daten einschließlich Historie, Aktivitäten und Zeilenreihenfolge. Der Tabellenumbau erfolgt in einer Transaktion mit Foreign-Key-Prüfung vor dem Commit; danach wird die Foreign-Key-Erzwingung wieder aktiviert.

Migration 005 erlaubt das endgültige Löschen eines vollständigen Angebots samt Historie und Aktivitäten. Ein SQLite-Trigger entfernt dessen Ereignisse innerhalb derselben Transaktion. Einzelne Historien- und Aktivitätseinträge bleiben gegen Änderungen und Löschungen geschützt; die Migration erhält alle bestehenden Daten.

Migration 006 ersetzt die festen Kanal-Enums durch Foreign Keys auf `pitch_channels` und erhält alle Angebots-, Historien- und Aktivitätszeilen. Migration 007 ergänzt die Tag-Tabellen. Kanäle aus der JSON-Datei werden beim Start registriert; weitere Einträge benötigen keine zusätzliche Schema-Migration.

- IDs sind UUIDs. Kunden besitzen beliebig viele Mitarbeiter. Dienstleistungen können ohne Kunden existieren.
- Ein Angebot ist genau eine Kunden-Dienstleistungs-Beziehung. **Kein UNIQUE-Constraint** auf Kunde/Dienstleistung: wiederholte Aufträge sind unabhängig.
- Kontaktzuordnungen werden fachlich und über zusammengesetzte Foreign Keys bzw. einen Aktivitätstrigger abgesichert. Ein Mitarbeiter kann ausschließlich zum Kunden des Angebots gehören.
- Status: `open → pitched → accepted → done` oder `pitched → rejected`. Bei ausbleibender Rückmeldung ist `pitched → ghosted` möglich. `ghosted → accepted` oder `ghosted → rejected` erfasst eine spätere Entscheidung. `ghosted → pitched` und `rejected → pitched` erfordern eine Wiederaufnahmebegründung. `done` ist abgeschlossen. Andere Übergänge werden verweigert; ein neuer Auftrag erhält eine neue Beziehung.
- Bereits beim Anlegen wird `open` historisiert. Status und Historieneintrag werden gemeinsam in `BEGIN IMMEDIATE`/`COMMIT` gespeichert; Fehler rollen beide zurück. `status_since` markiert den Beginn der aktuellen Phase. Optional rückdatierte Statusereignisse dürfen nicht vor der aktuellen Phase oder in der Zukunft liegen.
- Der erste tatsächliche Pitch hält den zu diesem Zeitpunkt angebotenen Preis in `first_pitched_price_minor` fest. Vor dem Pitch ist dieses Feld NULL. Verhandlungen ändern nur den aktuellen Angebotspreis und erzeugen strukturierte `price_change`-Aktivitäten mit Preisfeld, altem und neuem Betrag.
- Die Zusage speichert separat `accepted_price_minor`; auch dessen Erfassung und spätere Änderungen werden protokolliert. Nach Zusage wird eine Preisänderung am vereinbarten Preis durchgeführt.
- Angebotspreise werden ausschließlich als nichtnegative **Integer-Cent** gespeichert. v1 unterstützt EUR, USD und GBP (je zwei Nachkommastellen), bis 1.000.000.000.000 Cent je Preis. Eingaben wie `1200,50` werden anhand der Ziffern verarbeitet. Währung und Abrechnungsmodell sind nach dem ersten Pitch festgeschrieben. Der ursprüngliche Pitch-Kanal kann über **Bearbeiten** in den Angebotsdetails auch danach korrigiert werden; Analytics und Kanalfilter verwenden den korrigierten Wert. Historische Kontaktaktivitäten behalten ihren eigenen Kanal.
- Abrechnung: `one_time`, `monthly`, `yearly`, `hourly`, `daily`. Standardkanäle: `linkedin`, `email`, `phone`, `meeting`, `internal_software`, `other`.
- Absagegründe werden als JSON mit `code` und optionaler `note` gespeichert: `budget`, `timing`, `competitor`, `no_need`, `no_response`, `other`. Die jeweilige Absage bleibt in der Historie erhalten, auch nach Wiederaufnahme.
- Kontaktaktivitäten: `pitch`, `follow_up`, `call`, `meeting`, `note`. Sie ändern keinen Status. Ein initialer Pitch ist zuerst über die Statusaktion zu erfassen. Zeitpunkte sind ISO-8601 mit Zeitzone, Speicherung in UTC, Anzeige in der Browser-Zeitzone.
- Historie und Aktivitäten sind append-only und zusätzlich durch SQLite-Trigger gegen reguläres UPDATE/DELETE geschützt. Archivierung erhält alle Geschäftsdaten. Foreign Keys, WAL und Busy Timeout (5 Sekunden) sind aktiv.
- In den Angebotsdetails löscht **Löschen** nach Bestätigung das gesamte Angebot inklusive Statushistorie, Kontakt- und Preisaktivitäten, auch bei archivierten Angeboten. Kunden, Dienstleistungen, Mitarbeiter und andere Angebote bleiben erhalten. Gelöschte Angebote werden nicht mehr in Analytics ausgewertet. Nach erfolgreichem Löschen öffnet sich die Pipeline; bei einem Fehler bleibt die Detailansicht erhalten.

## Pitch-Kanäle erweitern

Die gemeinsame Konfiguration liegt in [public/config/pitch-channels.json](public/config/pitch-channels.json). Backend-Validierung, Formulare, Aktivitäten und Analytics verwenden dieselben registrierten Kanäle. Zum Ergänzen einen Eintrag hinzufügen und den Server neu starten:

```json
{ "id": "referral", "label": "Empfehlung" }
```

`id` beginnt mit einem Kleinbuchstaben und darf Kleinbuchstaben, Ziffern und Unterstriche enthalten (maximal 64 Zeichen). `label` ist der sichtbare Name (maximal 80 Zeichen). Bestehende IDs beibehalten; sichtbare Namen können angepasst werden. Bereits registrierte Kanäle bleiben für gespeicherte Vorgänge erhalten. Ungültige/mehrfach vergebene IDs und leere Namen verhindern den Start mit einer erklärenden Fehlermeldung.

## Dienstleistungs-Tags

Unter **Dienstleistungen → Tags verwalten** werden Tags mit Name, optionaler Notiz und Farbe angelegt, bearbeitet oder gelöscht. Für die Eindeutigkeitsprüfung werden Namen normalisiert und in Kleinschreibung verglichen. Namen sind auf 80, Notizen auf 2000 Zeichen begrenzt; Farben verwenden `#RRGGBB`.

Tags können beim Anlegen/Bearbeiten einer Dienstleistung ausgewählt werden. In deren Details öffnet **Tags bearbeiten** die Zuweisung. Mehrere Dienstleistungen können dieselben Tags verwenden. Die Liste zeigt farbige Tags und unterstützt die Suche nach Tag-Namen; die Details zeigen zusätzlich die Notizen. Entfernen einer Zuweisung verändert den globalen Tag nicht. Löschen eines Tags entfernt nach Bestätigung alle Zuordnungen, einschließlich archivierter Dienstleistungen. Änderungen an Dienstleistung und Zuordnungen werden gemeinsam gespeichert oder vollständig zurückgerollt.

## Analytics-Definitionen

Filter beziehen sich auf eine **Angebotskohorte nach Anlagedatum in UTC**, einschließlich archivierter Vorgänge. Kunden, Dienstleistungen und ursprünglicher Pitch-Kanal sind zusätzlich filterbar. Der Aktivitätsbereich verwendet stattdessen den tatsächlichen Aktivitätszeitpunkt.

| Kennzahl                     | Definition                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Angelegt                     | Anzahl eigenständiger Angebote der Kohorte                                                                                    |
| Gepitcht                     | Mindestens ein `pitched`-Historieneintrag; ein Vorgang zählt einmal                                                           |
| Ghosted                      | Aktueller Status `ghosted`: keine Rückmeldung nach dem Pitch, ohne bestätigte Absage                                          |
| Gewonnen                     | Aktueller Status `accepted` oder `done`                                                                                       |
| Abgelehnt                    | Aktueller Status `rejected`                                                                                                   |
| Unentschieden                | Aktueller Status `open`, `pitched` oder `ghosted`                                                                             |
| Abschlussquote               | Gewonnen / (gewonnen + abgelehnt); ohne Entscheidungen NULL/„–“                                                               |
| Pitch → Zusage               | Durchschnitt vom ersten Pitch bis zur ersten Zusage, in Kalendertagen; nur Vorgänge mit beiden Ereignissen                    |
| Pitch → Entscheidung         | Durchschnitt vom ersten Pitch bis zur ersten Zusage oder Absage; nach Wiederaufnahme bleibt die erste Entscheidung maßgeblich |
| Angebotene Werte             | Summe der aktuellen Angebotspreise aller Angebote der Kohorte                                                                 |
| Ursprünglich gepitchte Werte | Summe der ursprünglichen Preise aller tatsächlich gepitchten Angebote                                                         |
| Vereinbarte Werte            | Summe der vereinbarten Preise aktuell gewonnener Angebote                                                                     |
| Ablehnungsgründe             | Aktueller Absagegrund aktuell abgelehnter Angebote; einmal pro Vorgang                                                        |

Performance je Kunde, Dienstleistung und Pitch-Kanal verwendet dieselben Zählregeln. Alle Werte werden **je Währung und Abrechnungsmodell getrennt** angezeigt. Monats-/Jahresbeträge sind Periodenwerte; Stunden-/Tagessätze werden nicht als Projektumsatz hochgerechnet. Wiederholte Statuswechsel vervielfachen keine Kennzahl.

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

Die gemeinsame Prettier-Konfiguration behält für `package.json` vier Leerzeichen bei. `npm run format:check` prüft diese Datei ebenfalls; lokal und in GitHub Actions gelten dieselben Regeln.

Die Node-Tests prüfen Mehrfachangebote, separate Historien, erzwungene Transaktionsfehler, Originalpreis, Ansprechpartner-Zuordnung (auch direkt in SQLite), Wiederaufnahme, ungültige Übergänge, Archive, Batch-Atomizität, Analytics, Filter, Persistenz nach Neustart, API-Schutz und Backup/Restore.

Browser-Tests verwenden separate temporäre SQLite-Datenbanken. Eine zweite unveränderte Demo-Fixture erzeugt reproduzierbare Ansichten mit festen UUIDs, fester Zeit für Verweildauern und definierter Zeitzone; produktive Daten werden nie verwendet. Chromium und WebKit prüfen den vollständigen UI-Ablauf, Suche/Filter, Mehrfachzuweisung, XSS-Text, Dialog-/Tastaturfokus, 1440px-/390px-Layouts und Axe-WCAG-Prüfungen aller sechs Bereiche und Detailansichten. Berichte, Screenshots und Fehler-Traces liegen unter `artifacts/`. Die lokale CI-Konfiguration führt dieselben Prüfungen aus.

## Umfang von v1

PDF-Rechnungen werden importiert und verwaltet; neue Rechnungsdokumente werden nicht erzeugt. Keine E-Mail-Anbindung, LinkedIn-Automatisierung, externes CRM-Syncing, komplexe Aufgabenverwaltung oder automatischen Wiedervorlagen. Externe Links zu manuell gepflegten Ansprechpartnerprofilen bleiben normale Links.
