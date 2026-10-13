import { transaction } from "../database/database.js";
import { AppError, allowedKeys, invalid, text, uuid } from "./validation.js";

export function createServiceTags(db, repo, { now, idFactory }) {
  const requireTag = (id) => {
    uuid(id, "id");
    const tag = repo.get("service_tags", id);
    if (!tag) throw new AppError(404, "not_found", "Tag nicht gefunden.");
    return tag;
  };
  const values = (data, creating) => {
    allowedKeys(data, ["name", "note", "color"]);
    const out = {};
    if (creating || data.name !== undefined) {
      out.name = text(data.name ?? "", "name", {
        required: true,
        max: 80,
      }).normalize("NFC");
      out.name_key = out.name.toLowerCase();
    }
    if (creating || data.note !== undefined)
      out.note = text(data.note ?? "", "note", { max: 2000 });
    if (creating || data.color !== undefined) {
      const color = data.color ?? "#4d8dff";
      if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
        invalid("Bitte eine Farbe im Format #RRGGBB angeben.", "color");
      out.color = color.toLowerCase();
    }
    return out;
  };
  const checkName = (values, id) => {
    if (values.name_key) {
      const existing = repo.tagByKey(values.name_key);
      if (existing && existing.id !== id)
        invalid("Ein Tag mit diesem Namen existiert bereits.", "name");
    }
  };
  return {
    listTags: () => repo.tags(),
    createTag(data) {
      return transaction(db, () => {
        const fields = values(data, true);
        checkName(fields);
        const at = now(),
          id = idFactory();
        repo.insert("service_tags", {
          id,
          ...fields,
          created_at: at,
          updated_at: at,
        });
        return { ...requireTag(id), service_count: 0 };
      });
    },
    updateTag(id, data) {
      return transaction(db, () => {
        requireTag(id);
        const fields = values(data, false);
        checkName(fields, id);
        repo.update("service_tags", id, { ...fields, updated_at: now() });
        return repo.tags().find((tag) => tag.id === id);
      });
    },
    deleteTag(id) {
      return transaction(db, () => {
        requireTag(id);
        repo.deleteTag(id);
        return { id, deleted: true };
      });
    },
    validateTagIds(value) {
      if (!Array.isArray(value) || value.length > 100)
        invalid(
          "Tags müssen als Liste mit maximal 100 Einträgen angegeben werden.",
          "tag_ids",
        );
      const ids = [...new Set(value)];
      for (const id of ids) {
        uuid(id, "tag_ids");
        if (!repo.get("service_tags", id))
          invalid("Ein ausgewählter Tag existiert nicht mehr.", "tag_ids");
      }
      return ids;
    },
  };
}
