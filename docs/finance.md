# Finanzen aus Billly

Pitchary integriert Billlys PDF-Rechnungsverwaltung in denselben lokalen Server und dieselbe SQLite-Datenbank. Der Finanzbereich verwendet die bestehenden CRM-Kunden und Ansprechpartner. E-Mail-Versand, Vorlagen und Gmail/OAuth sind ausgeschlossen.

## Benutzung

- **Finanzen** zeigt Einnahmen, Ausgaben und Gewinn für Monat und Jahr, überfällige Rechnungen, offene Posten, die fünf umsatzstärksten Kunden und höchsten Kosten je Währung sowie die letzten zwölf Monate im Diagramm. Monatswerte folgen dem Rechnungsdatum, unabhängig vom Zahlungsstatus.
- **Rechnungen** bietet Einnahmen/Ausgaben, Suche, Jahres- und Statusfilter, sortierbare Spalten sowie offen/bezahlt. Beim Bezahlen wird das heutige Datum in Europe/Vienna gesetzt; beim Wiederöffnen wird es gelöscht.
- Eine **PDF importieren** oder in **Einstellungen** getrennte lokale Rechnungsordner angeben. Der Server liest PDFs bis zu zwei Unterordnerebenen, beobachtet neue/geänderte Dateien und prüft zusätzlich alle zehn Sekunden. Symlinks werden nicht verfolgt. Dateien müssen mindestens 700 ms unverändert sein.
- Rechnungsdetails erlauben Korrekturen, Zahlungsdatum, Kategorie, Ausgaben-Tags und die Zuordnung zu einem CRM-Kunden sowie einem seiner Angebote. Einzelne oder alle Korrekturen sind zurücksetzbar. Erneute Verarbeitung erhält Korrekturen, Zahlungsstatus und Links.
- **Kundenumsatz** zeigt Rechnungsanzahl, erste/letzte Rechnung, Umsatz und Monatsdurchschnitt je Währung. Rechnungsadresse, Kontaktadresse und CRM-Ansprechpartner sind dort bearbeitbar. Die KI-Anreicherung aus der letzten Einnahmen-Rechnung ergänzt ausschließlich leere Profilfelder.
- **PDF öffnen** verwendet die gespeicherte Kopie. Löschen entfernt den Datensatz samt Korrekturen/Protokollen, erhält die Quelldatei und verhindert den sofortigen Neuimport unveränderter Dateien. Geänderte Quelldateien werden wieder eingelesen.

Bestehende Billly-Daten können unter **Einstellungen → Billly-Daten übernehmen** nach einer Zusammenfassung und Sicherung importiert werden. Alternativ: `npm run import:billly -- --source /pfad/billly.sqlite` zur Prüfung, danach mit `--apply` zum Import. Details: [Billly-Import](billly-import.md).

## PDF, OCR und OpenAI

PDFs bis 20 MiB werden in SQLite gespeichert; Backups schließen die Dokumente ein. Text wird lokal mit Poppler (`pdftotext`) gelesen. Bild-PDFs werden mit `pdftoppm` rasterisiert und mit Tesseract erkannt; OCR unterstützt bis zu 100 Seiten. Deutsch/Englisch werden verwendet, soweit die installierten Tesseract-Sprachdaten vorhanden sind; Englisch ist der Rückfall.

Auf macOS: `brew install poppler tesseract`; `tesseract-lang` ergänzt weitere Sprachen. Die Einstellungen zeigen verfügbare Werkzeuge. Manuelle Korrekturen benötigen keinen API-Schlüssel.

Mit einem gespeicherten OpenAI-Schlüssel werden lokal erkannte Texte an `gpt-4o-mini` übergeben. Eigener Firmenname, E-Mail und Anschrift werden vor Textspeicherung und Anfrage entfernt. Die PDF bleibt lokal. Die Extraktion verwendet ein striktes JSON-Schema, prüft Datum/Beträge/Konfidenz und speichert Roh-JSON sowie Notizen. Dokumentinhalte werden ausschließlich als Daten behandelt. Grundlage: [offizielle OpenAI-Dokumentation zu Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

Ohne Schlüssel bleiben PDF und Text gespeichert; die Erkennung ist ausstehend. Fehler erscheinen im Verarbeitungsprotokoll und können mit **Erneut verarbeiten** wiederholt werden. Bei fehlender Quelldatei bleiben Datensatz und PDF-Kopie erhalten.

Der Schlüssel wird verschlüsselt gespeichert und niemals an die Oberfläche zurückgegeben. Die Entschlüsselungsdatei liegt neben der Datenbank (`DATENBANK.sqlite.finance-key`, Berechtigung 0600), außerhalb des SQLite-Backups. Nach Restore unter neuem Dateinamen oder Umzug den Schlüssel erneut eingeben. Rechnungen und nicht geheime Einstellungen bleiben im Backup enthalten.

## Datenregeln

Migration 008 ergänzt `finance_invoices`, `finance_invoice_overrides`, `finance_processing_logs`, `finance_customer_profiles` und `finance_settings`. Bestehende CRM-Tabellen bleiben erhalten. Inhalts-Hashes erkennen gleiche PDFs innerhalb einer Kategorie; Umbenennen aktualisiert den Quellpfad.

Beträge liegen als vorzeichenbehaftete ganze Cent vor. Einnahmen-Gutschriften dürfen negativ sein; Billly-Ausgaben werden beim Import/Erkennen als positive Kosten normalisiert. Summen werden ausschließlich je Währung berechnet. Rechnungen ohne Datum erscheinen in der Liste, tragen aber nicht zu Monats-/Jahressummen bei. Kennzahlen verwenden wirksame Werte einschließlich Korrekturen. Das Löschen eines Angebots entfernt dessen Rechnungslink; die Rechnung bleibt erhalten.

## REST-Endpunkte

Alle Pfade liegen unter `/api/finance` und verwenden die lokalen Host-/Origin-Schutzregeln des CRM.

| Funktion            | Endpunkte                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Übersicht           | `GET /dashboard?year=2026&month=10`                                                                       |
| Rechnungen          | `GET /invoices`, `GET/PATCH/DELETE /invoices/:id`                                                         |
| Korrekturen         | `POST /invoices/:id/reset` mit `{field:"total_amount_minor"}` oder `{}`                                   |
| Dokument/Protokoll  | `GET /invoices/:id/file`, `GET /invoices/:id/logs`                                                        |
| Import/Verarbeitung | `POST /import` mit `{category,file_name,data}` (PDF-Base64), `POST /invoices/:id/reprocess`, `POST /scan` |
| Kunden              | `GET /customers`, `GET/PATCH /customers/:id`, `POST /customers/:id/enrich`                                |
| Einstellungen       | `GET/PATCH /settings`, `POST /settings/test-key` mit `{api_key}` oder `{}`, `DELETE /settings/key`        |
| Billly-Import       | `GET /billly/inspect?source=/pfad/billly.sqlite`, `POST /billly/import` mit `{source}`                    |

Rechnungsfilter: `category=revenue|payable`, `year`, `status=open|paid|overdue`, `search`, `customer_id`, `customer_service_id`, `sort` und `order=asc|desc`. Rechnungsantworten enthalten wirksame Felder, `original`, `overrides`, `tags` und `has_file`, keine PDF-Bytes in JSON. PDF-Zugriff erfolgt ausschließlich über die Rechnungs-ID.
