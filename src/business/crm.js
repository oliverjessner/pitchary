import { randomUUID } from "node:crypto";
import { transaction } from "../database/database.js";
import { createRepository } from "../database/repository.js";
import {
  website,
  logo,
  customerRecord,
  relationshipRecord,
} from "./customer-branding.js";
import { createServiceTags } from "./service-tags.js";
import {
  AppError,
  invalid,
  text,
  choice,
  money,
  uuid,
  dateTime,
  filterInput,
  allowedKeys,
  billingTypes,
  currencies,
  statuses,
  rejectionCodes,
} from "./validation.js";
export const transitions = {
  open: ["pitched"],
  pitched: ["accepted", "ghosted", "rejected"],
  ghosted: ["pitched", "accepted", "rejected"],
  accepted: ["done"],
  done: [],
  rejected: ["pitched"],
};
export function createCRM(
  db,
  { clock = () => new Date().toISOString(), idFactory = randomUUID } = {},
) {
  const repo = createRepository(db);
  const channels = repo.pitchChannels().map(({ id }) => id);
  const now = () => clock();
  const serviceTags = createServiceTags(db, repo, { now, idFactory });
  const requireRecord = (table, id, active = false) => {
    uuid(id, "id");
    const row = repo.get(table, id);
    if (!row) throw new AppError(404, "not_found", "Datensatz nicht gefunden.");
    if (active && row.archived_at)
      throw new AppError(
        409,
        "archived",
        "Archivierte Datensätze können nicht verändert werden.",
      );
    return row;
  };
  function contact(id, customerId) {
    if (!id) return null;
    const row = requireRecord("employees", id, true);
    if (row.customer_id !== customerId)
      invalid(
        "Der Ansprechpartner gehört zu einem anderen Kunden.",
        "primary_employee_id",
      );
    return id;
  }
  function entityData(table, data, creating = false) {
    const keys =
      table === "employees"
        ? ["name", "email", "position", "linkedin"]
        : ["name", "note", ...(table === "customers" ? ["website"] : [])];
    allowedKeys(data, [
      ...keys,
      ...(table === "customers" ? ["logo"] : []),
      ...(table === "services" ? ["tag_ids"] : []),
      ...(table === "employees" && creating ? ["customer_id"] : []),
    ]);
    const out = {};
    for (const key of keys)
      if (creating || data[key] !== undefined)
        out[key] = text(data[key] ?? "", key, {
          required: key === "name",
          max:
            key === "note"
              ? 10000
              : key === "name"
                ? 200
                : key === "website"
                  ? 2048
                  : 500,
        });
    if (table === "customers") {
      if ("website" in out) out.website = website(out.website);
      if ("logo" in data) Object.assign(out, logo(data.logo));
    }
    if (table === "employees") {
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
        invalid("Ungültige E-Mail-Adresse.", "email");
      if (out.linkedin) {
        let url;
        try {
          url = new URL(out.linkedin);
        } catch {
          invalid("Ungültiger LinkedIn-Link.", "linkedin");
        }
        if (
          url.protocol !== "https:" ||
          !/(^|\.)linkedin\.com$/.test(url.hostname)
        )
          invalid("Bitte einen HTTPS-Link zu LinkedIn verwenden.", "linkedin");
      }
      if (creating) {
        requireRecord("customers", data.customer_id, true);
        out.customer_id = data.customer_id;
      }
    }
    return out;
  }
  function event(id, from, to, reason, occurred, recorded) {
    repo.insert("customer_service_status_history", {
      id: idFactory(),
      customer_service_id: id,
      from_status: from,
      to_status: to,
      reason,
      occurred_at: occurred,
      recorded_at: recorded,
    });
  }
  function priceEvent(row, field, value, note, at) {
    repo.insert("activities", {
      id: idFactory(),
      customer_service_id: row.id,
      employee_id: null,
      type: "price_change",
      channel: null,
      note,
      occurred_at: at,
      created_at: at,
      price_field: field,
      previous_price_minor: row[field],
      new_price_minor: value,
    });
  }
  function tagsByService() {
    const tags = new Map();
    for (const { service_id, ...tag } of repo.serviceTags()) {
      if (!tags.has(service_id)) tags.set(service_id, []);
      tags.get(service_id).push(tag);
    }
    return tags;
  }
  function relationshipRecords(rows) {
    const tags = tagsByService();
    return rows.map((row) => ({
      ...relationshipRecord(row),
      service_tags: tags.get(row.service_id) ?? [],
    }));
  }
  const crm = {
    repo,
    ...serviceTags,
    listEntities(table, filters = {}) {
      const rows = repo.list(table, {
        archived: filters.archived === true || filters.archived === "true",
        search: text(filters.search ?? "", "search", { max: 200 }),
        customer_id: filters.customer_id
          ? uuid(filters.customer_id, "customer_id")
          : undefined,
      });
      if (table === "services") {
        const tags = tagsByService();
        return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] }));
      }
      return table === "customers" ? rows.map(customerRecord) : rows;
    },
    entity(table, id) {
      const row = requireRecord(table, id);
      if (table === "customers")
        return {
          ...customerRecord(row),
          employees: repo.list("employees", { customer_id: id }),
          archived_employees: repo.list("employees", {
            customer_id: id,
            archived: true,
          }),
          relationships: relationshipRecords(
            repo.relationships({ customer_id: id }),
          ).map((row) => ({
            ...row,
            history: repo.history(row.id),
            activities: repo.activities(row.id),
          })),
        };
      if (table === "services")
        return {
          ...row,
          tags: repo.serviceTags(id).map(({ service_id, ...tag }) => tag),
          relationships: relationshipRecords(
            repo.relationships({ service_id: id }),
          ),
        };
      return row;
    },
    createEntity(table, data) {
      const save = () => {
        const values = entityData(table, data, true),
          at = now();
        const tagIds =
          table === "services"
            ? serviceTags.validateTagIds(data.tag_ids ?? [])
            : null;
        const id = idFactory();
        repo.insert(table, {
          id,
          ...values,
          created_at: at,
          updated_at: at,
          archived_at: null,
        });
        if (tagIds) repo.replaceServiceTags(id, tagIds);
        const result = repo.get(table, id);
        if (table === "services")
          return {
            ...result,
            tags: repo.serviceTags(id).map(({ service_id, ...tag }) => tag),
          };
        return table === "customers" ? customerRecord(result) : result;
      };
      return table === "services" ? transaction(db, save) : save();
    },
    updateEntity(table, id, data) {
      const save = () => {
        requireRecord(table, id, true);
        const tagIds =
          table === "services" && data.tag_ids !== undefined
            ? serviceTags.validateTagIds(data.tag_ids)
            : null;
        const result = repo.update(table, id, {
          ...entityData(table, data),
          updated_at: now(),
        });
        if (tagIds) repo.replaceServiceTags(id, tagIds);
        if (table === "services")
          return {
            ...result,
            tags: repo.serviceTags(id).map(({ service_id, ...tag }) => tag),
          };
        return table === "customers" ? customerRecord(result) : result;
      };
      return table === "services" ? transaction(db, save) : save();
    },
    archive(table, id, archived = true) {
      requireRecord(table, id);
      const result = repo.update(table, id, {
        archived_at: archived ? now() : null,
        updated_at: now(),
      });
      return table === "customers" ? customerRecord(result) : result;
    },
    customerLogo(id) {
      requireRecord("customers", id);
      const image = repo.customerLogo(id);
      if (!image.logo_data)
        throw new AppError(
          404,
          "not_found",
          "Für diesen Kunden ist kein Logo gespeichert.",
        );
      return { data: Buffer.from(image.logo_data), mime: image.logo_mime };
    },
    relationships(filters = {}) {
      return relationshipRecords(
        repo.relationships({
          ...filterInput(filters, channels),
          archived: filters.archived === true || filters.archived === "true",
        }),
      );
    },
    deleteRelationship(id) {
      return transaction(db, () => {
        requireRecord("customer_services", id);
        repo.deleteRelationship(id);
        return { id, deleted: true };
      });
    },
    relationship(id) {
      requireRecord("customer_services", id);
      const row = repo.relationship(id),
        history = repo.history(id),
        at = now();
      return {
        ...relationshipRecord(row),
        service_tags: repo
          .serviceTags(row.service_id)
          .map(({ service_id, ...tag }) => tag),
        history,
        activities: repo.activities(id),
        phases: history.map((h, i) => ({
          status: h.to_status,
          started_at: h.occurred_at,
          ended_at: history[i + 1]?.occurred_at ?? null,
          duration_ms: Math.max(
            0,
            Date.parse(history[i + 1]?.occurred_at ?? at) -
              Date.parse(h.occurred_at),
          ),
        })),
        first_pitch_at:
          history.find((h) => h.to_status === "pitched")?.occurred_at ?? null,
        first_acceptance_at:
          history.find((h) => h.to_status === "accepted")?.occurred_at ?? null,
      };
    },
    createRelationship(data) {
      allowedKeys(data, [
        "customer_id",
        "service_id",
        "primary_employee_id",
        "current_offered_price_minor",
        "currency",
        "billing_type",
        "pitch_channel",
      ]);
      requireRecord("customers", data.customer_id, true);
      requireRecord("services", data.service_id, true);
      const at = now();
      const row = {
        id: idFactory(),
        customer_id: data.customer_id,
        service_id: data.service_id,
        primary_employee_id: contact(
          data.primary_employee_id,
          data.customer_id,
        ),
        status: "open",
        first_pitched_price_minor: null,
        current_offered_price_minor: money(
          data.current_offered_price_minor,
          "current_offered_price_minor",
        ),
        accepted_price_minor: null,
        currency: choice(data.currency ?? "EUR", currencies, "currency"),
        billing_type: choice(
          data.billing_type ?? "one_time",
          billingTypes,
          "billing_type",
        ),
        pitch_channel: choice(
          data.pitch_channel ?? "email",
          channels,
          "pitch_channel",
        ),
        status_since: at,
        rejection_reason: null,
        created_at: at,
        updated_at: at,
        archived_at: null,
      };
      transaction(db, () => {
        repo.insert("customer_services", row);
        event(row.id, null, "open", null, at, at);
      });
      return crm.relationship(row.id);
    },
    createRelationships(data) {
      allowedKeys(data, [
        "customer_ids",
        "service_id",
        "current_offered_price_minor",
        "currency",
        "billing_type",
        "pitch_channel",
      ]);
      if (
        !Array.isArray(data.customer_ids) ||
        !data.customer_ids.length ||
        data.customer_ids.length > 100
      )
        invalid("Bitte 1 bis 100 Kunden auswählen.", "customer_ids");
      // Validate the entire batch before writing; each relationship has its own history.
      const rows = data.customer_ids.map((id) => {
        requireRecord("customers", id, true);
        return id;
      });
      requireRecord("services", data.service_id, true);
      money(data.current_offered_price_minor, "current_offered_price_minor");
      choice(data.currency ?? "EUR", currencies, "currency");
      choice(data.billing_type ?? "one_time", billingTypes, "billing_type");
      choice(data.pitch_channel ?? "email", channels, "pitch_channel");
      const at = now(),
        ids = [];
      transaction(db, () => {
        for (const customer_id of rows) {
          const row = {
            id: idFactory(),
            customer_id,
            service_id: data.service_id,
            primary_employee_id: null,
            status: "open",
            first_pitched_price_minor: null,
            current_offered_price_minor: data.current_offered_price_minor,
            accepted_price_minor: null,
            currency: data.currency ?? "EUR",
            billing_type: data.billing_type ?? "one_time",
            pitch_channel: data.pitch_channel ?? "email",
            status_since: at,
            rejection_reason: null,
            created_at: at,
            updated_at: at,
            archived_at: null,
          };
          repo.insert("customer_services", row);
          event(row.id, null, "open", null, at, at);
          ids.push(row.id);
        }
      });
      return ids.map((id) => crm.relationship(id));
    },
    updateRelationship(id, data) {
      allowedKeys(data, [
        "primary_employee_id",
        "pitch_channel",
        "billing_type",
        "currency",
      ]);
      const row = requireRecord("customer_services", id, true);
      const out = { updated_at: now() };
      if ("primary_employee_id" in data)
        out.primary_employee_id =
          data.primary_employee_id === row.primary_employee_id
            ? row.primary_employee_id
            : contact(data.primary_employee_id, row.customer_id);
      if (
        ["billing_type", "currency"].some((k) => k in data) &&
        row.first_pitched_price_minor !== null
      )
        throw new AppError(
          409,
          "immutable_pitch",
          "Währung und Abrechnungsmodell bleiben nach dem ersten Pitch unverändert. Für einen neuen Auftrag ein neues Angebot anlegen.",
        );
      if (data.pitch_channel !== undefined)
        out.pitch_channel = choice(
          data.pitch_channel,
          channels,
          "pitch_channel",
        );
      if (data.billing_type !== undefined)
        out.billing_type = choice(
          data.billing_type,
          billingTypes,
          "billing_type",
        );
      if (data.currency !== undefined)
        out.currency = choice(data.currency, currencies, "currency");
      repo.update("customer_services", id, out);
      return crm.relationship(id);
    },
    changeStatus(id, data) {
      allowedKeys(data, [
        "status",
        "expected_status",
        "reason",
        "accepted_price_minor",
        "occurred_at",
      ]);
      return transaction(db, () => {
        const row = requireRecord("customer_services", id, true),
          to = choice(data.status, statuses, "status");
        if (data.expected_status && data.expected_status !== row.status)
          throw new AppError(
            409,
            "status_conflict",
            "Der Status wurde inzwischen geändert. Bitte neu laden.",
          );
        if (!transitions[row.status].includes(to))
          throw new AppError(
            409,
            "invalid_transition",
            `Statuswechsel ${row.status} → ${to} ist nicht erlaubt.`,
          );
        const at = now(),
          occurred = dateTime(data.occurred_at ?? at, at, row.status_since),
          out = {
            status: to,
            status_since: occurred,
            updated_at: at,
            rejection_reason: null,
          };
        let reason = null;
        if (to === "rejected") {
          if (!data.reason || typeof data.reason !== "object")
            invalid("Bitte einen Absagegrund angeben.", "reason");
          allowedKeys(data.reason, ["code", "note"]);
          reason = JSON.stringify({
            code: choice(data.reason.code, rejectionCodes, "reason.code"),
            note: text(data.reason.note ?? "", "reason.note", { max: 2000 }),
          });
          out.rejection_reason = reason;
        } else if (data.reason !== undefined)
          reason = text(data.reason, "reason", { max: 2000 }) || null;
        if (
          to === "pitched" &&
          ["rejected", "ghosted"].includes(row.status) &&
          !reason
        )
          invalid("Bitte den Grund für die Wiederaufnahme angeben.", "reason");
        if (to === "pitched" && row.first_pitched_price_minor === null)
          out.first_pitched_price_minor = row.current_offered_price_minor;
        if (to === "accepted") {
          out.accepted_price_minor = money(
            data.accepted_price_minor ?? row.current_offered_price_minor,
            "accepted_price_minor",
          );
          if (row.accepted_price_minor !== out.accepted_price_minor)
            priceEvent(
              row,
              "accepted_price_minor",
              out.accepted_price_minor,
              "Preis bei Zusage",
              at,
            );
        } else if (data.accepted_price_minor !== undefined)
          invalid(
            "Vereinbarten Preis bei der Zusage oder über eine Preisänderung erfassen.",
            "accepted_price_minor",
          );
        repo.update("customer_services", id, out);
        event(id, row.status, to, reason, occurred, at);
        return crm.relationship(id);
      });
    },
    changePrice(id, data) {
      allowedKeys(data, ["field", "price_minor", "note"]);
      return transaction(db, () => {
        const row = requireRecord("customer_services", id, true);
        const field = choice(
            data.field,
            ["current_offered_price_minor", "accepted_price_minor"],
            "field",
          ),
          value = money(data.price_minor, "price_minor"),
          note = text(data.note ?? "", "note", { max: 2000 });
        if (
          field === "accepted_price_minor" &&
          !["accepted", "done"].includes(row.status)
        )
          invalid("Ein vereinbarter Preis benötigt eine Zusage.", "field");
        if (
          field === "current_offered_price_minor" &&
          ["accepted", "done"].includes(row.status)
        )
          invalid(
            "Bei zugesagten Aufträgen den vereinbarten Preis ändern.",
            "field",
          );
        if (value === row[field])
          throw new AppError(
            409,
            "unchanged_price",
            "Der Preis ist bereits gespeichert.",
          );
        const at = now();
        priceEvent(row, field, value, note, at);
        repo.update("customer_services", id, {
          [field]: value,
          updated_at: at,
        });
        return crm.relationship(id);
      });
    },
    addActivity(id, data) {
      allowedKeys(data, [
        "employee_id",
        "type",
        "channel",
        "note",
        "occurred_at",
      ]);
      const row = requireRecord("customer_services", id, true),
        at = now();
      const type = choice(
        data.type,
        ["pitch", "follow_up", "call", "meeting", "note"],
        "type",
      );
      if (type === "pitch" && row.status === "open")
        invalid(
          "Bitte das Angebot zuerst über die Statusaktion pitchen.",
          "type",
        );
      return repo.insert("activities", {
        id: idFactory(),
        customer_service_id: id,
        employee_id: contact(data.employee_id, row.customer_id),
        type,
        channel: data.channel
          ? choice(data.channel, channels, "channel")
          : null,
        note: text(data.note ?? "", "note", { required: true, max: 10000 }),
        occurred_at: dateTime(data.occurred_at ?? at, at, row.created_at),
        created_at: at,
        price_field: null,
        previous_price_minor: null,
        new_price_minor: null,
      });
    },
    activities(filters = {}) {
      const f = filterInput(filters, channels);
      const ids = new Set(
        repo
          .relationships(
            Object.fromEntries(
              Object.entries(f).filter(
                ([k]) => !["from", "to", "archived"].includes(k),
              ),
            ),
          )
          .map((r) => r.id),
      );
      return repo
        .activities()
        .filter(
          (a) =>
            ids.has(a.customer_service_id) &&
            (!f.from || a.occurred_at >= f.from + "T00:00:00.000Z") &&
            (!f.to || a.occurred_at <= f.to + "T23:59:59.999Z"),
        );
    },
  };
  return crm;
}
