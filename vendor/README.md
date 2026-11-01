# OJ-Designsystem

`oj-designsystem` wird als reguläre npm-Abhängigkeit installiert. Version und Integrität stehen in `package-lock.json`; ein benachbartes Repository oder ein manuell erstelltes Archiv ist nicht erforderlich.

`npm install` und `npm ci` synchronisieren über `postinstall` die installierte Distribution einschließlich Fonts und Lizenzhinweisen nach `public/vendor/oj-designsystem`. Die App lädt diese Assets lokal und funktioniert weiter ohne CDN. Die Desktop-Vorbereitung übernimmt diese synchronisierten Dateien.

Auf die neueste veröffentlichte Version aktualisieren:

```sh
npm run update:designsystem
```

Der Befehl aktualisiert die npm-Abhängigkeit und den Lockfile und synchronisiert anschließend die Browser-Assets. Danach `package.json`, `package-lock.json` und die Änderungen in `public/vendor/oj-designsystem` zusammen committen. Zum reinen erneuten Synchronisieren: `npm run sync:designsystem`.
