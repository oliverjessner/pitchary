# Automatische Kundenlogos

Beim Anlegen eines Kunden kann eine **Haupt-E-Mail** angegeben werden. Pitchary sucht über [Fetchary](https://github.com/oliverjessner/fetchary/blob/main/docs/LIBRARY.md) auf der Firmenwebsite nach einem Icon und speichert es als lokales Kundenlogo. Eine eingetragene Website hat Vorrang; andernfalls wird die E-Mail-Domain verwendet. Von der E-Mail wird nur die Domain für den Abruf verwendet.

Bei privaten Mailanbietern wie Gmail, Outlook oder GMX wird ohne eingetragene Firmenwebsite kein Anbieterlogo übernommen. Ein manuell hochgeladenes Logo hat immer Vorrang. Auch wenn eine Website nicht erreichbar ist oder kein unterstütztes Icon liefert, wird der Kunde gespeichert. Das Logo lässt sich anschließend über **Bearbeiten** manuell ergänzen, ersetzen oder entfernen. Bestehende Kunden werden nicht automatisch verändert.

Die Haupt-E-Mail ist dieselbe Adresse wie unter **Rechnungsdaten des Kunden**; sie wird in `finance_customer_profiles.general_email` gespeichert. Kunden- und Rechnungsprofil verwenden denselben Wert. Dafür ist keine Datenbankmigration erforderlich. Die Kundensuche berücksichtigt die Adresse ebenfalls.

## Abruf und Bildverarbeitung

Fetchary **1.2.0** wird als lokale npm-Bibliothek im HTTP-Modus verwendet. Die öffentlichen Methoden `add`, `version` und `read` liefern die HTML-Seite und deren endgültige Adresse. Jede Suche verwendet ein eigenes temporäres Archiv, das danach entfernt wird; die persönliche Fetchary-Datenbank wird nicht verwendet. Chromium wird für diese Funktion nicht gestartet oder heruntergeladen (`.puppeteerrc.cjs`).

Die Suche berücksichtigt `apple-touch-icon`, `apple-touch-icon-precomposed`, `icon`/`shortcut icon` und `mask-icon`, relative URLs und HTML-`base`-Tags. Anschließend wird `/favicon.ico` versucht. Rasterformate, SVG und ICO werden in PNG umgewandelt und auf höchstens 256 × 256 Pixel verkleinert. Die bestehenden Logo-Limits und lokalen Logo-URLs gelten auch für automatisch gefundene Bilder.

Die Suche hat ein Zeitbudget von zehn Sekunden und begrenzt Antworten auf 2 MiB. Abrufe verwenden öffentliche HTTP-/HTTPS-Adressen, kontrollierte Weiterleitungen und für die Verbindung festgelegte DNS-Ergebnisse. Private, lokale und reservierte Adressen sowie URL-Zugangsdaten werden abgewiesen; Cookies und Autorisierungsheader werden nicht weitergegeben. HTML wird nicht ausgeführt. SVG-Inhalte mit Skripten, externen Ressourcen oder XML-Entitäten werden nicht verwendet. Ein während der Suche manuell gesetztes Logo oder eine geänderte Website/E-Mail wird nicht überschrieben.

## API

`POST /api/customers` akzeptiert zusätzlich `general_email`. Nach erfolgreicher Validierung und Speicherung wird die Logo-Suche abgeschlossen; die Antwort enthält wie bisher `has_logo` und `logo_url`. Die Logo-Suche ist optional: Ein Fehler verhindert die Kundenanlage nicht. `logo: null` oder ein manuell geliefertes Logo unterdrückt die automatische Suche.

`PATCH /api/customers/:id` kann `general_email` bearbeiten. Bearbeiten oder Entfernen eines Logos startet keine neue Suche. Die Logo-Datei wird weiterhin unter `GET /api/customers/:id/logo` ausgeliefert und in Kundendetails, Tabellen und Pipeline-Karten angezeigt.

Tests decken den echten Fetchary-HTTP-Pfad mit kontrollierten Antworten, lokale Bildspeicherung, E-Mail-Persistenz, manuelle Priorität, SVG-/ICO-Konvertierung, Fehlerfälle, konkurrierende Änderungen, Netzwerk- und Größenbegrenzungen ab. Browserabläufe prüfen Anlage, Logoanzeige nach Reload und E-Mail-Suche auf Desktop/Mobil in Chromium und WebKit. Ein öffentlicher Live-Abruf für `golem.de` lieferte ein PNG-Logo mit 96 × 96 Pixeln; dabei wurde kein produktiver Kundendatensatz geändert.
