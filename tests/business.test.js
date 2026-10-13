import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createAnalytics } from "../src/business/analytics.js";
import { seedDemo } from "../scripts/seed.js";
function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let time = "2026-09-01T09:00:00.000Z";
  const crm = createCRM(db, { clock: () => time });
  const c = crm.createEntity("customers", { name: "Kunde", note: "" }),
    s = crm.createEntity("services", { name: "Leistung", note: "" }),
    employee = crm.createEntity("employees", {
      customer_id: c.id,
      name: "Anna",
      email: "anna@example.com",
    });
  const create = (extra = {}) =>
    crm.createRelationship({
      customer_id: c.id,
      service_id: s.id,
      primary_employee_id: employee.id,
      current_offered_price_minor: 100001,
      currency: "EUR",
      billing_type: "one_time",
      pitch_channel: "email",
      ...extra,
    });
  return {
    db,
    crm,
    c,
    s,
    employee,
    create,
    setTime: (value) => {
      time = value;
    },
    analytics: createAnalytics(crm.repo),
  };
}
test("duplicate offers keep independent UUIDs and append-only histories", (t) => {
  const { crm, create } = fixture(t),
    a = create(),
    b = create();
  assert.notEqual(a.id, b.id);
  crm.changeStatus(a.id, { status: "pitched" });
  assert.equal(crm.relationship(a.id).history.length, 2);
  assert.equal(crm.relationship(b.id).history.length, 1);
  assert.equal(crm.relationship(b.id).status, "open");
});
test("status update and history insert roll back together on database failure", (t) => {
  const { db, crm, create } = fixture(t),
    a = create();
  db.exec(
    "CREATE TRIGGER fail_history BEFORE INSERT ON customer_service_status_history WHEN NEW.to_status='pitched' BEGIN SELECT RAISE(ABORT,'forced failure'); END",
  );
  assert.throws(
    () => crm.changeStatus(a.id, { status: "pitched" }),
    /forced failure/,
  );
  const result = crm.relationship(a.id);
  assert.equal(result.status, "open");
  assert.equal(result.history.length, 1);
  assert.equal(result.first_pitched_price_minor, null);
  assert.equal(result.status_since, a.status_since);
});
test("negotiation keeps the price at first actual pitch; acceptance has its own price", (t) => {
  const { crm, create } = fixture(t),
    a = create();
  crm.changePrice(a.id, {
    field: "current_offered_price_minor",
    price_minor: 95001,
  });
  crm.changeStatus(a.id, { status: "pitched" });
  crm.changePrice(a.id, {
    field: "current_offered_price_minor",
    price_minor: 85001,
    note: "Scope",
  });
  crm.changeStatus(a.id, { status: "accepted", accepted_price_minor: 80001 });
  crm.changePrice(a.id, { field: "accepted_price_minor", price_minor: 82001 });
  const result = crm.relationship(a.id);
  assert.equal(result.first_pitched_price_minor, 95001);
  assert.equal(result.current_offered_price_minor, 85001);
  assert.equal(result.accepted_price_minor, 82001);
  assert.deepEqual(
    result.activities
      .filter((a) => a.type === "price_change")
      .map((a) => [a.price_field, a.previous_price_minor, a.new_price_minor])
      .reverse(),
    [
      ["current_offered_price_minor", 100001, 95001],
      ["current_offered_price_minor", 95001, 85001],
      ["accepted_price_minor", null, 80001],
      ["accepted_price_minor", 80001, 82001],
    ],
  );
});
test("price update is transactional when activity logging fails", (t) => {
  const { db, crm, create } = fixture(t),
    a = create();
  db.exec(
    "CREATE TRIGGER fail_price BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT,'forced price failure'); END",
  );
  assert.throws(
    () =>
      crm.changePrice(a.id, {
        field: "current_offered_price_minor",
        price_minor: 1,
      }),
    /forced price failure/,
  );
  assert.equal(crm.relationship(a.id).current_offered_price_minor, 100001);
});
test("contact belongs to the offer customer across create, edit and activities", (t) => {
  const { crm, create, c, s } = fixture(t),
    other = crm.createEntity("customers", { name: "Other" }),
    employee = crm.createEntity("employees", {
      customer_id: other.id,
      name: "Wrong",
    }),
    a = create();
  assert.throws(
    () => create({ primary_employee_id: employee.id }),
    /anderen Kunden/,
  );
  assert.throws(
    () => crm.updateRelationship(a.id, { primary_employee_id: employee.id }),
    /anderen Kunden/,
  );
  assert.throws(
    () =>
      crm.addActivity(a.id, {
        employee_id: employee.id,
        type: "note",
        note: "Contact",
      }),
    /anderen Kunden/,
  );
  assert.equal(crm.relationship(a.id).activities.length, 0);
  assert.throws(
    () =>
      crm.createRelationship({
        customer_id: c.id,
        service_id: s.id,
        primary_employee_id: randomUUID(),
        current_offered_price_minor: 1,
      }),
    /nicht gefunden/,
  );
});
test("database also prevents cross-customer contacts without the business layer", (t) => {
  const { db, crm, create } = fixture(t),
    a = create(),
    other = crm.createEntity("customers", { name: "Other" }),
    e = crm.createEntity("employees", { customer_id: other.id, name: "Wrong" });
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE customer_services SET primary_employee_id=? WHERE id=?",
        )
        .run(e.id, a.id),
    /FOREIGN KEY/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO activities(id,customer_service_id,employee_id,type,note,occurred_at,created_at) VALUES(?,?,?,'note','x','2026-09-01','2026-09-01')",
        )
        .run(randomUUID(), a.id, e.id),
    /another customer/,
  );
});
test("rejection needs structured reason and resumption needs a reason", (t) => {
  const { crm, create, setTime } = fixture(t),
    a = create();
  crm.changeStatus(a.id, { status: "pitched" });
  assert.throws(
    () => crm.changeStatus(a.id, { status: "rejected" }),
    /Absagegrund/,
  );
  crm.changeStatus(a.id, {
    status: "rejected",
    reason: { code: "budget", note: "Q4" },
  });
  setTime("2026-09-02T09:00:00.000Z");
  assert.throws(
    () => crm.changeStatus(a.id, { status: "pitched" }),
    /Wiederaufnahme/,
  );
  crm.changeStatus(a.id, { status: "pitched", reason: "New budget" });
  const result = crm.relationship(a.id);
  assert.equal(result.first_pitched_price_minor, 100001);
  assert.equal(result.rejection_reason, null);
  assert.deepEqual(
    result.history.map((h) => h.to_status),
    ["open", "pitched", "rejected", "pitched"],
  );
  assert.equal(JSON.parse(result.history[2].reason).code, "budget");
  assert.equal(result.status_since, "2026-09-02T09:00:00.000Z");
});
test("invalid transitions and stale status edits are rejected", (t) => {
  const { crm, create } = fixture(t),
    a = create();
  for (const status of ["done", "accepted", "rejected", "open"])
    assert.throws(() => crm.changeStatus(a.id, { status }), /nicht erlaubt/);
  crm.changeStatus(a.id, { status: "pitched" });
  assert.throws(
    () =>
      crm.changeStatus(a.id, { status: "accepted", expected_status: "open" }),
    /inzwischen geändert/,
  );
  crm.changeStatus(a.id, { status: "accepted" });
  crm.changeStatus(a.id, { status: "done" });
  assert.throws(
    () => crm.changeStatus(a.id, { status: "pitched" }),
    /nicht erlaubt/,
  );
});
test("follow-ups leave status history and status_since unchanged", (t) => {
  const { crm, create, setTime } = fixture(t),
    a = create();
  crm.changeStatus(a.id, { status: "pitched" });
  setTime("2026-09-03T09:00:00.000Z");
  crm.addActivity(a.id, {
    type: "follow_up",
    channel: "email",
    note: "Reminder",
  });
  const result = crm.relationship(a.id);
  assert.equal(result.history.length, 2);
  assert.equal(result.status_since, a.status_since);
  assert.equal(result.activities.length, 1);
});
test("history and activities cannot be edited or deleted", (t) => {
  const { db, crm, create } = fixture(t),
    a = create();
  crm.addActivity(a.id, { type: "note", note: "History" });
  for (const name of ["customer_service_status_history", "activities"]) {
    assert.throws(
      () => db.prepare(`UPDATE ${name} SET id=?`).run(randomUUID()),
      /immutable/,
    );
    assert.throws(() => db.exec(`DELETE FROM ${name}`), /immutable/);
  }
});
test("integer money, immutable pricing metadata and chronology are enforced", (t) => {
  const { crm, create } = fixture(t),
    a = create();
  for (const value of [1.5, -1, "100", Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(
      () => create({ current_offered_price_minor: value }),
      /ganzen Cent/,
    );
  crm.changeStatus(a.id, { status: "pitched" });
  assert.throws(
    () => crm.updateRelationship(a.id, { currency: "USD" }),
    /unverändert/,
  );
  assert.throws(
    () => crm.updateRelationship(a.id, { billing_type: "monthly" }),
    /unverändert/,
  );
  assert.throws(
    () =>
      crm.changeStatus(a.id, {
        status: "accepted",
        occurred_at: "2026-08-01T09:00:00.000Z",
      }),
    /Zeitpunkt/,
  );
  assert.throws(
    () =>
      crm.addActivity(a.id, {
        type: "note",
        note: "Future",
        occurred_at: "2027-01-01T09:00:00.000Z",
      }),
    /Zeitpunkt/,
  );
  assert.throws(
    () => crm.updateRelationship(a.id, { status: "done" }),
    /nicht änderbar/,
  );
});
test("original pitch channel can be corrected in every active status without changing historical events or prices", (t) => {
  const { crm, create, setTime, analytics } = fixture(t);
  for (const status of [
    "open",
    "pitched",
    "ghosted",
    "rejected",
    "accepted",
    "done",
  ]) {
    const row = create();
    if (status !== "open") crm.changeStatus(row.id, { status: "pitched" });
    if (status === "ghosted") crm.changeStatus(row.id, { status });
    if (status === "rejected")
      crm.changeStatus(row.id, { status, reason: { code: "budget" } });
    if (["accepted", "done"].includes(status))
      crm.changeStatus(row.id, { status: "accepted" });
    if (status === "done") crm.changeStatus(row.id, { status });
    crm.addActivity(row.id, {
      type: "note",
      channel: "email",
      note: "Original contact channel",
    });
    setTime("2026-09-02T09:00:00.000Z");
    const before = crm.relationship(row.id);
    const updated = crm.updateRelationship(row.id, {
      pitch_channel: "internal_software",
    });
    assert.deepEqual(updated, {
      ...before,
      pitch_channel: "internal_software",
      updated_at: "2026-09-02T09:00:00.000Z",
    });
    for (const pitch_channel of ["", null, "not_registered"]) {
      assert.throws(
        () => crm.updateRelationship(row.id, { pitch_channel }),
        (error) => error.status === 422,
      );
      assert.deepEqual(crm.relationship(row.id), updated);
    }
  }
  assert.equal(crm.relationships({ pitch_channel: "email" }).length, 0);
  assert.equal(
    crm.relationships({ pitch_channel: "internal_software" }).length,
    6,
  );
  assert.equal(
    analytics({ pitch_channel: "internal_software" }).summary.created,
    6,
  );
  assert.equal(analytics({ pitch_channel: "email" }).summary.created, 0);
  const archived = crm.relationships()[0];
  crm.archive("customer_services", archived.id);
  assert.throws(
    () => crm.updateRelationship(archived.id, { pitch_channel: "phone" }),
    (error) => error.status === 409,
  );
});
test("archives retain business history; contacts cannot be reused until restored", (t) => {
  const { crm, create, employee } = fixture(t),
    a = create();
  crm.archive("employees", employee.id);
  assert.throws(() => create(), /Archivierte/);
  crm.archive("customer_services", a.id);
  assert.equal(crm.relationship(a.id).history.length, 1);
  assert.equal(crm.relationships().length, 0);
  assert.equal(crm.relationships({ archived: true }).length, 1);
  assert.throws(
    () => crm.changeStatus(a.id, { status: "pitched" }),
    /Archivierte/,
  );
  crm.archive("customer_services", a.id, false);
  assert.equal(crm.relationships().length, 1);
});
test("batch offers are independent and invalid batches do not partially write", (t) => {
  const { crm, c, s } = fixture(t),
    other = crm.createEntity("customers", { name: "Other" });
  const payload = {
    customer_ids: [c.id, other.id, c.id],
    service_id: s.id,
    current_offered_price_minor: 100,
  };
  const rows = crm.createRelationships(payload);
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  assert.ok(rows.every((r) => r.history.length === 1));
  assert.throws(
    () =>
      crm.createRelationships({
        ...payload,
        customer_ids: [c.id, randomUUID()],
      }),
    /nicht gefunden/,
  );
  assert.equal(crm.relationships().length, 3);
});
test("editing an offer preserves its historical archived contact, without allowing a new archived assignment", (t) => {
  const { crm, create, employee } = fixture(t);
  const row = create();
  crm.archive("employees", employee.id);
  assert.equal(
    crm.updateRelationship(row.id, { primary_employee_id: employee.id })
      .primary_employee_id,
    employee.id,
  );
  crm.updateRelationship(row.id, { primary_employee_id: null });
  assert.throws(
    () => crm.updateRelationship(row.id, { primary_employee_id: employee.id }),
    /Archivierte/,
  );
});
test("analytics counts each offer once through rejection and resumption", (t) => {
  const { crm, create, setTime, analytics } = fixture(t);
  const a = create(),
    b = create(),
    c = create(),
    d = create();
  crm.changeStatus(a.id, { status: "pitched" });
  crm.changeStatus(b.id, { status: "pitched" });
  crm.changeStatus(c.id, { status: "pitched" });
  setTime("2026-09-03T09:00:00.000Z");
  crm.changeStatus(a.id, { status: "rejected", reason: { code: "timing" } });
  crm.changeStatus(b.id, { status: "rejected", reason: { code: "budget" } });
  setTime("2026-09-05T09:00:00.000Z");
  crm.changeStatus(a.id, { status: "pitched", reason: "Resume" });
  setTime("2026-09-06T09:00:00.000Z");
  crm.changeStatus(a.id, { status: "accepted", accepted_price_minor: 90000 });
  crm.changeStatus(a.id, { status: "done" });
  const r = analytics({});
  assert.deepEqual(r.summary, {
    created: 4,
    pitched: 3,
    ghosted: 0,
    won: 1,
    rejected: 1,
    undecided: 2,
    win_rate: 0.5,
    avg_pitch_to_accept_days: 5,
    avg_pitch_to_decision_days: 2,
  });
  assert.deepEqual(r.rejection_reasons, [{ code: "budget", count: 1 }]);
  assert.equal(r.values[0].accepted_price_minor, 90000);
  assert.equal(crm.relationship(d.id).history.length, 1);
});
test("ghosted stays undecided and resumes without replacing the first pitch price", (t) => {
  const { crm, create, setTime, analytics } = fixture(t);
  const row = create();
  assert.throws(
    () => crm.changeStatus(row.id, { status: "ghosted" }),
    /nicht erlaubt/,
  );
  crm.changeStatus(row.id, { status: "pitched" });
  setTime("2026-09-03T09:00:00.000Z");
  crm.changeStatus(row.id, {
    status: "ghosted",
    reason: "Keine Antwort auf den Pitch",
  });
  const summary = analytics({}).summary;
  assert.equal(summary.ghosted, 1);
  assert.equal(summary.undecided, 1);
  assert.equal(summary.rejected, 0);
  assert.equal(summary.win_rate, null);
  assert.equal(summary.avg_pitch_to_decision_days, null);
  assert.equal(analytics({}).by_customer[0].ghosted, 1);
  assert.equal(analytics({ status: "ghosted" }).summary.created, 1);
  assert.equal(crm.relationships({ status: "ghosted" })[0].id, row.id);
  assert.throws(
    () => crm.changeStatus(row.id, { status: "pitched" }),
    /Wiederaufnahme/,
  );
  crm.addActivity(row.id, {
    type: "follow_up",
    note: "Noch einmal nachgefragt",
  });
  assert.equal(crm.relationship(row.id).status, "ghosted");
  crm.changePrice(row.id, {
    field: "current_offered_price_minor",
    price_minor: 95000,
  });
  setTime("2026-09-05T09:00:00.000Z");
  crm.changeStatus(row.id, {
    status: "pitched",
    reason: "Kontakt antwortet wieder",
  });
  const result = crm.relationship(row.id);
  assert.equal(result.first_pitched_price_minor, 100001);
  assert.equal(result.current_offered_price_minor, 95000);
  assert.deepEqual(
    result.history.map((h) => h.to_status),
    ["open", "pitched", "ghosted", "pitched"],
  );
  assert.equal(result.history.at(-1).from_status, "ghosted");
  assert.equal(analytics({}).summary.pitched, 1);
  assert.equal(analytics({}).summary.ghosted, 0);
});
test("ghosted allows real decisions and never inflates the win rate denominator", (t) => {
  const { crm, create, setTime, analytics } = fixture(t);
  const won = create(),
    lost = create(),
    waiting = create();
  for (const row of [won, lost, waiting]) {
    crm.changeStatus(row.id, { status: "pitched" });
    crm.changeStatus(row.id, { status: "ghosted" });
  }
  setTime("2026-09-04T09:00:00.000Z");
  crm.changeStatus(won.id, { status: "accepted", accepted_price_minor: 90000 });
  crm.changeStatus(lost.id, { status: "rejected", reason: { code: "budget" } });
  const result = analytics({});
  assert.equal(result.summary.ghosted, 1);
  assert.equal(result.summary.won, 1);
  assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.undecided, 1);
  assert.equal(result.summary.win_rate, 0.5);
  assert.equal(result.summary.avg_pitch_to_decision_days, 3);
  assert.deepEqual(result.rejection_reasons, [{ code: "budget", count: 1 }]);
  assert.throws(
    () => crm.changeStatus(won.id, { status: "ghosted" }),
    /nicht erlaubt/,
  );
});
test("analytics date, entity and channel filters and separated values are correct", (t) => {
  const { crm, create, setTime, analytics, c, s } = fixture(t);
  create({ billing_type: "monthly" });
  create({ currency: "USD" });
  setTime("2026-09-10T09:00:00.000Z");
  const r = create({ pitch_channel: "linkedin" });
  crm.archive("customer_services", r.id);
  assert.equal(analytics({}).summary.created, 3);
  assert.equal(analytics({}).values.length, 3);
  assert.equal(
    analytics({
      from: "2026-09-10",
      to: "2026-09-10",
      customer_id: c.id,
      service_id: s.id,
      pitch_channel: "linkedin",
    }).summary.created,
    1,
  );
  assert.equal(analytics({ to: "2026-09-09" }).summary.created, 2);
  assert.equal(analytics({ pitch_channel: "phone" }).summary.win_rate, null);
  assert.throws(
    () => analytics({ from: "2026-09-12", to: "2026-09-01" }),
    /Startdatum/,
  );
  assert.throws(() => analytics({ from: "2026-02-30" }), /Filterdatum/);
});
test("explicit seed refuses populated databases and offers realistic fixtures", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  assert.equal(seedDemo(db).relationships, 7);
  assert.throws(() => seedDemo(db), /verweigert/);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM customer_services").get().n,
    7,
  );
});
