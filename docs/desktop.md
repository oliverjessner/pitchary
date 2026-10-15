# Desktop-App und Veröffentlichung

Pitchary läuft als Tauri-2-App auf Apple-Silicon-Macs. Die App enthält den bestehenden Fastify-Server, eine offizielle Node-26-Laufzeit, SQLite, Sharp, lokale Oberflächenassets sowie Poppler und Tesseract mit deutschen und englischen OCR-Modellen. Für die installierte App sind weder Node noch Homebrew nötig. Der bisherige Browserbetrieb bleibt mit `npm run dev` verfügbar.

## Entwickeln und bauen

Zum Bauen werden Node 26, npm, Rust/Cargo, die Xcode Command Line Tools und Homebrew mit `poppler` und `tesseract` benötigt. Die PDF-Werkzeuge werden aus dieser Installation samt ihren dynamischen Bibliotheken und vorhandenen Lizenzdateien kopiert; Node und OCR-Modelle werden mit SHA-256-Prüfung heruntergeladen. Puppeteer lädt keinen Browser herunter.

```sh
npm ci
brew install poppler tesseract
npm run desktop:dev
```

Der Desktop-Entwicklungsmodus arbeitet mit einer vorbereiteten Laufzeit. Nach Backend- oder Frontend-Änderungen die App beenden und `npm run desktop:dev` erneut starten. Änderungen an Rust-Dateien erkennt Tauri automatisch.

```sh
npm run desktop:build
```

Die App entsteht unter `src-tauri/target/release/bundle/macos/Pitchary.app`, die DMG unter `artifacts/releases/v<VERSION>/Pitchary_<VERSION>_aarch64.dmg`. Daneben stehen `manifest.json` und `SHA256SUMS`. Die DMG enthält die App und einen Link auf „Applications“.

Die erforderliche macOS-Version wird aus allen enthaltenen Mach-O-Dateien ermittelt und in die App sowie den Cask übernommen. Mit den derzeit hier installierten PDF/OCR-Werkzeugen ist das **macOS 26.4**. Für ältere Systeme müssen entsprechend kompatibel gebaute Werkzeuge verwendet werden. Intel-, Windows- und Linux-Pakete sind nicht Bestandteil dieses Buildablaufs.

Die App und alle eingebundenen nativen Programme/Bibliotheken werden ad hoc signiert; die Signatur und die DMG werden geprüft. Eine Apple-Developer-ID-Signatur und Notarisierung sind derzeit nicht eingerichtet. Heruntergeladene Builds können deshalb von Gatekeeper einen zusätzlichen Öffnungsschritt verlangen.

## Daten und Lebenszyklus

Die App speichert ihre Daten unter `~/Library/Application Support/com.pitchary.app/`: `pitchary.sqlite`, gegebenenfalls `pitchary.sqlite.finance-key`, Backups und `desktop.log`. Sie startet mit einer leeren Datenbank und übernimmt keine Daten aus dem Entwicklungscheckout. Ein App-Update ersetzt diesen Datenordner nicht.

Zum Übertragen vorhandener Daten die Desktop-App zuerst schließen und vor ihrem ersten Start eine konsistente SQLite-Sicherung erstellen und wiederherstellen:

```sh
npm run backup -- /tmp/pitchary-transfer.sqlite
npm run restore -- /tmp/pitchary-transfer.sqlite "$HOME/Library/Application Support/com.pitchary.app/pitchary.sqlite"
```

`restore` verweigert ein vorhandenes Ziel. Ein gespeicherter API-Schlüssel benötigt zusätzlich die zugehörige `data/pitchary.sqlite.finance-key`; diese Datei bei geschlossener App als `pitchary.sqlite.finance-key` mit Dateirechten `0600` in den App-Datenordner kopieren oder den API-Schlüssel in den App-Einstellungen neu eingeben. Keine Live-Datenbank ohne ihre WAL-Dateien kopieren. Für isolierte Tests lässt sich der Datenordner über eine absolute `PITCHARY_DATA_DIR`-Umgebungsvariable ändern.

Der Backend-Port wird vom Betriebssystem vergeben und nur an `127.0.0.1` gebunden. Eine zufällige Sitzung wird beim Start in einem HttpOnly-/SameSite-Cookie hinterlegt. Andere lokale Aufrufe erhalten ohne diese Sitzung keinen Zugriff. Externe Web- und Mail-Links öffnen im Standardprogramm, eigene PDF-Fenster bleiben in der App. Downloads landen im Benutzerordner „Downloads“; vorhandene Dateinamen erhalten einen nummerierten Zusatz. Eine zweite App-Instanz fokussiert das vorhandene Fenster. Beim Beenden oder Verlust des Elternprozesses beendet sich auch das Backend.

## Release und Homebrew

`package.json` ist die Versionsquelle. Publish, Desktop-Build und Laufzeitvorbereitung übernehmen diese Version automatisch in `[package].version` von `src-tauri/Cargo.toml`, die Tauri-Konfiguration und die Anwendungs-Einträge in Cargo-/npm-Lockdateien. Abhängigkeiten behalten ihre Versionen. Mit `npm run version:sync` lässt sich die Synchronisierung auch separat ausführen. Für eine echte Veröffentlichung müssen die synchronisierten Dateien anschließend mit den gewünschten Änderungen selbst committet und gepusht sein; das Skript erstellt dafür keine automatischen Quellcode-Commits.

Release-Titel und Release-Text kommen aus `docs/changelog.md`: Verwendet wird die oberste Versionsüberschrift, die exakt zur Version aus `package.json` passt, und ihr zugehöriger Inhalt. Beispielsweise wird bei Version `0.4.2` die Überschrift `# 0.4.2` zum GitHub-Titel und der Inhalt bis zur nächsten Release-Überschrift zum Text. Unterüberschriften und Codeblöcke bleiben erhalten; ältere Versionen werden nicht angehängt. Fehlt der passende Abschnitt oder enthält er keinen Text, bricht Publish vor dem Build und vor GitHub-Änderungen mit einer Fehlermeldung ab.

```sh
npm run publish -- --dry-run
```

Der Dry-Run führt Formatprüfung, Backend- und native Tests aus, baut App/DMG und bereitet `Casks/pitchary.rb` sowie `release-notes.md` im lokalen Release-Verzeichnis vor. Er erstellt keine Tags, GitHub-Releases, Tap-Änderungen, Commits oder Pushes. Ein bereits gebautes, unverändertes Paket kann mit `--skip-build` geprüft werden; Quell- und DMG-Prüfsummen müssen weiterhin passen.

```sh
npm run publish
```

Dieser ausdrücklich gestartete Publish-Aufruf prüft einen sauberen, bereits auf GitHub vorhandenen Quellstand, Versionsgleichheit, GitHub-Schreibrechte und den sauberen Tap mit korrektem `origin`. Er baut und prüft das Paket, erstellt einen Release-Entwurf unter `https://github.com/oliverjessner/pitchary/releases` und lädt die DMG sowie `SHA256SUMS` dort hoch. Nach erneutem Herunterladen zur Prüfsummenverifikation veröffentlicht er den Release. Ein Tag muss nicht vorher von Hand angelegt werden; ein fehlender Tag wird beim ersten Release akzeptiert. Danach schreibt er `Casks/pitchary.rb` nach **`../homebrew-tap`**, führt `brew style` aus, committet ausschließlich diesen Cask und pusht den Tap. Der Pitchary-Checkout wird vom Skript weder committet noch gepusht.

`--tap-path /absoluter/pfad` wählt einen anderen Checkout von `oliverjessner/homebrew-tap`; `--skip-brew` veröffentlicht nur den GitHub-Release. Bereits veröffentlichte Assets oder Tags werden nie ersetzt. Bei einem Teilfehler lässt sich mit `npm run publish -- --skip-build` fortsetzen, sofern das Paket unverändert ist. Falls ein Tap-Commit bereits angelegt, sein Push aber fehlgeschlagen ist, diesen Commit zuerst selbst pushen; der Preflight verweigert das Mitsenden unbekannter lokaler Commits.

Nach erfolgreicher Veröffentlichung lautet die Installation:

```sh
brew install --cask oliverjessner/tap/pitchary
```

## Durchgeführte Prüfungen

Die Backend-/Release-Tests sowie der native Test für Start, Datenordner und Prozessende bestehen. Das App-Bundle wurde mit temporären Testdaten nativ gestartet; ohne Sitzung ist sein Backend gesperrt und nach Beenden des Elternprozesses nicht mehr erreichbar. PDF-Textextraktion und echte Bild-OCR wurden ausschließlich mit den gebündelten Werkzeugen und einem PATH ohne Homebrew geprüft. Chromium und WebKit prüfen gegen das fertige Bundle Sitzungsstart, Kundenanlage und Reload sowie PDF-Upload und unveränderten Abruf. Signaturprüfung, DMG-Verifikation, Publish-Dry-Run und `brew style` für den erzeugten Cask bestehen. Die Release-Tests prüfen zusätzlich die Reihenfolge von Erstellung, DMG-Upload, Verifikation und Veröffentlichung, den Abbruch bei falscher Prüfsumme, die Auswahl des passenden Changelog-Abschnitts und die automatische Versionsübernahme einschließlich unveränderter Abhängigkeitsversionen.

Die native Fensterautomation war in dieser Umgebung nicht verfügbar. Die direkte Bedienung der nativen Fenster, externe Links und die Anzeige zusätzlicher PDF-Fenster bleiben manuell zu prüfen. Es wurde kein Release veröffentlicht und kein Tap-Commit oder Push durchgeführt.
