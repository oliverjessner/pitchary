import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
export function seedDemo(db) {
  let time = "2026-09-01T09:00:00.000Z";
  let sequence = 0;
  const crm = createCRM(db, {
    clock: () => time,
    idFactory: () => {
      const bytes = createHash("sha256")
        .update("pitchary-demo-" + ++sequence)
        .digest()
        .subarray(0, 16);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.toString("hex");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
  if (Object.values(crm.repo.counts()).some((n) => n > 0))
    throw new Error(
      "Demo-Seed verweigert: Die Datenbank enthält bereits Geschäftsdatensätze.",
    );
  const customers = ["Studio Nord", "Morgenwerk", "Atlas Digital"].map(
    (name, i) =>
      crm.createEntity("customers", {
        name,
        note: [
          "Designstudio in Wien. Kontakt über das Netzwerk.",
          "B2B-Software für kleine Teams.",
          "Beratung und digitale Produkte.",
        ][i],
      }),
  );
  const employees = customers.map((c, i) =>
    crm.createEntity("employees", {
      customer_id: c.id,
      name: ["Anna Berger", "Leon Weber", "Mira Hoffmann"][i],
      email: ["anna", "leon", "mira"][i] + "@example.com",
      position: ["Geschäftsführung", "Marketing", "Produktleitung"][i],
      linkedin: "",
    }),
  );
  const services = [
    "Website-Relaunch",
    "Content-Beratung",
    "Technischer Audit",
  ].map((name) =>
    crm.createEntity("services", {
      name,
      note: "Wiederverwendbarer Leistungstyp. Umfang pro Auftrag abstimmen.",
    }),
  );
  const specs = [
    [0, 0, 320000, "done", "email", "one_time"],
    [1, 1, 120000, "accepted", "linkedin", "monthly"],
    [2, 2, 180000, "pitched", "meeting", "one_time"],
    [0, 2, 160000, "rejected", "phone", "one_time"],
    [1, 0, 450000, "open", "email", "one_time"],
    [2, 1, 90000, "pitched", "linkedin", "monthly"],
    [0, 0, 280000, "open", "other", "one_time"],
  ];
  for (const [c, s, price, status, channel, billing] of specs) {
    time = "2026-09-02T09:00:00.000Z";
    const r = crm.createRelationship({
      customer_id: customers[c].id,
      service_id: services[s].id,
      primary_employee_id: employees[c].id,
      current_offered_price_minor: price,
      currency: "EUR",
      billing_type: billing,
      pitch_channel: channel,
    });
    if (status !== "open") {
      time = "2026-09-05T09:00:00.000Z";
      crm.changeStatus(r.id, { status: "pitched" });
      crm.addActivity(r.id, {
        type: "pitch",
        channel,
        note: "Leistungsumfang besprochen und Angebot vorgestellt.",
        employee_id: employees[c].id,
      });
      time = "2026-09-08T09:00:00.000Z";
      crm.addActivity(r.id, {
        type: "follow_up",
        channel: "email",
        note: "Rückfragen zu Umfang und Zeitplan beantwortet.",
      });
      if (["accepted", "done"].includes(status)) {
        time = "2026-09-12T09:00:00.000Z";
        crm.changePrice(r.id, {
          field: "current_offered_price_minor",
          price_minor: price - 10000,
          note: "Umfang gemeinsam angepasst.",
        });
        crm.changeStatus(r.id, {
          status: "accepted",
          accepted_price_minor: price - 10000,
        });
        if (status === "done") {
          time = "2026-09-25T09:00:00.000Z";
          crm.changeStatus(r.id, { status: "done" });
        }
      }
      if (status === "rejected") {
        time = "2026-09-10T09:00:00.000Z";
        crm.changeStatus(r.id, {
          status: "rejected",
          reason: {
            code: "budget",
            note: "Budget für dieses Quartal bereits verplant.",
          },
        });
      }
    }
  }
  return {
    customers: customers.length,
    services: services.length,
    relationships: specs.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = openDatabase();
  try {
    console.log(seedDemo(db));
  } finally {
    db.close();
  }
}
