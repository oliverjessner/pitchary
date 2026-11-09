import { t, getLanguage, localizedMessage } from "./i18n.js";

export async function api(path, { method = "GET", body, query } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== "" && value !== undefined && value !== null)
      params.set(key, String(value));
  const response = await fetch(
    "/api" + path + (params.size ? "?" + params : ""),
    {
      method,
      headers: {
        "Accept-Language": getLanguage(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      localizedMessage(result.error?.message ?? t("Anfrage fehlgeschlagen.")),
    );
    error.fields = result.error?.fields;
    throw error;
  }
  return result;
}
