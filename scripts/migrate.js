import { openDatabase, defaultDatabasePath } from "../src/database/database.js";
const db = openDatabase();
console.log(
  `Schema ${db.prepare("PRAGMA user_version").get().user_version}: ${defaultDatabasePath}`,
);
db.close();
