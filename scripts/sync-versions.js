import { syncVersions, version } from "./desktop-common.js";
if (!syncVersions().length)
  console.log(`Desktop versions already match ${version}.`);
