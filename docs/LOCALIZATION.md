# Localization

Pitchary supports German (`de`, default) and English (`en`). The language is stored in SQLite through `GET /api/settings` and `PATCH /api/settings` with `{ "language": "en" }`; it survives desktop restarts and changes of the local server port. The settings page saves the preference and reloads the current route.

Import `t` from `public/js/i18n.js` for every authored interface string, including accessible labels, helper text, errors, confirmations and empty states. German source strings are stable translation keys; add their English translation to the appropriate file in `public/js/locales/`. Reuse an existing key when the meaning is identical. For different meanings, use a more specific source phrase.

```js
t("Angebot für {name}", { name: customer.name });
```

Use named placeholders rather than translating string fragments. Both translations must contain the same placeholders. Keep identifiers, API payloads and saved customer names, notes, tags and invoice text unchanged; translate only authored labels. Built-in pitch-channel labels are translated when they still match their shipped defaults; custom channel labels remain as configured.

Use `getLocale()` for `Intl` number, currency, date and sorting operations. Locale-independent business dates remain `YYYY-MM-DD`; their displayed form follows the selected language. `Europe/Vienna` remains the business timezone. New interface work must cover both languages.

Controlled server errors are translated from their source templates when the request sends `Accept-Language: en`; field names, error codes and substituted values remain unchanged. Catalog and browser regression tests cover translation completeness, placeholders, persisted settings, navigation and forms. Run `npm test` and `npm run test:ui` after changing translations.
