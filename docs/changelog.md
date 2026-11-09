# 0.7.0

- Die Sprachwahl befindet sich im neuen Einstellungs-Tab „Allgemein“.
- Die Oberfläche lässt sich in den Einstellungen dauerhaft zwischen Deutsch und Englisch umschalten und verwendet gemeinsame Übersetzungskataloge.
- Die Personenübersicht zeigt statt der LinkedIn-Spalte das sortierbare Anlegedatum.
- Abgelehnte Angebotskarten lassen sich direkt in der Pipeline archivieren.
- Neue und bestehende Angebote erhalten ein frei bearbeitbares Angebotsdatum, das auch in der Vergangenheit liegen kann.
- Die Dienstleistungstabelle lässt sich wie die Kundentabelle über ihre Spalten auf- und absteigend sortieren.
- Der Hinweis zur automatischen Logosuche steht direkt unter „Logo hochladen“.
- Aktivitäten in Personen- und Angebotszeitleisten sind durch sichtbare Punkte und Trennlinien voneinander abgegrenzt.
- Die Dienstleistungstabelle zeigt unter „Pitched“ die Anzahl der bisherigen Kunden-Pitches.

# 0.6.5

- MCP kann Kunden, Personen und Dienstleistungen anlegen und vorhandene Einträge nachschlagen. Änderungen, Archivierung, Löschen und beliebige SQL-Befehle sind gesperrt; bestehende Datensätze bleiben unverändert.
- OJ-Designsystem wird aus npm installiert und lässt sich mit `npm run update:designsystem` aktualisieren; lokale Browser-Assets und Lizenzhinweise werden automatisch synchronisiert.
- Erfolgreiches Publish räumt anschließend generierte Build-, Runtime- und Testdateien auf. Release-Artefakte, Datenbanken und Backups bleiben erhalten; bei Fehlern und Dry Runs findet kein Cleanup statt.
- Abhängigkeiten aktualisiert und Paket-, Lockfile-, Cargo- und Tauri-Versionen auf `0.6.5` abgestimmt.

# 0.6.4

- DMG-Erstellung verwendet auf aktuellen macOS-Versionen `diskutil image create`, wiederholt temporäre „Resource busy“-Fehler und ersetzt vorhandene Images erst nach erfolgreicher Prüfung.
- GLib-Sicherheitsfix für RUSTSEC-2024-0429 als lokaler Backport für Tauri/GTK3 eingebunden; CI prüft die ursprünglichen Iterator-Regressionstests im Release-Modus.
- Filter und Suchbegriffe bleiben je Ansicht beim Menüwechsel und Neuladen erhalten.
- Die Umsatzübersicht zeigt nur Kunden mit Einnahmenrechnungen; reine Rechnungsprofile und Kunden mit ausschließlich Ausgaben werden ausgeblendet.
- Eigene Tagspalte und Tagfilter mit Suche und Mehrfachauswahl in der Dienstleistungsübersicht, kombinierbar mit Textsuche und Archivansicht.

# 0.6.2

- Tagfilter in Kunden-, Personen- und Pipelineansicht verwenden die Multiselect-Komponente aus OJ 0.2.2 mit Suche, Mehrfachauswahl und Tastaturbedienung. Der korrigierte lokale OJ-Build wird für reproduzierbare Installationen mitgeliefert.
- Eigene sortierbare Tagspalte in der Kunden- und Personenübersicht.

# 0.6.1

- Automatische Kundenlogos funktionieren mit Fetchary 2.0.4 wieder, auch für lokale HTTP-Websites.
- Gemeinsame Tags für Unternehmen und Dienstleistungen mit Tagzuordnung bei Kunden, Tagfiltern in Kunden- und Personenübersicht und Erhalt der Tags beim Zusammenführen von Kunden.
- Kunden- und Personentabellen mit auf- und absteigender Sortierung per Spaltenüberschrift, Richtungspfeilen und Tastaturbedienung.
- Rechnungs-PDFs öffnen in Tauri wieder in einem angemeldeten App-Fenster; interne Links werden nicht mehr vom Opener-Plugin abgefangen.
- LinkedIn-Spalte mit direkten Profillinks in der Personenübersicht.
- Personenmenü mit Suche, Archivansicht und direkten Links zu den persönlichen Kontaktdaten, Angeboten und Aktivitäten.
- Einheitliche OJ-Selects in allen Filtern und Formularen, einschließlich Rechnungen und Einstellungen.
- employee view
- context menu
- Fix false missing invoice files when closing during a folder scan and restore unchanged PDFs without reprocessing.

# 0.4.4

- automatic publish

# 0.1.0

- Integration der Rechnungsverwaltung.
