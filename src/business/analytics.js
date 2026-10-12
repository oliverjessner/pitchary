import { filterInput } from "./validation.js";
const days = (ms) => ms / 86400000;
const average = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function createAnalytics(repo) {
  return (filters) => {
    const f = filterInput(filters);
    delete f.archived;
    const rows = repo.relationships(f);
    const histories = new Map();
    for (const h of repo.allHistory()) {
      if (!histories.has(h.customer_service_id))
        histories.set(h.customer_service_id, []);
      histories.get(h.customer_service_id).push(h);
    }
    const enriched = rows.map((r) => {
      const h = histories.get(r.id) ?? [],
        pitch = h.find((x) => x.to_status === "pitched"),
        accepted = h.find((x) => x.to_status === "accepted"),
        decision = h.find((x) =>
          ["accepted", "rejected"].includes(x.to_status),
        );
      return {
        ...r,
        pitched: Boolean(pitch),
        won: ["accepted", "done"].includes(r.status),
        lost: r.status === "rejected",
        pitch_to_accept_days:
          pitch && accepted
            ? days(
                Date.parse(accepted.occurred_at) -
                  Date.parse(pitch.occurred_at),
              )
            : null,
        pitch_to_decision_days:
          pitch && decision
            ? days(
                Date.parse(decision.occurred_at) -
                  Date.parse(pitch.occurred_at),
              )
            : null,
      };
    });
    function summary(group) {
      const won = group.filter((r) => r.won).length,
        lost = group.filter((r) => r.lost).length;
      return {
        created: group.length,
        pitched: group.filter((r) => r.pitched).length,
        ghosted: group.filter((r) => r.status === "ghosted").length,
        won,
        rejected: lost,
        undecided: group.length - won - lost,
        win_rate: won + lost ? won / (won + lost) : null,
        avg_pitch_to_accept_days: average(
          group.map((r) => r.pitch_to_accept_days).filter((v) => v !== null),
        ),
        avg_pitch_to_decision_days: average(
          group.map((r) => r.pitch_to_decision_days).filter((v) => v !== null),
        ),
      };
    }
    function groups(key, label) {
      const map = new Map();
      for (const row of enriched) {
        const k = row[key];
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(row);
      }
      return [...map]
        .map(([id, rs]) => ({
          id,
          name: label ? rs[0][label] : id,
          ...summary(rs),
        }))
        .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
    }
    const values = new Map(),
      reasons = new Map();
    for (const r of enriched) {
      const key = r.currency + ":" + r.billing_type;
      if (!values.has(key))
        values.set(key, {
          currency: r.currency,
          billing_type: r.billing_type,
          offered_price_minor: 0,
          first_pitched_price_minor: 0,
          accepted_price_minor: 0,
          won_count: 0,
        });
      const v = values.get(key);
      v.offered_price_minor += r.current_offered_price_minor;
      v.first_pitched_price_minor += r.first_pitched_price_minor ?? 0;
      if (r.won) {
        v.accepted_price_minor += r.accepted_price_minor ?? 0;
        v.won_count++;
      }
      if (r.lost && r.rejection_reason) {
        const code = JSON.parse(r.rejection_reason).code;
        reasons.set(code, (reasons.get(code) ?? 0) + 1);
      }
    }
    return {
      filters: f,
      summary: summary(enriched),
      by_customer: groups("customer_id", "customer_name"),
      by_service: groups("service_id", "service_name"),
      by_channel: groups("pitch_channel"),
      values: [...values.values()],
      rejection_reasons: [...reasons]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
      definitions: {
        cohort:
          "Datumsfilter beziehen sich auf das Anlagedatum des Angebots (UTC). Archivierte Angebote bleiben in Analytics enthalten.",
        pitched: "Mindestens ein pitched-Ereignis; pro Vorgang einmal.",
        won: "Aktueller Status accepted oder done.",
        rejected: "Aktueller Status rejected.",
        ghosted:
          "Aktueller Status ghosted: keine Rückmeldung nach dem Pitch, ohne bestätigte Absage.",
        undecided:
          "Aktueller Status open, pitched oder ghosted; keine bestätigte Entscheidung.",
        win_rate:
          "Gewonnen / (gewonnen + abgelehnt); ohne Entscheidungen kein Wert.",
        timing:
          "Erster Pitch bis zur ersten Zusage bzw. ersten Entscheidung; pro Vorgang einmal, auch bei Wiederaufnahme. Dauer in Kalendertagen.",
        values:
          "Aktuelle Angebotspreise aller Vorgänge; ursprüngliche Pitch-Preise tatsächlich gepitchter Vorgänge; vereinbarte Preise aktuell gewonnener Vorgänge. Je Währung und Abrechnungsmodell separat, ohne Hochrechnung.",
        reasons:
          "Aktueller Absagegrund jedes aktuell abgelehnten Vorgangs; pro Vorgang einmal.",
      },
    };
  };
}
