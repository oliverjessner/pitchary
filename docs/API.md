# REST API

Basis: `http://127.0.0.1:3031/api`. JSON-Body mit `Content-Type: application/json`. GET liefert ein Objekt oder ein Array; POST-Erstellung liefert **201**, Änderungen/Archivierung **200**. DELETE auf den Ressourcen-Endpunkten archiviert. Der explizite Endpunkt `/customer-services/:id/permanent` löscht ein Angebot endgültig. Es gibt keine regulären Änderungs-/Löschendpunkte für einzelne Historien- oder Aktivitätseinträge.

| Ressource            | Endpunkte                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Kunden               | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`, `POST /customers/:id/restore`                         |
| Kundenlogo           | `GET /customers/:id/logo` liefert die gespeicherten Bildbytes mit passendem Content-Type                        |
| Mitarbeiter          | `GET/POST /employees`, `GET/PATCH/DELETE /employees/:id`, `POST /employees/:id/restore`                         |
| Dienstleistungen     | `GET/POST /services`, `GET/PATCH/DELETE /services/:id`, `POST /services/:id/restore`                            |
| Angebote             | `GET/POST /customer-services`, `GET/PATCH/DELETE /customer-services/:id`, `POST /customer-services/:id/restore` |
| Angebot löschen      | `DELETE /customer-services/:id/permanent` entfernt das Angebot mit allen zugehörigen Ereignissen                |
| Mehrfachzuweisung    | `POST /customer-services/batch` mit `customer_ids` statt `customer_id`                                          |
| Status               | `POST /customer-services/:id/status`                                                                            |
| Preise               | `POST /customer-services/:id/prices`                                                                            |
| Kontakte             | `GET/POST /customer-services/:id/activities`                                                                    |
| Alle Aktivitäten     | `GET /activities`                                                                                               |
| Analytics            | `GET /analytics`                                                                                                |
| Gesundheit           | `GET /health`                                                                                                   |
| Pitch-Kanäle         | `GET /pitch-channels` liefert die registrierten IDs und Anzeigenamen                                            |
| Dienstleistungs-Tags | `GET/POST /service-tags`, `PATCH/DELETE /service-tags/:id`                                                      |

Listen für Kunden/Mitarbeiter/Dienstleistungen unterstützen `search` und `archived=true`; Mitarbeiter zusätzlich `customer_id`. Angebote unterstützen `customer_id`, `service_id`, `pitch_channel`, `status`, `from`, `to` und `archived=true`. Standardmäßig werden aktive Datensätze gelistet. Kundendetails enthalten aktive/archivierte Mitarbeiter sowie alle Angebote inklusive Historie und Aktivitäten. Angebotsdetails enthalten Timeline-Daten, Statusphasen und erste Pitch-/Zusagezeitpunkte.

Dienstleistungslisten und -details enthalten `tags: [{id,name,note,color}]`. `search` findet auch zugewiesene Tag-Namen. `POST/PATCH /services` akzeptiert zusätzlich `tag_ids` (bis zu 100 UUIDs; Duplikate werden zusammengefasst). Beim PATCH erhält ein weggelassenes `tag_ids` die Zuordnung; `[]` entfernt alle Zuordnungen. Änderungen sind atomar mit den übrigen Dienstleistungsfeldern.

Angebotslisten und -details enthalten `service_tags: [{id,name,note,color}]` mit den aktuellen Tags der zugehörigen Dienstleistung, auch bei archivierten Dienstleistungen und Angeboten. Die Pipeline filtert mehrere ausgewählte Tags mit ODER und kombiniert diese Auswahl mit Textsuche, Status und Archivansicht. Ohne Tag-Auswahl werden auch Angebote ohne Tags angezeigt.

`GET /pitch-channels` liefert `[{id,label}]`. Die gemeinsame Konfiguration ist `public/config/pitch-channels.json`; neue IDs werden beim Serverstart registriert. `internal_software` hat das Label „Interne Software“ und kann für Angebote, Aktivitäten und Filter verwendet werden. Unregistrierte Kanäle werden fachlich und durch Foreign Keys abgewiesen.

Tag anlegen mit `POST /service-tags` (**201**):

```json
{ "name": "Wartung", "note": "Wiederkehrende Betreuung", "color": "#4d8dff" }
```

Name erforderlich (maximal 80 Zeichen), Notiz optional (maximal 2000 Zeichen), Farbe optional mit Standard `#4d8dff`. Namen sind nach Unicode-Normalisierung und Kleinschreibung eindeutig; doppelte Namen/ungültige Farben liefern **422**. Die Liste enthält zusätzlich `service_count`, einschließlich archivierter Dienstleistungen. PATCH erlaubt `name`, `note` und `color`. DELETE entfernt den Tag mit allen Zuordnungen und liefert **200**: `{id,deleted:true}`. Fehlende Tags liefern **404**.

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
  "pitch_channel": "email"
}
```

PATCH erlaubt `primary_employee_id` und `pitch_channel` für aktive Angebote in jedem Status. Der ursprüngliche Pitch-Kanal lässt sich auch nach dem ersten Pitch korrigieren und muss ein registrierter Kanal sein; vorhandene Kontaktaktivitäten behalten ihren eigenen Kanal. `currency` und `billing_type` sind nur vor dem ersten Pitch bearbeitbar. Status, Preise, Kunde, Dienstleistung und Ursprungspreis können nicht durch PATCH überschrieben werden.

Status/Zusage:

```json
{
  "status": "accepted",
  "expected_status": "pitched",
  "accepted_price_minor": 110000,
  "occurred_at": "2026-10-12T08:00:00.000Z"
}
```

`occurred_at` ist optional und darf nicht vor der aktuellen Phase oder nach jetzt liegen. `expected_status` erkennt veraltete Eingaben. Ohne expliziten Zusagepreis wird der aktuelle Angebotspreis verwendet. Bei Ablehnung: `reason: {"code":"budget","note":"Nächstes Quartal"}`. Bei Wiederaufnahme: `status: "pitched"` und eine Textbegründung in `reason`.

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

`employee_id`, `channel` und `occurred_at` sind optional. Strukturierte Preisereignisse entstehen ausschließlich durch Preis-/Zusageaktionen.

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
