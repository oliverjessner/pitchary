const tables = new Set([
  "customers",
  "employees",
  "services",
  "customer_services",
  "customer_service_status_history",
  "activities",
  "service_tags",
]);
const joins = `SELECT cs.*, c.name AS customer_name, c.archived_at AS customer_archived_at, c.logo_data IS NOT NULL AS customer_has_logo, c.updated_at AS customer_updated_at, s.name AS service_name, s.archived_at AS service_archived_at, e.name AS employee_name FROM customer_services cs JOIN customers c ON c.id=cs.customer_id JOIN services s ON s.id=cs.service_id LEFT JOIN employees e ON e.id=cs.primary_employee_id`;
const projection = (name) =>
  name === "customers"
    ? "id,name,note,website,logo_mime,created_at,updated_at,archived_at,customer_type,logo_data IS NOT NULL AS has_logo,COALESCE((SELECT general_email FROM finance_customer_profiles WHERE customer_id=customers.id),'') AS general_email"
    : name === "service_tags"
      ? "id,name,note,color,created_at,updated_at"
      : "*";
export function createRepository(db) {
  const table = (name) => {
    if (!tables.has(name)) throw new Error("Unknown repository");
    return name;
  };
  return {
    pitchChannels: () =>
      db
        .prepare("SELECT id,label FROM pitch_channels ORDER BY sort_order,id")
        .all(),
    tags: () =>
      db
        .prepare(
          "SELECT t.id,t.name,t.note,t.color,t.created_at,t.updated_at,count(a.service_id) AS service_count FROM service_tags t LEFT JOIN service_tag_assignments a ON a.tag_id=t.id GROUP BY t.id ORDER BY t.name_key,t.id",
        )
        .all(),
    tagByKey: (key) =>
      db.prepare("SELECT id FROM service_tags WHERE name_key=?").get(key),
    serviceTags: (id) =>
      db
        .prepare(
          `SELECT t.id,t.name,t.note,t.color,a.service_id FROM service_tags t JOIN service_tag_assignments a ON a.tag_id=t.id ${id ? "WHERE a.service_id=?" : ""} ORDER BY t.name_key,t.id`,
        )
        .all(...(id ? [id] : [])),
    replaceServiceTags(id, tagIds) {
      db.prepare("DELETE FROM service_tag_assignments WHERE service_id=?").run(
        id,
      );
      const insert = db.prepare(
        "INSERT INTO service_tag_assignments(service_id,tag_id) VALUES(?,?)",
      );
      tagIds.forEach((tagId) => insert.run(id, tagId));
    },
    deleteTag: (id) =>
      db.prepare("DELETE FROM service_tags WHERE id=?").run(id),
    get: (name, id) =>
      db
        .prepare(`SELECT ${projection(name)} FROM ${table(name)} WHERE id=?`)
        .get(id),
    customerLogo: (id) =>
      db
        .prepare("SELECT logo_data,logo_mime FROM customers WHERE id=?")
        .get(id),
    saveCustomerEmail(id, email, at) {
      db.prepare(
        "INSERT INTO finance_customer_profiles(customer_id,general_email,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET general_email=excluded.general_email,updated_at=excluded.updated_at",
      ).run(id, email, at, at);
    },
    list(name, { archived = false, search = "", customer_id } = {}) {
      const clauses = ["archived_at IS " + (archived ? "NOT NULL" : "NULL")];
      const params = [];
      if (search) {
        const fields = [
          "name",
          name === "employees" ? "email" : "note",
          ...(name === "customers"
            ? [
                "website",
                "COALESCE((SELECT general_email FROM finance_customer_profiles WHERE customer_id=customers.id),'')",
              ]
            : []),
        ];
        clauses.push(
          "(" +
            fields.map((field) => field + " LIKE ? ESCAPE '\\'").join(" OR ") +
            (name === "services"
              ? " OR EXISTS (SELECT 1 FROM service_tag_assignments a JOIN service_tags t ON t.id=a.tag_id WHERE a.service_id=services.id AND t.name LIKE ? ESCAPE '\\')"
              : "") +
            ")",
        );
        const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
        params.push(...fields.map(() => term));
        if (name === "services") params.push(term);
      }
      if (customer_id) {
        clauses.push("customer_id=?");
        params.push(customer_id);
      }
      return db
        .prepare(
          `SELECT ${projection(name)} FROM ${table(name)} WHERE ${clauses.join(" AND ")} ORDER BY name COLLATE NOCASE,id`,
        )
        .all(...params);
    },
    insert(name, record) {
      const keys = Object.keys(record);
      db.prepare(
        `INSERT INTO ${table(name)} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ).run(...Object.values(record));
      return record;
    },
    update(name, id, record) {
      const keys = Object.keys(record);
      db.prepare(
        `UPDATE ${table(name)} SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
      ).run(...Object.values(record), id);
      return this.get(name, id);
    },
    relationships(filters = {}) {
      const clauses = [],
        params = [];
      for (const key of [
        "customer_id",
        "service_id",
        "pitch_channel",
        "status",
      ])
        if (filters[key]) {
          clauses.push(`cs.${key}=?`);
          params.push(filters[key]);
        }
      if (filters.archived !== undefined) {
        clauses.push(
          "cs.archived_at IS " + (filters.archived ? "NOT NULL" : "NULL"),
        );
      }
      if (filters.from) {
        clauses.push("cs.created_at>=?");
        params.push(filters.from + "T00:00:00.000Z");
      }
      if (filters.to) {
        clauses.push("cs.created_at<=?");
        params.push(filters.to + "T23:59:59.999Z");
      }
      return db
        .prepare(
          joins +
            (clauses.length ? " WHERE " + clauses.join(" AND ") : "") +
            " ORDER BY cs.created_at DESC,cs.id",
        )
        .all(...params);
    },
    relationship: (id) => db.prepare(joins + " WHERE cs.id=?").get(id),
    deleteRelationship: (id) =>
      db.prepare("DELETE FROM customer_services WHERE id=?").run(id),
    history: (id) =>
      db
        .prepare(
          "SELECT * FROM customer_service_status_history WHERE customer_service_id=? ORDER BY occurred_at,recorded_at,rowid",
        )
        .all(id),
    activities(id) {
      return db
        .prepare(
          `SELECT a.*,e.name AS employee_name,c.name AS customer_name,s.name AS service_name,cs.currency FROM activities a LEFT JOIN employees e ON e.id=a.employee_id JOIN customer_services cs ON cs.id=a.customer_service_id JOIN customers c ON c.id=cs.customer_id JOIN services s ON s.id=cs.service_id ${id ? "WHERE a.customer_service_id=?" : ""} ORDER BY a.occurred_at DESC,a.rowid DESC`,
        )
        .all(...(id ? [id] : []));
    },
    allHistory: () =>
      db
        .prepare(
          "SELECT * FROM customer_service_status_history ORDER BY occurred_at,recorded_at,rowid",
        )
        .all(),
    counts: () =>
      Object.fromEntries(
        ["customers", "services", "customer_services"].map((t) => [
          t,
          db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n,
        ]),
      ),
  };
}
