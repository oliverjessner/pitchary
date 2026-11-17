import { AppError } from "../business/validation.js";

const base = "/api/finance/creation";
const idSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
};

function document(reply, data, name, type, download = false) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\/]/g, "_");
  return reply
    .type(type)
    .header(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
    .send(data);
}

export function registerInvoiceCreationAPI(app, creation) {
  const schema = { params: idSchema };
  const bodyLimit = 2 * 1024 * 1024;
  app.get(base + "/options", (request) => creation.options(request.query));
  app.get(base + "/settings", () => creation.settings());
  app.patch(base + "/settings", { bodyLimit }, (request) =>
    creation.saveSettings(request.body),
  );
  app.get(base + "/profiles/:id", { schema }, (request) =>
    creation.profile(request.params.id),
  );
  app.patch(base + "/profiles/:id", { schema }, (request) =>
    creation.saveProfile(request.params.id, request.body),
  );
  app.post(base + "/calculate", { bodyLimit }, (request) =>
    creation.calculate(request.body),
  );
  app.get(base + "/drafts", (request) => ({
    items: creation.list(request.query),
  }));
  app.post(base + "/drafts", { bodyLimit }, async (request, reply) =>
    reply.code(201).send(await creation.create(request.body)),
  );
  app.get(base + "/drafts/:id", { schema }, (request) =>
    creation.get(request.params.id),
  );
  app.patch(base + "/drafts/:id", { schema, bodyLimit }, (request) =>
    creation.update(request.params.id, request.body),
  );
  app.delete(base + "/drafts/:id", { schema }, (request) =>
    creation.remove(request.params.id),
  );
  const preview = async (request, reply) => {
    const file = await creation.preview(request.params.id);
    return document(reply, file.data, file.name, "application/pdf");
  };
  app.get(base + "/drafts/:id/preview", { schema }, preview);
  app.post(base + "/drafts/:id/preview", { schema }, preview);
  app.post(base + "/drafts/:id/finalize", { schema }, (request) =>
    creation.finalize(request.params.id, request.body),
  );
  app.get("/api/finance/invoices/:id/xml", { schema }, (request, reply) => {
    const file = creation.xml(request.params.id);
    if (!file)
      throw new AppError(
        404,
        "xml_unavailable",
        "Für diese Rechnung ist keine E-Rechnung gespeichert.",
      );
    return document(reply, file.data, file.name, "application/xml", true);
  });
}
