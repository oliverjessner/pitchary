import {
  languages,
  localeFor,
  translate,
  translateMessage,
} from "./translate.js";

let language = "de";
export const getLanguage = () => language;
export const getLocale = () => localeFor(language);
export const t = (source, parameters) =>
  translate(source, language, parameters);
export const localizedMessage = (message) =>
  translateMessage(message, language);

// Read SQLite-backed preferences on every launch; desktop origins use dynamic ports.
if (typeof window !== "undefined") {
  try {
    const response = await fetch("/api/settings");
    if (response.ok) {
      const settings = await response.json();
      if (languages.includes(settings.language)) language = settings.language;
    }
  } catch {
    // The normal route error UI handles unavailable servers; German remains the default.
  }
  document.documentElement.lang = language;
}
