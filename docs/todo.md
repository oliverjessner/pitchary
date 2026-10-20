# Codex-Prompt: Pitchary – PDF-Rechnungserstellung und EU-E-Rechnungen

## Ziel

Erweitere das bestehende Projekt https://github.com/oliverjessner/pitchary um eine vollständig integrierte Rechnungserstellung.

Pitchary soll Rechnungen aus vorhandenen Kundendaten, Dienstleistungen und Angeboten erstellen und als klassische PDF-Rechnung sowie als strukturierte E-Rechnung im europäischen Standard EN 16931 (UBL 2.1) exportieren können.

**Besonders wichtig: Selbst erstellte Rechnungen dürfen niemals durch OCR oder KI analysiert werden. Alle Rechnungsdaten sind bereits strukturiert in der Datenbank vorhanden und werden direkt übernommen.**

Implementiere die Funktion vollständig, einschließlich Backend, Datenbankmigrationen, Frontend, PDF- und XML-Generierung sowie automatisierter Tests.

Arbeite selbstständig. Untersuche zunächst die bestehende Architektur und verwende vorhandene Komponenten und Datenmodelle wieder. Keine unnötige Neustrukturierung des Projekts.

## 1. Bestehende Architektur untersuchen

Pitchary verwendet unter anderem:

- Node.js 26 mit nativen ES-Modulen
- Fastify
- SQLite über `node:sqlite`
- Tauri 2 für die Desktop-Anwendung
- Vanilla JavaScript, HTML und CSS
- `oj-designsystem`

Prüfe insbesondere:

- `src/business/finance.js`
- `src/business/finance-settings.js`
- `src/business/invoice-processor.js`
- `src/database/finance-repository.js`
- `src/database/migrations/`
- `src/api/finance-routes.js`
- `src/api/finance-processing-routes.js`
- `src/server/app.js`
- `public/js/finance.js`
- `public/js/offer-form.js`
- Die vorhandenen Finanz- und UI-Tests

Die Tabelle `finance_invoices` enthält bereits Rechnungsdaten, Kunden- und Angebotsverknüpfungen sowie PDF-Daten.

Die bestehende Rechnungsverwaltung und ihre Statistiken müssen weiterverwendet werden.

Finde eine saubere additive Architektur, die bestehende Daten und APIs nicht beschädigt.

## 2. Zwei unterschiedliche Rechnungsquellen

Unterscheide künftig explizit zwischen:

**A. Importierte Rechnungen**

- Rechnungen stammen von externen PDF-Dateien.
- Bestehender Dateiimport und Folder-Watcher bleiben erhalten.
- Textextraktion, OCR und optionale KI-Analyse bleiben wie bisher möglich.
- Manuelle Korrekturen der erkannten Rechnungsdaten bleiben möglich.

**B. Selbst erstellte Rechnungen**

- Rechnungen werden innerhalb von Pitchary erstellt.
- Alle Daten werden aus SQLite und den Eingaben des Rechnungsformulars übernommen.
- Es erfolgt keine OCR.
- Es erfolgt keine Textextraktion.
- Es erfolgt kein OpenAI-Aufruf.
- Es erfolgt keine automatische Klassifikation.
- Es erfolgt kein Aufruf der bestehenden Rechnungsverarbeitungspipeline.
- Ein OpenAI-API-Key ist für die Rechnungserstellung niemals erforderlich.

Implementiere eine klare Herkunftskennzeichnung, beispielsweise `origin = imported | generated`.

Die bisherige `ingestion_status`-Logik darf nicht missbraucht werden, um Entwurfs- oder Ausstellungszustände abzubilden.

Für selbst erzeugte Rechnungen müssen Aktionen wie „Erneut auslesen“ oder „OCR wiederholen“ sowohl im Frontend als auch im Backend unterbunden werden.

## 3. Rechnungserstellung

Ergänze die bestehende Rechnungsverwaltung um „Neue Rechnung“.

Die Funktion soll aus drei Kontexten aufrufbar sein:

1. Direkt aus der Rechnungsübersicht.
2. Aus einem bestehenden Kundenprofil.
3. Aus einem angenommenen Angebot.

Bei vorhandener Kundenauswahl werden die verfügbaren Daten automatisch übernommen.

Bei einem angenommenen Angebot zusätzlich:

- Kunde
- Dienstleistung
- Vereinbarter Preis
- Währung
- Zugehörige Angebots-ID

Alle Werte sollen im Rechnungsentwurf bearbeitet werden können, ohne die ursprünglichen CRM-Daten zu verändern.

### Rechnungsfelder

Unterstütze mindestens:

**Rechnungskopf**

- Rechnungsnummer
- Rechnungsdatum
- Leistungsdatum oder Leistungszeitraum
- Fälligkeitsdatum
- Referenz auf ein Angebot, sofern vorhanden
- Bestell- beziehungsweise Kundenreferenz, sofern vorhanden
- Währung

**Rechnungsaussteller**

- Firmenname
- Vollständige Anschrift
- E-Mail-Adresse
- UID-/USt-IdNr., sofern vorhanden oder erforderlich
- Weitere relevante Unternehmenskennzeichen
- IBAN
- BIC, sofern erforderlich
- Zahlungsbedingungen
- Optionales Firmenlogo

**Empfänger**

- Firmen- beziehungsweise Kundenname
- Rechnungsadresse
- E-Mail-Adresse
- UID-/USt-IdNr., sofern vorhanden oder erforderlich
- Optionale Empfängerreferenz

**Rechnungspositionen**

- Freitextbeschreibung
- Menge
- Einheit
- Einzelpreis
- Steuerkategorie
- Steuersatz
- Nettobetrag
- Steuerbetrag
- Gesamtbetrag

Beliebig viele Positionen müssen unterstützt werden.

Bestehende Dienstleistungen sollen auswählbar sein, aber auch freie Positionen müssen möglich sein.

### Steuerbehandlung

Unterstütze eine explizite Konfiguration für mindestens:

- Reguläre Umsatzsteuer
- Steuerfreie beziehungsweise befreite Leistungen mit korrektem Grund
- Kleinunternehmerregelung
- Reverse Charge

Diese Fälle dürfen nicht allein anhand eines Steuersatzes von 0 % unterschieden werden.

Steuerkategorie, anwendbare Steuersätze, notwendige Kennzeichen und Erläuterungstexte müssen fachlich korrekt abgebildet werden.

Keine automatische steuerrechtliche Einstufung allein aufgrund des Kundenlandes vornehmen.

Fehlende Pflichtangaben müssen vor der Ausstellung angezeigt werden.

## 4. Unternehmensdaten in den Einstellungen

Die Firmeneinstellungen enthalten bereits Grunddaten wie Name, E-Mail und Adresse.

Erweitere diese um die für die Rechnungserstellung erforderlichen Angaben.

Die Einstellungen sollen als zentrale Datenquelle für den Rechnungsaussteller dienen.

Einmal eingegebene Unternehmensdaten dürfen nicht bei jeder Rechnung erneut erforderlich sein.

Ergänze passende Felder für Zahlungsinformationen, Steuerkennzeichen, Standardzahlungsziel, Standardwährung und optionales Firmenlogo.

Nutze die bestehenden Konventionen zur lokalen Speicherung.

## 5. Datenmodell und Rechnungsentwürfe

Implementiere ein versionierbares internes Rechnungsmodell als Single Source of Truth.

PDF und XML müssen aus demselben fachlichen Rechnungsobjekt generiert werden.

Vermeide getrennte Berechnungslogik für beide Formate.

### Entwürfe

Rechnungsentwürfe sollen:

- Angelegt werden können
- Gespeichert werden können
- Bearbeitbar bleiben
- Gelöscht werden können
- Noch keine endgültige Rechnungsnummer verbrauchen
- Nicht in den Umsatz- und Gewinnstatistiken erscheinen
- Nicht als offene Forderungen zählen

Nutze hierfür eine saubere Trennung in der Datenbank. Prüfe, ob eigene Entwurfstabellen oder eine additive Erweiterung der bestehenden Struktur besser geeignet sind.

### Ausgestellte Rechnungen

Beim Ausstellen:

1. Alle Pflichtfelder prüfen.
2. Beträge und Steuern berechnen.
3. Eine eindeutige Rechnungsnummer vergeben.
4. Einen vollständigen unveränderlichen Datensnapshot erzeugen.
5. PDF und UBL-XML aus diesem Snapshot erstellen.
6. Dokumente und strukturierte Daten dauerhaft speichern.
7. Die ausgestellte Rechnung in die bestehende Einnahmenverwaltung integrieren.

Rechnungsnummern müssen innerhalb des konfigurierten Nummernkreises eindeutig vergeben werden.

Standardformat beispielsweise `2026-0001`, konfigurierbar.

Die Nummernvergabe muss transaktionssicher sein. Gleichzeitige Ausstellungsversuche dürfen keine identischen Nummern erzeugen.

Schlägt die Ausstellung fehl, darf keine teilweise ausgestellte Rechnung zurückbleiben.

Nach Ausstellung dürfen rechtlich relevante Rechnungsdaten und gespeicherte Originaldokumente nicht stillschweigend überschrieben werden.

Zahlungsstatus und Zahlungsdatum müssen weiterhin aktualisierbar bleiben.

Für eine spätere Stornierungs- beziehungsweise Gutschriftenfunktion eine passende Architektur vorsehen. Bereits ausgestellte Rechnungen dürfen nicht über die bisherige normale Löschfunktion endgültig entfernt werden.

Kundenänderungen im CRM dürfen bereits ausgestellte Rechnungen nicht beeinflussen.

## 6. Beträge und Rundung

Nutze die vorhandene Konvention, Geldbeträge als Integer in kleinsten Währungseinheiten zu speichern.

Vermeide Floating-Point-Fehler bei Rechnungsbeträgen.

Mengen und Steuersätze müssen mit geeigneter Dezimal- beziehungsweise Festkommaarithmetik verarbeitet werden.

Definiere eine zentrale, dokumentierte Rundungsstrategie.

Netto, Umsatzsteuer und Brutto müssen rechnerisch konsistent sein.

Erstelle Tests für:

- Mehrere Rechnungspositionen
- Unterschiedliche Steuersätze
- Mengen mit Nachkommastellen
- Steuerbefreiung
- Reverse Charge
- Rundungsgrenzfälle
- Große Beträge
- Ungültige Eingaben

PDF, XML und Datenbank müssen exakt dieselben Rechnungsbeträge enthalten.

## 7. Klassische PDF-Rechnung

Implementiere eine hochwertige PDF-Generierung direkt im lokalen Node.js-Backend.

Evaluiere PDFKit als bevorzugte Library. Falls eine Alternative besser zur bestehenden Architektur passt, begründe die Entscheidung.

Anforderungen:

- DIN A4
- Hochwertiges, minimalistisches Layout
- Firmenlogo optional
- Unternehmens- und Empfängerdaten
- Deutlich sichtbare Rechnungsnummer
- Rechnungsdatum, Leistungsdatum und Zahlungsziel
- Positionstabelle
- Summenübersicht
- Steuerangaben
- Zahlungsinformationen
- Optionaler Fußtext
- Automatische Seitenumbrüche
- Unterstützung längerer Positionen und mehrseitiger Rechnungen
- Saubere Darstellung von Umlauten und Sonderzeichen
- Geeignete eingebettete Schriftarten

Das Design soll professionell und ruhig wirken und optisch zu Pitchary passen.

Vermeide unnötige Farbakzente, dekorative Elemente oder auffällige Schatten.

Verwende keine externe Cloud-PDF-API.

Keine Abhängigkeit von einer zusätzlich installierten Browser- oder Office-Anwendung zur PDF-Erzeugung.

Stelle sicher, dass benötigte Libraries und Assets auch im gebündelten Tauri-Release verfügbar sind.

### PDF-Vorschau

Während der Erstellung soll eine PDF-Vorschau verfügbar sein.

Die Vorschau darf keine endgültige Rechnungsnummer vergeben.

Kennzeichne Entwürfe eindeutig als Entwurf.

Die finale PDF muss nach Ausstellung die tatsächlich vergebene Rechnungsnummer enthalten.

## 8. EU-E-Rechnung – UBL 2.1 / EN 16931

Implementiere zusätzlich die Erstellung strukturierter E-Rechnungen als UBL-2.1-XML auf Grundlage der europäischen Norm EN 16931.

Evaluiere insbesondere:

https://github.com/gflohr/e-invoice-eu

npm:
`@e-invoice-eu/core`

Verwende die aktuelle dokumentierte API und prüfe die tatsächlich unterstützten Formate und Abhängigkeiten.

### Architektur

Implementiere einen eigenständigen Adapter für den XML-Export.

Die Struktur soll ungefähr folgendem Prinzip entsprechen:

`Invoice Model -> Normalized Invoice Data -> PDF Renderer / UBL Renderer`

Der UBL-Renderer darf keine Daten aus dem generierten PDF auslesen.

Die UBL-Ausgabe muss direkt aus dem strukturierten Rechnungsmodell entstehen.

### UBL-Inhalte

Implementiere die korrekte Abbildung der jeweils anwendbaren EN-16931-Felder, insbesondere:

- Rechnungsidentifikation
- Ausstellungsdatum
- Leistungsinformationen
- Lieferant und Käufer
- Elektronische Adressen, soweit erforderlich
- Steuerkennzeichen
- Zahlungsbedingungen
- Zahlungsinformationen
- Rechnungspositionen
- Mengen und Einheiten
- Steuerkategorien und Steuerbeträge
- Steueraufschlüsselung
- Gesamtsummen
- Währungsangaben
- Zusätzliche Referenzen, sofern erforderlich

Verwende standardisierte Codes und die korrekten UBL-Namensräume.

### Validierung

Wichtig: Eine syntaktisch korrekte XML-Datei ist nicht automatisch EN-16931-konform.

Implementiere eine zweistufige Validierung:

1. Interne Validierung des Rechnungsmodells, einschließlich Pflichtfeldern, Datentypen, erlaubten Werten und Betragslogik.
2. Unabhängige Prüfung der generierten XML-Datei gegen UBL-XSD und die offiziellen EN-16931-Schematron-Regeln.

Orientiere dich an den offiziellen Validierungsartefakten:

https://github.com/ConnectingEurope/eInvoicing-EN16931

Die Prüfung darf nicht ausschließlich aus einer erfolgreichen Rückgabe der Generator-Library bestehen.

Prüfe auch Sonderfälle wie Steuerbefreiung und Reverse Charge.

Wenn bestimmte Konstellationen nicht zuverlässig validiert werden können, muss die Anwendung diese vor der Ausstellung beziehungsweise dem XML-Export verständlich zurückweisen, statt eine vermeintlich konforme Datei zu erzeugen.

Keine pauschale EU-Konformität behaupten, solange keine unabhängigen Konformitätstests erfolgreich durchgeführt wurden.

## 9. Spätere Exportformate vorbereiten

Die interne Architektur soll ohne neues Rechnungsdatenmodell erweiterbar sein.

Vorgesehene spätere Ausgabeformate:

- XRechnung
- ZUGFeRD / Factur-X
- Peppol BIS Billing 3.0
- Optional ebInterface für Österreich

Diese Formate sollen später eigene Adapter beziehungsweise Profile bekommen und zusätzliche Validierungsregeln berücksichtigen können.

**In diesem Arbeitsschritt vollständig implementieren: normales PDF und EN-16931-UBL-XML.**

Die übrigen Formate zunächst nur architektonisch vorbereiten. Keine deaktivierten oder funktionslosen Export-Buttons anzeigen.

Nicht behaupten, dass ein generisches EN-16931-UBL-Dokument automatisch alle nationalen Anforderungen, etwa der XRechnung, erfüllt.

## 10. Speicherung und Verknüpfung

Alle selbst erzeugten Rechnungen sollen in der bestehenden Rechnungsverwaltung sichtbar sein.

Verknüpfe sie mit:

- `customer_id`
- Optional `customer_service_id`
- Vorhandenem Einnahmenstatus
- Rechnungsnummer
- Ausstellungsdatum
- Zahlungsziel
- PDF-Dokument
- UBL-XML-Dokument
- Unveränderlichem Rechnungs-Snapshot

Berücksichtige, dass derzeit Rechnungs-PDFs als BLOB in SQLite gespeichert werden.

Prüfe, ob für mehrere Dokumentformate eine ergänzende Dokumententabelle sinnvoller ist als zusätzliche BLOB-Spalten.

Dokumente sollen vollständig lokal gespeichert und auch nach einem Neustart wieder verfügbar sein.

Berücksichtige Dateiformat, Erstellungszeitpunkt, Formatversion und einen SHA-256-Hash.

Verschiedene Exportformate dürfen nicht zu mehreren Einträgen derselben Rechnung in der Umsatzstatistik führen.

## 11. OCR-Pipeline ausdrücklich umgehen

Dieser Abschnitt ist eine verbindliche Architektur- und Testanforderung.

Für jede innerhalb von Pitchary erzeugte Rechnung gilt:

- Kein `extractPDF()`.
- Kein `createOpenAIExtractor()`.
- Kein OCR-Aufruf.
- Kein KI-Aufruf.
- Keine erneute Extraktion des Rechnungs-PDFs.
- Kein Warteschlangenauftrag für Dokumentenerkennung.
- Keine Abhängigkeit von der Verfügbarkeit eines API-Keys.
- Keine automatische Neuverarbeitung über `/reprocess`.
- Kein automatischer Import des selbst generierten PDFs über den Folder-Watcher.

Die bereits bekannten Daten wie Rechnungsnummer, Empfänger, Beträge, Steuern, Datum und Positionen werden direkt aus dem strukturierten Snapshot in die bestehenden Finanzdaten übernommen.

Insbesondere darf kein unnötiger Kreislauf entstehen:

Rechnung erstellen -> PDF generieren -> PDF importieren -> OCR ausführen -> Daten erneut erkennen.

Stattdessen:

Rechnung erstellen -> strukturierte Daten validieren -> PDF/XML generieren -> Datensatz direkt speichern.

Prüfe außerdem, ob ein exportiertes PDF versehentlich in einem überwachten Ordner landen und dort erneut importiert werden könnte.

Verhindere solche Duplikate zuverlässig, ohne den bisherigen Import fremder Rechnungen zu beschädigen.

## 12. Frontend und UX

Nutze konsequent das bestehende `oj-designsystem`.

Keine neue Frontend-Library und kein Framework-Wechsel.

### Rechnungsübersicht

Ergänze:

- „Neue Rechnung“
- Kennzeichnung „Erstellt“ oder „Importiert“
- Kennzeichnung für Entwürfe
- Verfügbare Dokumentformate
- PDF öffnen beziehungsweise herunterladen
- XML herunterladen

### Rechnungsformular

Gestalte das Formular in klaren Bereichen:

1. Kunde und Rechnungsdaten
2. Positionen
3. Steuer und Zahlungsbedingungen
4. Summenübersicht
5. Vorschau und Ausstellung

Felder mit vorhandenen Daten automatisch vorausfüllen.

Die Summen müssen bei Änderungen sofort aktualisiert werden.

Zeige Validierungsfehler unmittelbar am betroffenen Feld an.

### Rechnungsdetails

Unterscheide bei der Darstellung zwischen importierten und selbst erstellten Rechnungen.

Für erstellte Rechnungen:

- Rechnungsdaten darstellen
- Verknüpften Kunden öffnen
- Verknüpftes Angebot öffnen
- PDF herunterladen
- XML herunterladen
- Zahlungsstatus ändern
- Ausstellungsdatum anzeigen
- Keine OCR-/KI-Optionen anzeigen

Für importierte Rechnungen bleibt der bisherige Funktionsumfang erhalten.

Der neue Workflow soll auch über die Desktop-Anwendung vollständig offline nutzbar sein.

## 13. REST-API

Erweitere die bestehende Fastify-API passend zur bisherigen Konvention.

Implementiere Endpunkte für:

- Rechnungsentwurf erstellen
- Rechnungsentwurf abrufen
- Rechnungsentwurf bearbeiten
- Rechnungsentwurf löschen
- PDF-Vorschau erzeugen
- Rechnung endgültig ausstellen
- Erstellte PDF abrufen
- UBL-XML abrufen

Verwende konsistente Validierung, HTTP-Statuscodes und Fehlerantworten.

Die Ausstellung soll bei wiederholten Requests nicht versehentlich eine weitere Rechnung erzeugen.

Der bestehende Finance-Import muss unverändert funktionieren.

Die vorhandenen Sicherheitsmechanismen gegen fremde Origins und unzulässige Zugriffe müssen erhalten bleiben.

## 14. Automatisierte Tests

Erweitere die bestehenden Node.js-Tests und die relevanten Playwright-Tests.

Mindestens folgende Szenarien abdecken:

**Rechnungserstellung**

- Rechnung aus vorhandenem Kunden erstellen
- Rechnung aus angenommenem Angebot erstellen
- Freie Positionen hinzufügen
- Entwurf bearbeiten und speichern
- Rechnung final ausstellen
- Rechnungsnummern eindeutig vergeben
- Erneutes Ausstellen derselben Rechnung verhindern

**Dokumente**

- Generierte PDF ist eine gültige PDF-Datei
- PDF enthält die korrekten Rechnungsdaten
- UBL-XML enthält dieselben strukturierten Daten
- Beträge stimmen in DB, PDF und XML überein
- UBL-XML besteht unabhängige Validierung
- Sonderzeichen und mehrseitige Rechnungen funktionieren

**Datenbank**

- Rechnungen bleiben nach Neustart erhalten
- CRM-Änderungen beeinflussen ausgestellte Rechnungen nicht
- Entwürfe erscheinen nicht im Umsatz
- Ausgestellte Rechnungen erscheinen genau einmal im Umsatz
- Zahlungsstatus bleibt aktualisierbar
- Bestehende Rechnungsimporte bleiben intakt
- Bestehende Migrationen funktionieren weiterhin

**OCR-Isolation**

- Beim Erstellen wird OCR nicht aufgerufen
- Bei der PDF-Erzeugung wird OCR nicht aufgerufen
- Beim XML-Export wird OCR nicht aufgerufen
- Es erfolgt kein KI-Aufruf
- Erstellung funktioniert vollständig ohne OpenAI-Key
- Der Reprocess-Endpunkt weist selbst erzeugte Rechnungen ab
- Der Folder-Watcher erzeugt keine Duplikate aus selbst erstellten Dokumenten
- Importierte Fremdrechnungen durchlaufen weiterhin die normale Erkennung

Nutze Mock- beziehungsweise Spy-Funktionen, um die Nichtausführung von OCR und KI explizit nachzuweisen.

Teste mehrere fachlich relevante XML-Beispielrechnungen gegen die offiziellen Schematron-Validierungsartefakte.

## 15. Technische Anforderungen

- Node.js 26 beibehalten
- SQLite und Fastify beibehalten
- Tauri 2 beibehalten
- Vanilla JS beibehalten
- `oj-designsystem` verwenden
- Lokale und Offline-Verarbeitung
- Keine Cloud-Pflicht
- Keine unnötigen Dependencies
- Keine Duplizierung bestehender Finanzlogik
- Rückwärtskompatible Datenbankmigrationen
- Sinnvolle Trennung zwischen Business-Logik, Datenbank, API und UI
- Bestehende Tests dürfen nicht beschädigt werden
- Keine Einführung von Puppeteer oder LibreOffice nur für die Rechnungserstellung

Aktualisiere die technische Dokumentation und API-Dokumentation.

Achte insbesondere darauf, dass die neue PDF- und XML-Erstellung auch in der gebündelten macOS-Tauri-App funktioniert, nicht nur unter `npm run dev`.

## 16. Eigenständige Abschlussprüfung

Nach der Implementierung musst du die Funktion selbstständig überprüfen.

1. Alle bestehenden und neuen Tests ausführen.
2. Einen vollständigen Testkunden samt Rechnungsdaten anlegen.
3. Eine Rechnung mit mehreren Positionen erzeugen.
4. Das PDF generieren und seine Inhalte prüfen.
5. Die UBL-XML generieren und unabhängig validieren.
6. Beträge zwischen Datenbank, PDF und XML vergleichen.
7. Überprüfen, dass kein OCR- oder KI-Aufruf stattgefunden hat.
8. Die bestehende Rechnungsimportfunktion erneut testen.
9. Die neue UI mit Playwright testen, inklusive relevanter Fehlerzustände.
10. Die Tauri-Build-Kompatibilität überprüfen.

Fehler selbstständig korrigieren und die betroffenen Tests erneut ausführen.

Erst abschließen, wenn die tatsächlich überprüfbaren Akzeptanzkriterien erfüllt sind.

Falls ein notwendiger Konformitätstest, eine externe Validierungsumgebung oder ein Plattform-Build nicht ausgeführt werden kann, diesen Punkt ausdrücklich als **nicht verifiziert** dokumentieren. Nicht als bestanden markieren.

## 17. Gewünschter Abschlussbericht

Gib am Ende eine kompakte Zusammenfassung mit:

- Implementierten Funktionen
- Datenbankmigrationen
- Neuen Abhängigkeiten
- Unterstützten Rechnungs- und Exportformaten
- Ergebnis der EN-16931-Validierung
- Ergebnis der OCR-/KI-Isolationstests
- Ausgeführten Tests samt Ergebnissen
- Noch bestehenden Einschränkungen

Keine reine Konzeptausarbeitung erstellen. Setze die erste Ausbaustufe tatsächlich im Repository um.

**Oberstes Ziel: Pitchary soll einmal erfasste Rechnungsdaten direkt weiterverwenden und daraus ohne zusätzliche Erkennung professionelle PDF-Rechnungen und standardkonforme UBL-E-Rechnungen erstellen.**
