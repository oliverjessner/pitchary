// Chat Completions and strict Structured Outputs support checked against the
// official OpenAI model pages on 2026-10-13. Availability depends on API access.
export const defaultRecognitionModel = "gpt-4o-mini";
export const recognitionModels = Object.freeze([
  Object.freeze({ id: "gpt-4o-mini", label: "GPT-4o Mini" }),
  Object.freeze({ id: "gpt-4.1-mini", label: "GPT-4.1 Mini" }),
  Object.freeze({ id: "gpt-4.1", label: "GPT-4.1" }),
]);
export const recognitionModelIds = Object.freeze(
  recognitionModels.map(({ id }) => id),
);
