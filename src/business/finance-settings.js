import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { AppError, allowedKeys, text, invalid, choice } from "./validation.js";
import { extractionTools } from "./finance-extraction.js";
import { createFinanceProcessingRepository } from "../database/finance-processing-repository.js";
import {
  defaultRecognitionModel,
  recognitionModels,
  recognitionModelIds,
} from "../config/recognition-models.js";

export function normalizeKey(value) {
  if (typeof value !== "string")
    invalid(
      "Bitte einen gültigen OpenAI-Schlüssel eingeben.",
      "openai_api_key",
    );
  const key = value.replace(/[\s\u200B-\u200D\uFEFF]/g, "");
  if (!/^sk-[\x21-\x7e]{5,500}$/.test(key))
    invalid(
      "Bitte einen gültigen OpenAI-Schlüssel eingeben.",
      "openai_api_key",
    );
  return key;
}
export function createFinanceSettings(
  db,
  { clock = () => new Date(), keyPath, tools = extractionTools } = {},
) {
  const repo = createFinanceProcessingRepository(db);
  const filename = repo.databasePath();
  const secretPath = keyPath ?? (filename ? filename + ".finance-key" : null);
  let memoryKey;
  const now = () => {
    const value = clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  };
  const read = (key) => repo.setting(key);
  const write = (key, value) => repo.saveSetting(key, value, now());
  const model = () =>
    choice(
      read("recognition_model") || defaultRecognitionModel,
      recognitionModelIds,
      "model",
    );
  async function masterKey(create = false) {
    if (!secretPath) return (memoryKey ??= randomBytes(32));
    try {
      const bytes = await readFile(secretPath);
      if (bytes.length !== 32) throw new Error("invalid");
      return bytes;
    } catch (error) {
      if (error.code !== "ENOENT" || !create)
        throw new AppError(
          422,
          "key_unavailable",
          "Der gespeicherte Schlüssel kann hier nicht entschlüsselt werden. Bitte erneut eingeben.",
        );
      await mkdir(path.dirname(secretPath), { recursive: true, mode: 0o700 });
      const bytes = randomBytes(32);
      try {
        await writeFile(secretPath, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST") return masterKey();
        throw error;
      }
      return bytes;
    }
  }
  async function getKey() {
    const value = read("openai_api_key");
    if (!value) return null;
    try {
      const [iv, tag, data] = value
        .split(".")
        .map((v) => Buffer.from(v, "base64"));
      const cipher = createDecipheriv("aes-256-gcm", await masterKey(), iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString(
        "utf8",
      );
    } catch {
      throw new AppError(
        422,
        "key_unavailable",
        "Der gespeicherte Schlüssel kann hier nicht entschlüsselt werden. Bitte erneut eingeben.",
      );
    }
  }
  async function folder(value, field) {
    const supplied = text(value, field, { max: 4000 });
    if (!supplied) return "";
    const expanded = supplied.startsWith("~/")
      ? path.join(homedir(), supplied.slice(2))
      : supplied;
    if (!path.isAbsolute(expanded))
      invalid("Bitte einen absoluten Ordnerpfad eingeben.", field);
    try {
      const resolved = await realpath(expanded);
      if (!(await stat(resolved)).isDirectory())
        throw new Error("not directory");
      return resolved;
    } catch {
      invalid("Dieser Ordner ist nicht erreichbar.", field);
    }
  }
  const values = () =>
    Object.fromEntries(
      [
        "revenue_folder",
        "payable_folder",
        "company_name",
        "company_email",
        "company_address",
      ].map((key) => [key, read(key)]),
    );
  return {
    values,
    model,
    getKey,
    read,
    write,
    async public() {
      let last4 = null,
        keyError = false;
      const present = Boolean(read("openai_api_key"));
      if (present) {
        try {
          last4 = (await getKey()).slice(-4);
        } catch {
          keyError = true;
        }
      }
      return {
        ...values(),
        openai_api_key_present: present,
        openai_api_key_last4: last4,
        openai_api_key_error: keyError,
        model: model(),
        models: recognitionModels.map(({ id, label }) => ({ id, label })),
        tools: await tools(),
      };
    },
    async save(input) {
      if (input === null || typeof input !== "object" || Array.isArray(input))
        invalid("Einstellungen müssen als Objekt angegeben werden.");
      allowedKeys(input, [
        "revenue_folder",
        "payable_folder",
        "company_name",
        "company_email",
        "company_address",
        "openai_api_key",
        "model",
      ]);
      const patch = {};
      if (Object.hasOwn(input, "model"))
        patch.recognition_model = choice(
          input.model,
          recognitionModelIds,
          "model",
        );
      for (const field of ["revenue_folder", "payable_folder"])
        if (field in input) patch[field] = await folder(input[field], field);
      const combined = { ...values(), ...patch };
      if (
        combined.revenue_folder &&
        combined.payable_folder &&
        (combined.revenue_folder === combined.payable_folder ||
          combined.revenue_folder.startsWith(
            combined.payable_folder + path.sep,
          ) ||
          combined.payable_folder.startsWith(
            combined.revenue_folder + path.sep,
          ))
      )
        invalid(
          "Einnahmen und Ausgaben brauchen getrennte Ordner.",
          "payable_folder",
        );
      for (const field of ["company_name", "company_email", "company_address"])
        if (field in input)
          patch[field] = text(input[field], field, {
            max: field === "company_address" ? 4000 : 200,
          });
      if (
        patch.company_email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.company_email)
      )
        invalid("Bitte eine gültige E-Mail-Adresse eingeben.", "company_email");
      if (
        input.openai_api_key !== undefined &&
        typeof input.openai_api_key !== "string"
      )
        invalid("Ungültiger Schlüssel.", "openai_api_key");
      if (
        typeof input.openai_api_key === "string" &&
        input.openai_api_key.trim()
      ) {
        const key = normalizeKey(input.openai_api_key);
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", await masterKey(true), iv);
        const encrypted = Buffer.concat([
          cipher.update(key, "utf8"),
          cipher.final(),
        ]);
        patch.openai_api_key = [iv, cipher.getAuthTag(), encrypted]
          .map((v) => v.toString("base64"))
          .join(".");
      }
      repo.transaction(() => {
        for (const [key, value] of Object.entries(patch)) write(key, value);
      });
      return this.public();
    },
    removeKey() {
      repo.removeSetting("openai_api_key");
      return { ok: true };
    },
  };
}
