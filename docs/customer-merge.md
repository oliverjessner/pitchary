# Kunden zusammenführen

`createCustomerMerge(db)` aus `src/business/customer-merge.js` stellt intern `merge(sourceId, targetId)` und `resolve(id)` bereit. Die Zusammenführung verwendet eine Transaktion; mehrere Zusammenführungen können gemeinsam in `transaction(db, ...)` ausgeführt werden. Vor Änderungen am normalen Bestand zuerst ein SQLite-Backup erstellen und den Ablauf auf dessen Kopie prüfen.

Der Zielkunde behält seine ID, seinen Namen und seinen Archivzustand. Fehlende Website und Logo werden ergänzt, unterschiedliche Notizen zusammengeführt. Der stärkere Lead-/Kundenstatus bleibt erhalten, auch wenn frühere Einnahmenrechnungen bereits gelöscht wurden. Alle Kontakte behalten ihre IDs, sodass auch unveränderliche Aktivitäten weiterhin ihren ursprünglichen Ansprechpartner haben. Angebote und Rechnungen werden umgebunden, ohne Status, Beträge, Preise, Datumswerte, PDFs oder Ereignisse zu ändern. Manuelle Kunden-Zuordnungen in Rechnungskorrekturen werden ebenfalls umgeleitet. Bestehende Rechnungsprofile bleiben erhalten.

Bei unterschiedlichen nicht leeren Websites, Logos oder Rechnungsprofilen bricht die Funktion mit `customer_merge_conflict` ab. Ungültige Verknüpfungen und Zuordnungen brechen ebenfalls ab; die gesamte Transaktion wird zurückgerollt. Fremdschlüssel bleiben aktiviert, ihre Prüfung wird während der zusammenhängenden Kontakt-/Angebotsänderung aufgeschoben und vor Abschluss geprüft.

Historische Namen bleiben in `finance_customer_aliases` dem Ziel zugeordnet. Die Zuordnung alter Kunden-IDs wird in `customer_merges` gespeichert. Kunden- und Finanzkunden-Endpunkte sowie `customer_id`-Filter lösen diese IDs auf; dadurch funktionieren bestehende Links weiter. Eine erneute Zusammenführung desselben Paars ist idempotent. Es gibt keinen öffentlich aufrufbaren Merge-Endpunkt.

Am 13. Oktober 2026 wurden die angefragten Paare im lokalen Bestand zusammengeführt:

- Golem → Golem Media GmbH
- IT-Finanzmagazin → IT Finanzmagazin
- DIE ZEIT → Zeitverlag Gerd Bucerius GmbH & Co. KG

Der Bestand enthält danach 11 Kunden, weiterhin 10 Kontakte, 9 Angebote und 87 Rechnungen. Historien, Aktivitäten, Korrekturen, Finanzprotokolle und PDF-Inhalte wurden gegen das Backup geprüft. Die vorbereitete Kopie und der tatsächliche Bestand bestanden `foreign_key_check` und `integrity_check`. Sicherung: `backups/pitchary-before-customer-merge-2026-10-13T13-38-59-626Z.sqlite`. Die lokalen Prüfprotokolle liegen unter `artifacts/migrations/customer-merge-2026-10-13T13-38-59-626Z/`.
