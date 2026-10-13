import { demoCustomerLogo } from "../../scripts/demo-assets.js";

// Seed old schemas directly: future CRM features must not alter migration fixtures.
export function seedLegacyDemo(db) {
  const id = (number) =>
    `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const at = "2026-09-01T09:00:00.000Z";
  for (const index of [1, 2]) {
    db.prepare(
      "INSERT INTO customers(id,name,note,created_at,updated_at,website,logo_mime,logo_data) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id(index),
      "Legacy Kunde " + index,
      "Notiz behalten",
      at,
      at,
      "https://example.com/",
      index === 1 ? demoCustomerLogo.mime_type : null,
      index === 1 ? Buffer.from(demoCustomerLogo.data_base64, "base64") : null,
    );
    db.prepare(
      "INSERT INTO employees(id,customer_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(id(index + 10), id(index), "Kontakt " + index, at, at);
    db.prepare(
      "INSERT INTO services(id,name,note,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(id(index + 20), "Leistung " + index, "Alte Beschreibung", at, at);
  }
  let sequence = 100;
  for (const [number, customer, status] of [
    [31, 1, "pitched"],
    [32, 2, "done"],
  ]) {
    db.prepare(
      "INSERT INTO customer_services(id,customer_id,service_id,primary_employee_id,status,first_pitched_price_minor,current_offered_price_minor,accepted_price_minor,currency,billing_type,pitch_channel,status_since,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id(number),
      id(customer),
      id(customer + 20),
      id(customer + 10),
      status,
      10000,
      11000,
      status === "done" ? 10000 : null,
      "EUR",
      "one_time",
      "email",
      at,
      at,
      at,
    );
    const phases =
      status === "done"
        ? ["open", "pitched", "accepted", "done"]
        : ["open", "pitched"];
    phases.forEach((phase, index) =>
      db
        .prepare(
          "INSERT INTO customer_service_status_history(id,customer_service_id,from_status,to_status,occurred_at,recorded_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id(++sequence),
          id(number),
          phases[index - 1] ?? null,
          phase,
          at,
          at,
        ),
    );
    db.prepare(
      "INSERT INTO activities(id,customer_service_id,employee_id,type,channel,note,occurred_at,created_at) VALUES(?,?,?,'follow_up','email',?,?,?)",
    ).run(
      id(++sequence),
      id(number),
      id(customer + 10),
      "Historischer Kontakt",
      at,
      at,
    );
    db.prepare(
      "INSERT INTO activities(id,customer_service_id,type,note,occurred_at,created_at,price_field,previous_price_minor,new_price_minor) VALUES(?,?,'price_change','Verhandlung',?,?,'current_offered_price_minor',10000,11000)",
    ).run(id(++sequence), id(number), at, at);
  }
}
