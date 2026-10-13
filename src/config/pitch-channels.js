import definitions from "../../public/config/pitch-channels.json" with { type: "json" };
import { readFileSync } from "node:fs";

export function validatePitchChannels(input) {
  if (!Array.isArray(input) || !input.length)
    throw new Error("Pitch-Kanäle: Eine nicht leere JSON-Liste wird benötigt.");
  const ids = new Set();
  return input.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.label !== "string" ||
      !entry.label.trim() ||
      entry.label.trim().length > 80
    )
      throw new Error(
        "Pitch-Kanäle: Jeder Eintrag benötigt eine eindeutige id und ein label (maximal 80 Zeichen).",
      );
    ids.add(entry.id);
    return { id: entry.id, label: entry.label.trim() };
  });
}
export const pitchChannels = validatePitchChannels(definitions);
export const loadPitchChannels = (filename) =>
  filename
    ? validatePitchChannels(JSON.parse(readFileSync(filename, "utf8")))
    : pitchChannels;

export function syncPitchChannels(db, definitions) {
  const statement = db.prepare(
    "INSERT INTO pitch_channels(id,label,sort_order) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,sort_order=excluded.sort_order",
  );
  definitions.forEach((entry, index) =>
    statement.run(entry.id, entry.label, index),
  );
}
