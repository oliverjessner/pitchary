import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { openDatabase, projectRoot } from "../database/database.js";
import { createCRM } from "../business/crm.js";
import { AppError } from "../business/validation.js";
import { registerAPI } from "../api/routes.js";
import { createFinance } from "../business/finance.js";
import { createFinanceSettings } from "../business/finance-settings.js";
import { createInvoiceProcessor } from "../business/invoice-processor.js";
import { registerFinanceAPI } from "../api/finance-routes.js";
import { registerFinanceProcessingAPI } from "../api/finance-processing-routes.js";
import { createCustomerMerge } from "../business/customer-merge.js";
import { registerCustomerAliases } from "../api/customer-aliases.js";
export async function buildApp({
  databasePath,
  db,
  logger = false,
  clock,
  financeOptions = {},
} = {}) {
  const database = db ?? openDatabase(databasePath);
  const app = Fastify({ logger, bodyLimit: 131072 });
  app.decorate("crm", createCRM(database, { clock }));
  app.decorate("database", database);
  const customerMerge = createCustomerMerge(database);
  app.decorate("customerMerge", customerMerge);
  registerCustomerAliases(app, customerMerge);
  const finance = createFinance(database, { clock });
  const settings = createFinanceSettings(database, {
    clock,
    ...financeOptions.settings,
  });
  const processor = createInvoiceProcessor(database, finance, settings, {
    clock,
    ...financeOptions,
  });
  app.decorate("finance", finance);
  app.decorate("financeSettings", settings);
  app.decorate("invoiceProcessor", processor);
  app.addHook("onReady", async () => processor.start());
  app.addHook("onClose", async () => {
    await processor.close();
    if (!db) database.close();
  });
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host;
    if (host && !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host))
      throw new AppError(
        403,
        "invalid_host",
        "Nur lokale Zugriffe sind erlaubt.",
      );
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`)
      throw new AppError(
        403,
        "invalid_origin",
        "Anfragen von fremden Websites sind nicht erlaubt.",
      );
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers["sec-fetch-site"] === "cross-site"
    )
      throw new AppError(
        403,
        "invalid_origin",
        "Anfragen von fremden Websites sind nicht erlaubt.",
      );
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    if (request.url.startsWith("/api"))
      reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error.status ?? error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    reply.code(status).send({
      error: {
        code:
          error.code ??
          (error.validation ? "invalid_request" : "internal_error"),
        message:
          status >= 500
            ? "Interner Fehler. Bitte Serverprotokoll prüfen."
            : error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        ...(error.validation ? { details: error.validation } : {}),
      },
    });
  });
  await registerAPI(app, app.crm);
  await registerFinanceAPI(app, finance);
  await registerFinanceProcessingAPI(app, finance, settings, processor);
  await app.register(fastifyStatic, {
    root: path.join(projectRoot, "public"),
    prefix: "/",
    index: "index.html",
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: "not_found", message: "Endpunkt nicht gefunden." },
    }),
  );
  return app;
}
