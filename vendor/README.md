# OJ-Designsystem

`oj-designsystem-0.2.2.tgz` ist ein lokal erstelltes Paket aus dem benachbarten Repository `../oj-designsystem`. Es behebt den Scrollversatz langer Multiselect-Listen und hält per Tastatur fokussierte Optionen sichtbar. Dieser Stand ist lokal vorbereitet und nicht auf npm veröffentlicht.

Die Abhängigkeit in `package.json` und die Integrität in `package-lock.json` verweisen auf dieses Archiv. Dadurch funktionieren `npm ci` und die Desktop-Vorbereitung ohne Zugriff auf das benachbarte Repository.

Das Archiv nach Änderungen im Designsystem neu erstellen:

```sh
cd ../oj-designsystem
npm run build
npm pack --ignore-scripts --pack-destination ../pitchary/vendor
cd ../pitchary
npm install --save-exact ./vendor/oj-designsystem-0.2.2.tgz
npm run sync:designsystem
```
