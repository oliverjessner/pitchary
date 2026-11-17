import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("future pitches and activities persist and subsequent statuses default to the planned phase", async ({
  page,
  request,
}, testInfo) => {
  const origin = "http://127.0.0.1:3218";
  const prefix = `Planung ${testInfo.project.name} ${randomUUID()}`;
  async function create(resource, data) {
    const response = await request.post(`${origin}/api/${resource}`, { data });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }
  const customer = await create("customers", { name: prefix });
  const service = await create("services", { name: prefix });
  const offer = await create("customer-services", {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 10000,
  });
  try {
    await page.clock.setFixedTime(new Date("2026-10-12T10:00:00.000Z"));
    await page.goto(`${origin}/#/relationships/${offer.id}`);
    await page
      .getByRole("button", { name: "Pitch erfassen", exact: true })
      .click();
    const pitch = page.getByRole("dialog", { name: "Gepitcht", exact: true });
    const pitchTime = pitch.getByLabel("Zeitpunkt", { exact: true });
    await expect(pitchTime).toHaveJSProperty("max", "");
    await pitchTime.fill("2026-10-20T10:30:15.123");
    await pitch.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(pitch).toHaveCount(0);
    await page.reload();
    const pitched = await (
      await request.get(`${origin}/api/customer-services/${offer.id}`)
    ).json();
    expect(pitched.status).toBe("pitched");
    expect(pitched.status_since).toBe("2026-10-20T08:30:15.123Z");
    expect(pitched.first_pitch_at).toBe("2026-10-20T08:30:15.123Z");
    expect(pitched.history.at(-1).recorded_at).toBe("2026-10-12T10:00:00.000Z");
    await page
      .getByRole("button", { name: "Zusage erfassen", exact: true })
      .click();
    const acceptance = page.getByRole("dialog", {
      name: "Angenommen",
      exact: true,
    });
    const acceptanceTime = acceptance.getByLabel("Zeitpunkt", { exact: true });
    await expect(acceptanceTime).toHaveValue("2026-10-20T10:30:15.123");
    await expect(acceptanceTime).toHaveJSProperty(
      "min",
      "2026-10-20T10:30:15.123",
    );
    await expect(acceptanceTime).toHaveJSProperty("max", "");
    await acceptanceTime.fill("2026-10-21T10:30:15.123");
    await acceptance
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(acceptance).toHaveCount(0);
    await page
      .getByRole("button", { name: "Aktivität hinzufügen", exact: true })
      .click();
    const activity = page.getByRole("dialog", {
      name: "Aktivität hinzufügen",
      exact: true,
    });
    const activityTime = activity.getByLabel("Zeitpunkt", { exact: true });
    await expect(activityTime).toHaveJSProperty("max", "");
    await activityTime.fill("2026-10-22T11:45:15.123");
    await activity.getByLabel("Notiz", { exact: true }).fill(prefix);
    await activity
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(activity).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(prefix, { exact: true }).last()).toBeVisible();
    const saved = await (
      await request.get(`${origin}/api/customer-services/${offer.id}`)
    ).json();
    expect(saved.status).toBe("accepted");
    expect(saved.status_since).toBe("2026-10-21T08:30:15.123Z");
    expect(saved.activities.find((row) => row.note === prefix)).toMatchObject({
      type: "follow_up",
      channel: "email",
      occurred_at: "2026-10-22T09:45:15.123Z",
      created_at: "2026-10-12T10:00:00.000Z",
    });
  } finally {
    const removed = await request.delete(
      `${origin}/api/customer-services/${offer.id}/permanent`,
    );
    expect(removed.ok(), await removed.text()).toBe(true);
  }
});
