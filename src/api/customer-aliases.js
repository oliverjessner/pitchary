export function registerCustomerAliases(app, customerMerge) {
  app.addHook("preHandler", async (request) => {
    const route = request.routeOptions.url ?? "";
    if (
      request.params?.id &&
      (/^\/api\/customers\/:id(?:\/|$)/.test(route) ||
        /^\/api\/finance\/customers\/:id$/.test(route))
    )
      request.params.id = customerMerge.resolve(request.params.id);
    if (route.startsWith("/api/") && request.query?.customer_id)
      request.query.customer_id = customerMerge.resolve(
        request.query.customer_id,
      );
  });
}
