# REST API

Die integrierte Rechnungsverwaltung verwendet `/api/finance`.

Kunden enthalten ihre Rechnungsdaten aus `finance_customer_profiles`: `customer_number`, `billing_address`, `additional_name`, `street`, `postal_code`, `city`, `country_code`, `vat_id`, `tax_id`, `invoice_email`, `endpoint_id`, `endpoint_scheme` und `buyer_reference`. Anlegen und Bearbeiten eines Kunden können diese Felder atomar mitspeichern. Ohne eigene Kundennummer vergibt die Anlage fortlaufend `K-00001`, `K-00002` usw.; vorhandene nichtleere Nummern bleiben erhalten. Kundennummern sind beim Kunden editierbar und ohne Beachtung der Groß-/Kleinschreibung eindeutig. Rechnungsentwürfe übernehmen Empfängerdaten ausschließlich aus diesen Stammdaten. `recipient`, `buyer_reference` und ein einzelnes `service_date` werden im Rechnungserstellungs-Payload nicht mehr akzeptiert. Neue Rechnungen verwenden `service_period_start` und `service_period_end`; derselbe Tag in beiden Feldern bildet eine eintägige Leistung ab.

Die eigene Rechnungserstellung mit Entwürfen, Nummernkreis, Sammelrechnungen, PDF und lokal validierter XRechnung ist in [INVOICE_CREATION.md](INVOICE_CREATION.md) beschrieben. Sie verwendet `/api/finance/creation` und legt ausgestellte Rechnungen im bestehenden Finanzsystem ab.

## Rechnungsverarbeitung und KI

OpenAI darf ausschließlich Ausgabenrechnungen (`category = payable`) automatisch erkennen. Bei PDF-Import, Ordnerüberwachung und erneutem Verarbeiten werden Einnahmenrechnungen (`revenue`) ausschließlich lokal als Text beziehungsweise per OCR gelesen; ihre fachlichen Angaben werden manuell gepflegt. Eine Umklassifizierung zur Einnahmenrechnung sperrt die KI-Verarbeitung auch beim erneuten Verarbeiten. Eigene Rechnungsentwürfe, Berechnung, Nummernvergabe, PDF und XRechnung-XML verwenden nur lokale CRM-/SQLite-Daten und benötigen keinen OpenAI-Schlüssel.

Kundenangaben werden ausschließlich über die Kunden- und Rechnungsprofil-Endpunkte gepflegt. Der bisherige Endpunkt `POST /finance/customers/:id/enrich` liefert für vorhandene Kunden **422** mit `code = customer_enrichment_disabled` und der Meldung `Kundendaten werden ausschließlich im Kundenprofil gepflegt.`; dabei wird weder ein Schlüssel entschlüsselt noch ein KI-Aufruf ausgeführt oder das Profil verändert. Die ausdrückliche Schlüsselprüfung in den Einstellungen bleibt verfügbar und überträgt keine Rechnungsdaten.

## Endpunkte

Basis: `http://127.0.0.1:3031/api`. JSON-Body mit `Content-Type: application/json`. GET liefert ein Objekt oder ein Array; POST-Erstellung liefert **201**, Änderungen/Archivierung **200**. DELETE auf den Ressourcen-Endpunkten archiviert. Der explizite Endpunkt `/customer-services/:id/permanent` löscht ein Angebot endgültig. Es gibt keine regulären Änderungs-/Löschendpunkte für einzelne Historien- oder Aktivitätseinträge.

| Ressource         | Endpunkte                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Kunden            | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`, `POST /customers/:id/restore`                               |
| Kundenlogo        | `GET /customers/:id/logo` liefert die gespeicherten Bildbytes mit passendem Content-Type                              |
| Mitarbeiter       | `GET/POST /employees`, `GET/PATCH/DELETE /employees/:id`, `POST /employees/:id/restore`                               |
| Dienstleistungen  | `GET/POST /services`, `GET/PATCH/DELETE /services/:id`, `POST /services/:id/restore`                                  |
| Angebote          | `GET/POST /customer-services`, `GET/PATCH/DELETE /customer-services/:id`, `POST /customer-services/:id/restore`       |
| Angebot löschen   | `DELETE /customer-services/:id/permanent` entfernt das Angebot mit allen zugehörigen Ereignissen                      |
| Mehrfachzuweisung | `POST /customer-services/batch` mit `customer_ids` statt `customer_id`                                                |
| Status            | `POST /customer-services/:id/status`                                                                                  |
| Preise            | `POST /customer-services/:id/prices`                                                                                  |
| Kontakte          | `GET/POST /customer-services/:id/activities`                                                                          |
| Alle Aktivitäten  | `GET /activities`                                                                                                     |
| Analytics         | `GET /analytics`                                                                                                      |
| Gesundheit        | `GET /health`                                                                                                         |
| Pitch-Kanäle      | `GET /pitch-channels` liefert die registrierten IDs und Anzeigenamen                                                  |
| Tags              | `GET/POST /service-tags`, `PATCH/DELETE /service-tags/:id` (gemeinsamer Katalog für Unternehmen und Dienstleistungen) |

Listen für Kunden/Mitarbeiter/Dienstleistungen unterstützen `search` und `archived=true`; Mitarbeiter zusätzlich `customer_id`. Angebote unterstützen `customer_id`, `service_id`, `pitch_channel`, `status`, `from`, `to` und `archived=true`. Standardmäßig werden aktive Datensätze gelistet. Kundendetails enthalten aktive/archivierte Mitarbeiter sowie alle Angebote inklusive Historie und Aktivitäten. Angebotsdetails enthalten Timeline-Daten, Statusphasen und erste Pitch-/Zusagezeitpunkte.

Mitarbeiterlisten enthalten zusätzlich `customer_name`, `customer_archived_at` und `customer_tags: [{id,name,note,color}]`. Ihre Suche berücksichtigt Name, E-Mail, Position, LinkedIn, Unternehmensname und Unternehmenstags; sie lässt sich mit `customer_id` und `archived=true` kombinieren. Im Menü „Personen“ öffnet ein Klick auf einen Namen die persönliche Detailansicht. Die Tags gehören zum Unternehmen und werden auch bei archivierten Unternehmen angezeigt; Personen haben keine eigene Tagzuordnung.

`GET /employees/:id` enthält zusätzlich `customer` (Kundenstammdaten), `relationships` (Angebote mit dieser Person als aktuellem Ansprechpartner oder mit mindestens einer persönlich zugeordneten Aktivität) und `activities` (ausschließlich Aktivitäten mit dieser `employee_id`, neueste zuerst). Angebote werden ohne Duplikate und einschließlich archivierter Angebote und Dienstleistungen geliefert. Auch archivierte Mitarbeiter bleiben lesbar. Aktivitäten anderer Mitarbeiter oder ohne Mitarbeiterzuordnung werden nicht der Person zugerechnet; ein späterer Wechsel des Ansprechpartners erhält persönlich erfasste Aktivitäten beim ursprünglichen Mitarbeiter. Allgemeine Status- und Preisereignisse bleiben in der jeweiligen Angebotshistorie. Aktivitäten enthalten `relationship_archived_at` für die Kennzeichnung archivierter Angebote.

Kunden- und Dienstleistungslisten und -details enthalten `tags: [{id,name,note,color}]`. `search` findet auch zugewiesene Tag-Namen. `POST/PATCH /customers` und `POST/PATCH /services` akzeptieren zusätzlich `tag_ids` (bis zu 100 UUIDs; Duplikate werden zusammengefasst). Beim PATCH erhält ein weggelassenes `tag_ids` die Zuordnung; `[]` entfernt alle Zuordnungen. Änderungen sind atomar mit den übrigen Feldern. Kunden-Zusammenführungen übernehmen die Vereinigungsmenge beider Tagzuordnungen.

Dienstleistungen enthalten zusätzlich das schreibgeschützte Feld `pitched_count`: Es zählt jeden gespeicherten Statuswechsel nach `pitched` und jede zusätzlich erfasste Aktivität vom Typ `pitch`, einschließlich erneuter Pitches nach Ablehnung oder Ghosting und einschließlich archivierter Angebote und Kunden. Angebote ohne Pitch zählen nicht; spätere Zusagen oder Absagen verringern den Wert nicht. Die Dienstleistungstabelle zeigt diesen Wert unter „Pitched“. Beim endgültigen Löschen eines Angebots werden dessen Pitch-Ereignisse mit entfernt. Analytics zählt dagegen weiterhin jedes mindestens einmal gepitchte Angebot einmal.

`GET /customers`, `GET /employees` und `GET /services` unterstützen `tag_ids=UUID,UUID` als ODER-Filter. Die IDs müssen existieren; ungültige Auswahlen liefern **422**. Ohne Auswahl bleiben auch Datensätze ohne Tags sichtbar. Bei Mitarbeitern wird nach den Tags ihres Unternehmens gefiltert. Die Filter lassen sich mit `search`, `archived=true` und bei Mitarbeitern `customer_id` kombinieren. Die Kunden-, Personen- und Dienstleistungsübersichten bieten dieselbe Mehrfachauswahl, einschließlich Tagsuche und Zurücksetzen, sowie eine eigene Tagspalte; übrige Filter und die Sortierung in Kunden- und Personenübersichten bleiben bei einer Tag-Auswahl erhalten.

Angebotslisten und -details enthalten `service_tags: [{id,name,note,color}]` mit den aktuellen Tags der zugehörigen Dienstleistung, auch bei archivierten Dienstleistungen und Angeboten. Die Pipeline filtert mehrere ausgewählte Tags mit ODER und kombiniert diese Auswahl mit Textsuche, Status und Archivansicht. Ohne Tag-Auswahl werden auch Angebote ohne Tags angezeigt.

`GET /pitch-channels` liefert `[{id,label}]`. Die gemeinsame Konfiguration ist `public/config/pitch-channels.json`; neue IDs werden beim Serverstart registriert. `internal_software` hat das Label „Interne Software“ und kann für Angebote, Aktivitäten und Filter verwendet werden. Unregistrierte Kanäle werden fachlich und durch Foreign Keys abgewiesen.

Tag anlegen mit `POST /service-tags` (**201**):

```json
{ "name": "Wartung", "note": "Wiederkehrende Betreuung", "color": "#4d8dff" }
```

Name erforderlich (maximal 80 Zeichen), Notiz optional (maximal 2000 Zeichen), Farbe optional mit Standard `#4d8dff`. Namen sind nach Unicode-Normalisierung und Kleinschreibung eindeutig; doppelte Namen/ungültige Farben liefern **422**. Die Liste enthält zusätzlich `service_count` und `customer_count`, einschließlich archivierter Datensätze. Der Katalog ist gemeinsam, die Zuordnungen zu Unternehmen und Dienstleistungen sind unabhängig. PATCH erlaubt `name`, `note` und `color`. DELETE entfernt den Tag mit allen Unternehmens- und Dienstleistungszuordnungen und liefert **200**: `{id,deleted:true}`. Fehlende Tags liefern **404**.

Analytics unterstützt `from`/`to` (`YYYY-MM-DD`, inklusive, Angebots-Anlagedatum UTC), `customer_id`, `service_id` und `pitch_channel`. Archivierte Angebote sind immer enthalten. Aktivitäten unterstützen dieselben Filter; hier filtern die Datumsgrenzen den Aktivitätszeitpunkt.

`DELETE /customer-services/:id/permanent` löscht aktive oder archivierte Angebote, einschließlich ihrer Statushistorie und Aktivitäten, atomar. Antwort **200**: `{ "id": "…", "deleted": true }`. Unbekannte oder bereits gelöschte IDs liefern **404**. Kunden, Dienstleistungen, Mitarbeiter und andere Angebote werden nicht gelöscht. Die UI verlangt eine ausdrückliche Bestätigung und navigiert danach zur Pipeline.

## Beispiel-Bodies

Kunde/Dienstleistung:

```json
{ "name": "Studio Nord", "note": "Kontakt über das Netzwerk" }
```

Kunden unterstützen zusätzlich `website` (optional, HTTP/HTTPS, maximal 2048 Zeichen) und `logo` bei POST/PATCH:

```json
{
  "name": "Studio Nord",
  "website": "https://example.com",
  "logo": {
    "mime_type": "image/png",
    "data_base64": "BASE64-DER-BILDDATEI"
  }
}
```

Für Logos sind `image/png`, `image/jpeg` und `image/webp` bis 1 MiB erlaubt. Base64-Daten müssen das vollständige Bild ohne Data-URL-Präfix enthalten; Dateisignatur und MIME werden geprüft. `logo: null` entfernt das Logo, ein ausgelassenes `logo` erhält das bestehende Bild. `website: ""` entfernt die Website. Diese Felder sind ausschließlich für Kunden erlaubt.

Kundenantworten enthalten `website`, `has_logo`, `logo_mime` und `logo_url`; Bildbytes erscheinen nicht in JSON-Listen. `logo_url` verweist auf den lokalen Bildendpunkt. Dieser liefert bei fehlendem Logo **404** und bleibt auch für archivierte Kunden lesbar. Archivierte Kunden können erst nach Wiederherstellung bearbeitet werden.

`POST /customers/:id/logo/refetch` startet ohne Request-Body einen erneuten Fetchary-Abruf, auch wenn bereits ein Icon gespeichert ist. Als Quelle dient die Website, andernfalls die allgemeine Firmen-E-Mail-Domain; persönliche E-Mail-Anbieter ohne Website werden übersprungen. Die Antwort **200** enthält `{record, refreshed}`: `record` ist der aktuelle Kundendatensatz, `refreshed: true` bestätigt ein neu gespeichertes PNG-Icon. Ohne verwendbares Icon oder bei einem Abruffehler bleibt das vorhandene Logo erhalten und `refreshed` ist `false`. Ein während des Abrufs manuell geändertes oder entferntes Logo, eine geänderte Website/E-Mail oder eine Archivierung wird nicht überschrieben. Fehlende Kunden liefern **404**, bereits archivierte Kunden vor einem Abruf **409**. Dieser explizite Benutzer-Endpunkt wird durch den Button „Icon neu laden“ in der Kundenansicht aufgerufen; er erweitert nicht die Schreibrechte des MCP.

Angebotslisten und -details enthalten `customer_logo_url` für das aktuelle Kundenlogo, auch in Kunden-/Dienstleistungsdetails und bei archivierten Angeboten. Ohne Logo ist der Wert `null`. Der Versionsparameter folgt Änderungen am Kunden, damit ein ersetztes Logo beim nächsten Laden sofort erscheint; Bildbytes werden ausschließlich über den Bildendpunkt geladen.

Mitarbeiter (Kundenzuordnung ist später nicht veränderbar):

```json
{
  "customer_id": "UUID",
  "name": "Anna Berger",
  "email": "anna@example.com",
  "position": "Geschäftsführung",
  "linkedin": ""
}
```

Angebot:

```json
{
  "customer_id": "UUID",
  "service_id": "UUID",
  "primary_employee_id": null,
  "current_offered_price_minor": 120050,
  "currency": "EUR",
  "billing_type": "one_time",
  "pitch_channel": "email",
  "offer_date": "2026-09-01"
}
```

`offer_date` ist das unabhängig vom Erfassungszeitpunkt bearbeitbare Angebotsdatum als realer Kalendertag in `YYYY-MM-DD`. Vergangene und zukünftige Tage sind erlaubt. Ohne Angabe verwenden Einzel- und Mehrfachanlage den heutigen Tag in Europe/Vienna; bestehende Angebote erhalten bei der Migration den UTC-Kalendertag ihres bisherigen `created_at`. PATCH erhält das Datum bei ausgelassenem Feld. Die Änderung verändert weder `created_at`, `status_since` noch Statushistorie oder Aktivitätszeitpunkte; Analytics-Zeiträume bleiben auf das Erfassungsdatum bezogen.

PATCH erlaubt `primary_employee_id`, `pitch_channel` und `offer_date` für aktive Angebote in jedem Status. Der ursprüngliche Pitch-Kanal lässt sich auch nach dem ersten Pitch korrigieren und muss ein registrierter Kanal sein; vorhandene Kontaktaktivitäten behalten ihren eigenen Kanal. `currency` und `billing_type` sind nur vor dem ersten Pitch bearbeitbar. Status, Preise, Kunde, Dienstleistung und Ursprungspreis können nicht durch PATCH überschrieben werden.

Status/Zusage:

```json
{
  "status": "accepted",
  "expected_status": "pitched",
  "accepted_price_minor": 110000,
  "occurred_at": "2026-10-12T08:00:00.000Z"
}
```

`occurred_at` ist optional und darf auch in der Zukunft liegen, etwa für einen vorausgeplanten E-Mail-Pitch. Der Zeitpunkt darf nicht vor dem Beginn der aktuellen Statusphase liegen. Ohne Angabe wird der aktuelle Zeitpunkt verwendet; liegt die aktuelle Phase bereits in der Zukunft, muss ein mindestens gleich später Zeitpunkt angegeben werden. Der Status wird beim Speichern gesetzt, auch bei einem zukünftigen Zeitpunkt; `recorded_at` und `updated_at` bleiben die tatsächlichen Erfassungszeitpunkte. `expected_status` erkennt veraltete Eingaben. Ohne expliziten Zusagepreis wird der aktuelle Angebotspreis verwendet. Bei Ablehnung: `reason: {"code":"budget","note":"Nächstes Quartal"}`. Bei Wiederaufnahme: `status: "pitched"` und eine Textbegründung in `reason`.

`status: "ghosted"` ist aus `pitched` erlaubt und kann eine optionale Textnotiz in `reason` erhalten. Aus `ghosted` sind `accepted`, `rejected` oder `pitched` erlaubt; die Wiederaufnahme nach `pitched` benötigt eine Textbegründung. Listen akzeptieren `status=ghosted`. Analytics liefert `ghosted` in der Zusammenfassung und allen Performance-Gruppen; diese Angebote zählen als unentschieden und beeinflussen die Abschlussquote erst bei Zusage oder Absage.

Preisänderung:

```json
{
  "field": "current_offered_price_minor",
  "price_minor": 110000,
  "note": "Umfang angepasst"
}
```

Nach Zusage: `field: "accepted_price_minor"`. Beträge sind ganze Cent; `first_pitched_price_minor` ist niemals direkt veränderbar.

Aktivität:

```json
{
  "type": "follow_up",
  "channel": "email",
  "employee_id": null,
  "note": "Rückfragen beantwortet",
  "occurred_at": "2026-10-12T08:00:00.000Z"
}
```

`employee_id`, `channel` und `occurred_at` sind optional. Aktivitäten aller erlaubten Typen können mit einem zukünftigen `occurred_at` vorausgeplant werden; der Zeitpunkt darf nicht vor der Anlage des Angebots liegen. Ohne Angabe gilt der aktuelle Zeitpunkt. `created_at` bleibt der tatsächliche Erfassungszeitpunkt. Strukturierte Preisereignisse entstehen ausschließlich durch Preis-/Zusageaktionen.

## Fehler

```json
{
  "error": {
    "code": "validation_error",
    "message": "Der Ansprechpartner gehört zu einem anderen Kunden.",
    "fields": {
      "primary_employee_id": "Der Ansprechpartner gehört zu einem anderen Kunden."
    }
  }
}
```

**400**: ungültiges Request-Format; **403**: fremder Host/Origin; **404**: unbekannter Datensatz/Endpunkt; **409**: ungültiger Übergang, archivierter Datensatz, unveränderliche Pitch-Metadaten, unveränderter Preis oder Statuskonflikt; **422**: fachlich ungültige Eingaben; **500**: interner Fehler (Details ausschließlich im Serverlog).
