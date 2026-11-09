import { allowedKeys, choice, invalid } from "./validation.js";

export function createAppSettings(db, { clock = () => new Date() } = {}) {
  const get = () => ({
    language: db.prepare("SELECT language FROM app_settings WHERE id=1").get()
      .language,
  });
  return {
    get,
    save(input) {
      if (!input || typeof input !== "object" || Array.isArray(input))
        invalid("Einstellungen müssen als Objekt angegeben werden.");
      allowedKeys(input, ["language"]);
      const language = choice(
        Object.hasOwn(input, "language") ? input.language : undefined,
        ["de", "en"],
        "language",
      );
      db.prepare(
        "UPDATE app_settings SET language=?,updated_at=? WHERE id=1",
      ).run(language, new Date(clock()).toISOString());
      return get();
    },
  };
}
