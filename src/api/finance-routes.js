const idSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
};
const object = { type: "object", additionalProperties: true };
export async function registerFinanceAPI(app, finance) {
  const schema = { params: idSchema };
  const bodySchema = { params: idSchema, body: object };
  app.get("/api/finance/invoices", (request) => ({
    items: finance.list(request.query),
    years: finance.years(request.query),
  }));
  app.get("/api/finance/invoices/:id", { schema }, (request) =>
    finance.get(request.params.id),
  );
  app.patch("/api/finance/invoices/:id", { schema: bodySchema }, (request) =>
    finance.update(request.params.id, request.body),
  );
  app.delete("/api/finance/invoices/:id", { schema }, (request) =>
    finance.remove(request.params.id),
  );
  app.post(
    "/api/finance/invoices/:id/reset",
    { schema: bodySchema },
    (request) => {
      const keys = Object.keys(request.body);
      if (keys.some((key) => key !== "field")) {
        const error = new Error("Nur das Feld field ist hier erlaubt.");
        error.status = 422;
        error.code = "validation_error";
        throw error;
      }
      return finance.reset(request.params.id, request.body.field ?? null);
    },
  );
  app.get("/api/finance/invoices/:id/logs", { schema }, (request) => ({
    items: finance.logs(request.params.id),
  }));
  app.get("/api/finance/invoices/:id/file", { schema }, (request, reply) => {
    const file = finance.file(request.params.id);
    const name = file.name
      .replace(/[\r\n"\\/]/g, "_")
      .replace(/[^\x20-\x7E]/g, "_");
    return reply
      .type("application/pdf")
      .header(
        "Content-Disposition",
        `inline; filename="${name || "Rechnung.pdf"}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .send(file.data);
  });
  app.get("/api/finance/dashboard", (request) =>
    finance.dashboard(request.query),
  );
  app.get("/api/finance/customers", (request) => ({
    items: finance.customers(request.query),
  }));
  app.get("/api/finance/customers/:id", { schema }, (request) =>
    finance.customer(request.params.id),
  );
  app.patch("/api/finance/customers/:id", { schema: bodySchema }, (request) =>
    finance.updateCustomer(request.params.id, request.body),
  );
}
