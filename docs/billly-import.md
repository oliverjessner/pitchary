# Billly-Daten übernehmen

Pitchary kann Rechnungen und Kunden aus einer bestehenden Billly-SQLite-Datenbank übernehmen. Der Import öffnet die Quelle schreibgeschützt. Er liest keine E-Mail-Vorlagen, Google-Verbindungen, Signaturen oder API-Schlüssel.

Zuerst ohne Änderungen prüfen:

```sh
node scripts/import-billly.js --source "$HOME/Library/Application Support/com.oli.billly/billly.sqlite"
```

Ohne `--source` verwenden CLI und Import-API denselben automatisch erkannten Pfad. Billly nutzt den Tauri-App-Identifier `com.oli.billly`; zuerst wird dessen vorhandene Datenbank gewählt, danach gegebenenfalls der ältere Produktnamen-Ordner `Billly`. Wenn keine Quelle gefunden wird, zeigt der Standardpfad auf den Identifier-Ordner.

| Betriebssystem | Standardquelle                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| macOS          | `~/Library/Application Support/com.oli.billly/billly.sqlite`                                       |
| Windows        | `%APPDATA%\com.oli.billly\billly.sqlite`                                                           |
| Linux          | `$XDG_DATA_HOME/com.oli.billly/billly.sqlite`, sonst `~/.local/share/com.oli.billly/billly.sqlite` |

Die Ausgabe enthält ausschließlich Anzahlen, Schema-Version, PDF-Verfügbarkeit und Namen verfügbarer, nicht geheimer Einstellungen. Die Prüfung öffnet oder verändert keine Pitchary-Datenbank.

Die geprüften Daten übernehmen:

```sh
node scripts/import-billly.js --source "$HOME/Library/Application Support/com.oli.billly/billly.sqlite" --apply
```

`--apply` erstellt zuerst ein vollständiges SQLite-Backup der vorhandenen Zieldatenbank, bevor Pitchary-Migrationen oder Import-Schreibzugriffe beginnen. Der Pfad steht in der Ausgabe. Mit `--database /absoluter/pfad/pitchary.sqlite` lässt sich eine andere Zieldatenbank verwenden. Quelle und Ziel dürfen nicht dieselbe Datei sein.

## Übernommene Daten

- Einnahmen und Ausgaben mit Rechnungsnummer, Rechnungs- und Fälligkeitsdatum, Währung, Netto-, Steuer- und Gesamtbetrag.
- Zahlungsstatus und Bezahlt-Datum, sowie das historische Versanddatum als reine Rechnungsinformation.
- Ausgelesener Text, strukturiertes Extraktions-JSON, Erkennungswert, Sprache und Rechnungs-Tags.
- Manuelle Korrekturen als getrennte, zurücksetzbare Korrekturen über den ursprünglichen Extraktionswerten.
- Bereits bezahlte Altrechnungen mit unbekanntem Zahlungsdatum behalten ein leeres Datum. Der Import ergänzt kein Zahlungsdatum; neu gesetzte Zahlungen verwenden weiterhin die normale Datumsregel.
- Kunden, Rechnungsadresse und allgemeine Kontaktadresse sowie Ansprechpersonen. Bestehende CRM-Kunden werden über normalisierte Namen wiederverwendet; vorhandene Namen und ausgefüllte Kontaktdaten bleiben erhalten. Kontaktadressen allein aktivieren keine E-Mail-Funktion.
- Vorhandene PDF-Dateien bis 20 MiB werden nach Prüfung des PDF-Dateikopfes in der Zieldatenbank gesichert. Bei fehlenden, ungültigen oder größeren Dateien bleiben die Rechnungsdaten und der ursprüngliche Dateipfad erhalten; die Ausgabe zählt diese Fälle separat.

Dezimalbeträge werden direkt aus Text in ganze Cent umgerechnet. Negative Einnahmen bleiben als Gutschriften erhalten. Ausgaben verwenden positive Kostenbeträge. Ungültige Beträge, Datumswerte oder Rechnungsschemata brechen den Import ab, bevor Rechnungs- oder Kundendaten geschrieben werden.

Ein stabiler Billly-Quellschlüssel verhindert doppelte Rechnungen. Bereits übernommene Rechnungen werden bei erneuter Ausführung übersprungen; spätere Korrekturen in Pitchary bleiben erhalten. Der Import schreibt alle Änderungen in einer Transaktion. Die ursprüngliche Billly-Datenbank und ihre PDFs bleiben bestehen.

Die interne Import-API unterstützt zusätzlich `importBillly(source, finance, {dryRun: false, includeLogs: true})` für vorhandene Finanz-Verarbeitungsprotokolle. E-Mail-/OAuth-Ereignisse werden ausgelassen und Schlüssel-/Token-Muster in Meldungen maskiert. Quell-IDs und Zeitpunkte bleiben erhalten; wiederholte Importe überschreiben keine bestehenden Protokolle.

## Einstellungen

Ordner- und Firmenangaben werden beim Prüfen als verfügbare Einstellungen erkannt. Der Import aktiviert weder Ordnerüberwachung noch externe KI automatisch. Ordner, Firmenprofil und gegebenenfalls ein neuer API-Schlüssel werden anschließend in Pitcharys Einstellungen eingerichtet. Zugangsdaten aus Billly werden nicht gelesen oder kopiert.

## Sicherung zurückspielen

Das vor dem Import erzeugte Backup lässt sich über Pitcharys bestehenden Wiederherstellungsablauf verwenden. Vor einer Wiederherstellung den Server stoppen und auch den aktuellen Zustand sichern. Die Billly-Quelldaten sind für einen erneuten Import weiterhin verfügbar.
