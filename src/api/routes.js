import { createAnalytics } from "../business/analytics.js";
const idSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
};
const object = { type: "object", additionalProperties: true };
export async function registerAPI(app, crm) {
  const schema = { params: idSchema };
  const bodySchema = { params: idSchema, body: object };
  app.get("/api/health", () => ({ status: "ok", application: "pitchary" }));
  app.get("/api/pitch-channels", () => crm.repo.pitchChannels());
  app.get("/api/service-tags", () => crm.listTags());
  app.post(
    "/api/service-tags",
    { schema: { body: object } },
    (request, reply) => reply.code(201).send(crm.createTag(request.body)),
  );
  app.patch("/api/service-tags/:id", { schema: bodySchema }, (request) =>
    crm.updateTag(request.params.id, request.body),
  );
  app.delete("/api/service-tags/:id", { schema }, (request) =>
    crm.deleteTag(request.params.id),
  );
  app.get("/api/customers/:id/logo", { schema }, (request, reply) => {
    const image = crm.customerLogo(request.params.id);
    return reply
      .type(image.mime)
      .header("Content-Disposition", "inline")
      .send(image.data);
  });
  for (const name of ["customers", "employees", "services"]) {
    app.get(`/api/${name}`, (request) => crm.listEntities(name, request.query));
    app.get(`/api/${name}/:id`, { schema }, (request) =>
      crm.entity(name, request.params.id),
    );
    app.post(
      `/api/${name}`,
      {
        schema: { body: object },
        ...(name === "customers" ? { bodyLimit: 1500000 } : {}),
      },
      async (request, reply) => {
        let result = crm.createEntity(name, request.body);
        if (
          name === "customers" &&
          request.body.logo !== null &&
          !result.has_logo &&
          (result.general_email || result.website)
        )
          result = await app.customerLogoDiscovery.enrich(result.id);
        return reply.code(201).send(result);
      },
    );
    app.patch(
      `/api/${name}/:id`,
      {
        schema: bodySchema,
        ...(name === "customers" ? { bodyLimit: 1500000 } : {}),
      },
      (request) => crm.updateEntity(name, request.params.id, request.body),
    );
    app.delete(`/api/${name}/:id`, { schema }, (request) =>
      crm.archive(name, request.params.id),
    );
    app.post(`/api/${name}/:id/restore`, { schema }, (request) =>
      crm.archive(name, request.params.id, false),
    );
  }
  app.get("/api/customer-services", (request) =>
    crm.relationships(request.query),
  );
  app.get("/api/customer-services/:id", { schema }, (request) =>
    crm.relationship(request.params.id),
  );
  app.post(
    "/api/customer-services",
    { schema: { body: object } },
    (request, reply) =>
      reply.code(201).send(crm.createRelationship(request.body)),
  );
  app.post(
    "/api/customer-services/batch",
    { schema: { body: object } },
    (request, reply) =>
      reply.code(201).send(crm.createRelationships(request.body)),
  );
  app.patch("/api/customer-services/:id", { schema: bodySchema }, (request) =>
    crm.updateRelationship(request.params.id, request.body),
  );
  app.delete("/api/customer-services/:id", { schema }, (request) =>
    crm.archive("customer_services", request.params.id),
  );
  app.delete("/api/customer-services/:id/permanent", { schema }, (request) =>
    crm.deleteRelationship(request.params.id),
  );
  app.post("/api/customer-services/:id/restore", { schema }, (request) =>
    crm.archive("customer_services", request.params.id, false),
  );
  app.post(
    "/api/customer-services/:id/status",
    { schema: bodySchema },
    (request) => crm.changeStatus(request.params.id, request.body),
  );
  app.post(
    "/api/customer-services/:id/prices",
    { schema: bodySchema },
    (request) => crm.changePrice(request.params.id, request.body),
  );
  app.get(
    "/api/customer-services/:id/activities",
    { schema },
    (request) => crm.relationship(request.params.id).activities,
  );
  app.post(
    "/api/customer-services/:id/activities",
    { schema: bodySchema },
    (request, reply) =>
      reply.code(201).send(crm.addActivity(request.params.id, request.body)),
  );
  app.get("/api/activities", (request) => crm.activities(request.query));
  const analytics = createAnalytics(crm.repo);
  app.get("/api/analytics", (request) => analytics(request.query));
}
