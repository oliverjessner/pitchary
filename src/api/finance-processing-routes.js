import { backup } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { defaultDatabasePath, projectRoot } from "../database/database.js";
import { AppError, allowedKeys, choice, text } from "../business/validation.js";
import { MAX_PDF_BYTES } from "../business/finance-extraction.js";
import { normalizeKey } from "../business/finance-settings.js";
import { inspectLegacy, importLegacy } from "../business/legacy-import.js";
import { resolveImportSource } from "../config/import-source.js";
import { applicationVersion } from "../config/application.js";

export async function registerFinanceProcessingAPI(
  app,
  finance,
  settings,
  processor,
) {
  const objectBody = {
    schema: { body: { type: "object", additionalProperties: true } },
  };
  app.get("/api/finance/settings", async () => ({
    ...(await settings.public()),
    app_version: applicationVersion,
    watcher: { ...processor.state },
  }));
  app.patch("/api/finance/settings", objectBody, async (request) => {
    const result = await settings.save(request.body ?? {});
    processor.start();
    return {
      ...result,
      app_version: applicationVersion,
      watcher: { ...processor.state },
    };
  });
  app.delete("/api/finance/settings/key", async () => settings.removeKey());
  app.post("/api/finance/settings/test-key", objectBody, async (request) => {
    allowedKeys(request.body ?? {}, ["api_key", "model"]);
    return processor.testKey(
      request.body?.api_key ? normalizeKey(request.body.api_key) : null,
      request.body?.model,
    );
  });
  app.post("/api/finance/scan", async () => processor.scan({ settle: true }));
  app.post(
    "/api/finance/import",
    { ...objectBody, bodyLimit: Math.ceil((MAX_PDF_BYTES * 4) / 3) + 4096 },
    async (request) => {
      const body = request.body ?? {};
      allowedKeys(body, ["category", "file_name", "data"]);
      choice(body.category, ["revenue", "payable"], "category");
      text(body.file_name, "file_name", { required: true, max: 255 });
      if (
        typeof body.data !== "string" ||
        body.data.length % 4 ||
        body.data.length > Math.ceil((MAX_PDF_BYTES * 4) / 3) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)
      )
        throw new AppError(
          422,
          "invalid_pdf",
          "Bitte eine PDF-Datei bis 20 MB auswählen.",
        );
      const data = Buffer.from(body.data, "base64");
      if (data.toString("base64") !== body.data)
        throw new AppError(422, "invalid_pdf", "Ungültige PDF-Datei.");
      return processor.upload(data, {
        category: body.category,
        file_name: body.file_name,
      });
    },
  );
  app.post("/api/finance/invoices/:id/reprocess", async (request) =>
    processor.reprocess(request.params.id),
  );
  app.post("/api/finance/customers/:id/enrich", async (request) =>
    processor.enrich(request.params.id),
  );
  app.get("/api/finance/legacy/inspect", async (request) =>
    inspectLegacy(resolveImportSource(request.query.source)),
  );
  app.post("/api/finance/legacy/import", objectBody, async (request) => {
    allowedKeys(request.body ?? {}, ["source"]);
    const source = resolveImportSource(request.body?.source);
    inspectLegacy(source);
    const filename =
      finance.databasePath === ":memory:" ? null : finance.databasePath;
    if (filename && path.resolve(source) === path.resolve(filename))
      throw new AppError(
        422,
        "invalid_source",
        "Quell- und Zieldatenbank müssen verschieden sein.",
      );
    let snapshot = null;
    if (filename) {
      const directory =
        path.resolve(filename) === defaultDatabasePath
          ? path.join(projectRoot, "backups")
          : path.join(path.dirname(filename), "backups");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      snapshot = path.join(
        directory,
        `pitchary-before-legacy-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
      );
      await backup(app.database, snapshot);
    }
    const result = await importLegacy(source, finance, { dryRun: false });
    return { ...result, backup: snapshot };
  });
}
