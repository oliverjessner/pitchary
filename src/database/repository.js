const tables = new Set([
  "customers",
  "employees",
  "services",
  "customer_services",
  "customer_service_status_history",
  "activities",
]);
const joins = `SELECT cs.*, c.name AS customer_name, c.archived_at AS customer_archived_at, s.name AS service_name, s.archived_at AS service_archived_at, e.name AS employee_name FROM customer_services cs JOIN customers c ON c.id=cs.customer_id JOIN services s ON s.id=cs.service_id LEFT JOIN employees e ON e.id=cs.primary_employee_id`;
export function createRepository(db) {
  const table = (name) => {
    if (!tables.has(name)) throw new Error("Unknown repository");
    return name;
  };
  return {
    get: (name, id) =>
      db.prepare(`SELECT * FROM ${table(name)} WHERE id=?`).get(id),
    list(name, { archived = false, search = "", customer_id } = {}) {
      const clauses = ["archived_at IS " + (archived ? "NOT NULL" : "NULL")];
      const params = [];
      if (search) {
        clauses.push(
          "(name LIKE ? ESCAPE '\\' OR " +
            (name === "employees" ? "email" : "note") +
            " LIKE ? ESCAPE '\\')",
        );
        const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
        params.push(term, term);
      }
      if (customer_id) {
        clauses.push("customer_id=?");
        params.push(customer_id);
      }
      return db
        .prepare(
          `SELECT * FROM ${table(name)} WHERE ${clauses.join(" AND ")} ORDER BY name COLLATE NOCASE,id`,
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
