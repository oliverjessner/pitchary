// Chat Completions, strict Structured Outputs and reasoning parameters checked
// against the official OpenAI model pages/guide on 2026-10-13.
// https://developers.openai.com/api/docs/guides/latest-model
export const defaultRecognitionModel = "gpt-4o-mini";
const standard = Object.freeze({
  temperature: 0.1,
  max_completion_tokens: 4000,
});
const reasoning = Object.freeze({
  reasoning_effort: "low",
  max_completion_tokens: 12000,
});
export const recognitionModels = Object.freeze([
  Object.freeze({
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    parameters: standard,
  }),
  Object.freeze({
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    parameters: standard,
  }),
  Object.freeze({ id: "gpt-4.1", label: "GPT-4.1", parameters: standard }),
  Object.freeze({
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    parameters: Object.freeze({ ...standard, reasoning_effort: "none" }),
  }),
  Object.freeze({
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    parameters: reasoning,
  }),
  Object.freeze({
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    parameters: reasoning,
  }),
]);
export const recognitionModelIds = Object.freeze(
  recognitionModels.map(({ id }) => id),
);
