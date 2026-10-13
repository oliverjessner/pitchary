import { createCustomerMergeRepository } from "../database/customer-merge-repository.js";
import { AppError, invalid, uuid } from "./validation.js";

const normalized = (value) =>
  value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("de-AT");
function conflict(field, message) {
  throw new AppError(409, "customer_merge_conflict", message, {
    [field]: message,
  });
}
function combineText(source, target, field, label) {
  if (!source) return target;
  if (!target) return source;
  if (normalized(source) !== normalized(target))
    conflict(
      field,
      `Abweichende ${label} müssen vor der Kunden-Zusammenführung geklärt werden.`,
    );
  return target;
}
function parseMapping(value, key) {
  if (!value) return new Map();
  let data;
  try {
    data = JSON.parse(value);
  } catch {
    conflict(key, `Die gespeicherte Zuordnung ${key} enthält ungültiges JSON.`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    conflict(key, `Die gespeicherte Zuordnung ${key} muss ein Objekt sein.`);
  return new Map(Object.entries(data));
}

export function createCustomerMerge(db) {
  const repo = createCustomerMergeRepository(db);
  const getMapping = (key) => parseMapping(repo.setting.get(key)?.value, key);
  function follow(id, mappings) {
    const seen = new Set();
    let current = id;
    while (mappings.has(current)) {
      if (seen.has(current))
        conflict(
          "customer_merges",
          "Die gespeicherten Kunden-Zusammenführungen enthalten einen Zyklus.",
        );
      seen.add(current);
      const next = mappings.get(current);
      try {
        uuid(next, "customer_id");
      } catch {
        conflict(
          "customer_merges",
          "Die gespeicherten Kunden-Zusammenführungen enthalten eine ungültige Kunden-ID.",
        );
      }
      current = next;
    }
    return current;
  }
  function mappingKeys(mappings) {
    for (const id of mappings.keys()) {
      try {
        uuid(id, "customer_id");
      } catch {
        conflict(
          "customer_merges",
          "Die gespeicherten Kunden-Zusammenführungen enthalten eine ungültige Kunden-ID.",
        );
      }
      follow(id, mappings);
    }
  }
  function requireCustomer(id, field) {
    const row = repo.customer.get(id);
    if (!row)
      throw new AppError(
        404,
        "not_found",
        `${field === "source" ? "Quellkunde" : "Zielkunde"} nicht gefunden.`,
      );
    return row;
  }
  function profileValues(source, target) {
    if (!source) return null;
    if (!target) return { ...source };
    const result = {
      ...target,
      billing_address: combineText(
        source.billing_address,
        target.billing_address,
        "billing_address",
        "Rechnungsadressen",
      ),
      general_email: combineText(
        source.general_email,
        target.general_email,
        "general_email",
        "allgemeine E-Mail-Adressen",
      ),
      created_at:
        source.created_at < target.created_at
          ? source.created_at
          : target.created_at,
      updated_at:
        source.updated_at > target.updated_at
          ? source.updated_at
          : target.updated_at,
      enriched_at: !source.enriched_at
        ? target.enriched_at
        : !target.enriched_at || source.enriched_at > target.enriched_at
          ? source.enriched_at
          : target.enriched_at,
    };
    if (
      source.enrichment_invoice_id &&
      target.enrichment_invoice_id &&
      source.enrichment_invoice_id !== target.enrichment_invoice_id
    )
      conflict(
        "enrichment_invoice_id",
        "Die Rechnungsprofile verwenden unterschiedliche Quellrechnungen. Bitte vor der Zusammenführung klären.",
      );
    result.enrichment_invoice_id =
      target.enrichment_invoice_id || source.enrichment_invoice_id;
    if (
      source.enrichment_status === target.enrichment_status ||
      source.enrichment_status === "pending"
    )
      result.enrichment_status = target.enrichment_status;
    else if (target.enrichment_status === "pending")
      result.enrichment_status = source.enrichment_status;
    else
      conflict(
        "enrichment_status",
        "Die Rechnungsprofile haben unterschiedliche Bearbeitungsstände. Bitte vor der Zusammenführung klären.",
      );
    return result;
  }
  function customerValues(source, target) {
    if (source.website && target.website && source.website !== target.website)
      conflict(
        "website",
        "Beide Kunden haben unterschiedliche Websites. Bitte vor der Zusammenführung eine gemeinsame Website auswählen.",
      );
    const website = target.website || source.website;
    let logo = target.logo_data,
      mime = target.logo_mime;
    if (
      source.logo_data &&
      target.logo_data &&
      (source.logo_mime !== target.logo_mime ||
        !Buffer.from(source.logo_data).equals(Buffer.from(target.logo_data)))
    )
      conflict(
        "logo",
        "Beide Kunden haben unterschiedliche Logos. Bitte vor der Zusammenführung ein gemeinsames Logo auswählen.",
      );
    if (!logo && source.logo_data) {
      logo = source.logo_data;
      mime = source.logo_mime;
    }
    let note = target.note;
    if (source.note && source.note !== target.note)
      note = target.note ? `${target.note}\n\n${source.note}` : source.note;
    if (note.length > 10000)
      conflict(
        "note",
        "Die zusammengeführten Kundennotizen überschreiten 10.000 Zeichen. Bitte vorher kürzen oder separat sichern.",
      );
    return { note, website, logo_data: logo, logo_mime: mime };
  }
  function verifyLinks(sourceId, targetId) {
    if (repo.foreignKeyViolations().length)
      conflict(
        "foreign_keys",
        "Die Datenbank enthält widersprüchliche Verknüpfungen. Die Kunden wurden nicht zusammengeführt.",
      );
    for (const row of repo.effectiveInvoiceLinks.all(
      sourceId,
      targetId,
      sourceId,
      targetId,
      sourceId,
      targetId,
    ))
      if (
        row.customer_service_id &&
        row.customer_id !== row.relationship_customer_id
      )
        conflict(
          "customer_service_id",
          "Eine Rechnungszuordnung widerspricht dem Kunden des verknüpften Angebots. Bitte vor der Zusammenführung klären.",
        );
  }
  const merger = {
    resolve(id) {
      uuid(id, "customer_id");
      const mappings = getMapping("customer_merges");
      mappingKeys(mappings);
      const result = follow(id, mappings);
      if (result !== id && !repo.customer.get(result))
        conflict(
          "customer_merges",
          "Das Ziel einer gespeicherten Kunden-Zusammenführung wurde nicht gefunden.",
        );
      return result;
    },
    merge(sourceId, targetId) {
      uuid(sourceId, "source_id");
      uuid(targetId, "target_id");
      if (sourceId === targetId)
        invalid(
          "Quellkunde und Zielkunde müssen verschieden sein.",
          "target_id",
        );
      if (!repo.foreignKeysEnabled())
        conflict(
          "foreign_keys",
          "Die Zusammenführung benötigt aktivierte Fremdschlüsselprüfungen.",
        );
      return repo.atomic(() => {
        const mappings = getMapping("customer_merges");
        mappingKeys(mappings);
        const source = follow(sourceId, mappings),
          target = follow(targetId, mappings);
        if (source === target) {
          requireCustomer(target, "target");
          return {
            source: sourceId,
            target,
            merged: false,
            counts: {
              employees: 0,
              customer_services: 0,
              finance_invoices: 0,
              finance_customer_overrides: 0,
              profiles: 0,
              aliases: 0,
            },
          };
        }
        const sourceRow = requireCustomer(source, "source"),
          targetRow = requireCustomer(target, "target");
        verifyLinks(source, target);
        const values = customerValues(sourceRow, targetRow),
          sourceProfile = repo.profile.get(source),
          targetProfile = repo.profile.get(target),
          profile = profileValues(sourceProfile, targetProfile);
        const aliases = getMapping("finance_customer_aliases");
        let redirected = 0;
        for (const [name, id] of aliases) {
          try {
            uuid(id, "customer_id");
          } catch {
            conflict(
              "finance_customer_aliases",
              "Die gespeicherten Kundennamen enthalten eine ungültige Kunden-ID.",
            );
          }
          if (follow(id, mappings) === source) {
            aliases.set(name, target);
            redirected++;
          }
        }
        for (const name of [sourceRow.name, targetRow.name]) {
          const key = normalized(name),
            existing = aliases.get(key);
          if (
            existing &&
            ![source, target].includes(follow(existing, mappings))
          )
            conflict(
              "finance_customer_aliases",
              "Ein Kundenname ist bereits einem anderen Kunden zugeordnet. Bitte die Zuordnung vor der Zusammenführung klären.",
            );
          aliases.set(key, target);
        }
        const counts = {
          employees: Number(repo.moveEmployees.run(target, source).changes),
          customer_services: Number(
            repo.moveRelationships.run(target, source).changes,
          ),
          finance_invoices: Number(
            repo.moveInvoices.run(target, source).changes,
          ),
          finance_customer_overrides: Number(
            repo.moveInvoiceOverrides.run(JSON.stringify(target), source)
              .changes,
          ),
          profiles: sourceProfile ? 1 : 0,
          aliases: redirected,
        };
        if (profile)
          repo.saveProfile.run(
            target,
            profile.billing_address,
            profile.general_email,
            profile.enrichment_status,
            profile.enriched_at,
            profile.enrichment_invoice_id,
            profile.created_at,
            profile.updated_at,
          );
        const at = new Date().toISOString();
        repo.saveCustomer.run(
          values.note,
          values.website,
          values.logo_mime,
          values.logo_data,
          at,
          target,
        );
        mappings.set(source, target);
        for (const id of mappings.keys())
          mappings.set(id, follow(id, mappings));
        repo.saveSetting.run(
          "customer_merges",
          JSON.stringify(
            Object.fromEntries(
              [...mappings].sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
          at,
        );
        repo.saveSetting.run(
          "finance_customer_aliases",
          JSON.stringify(
            Object.fromEntries(
              [...aliases].sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
          at,
        );
        if (repo.remainingReferences.get(source, source, source, source).n)
          conflict(
            "references",
            "Es bestehen weiterhin Verknüpfungen zum Quellkunden. Die Zusammenführung wurde abgebrochen.",
          );
        repo.deleteCustomer.run(source);
        verifyLinks(source, target);
        return { source, target, merged: true, counts };
      });
    },
  };
  return merger;
}
