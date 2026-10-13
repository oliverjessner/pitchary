# Finanzen aus Billly

Pitchary integriert Billlys PDF-Rechnungsverwaltung in denselben lokalen Server und dieselbe SQLite-Datenbank. Der Finanzbereich verwendet die bestehenden CRM-Kunden und Ansprechpartner. E-Mail-Versand, Vorlagen und Gmail/OAuth sind ausgeschlossen.

## Benutzung

- **Dashboard** nutzt die gesamte Containerbreite. Der Finanzbereich steht direkt nach dem Titel, vor den vier Angebotskennzahlen und den neuesten Angeboten: Jahr/Monat, sechs Monats-/Jahreskennzahlen in einer Reihe und anschließend das Monatsdiagramm links mit zwei Überfälligkeitskarten rechts untereinander. Offene Einnahmen und Ausgaben stehen nebeneinander. Auf schmalen Fenstern werden die Bereiche gestapelt. Ein zusätzlicher Finanzheader sowie Import-/Aktualisieren-Buttons entfallen dort; PDF-Import bleibt unter **Rechnungen** verfügbar. USD ist ausschließlich in dieser Übersicht ausgeblendet; USD-Rechnungen und Kundenumsätze bleiben gespeichert und zugänglich. Monatswerte folgen dem Rechnungsdatum, unabhängig vom Zahlungsstatus. Alte `#/finance`-Links führen mit ihren Datumsfiltern zum Dashboard.
- **Rechnungen** bietet Einnahmen/Ausgaben, Suche, Jahres- und Statusfilter, sortierbare Spalten sowie offen/bezahlt. Beim Bezahlen wird das heutige Datum in Europe/Vienna gesetzt; beim Wiederöffnen wird es gelöscht.
- Eine **PDF importieren** oder in **Einstellungen** getrennte lokale Rechnungsordner angeben. Der Server liest PDFs bis zu zwei Unterordnerebenen, beobachtet neue/geänderte Dateien und prüft zusätzlich alle zehn Sekunden. Symlinks werden nicht verfolgt. Dateien müssen mindestens 700 ms unverändert sein.
- Rechnungsdetails erlauben Korrekturen, Zahlungsdatum, Kategorie, Ausgaben-Tags und die Zuordnung zu einem CRM-Kunden sowie einem seiner Angebote. Einzelne oder alle Korrekturen sind zurücksetzbar. Erneute Verarbeitung erhält Korrekturen, Zahlungsstatus und Links.
- **Umsatz** ist ein eigener Eintrag im Hauptmenü. Gesamtumsatz, „Beste Kunden“ und „Höchste Kosten“ stehen in einer Dreierreihe auf Desktop und untereinander auf Mobil; darunter folgt die Kundentabelle über alle Jahre. Jede Rangliste enthält insgesamt höchstens vier Kunden/Lieferanten ohne getrennte Währungsgruppen. Originalbeträge werden auf ausdrücklichen Wunsch ohne Umrechnung verglichen und bei demselben Kunden/Lieferanten nominal addiert. Gemischte Summen haben keinen einzelnen Währungscode; Hinweis und Tooltip erhalten die Währungszusammensetzung. Der Jahresfilter gilt ausschließlich für die Ranglisten; die Gesamtumsatz-Karte umfasst alle Einnahmenrechnungen über alle Jahre. Die Kundentabelle trennt ihre Währungen weiterhin. Kundennamen öffnen dieselbe gemeinsame Kundendetailansicht wie **Kunden**. Dort stehen Angebote, Kontakte und Rechnungen zusammen; Rechnungsadresse, Kontaktadresse und CRM-Ansprechpartner sind bearbeitbar. Die KI-Anreicherung aus der letzten Einnahmen-Rechnung ergänzt ausschließlich leere Profilfelder.
- **PDF öffnen** verwendet die gespeicherte Kopie. Löschen entfernt den Datensatz samt Korrekturen/Protokollen, erhält die Quelldatei und verhindert den sofortigen Neuimport unveränderter Dateien. Geänderte Quelldateien werden wieder eingelesen.

Die Karte zur Datenübernahme wurde aus den Einstellungen entfernt. Der bestehende CLI-Import bleibt verfügbar: `npm run import:billly -- --source /pfad/billly.sqlite` zur Prüfung, danach mit `--apply` zum Import. Details: [Billly-Import](billly-import.md).

## PDF, OCR und OpenAI

PDFs bis 20 MiB werden in SQLite gespeichert; Backups schließen die Dokumente ein. Text wird lokal mit Poppler (`pdftotext`) gelesen. Bild-PDFs werden mit `pdftoppm` rasterisiert und mit Tesseract erkannt; OCR unterstützt bis zu 100 Seiten. Deutsch/Englisch werden verwendet, soweit die installierten Tesseract-Sprachdaten vorhanden sind; Englisch ist der Rückfall.

Auf macOS: `brew install poppler tesseract`; `tesseract-lang` ergänzt weitere Sprachen. Die Einstellungen zeigen verfügbare Werkzeuge. Manuelle Korrekturen benötigen keinen API-Schlüssel.

Mit einem gespeicherten OpenAI-Schlüssel werden lokal erkannte Texte an das ausgewählte Erkennungsmodell übergeben. Eigener Firmenname, E-Mail und Anschrift werden vor Textspeicherung und Anfrage entfernt. Die PDF bleibt lokal. Die Extraktion verwendet ein striktes JSON-Schema, prüft Datum/Beträge/Konfidenz und speichert Roh-JSON sowie Notizen. Dokumentinhalte werden ausschließlich als Daten behandelt. Grundlage: [offizielle OpenAI-Dokumentation zu Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

In **Einstellungen** stehen [GPT-4o Mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [GPT-4.1 Mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) und [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) zur Auswahl. Die Auswahl wird unter `recognition_model` gespeichert und gilt für neue Erkennungsanfragen, erneutes Verarbeiten und Kundenergänzung. Ohne gespeicherte Auswahl bleibt GPT-4o Mini der Standard. Die [offizielle GPT-6-Anleitung](https://developers.openai.com/api/docs/guides/latest-model) bestimmt die Anfrageparameter: Luna verwendet `none`, Sol/Astra `low` ohne `temperature`; die drei älteren Modelle behalten ihre bisherigen Parameter. Vorhandene Rechnungsdaten ändern sich erst durch erneutes Verarbeiten. „Schlüssel prüfen“ kontrolliert den Zugriff auf das im Formular ausgewählte Modell, auch vor dem Speichern; der tatsächliche Modellzugriff hängt vom OpenAI-Projekt ab.

Die Version in **Einstellungen** stammt direkt aus `package.json`. Die Firmenadresse verwendet ein einzeiliges Textfeld; vorhandene mehrzeilige Adressen werden lesbar mit Kommas dargestellt und beim Speichern anderer unveränderter Angaben nicht umformatiert.

Ohne Schlüssel bleiben PDF und Text gespeichert; die Erkennung ist ausstehend. Fehler erscheinen im Verarbeitungsprotokoll und können mit **Erneut verarbeiten** wiederholt werden. Bei fehlender Quelldatei bleiben Datensatz und PDF-Kopie erhalten.

Der Schlüssel wird verschlüsselt gespeichert und niemals an die Oberfläche zurückgegeben. Die Entschlüsselungsdatei liegt neben der Datenbank (`DATENBANK.sqlite.finance-key`, Berechtigung 0600), außerhalb des SQLite-Backups. Nach Restore unter neuem Dateinamen oder Umzug den Schlüssel erneut eingeben. Rechnungen und nicht geheime Einstellungen bleiben im Backup enthalten.

## Datenregeln

Migration 008 ergänzt `finance_invoices`, `finance_invoice_overrides`, `finance_processing_logs`, `finance_customer_profiles` und `finance_settings`. Bestehende CRM-Tabellen bleiben erhalten. Inhalts-Hashes erkennen gleiche PDFs innerhalb einer Kategorie; Umbenennen aktualisiert den Quellpfad.

Migration 009 speichert `customer_type` als `lead` oder `customer`. Wirksam zugeordnete Einnahmenrechnungen befördern den Kundenstatus dauerhaft; Ausgaben nicht. Manuelle Kategorie-/Kundenkorrekturen werden berücksichtigt. Finanztransaktionen klassifizieren erst das endgültige Ergebnis, und Kunden-Zusammenführungen erhalten den stärkeren Typ. Rechnungs-Löschung oder Neuzuordnung setzt einen bereits bestätigten Kunden nicht zurück auf Lead.

Beträge liegen als vorzeichenbehaftete ganze Cent vor. Einnahmen-Gutschriften dürfen negativ sein; Billly-Ausgaben werden beim Import/Erkennen als positive Kosten normalisiert. Summen werden ausschließlich je Währung berechnet. Rechnungen ohne Datum erscheinen in der Liste, tragen aber nicht zu Monats-/Jahressummen bei. Kennzahlen verwenden wirksame Werte einschließlich Korrekturen. Das Löschen eines Angebots entfernt dessen Rechnungslink; die Rechnung bleibt erhalten.

## REST-Endpunkte

Alle Pfade liegen unter `/api/finance` und verwenden die lokalen Host-/Origin-Schutzregeln des CRM.

| Funktion            | Endpunkte                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Übersicht           | `GET /dashboard?year=2026&month=10`                                                                                                                 |
| Umsatz/Ranglisten   | `GET /revenue-overview?year=2026` (nominale Gesamtsumme über alle Jahre und maximal vier Jahresranglisten-Einträge pro Kategorie, ohne Umrechnung)  |
| Rechnungen          | `GET /invoices`, `GET/PATCH/DELETE /invoices/:id`                                                                                                   |
| Korrekturen         | `POST /invoices/:id/reset` mit `{field:"total_amount_minor"}` oder `{}`                                                                             |
| Dokument/Protokoll  | `GET /invoices/:id/file`, `GET /invoices/:id/logs`                                                                                                  |
| Import/Verarbeitung | `POST /import` mit `{category,file_name,data}` (PDF-Base64), `POST /invoices/:id/reprocess`, `POST /scan`                                           |
| Kunden              | `GET /customers`, `GET/PATCH /customers/:id`, `POST /customers/:id/enrich`                                                                          |
| Einstellungen       | `GET/PATCH /settings` (Modellauswahl mit `{model}`), `POST /settings/test-key` mit optionalen Feldern `api_key` und `model`, `DELETE /settings/key` |
| Billly-Import       | `GET /billly/inspect?source=/pfad/billly.sqlite`, `POST /billly/import` mit `{source}`                                                              |

Rechnungsfilter: `category=revenue|payable`, `year`, `status=open|paid|overdue`, `search`, `customer_id`, `customer_service_id`, `sort` und `order=asc|desc`. Rechnungsantworten enthalten wirksame Felder, `original`, `overrides`, `tags` und `has_file`, keine PDF-Bytes in JSON. PDF-Zugriff erfolgt ausschließlich über die Rechnungs-ID.
