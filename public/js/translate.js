import english from "./locales/en.js";
import errors from "./locales/errors.js";

export const languages = ["de", "en"];
export const localeFor = (language) => (language === "en" ? "en-GB" : "de-AT");
export function translate(source, language, parameters = {}) {
  const template =
    language === "en" && Object.hasOwn(english, source)
      ? english[source]
      : source;
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (token, key) =>
    Object.hasOwn(parameters, key) ? String(parameters[key]) : token,
  );
}

const patterns = Object.keys(errors)
  .filter((source) => /\{[a-zA-Z][\w]*\}/.test(source))
  .map((source) => {
    const keys = [];
    const escaped = source
      .split(/(\{[a-zA-Z][\w]*\})/g)
      .map((part) => {
        if (/^\{[a-zA-Z][\w]*\}$/.test(part)) {
          keys.push(part.slice(1, -1));
          return "(.*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { source, keys, pattern: new RegExp("^" + escaped + "$", "s") };
  });

// For controlled server messages whose placeholders have already been filled.
export function translateMessage(message, language) {
  if (typeof message !== "string" || language !== "en") return message;
  if (Object.hasOwn(errors, message)) return errors[message];
  for (const { source, keys, pattern } of patterns) {
    const match = pattern.exec(message);
    if (match)
      return translate(
        source,
        language,
        Object.fromEntries(keys.map((key, index) => [key, match[index + 1]])),
      );
  }
  return message;
}
