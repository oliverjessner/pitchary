import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { logoFormats } from "../fixtures/logo-formats.js";

test("invoice subjects follow the month and document language until edited", async ({
  page,
  request,
}, testInfo) => {
  await request.patch("/api/settings", { data: { language: "de" } });
  const name = `Betreff ${testInfo.project.name} ${randomUUID()}`;
  const created = await request.post("/api/customers", { data: { name } });
  expect(created.status()).toBe(201);
  const customer = await created.json();
  await page.goto("/#/invoice-editor");
  const subject = page.getByLabel("Betreff", { exact: true });
  await page.getByLabel("Rechnungsdatum", { exact: true }).fill("2026-11-17");
  await expect(subject).toHaveValue("November Rechnung 2026");
  await page.getByLabel("Dokumentsprache", { exact: true }).selectOption("en");
  await expect(subject).toHaveValue("November Invoice 2026");
  await page.getByLabel("Rechnungsdatum", { exact: true }).fill("2026-12-01");
  await expect(subject).toHaveValue("December Invoice 2026");
  await subject.fill("Individueller Betreff");
  await page.getByLabel("Rechnungsdatum", { exact: true }).fill("2027-01-01");
  await page.getByLabel("Dokumentsprache", { exact: true }).selectOption("de");
  await page
    .getByLabel("Rechnungskunde", { exact: true })
    .selectOption(customer.id);
  await expect(subject).toHaveValue("Individueller Betreff");
  await page
    .getByLabel("Leistungsdatum von", { exact: true })
    .fill("2026-12-01");
  await page
    .getByLabel("Leistungsdatum bis", { exact: true })
    .fill("2026-12-31");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/invoice-editor\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(subject).toHaveValue("Individueller Betreff");
});

test("customer numbers and billing addresses are edited in the customer record and stay fixed in invoices", async ({
  page,
  request,
}, testInfo) => {
  await request.patch("/api/settings", { data: { language: "de" } });
  const name = `Kundenanschrift ${testInfo.project.name} ${randomUUID()}`;
  const customerNumber = `K-UI-${randomUUID()}`;
  await page.goto("/#/customers");
  await page
    .getByRole("button", { name: "Kunde anlegen", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "Kunde anlegen",
    exact: true,
  });
  await create.getByLabel("Name", { exact: true }).fill(name);
  for (const [label, value] of Object.entries({
    Rechnungsadresse: "Beispielstraße 3\n1010 Wien",
    "Straße und Hausnummer": "Beispielstraße 3",
    Postleitzahl: "1010",
    Ort: "Wien",
    Ländercode: "AT",
  }))
    await create.getByLabel(label, { exact: true }).fill(value);
  await create.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const id = page.url().split("/customers/")[1];
  const initial = await (await request.get(`/api/customers/${id}`)).json();
  expect(initial.customer_number).toMatch(/^K-\d{5,}$/);
  expect(initial.billing_address).toBe("Beispielstraße 3\n1010 Wien");
  await expect(page.locator("#main")).toContainText(initial.customer_number);
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Bearbeiten", exact: true });
  await expect(edit.getByLabel("Kundennummer", { exact: true })).toHaveValue(
    initial.customer_number,
  );
  await edit.getByLabel("Kundennummer", { exact: true }).fill(customerNumber);
  await edit
    .getByLabel("Rechnungsadresse", { exact: true })
    .fill("Musterstraße 4\n1020 Wien");
  await edit
    .getByLabel("Straße und Hausnummer", { exact: true })
    .fill("Musterstraße 4");
  await edit.getByLabel("Postleitzahl", { exact: true }).fill("1020");
  await edit.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(edit).toHaveCount(0);
  const customer = await (await request.get(`/api/customers/${id}`)).json();
  expect(customer.customer_number).toBe(customerNumber);
  expect(customer.billing_address).toBe("Musterstraße 4\n1020 Wien");
  await page
    .getByRole("link", { name: "Rechnung erstellen", exact: true })
    .click();
  const editor = page.locator(".invoice-editor");
  await expect(editor).toContainText(customerNumber);
  await expect(editor).toContainText("Musterstraße 4");
  await expect(
    editor.locator(
      '[name="customer_number"], [name="billing_address"], [name="street"], [name="name"], [name="buyer_reference"], [name="endpoint_id"]',
    ),
  ).toHaveCount(1);
  // The only remaining name input belongs to an invoice position, not the recipient.
  await expect(editor.locator('.invoice-line [name="name"]')).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Anschrift im Kundenprofil speichern",
      exact: true,
    }),
  ).toHaveCount(0);
  const line = editor.locator(".invoice-line").first();
  for (const [scope, labels] of [
    [editor, ["Betreff", "Dokumentsprache", "Zahlungsziel (Tage)"]],
    [editor, ["Rechnungsdatum", "Fälligkeitsdatum", "Währung"]],
    [editor, ["Leistungsdatum von", "Leistungsdatum bis"]],
    [line, ["Menge", "Einheit", "Netto-Einzelpreis"]],
    [line, ["Steuerbehandlung", "Steuersatz (%)", "Steuergrund"]],
  ]) {
    const boxes = await Promise.all(
      labels.map((label) =>
        scope.getByLabel(label, { exact: true }).boundingBox(),
      ),
    );
    for (let index = 1; index < boxes.length; index++) {
      expect(
        Math.abs(boxes[0].y - boxes[index].y),
        labels.join(" | "),
      ).toBeLessThan(2);
      expect(boxes[index - 1].x).toBeLessThan(boxes[index].x);
    }
  }
  await expect(
    editor.getByText(
      "Die Dokumentensprache bleibt nach der Ausstellung erhalten.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  for (const [scope, labels] of [
    [editor, ["Betreff", "Dokumentsprache", "Zahlungsziel (Tage)"]],
    [editor, ["Rechnungsdatum", "Fälligkeitsdatum", "Währung"]],
    [line, ["Menge", "Einheit", "Netto-Einzelpreis"]],
    [line, ["Steuerbehandlung", "Steuersatz (%)", "Steuergrund"]],
  ]) {
    const boxes = await Promise.all(
      labels.map((label) =>
        scope.getByLabel(label, { exact: true }).boundingBox(),
      ),
    );
    for (let index = 1; index < boxes.length; index++) {
      expect(Math.abs(boxes[0].x - boxes[index].x)).toBeLessThan(2);
      expect(boxes[index - 1].y).toBeLessThan(boxes[index].y);
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(editor.locator('[name="service_date"]')).toHaveCount(0);
  await page
    .getByLabel("Leistungsdatum von", { exact: true })
    .fill("2026-11-01");
  await page
    .getByLabel("Leistungsdatum bis", { exact: true })
    .fill("2026-11-30");
  await page
    .getByLabel("Betreff", { exact: true })
    .fill("Kundenprofil übernehmen");
  const update = await request.patch(`/api/customers/${id}`, {
    data: {
      billing_address: "Abweichende Freitextadresse 99\n9999 Altstadt",
      street: "Neue Beispielstraße 5",
      postal_code: "1030",
    },
  });
  expect(update.ok(), await update.text()).toBe(true);
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/finance/creation/drafts"),
  );
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  const body = (await sent).postDataJSON();
  expect(body).not.toHaveProperty("recipient");
  expect(body).not.toHaveProperty("buyer_reference");
  expect(body).not.toHaveProperty("service_date");
  await expect(page).toHaveURL(/#\/invoice-editor\/[0-9a-f-]{36}$/);
  await expect(editor).toContainText("Neue Beispielstraße 5");
  await expect(editor).not.toContainText("Abweichende Freitextadresse 99");
  const draftId = page.url().split("/invoice-editor/")[1];
  const draft = await (
    await request.get(`/api/finance/creation/drafts/${draftId}`)
  ).json();
  expect(draft.recipient.customer_number).toBe(customerNumber);
  expect(draft.recipient.billing_address).toBe(
    "Abweichende Freitextadresse 99\n9999 Altstadt",
  );
  expect(draft.recipient.street).toBe("Neue Beispielstraße 5");
});

test("company invoice details have one form and preserve edits in other settings tabs", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings", { data: { language: "de" } });
  const initial = await (
    await request.get("/api/finance/creation/settings")
  ).json();
  const finance = await (await request.get("/api/finance/settings")).json();
  const hiddenIssuerValues = {
    tax_id: "TEST-STEUER-1",
    endpoint_id: "preserved@example.test",
    endpoint_scheme: "EM",
    contact_name: "Fiktiver Verkäuferkontakt",
  };
  try {
    await request.patch("/api/finance/creation/settings", {
      data: {
        company_address: "Example street 1\n10115 Berlin",
        ...hiddenIssuerValues,
      },
    });
    await page.goto("/#/finance-settings?tab=recognition");
    await page
      .getByLabel("Erkennungsmodell", { exact: true })
      .selectOption("gpt-4.1-mini");
    await page.getByRole("tab", { name: "Firma", exact: true }).click();
    const creation = page.locator(".invoice-creation-settings");
    const company = page.locator(".finance-company-settings");
    await expect(
      company.getByRole("heading", {
        name: "Eigene Rechnungsdaten",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      creation.getByRole("heading", {
        name: "Eigene Rechnungsdaten",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      company.getByText(
        "Firmenname und E-Mail werden mit den vorhandenen Firmeneinstellungen geteilt.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      creation.getByText(
        "Firmenname und E-Mail werden mit den vorhandenen Firmeneinstellungen geteilt.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      company.getByLabel("Straße und Hausnummer", { exact: true }),
    ).toBeVisible();
    await expect(
      company.getByLabel("Eigenes Rechnungslogo hochladen", { exact: true }),
    ).toBeVisible();
    await expect(
      creation.locator(
        '[name="street"], [name="postal_code"], [name="city"], [name="country_code"], [name="logo"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator('[name="company_name"]')).toHaveCount(1);
    await expect(page.locator('[name="company_email"]')).toHaveCount(1);
    for (const label of [
      "Weitere Steuerkennung",
      "Elektronische Adresse",
      "Adressschema",
      "Verkäuferkontakt",
    ])
      await expect(company.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(
      company.locator(
        '[name="tax_id"], [name="endpoint_id"], [name="endpoint_scheme"], [name="contact_name"]',
      ),
    ).toHaveCount(0);
    await expect(
      company.getByLabel("UID / USt-IdNr.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("form form")).toHaveCount(0);
    await company
      .getByLabel("Firmenname", { exact: true })
      .fill("Invoice form company");
    await company
      .getByLabel("Firmen-E-Mail", { exact: true })
      .fill("invoice-form@example.test");
    await expect(
      creation.getByLabel("Bisherige Freitextadresse", { exact: true }),
    ).toHaveCount(0);
    await expect(creation.locator('[name="company_address"]')).toHaveCount(0);
    const companySaveRequest = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        request.url().endsWith("/api/finance/creation/settings"),
    );
    await company
      .getByRole("button", {
        name: "Einstellungen speichern",
        exact: true,
      })
      .click();
    const companySaveBody = (await companySaveRequest).postDataJSON();
    for (const key of Object.keys(hiddenIssuerValues))
      expect(companySaveBody).not.toHaveProperty(key);
    await expect(
      page.getByText("Finanz-Einstellungen gespeichert.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Erkennung", exact: true }).click();
    await expect(
      page.getByLabel("Erkennungsmodell", { exact: true }),
    ).toHaveValue("gpt-4.1-mini");
    await page
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/finance/settings")).json())
            .company_name,
      )
      .toBe("Invoice form company");
    expect(
      (await (await request.get("/api/finance/settings")).json())
        .company_address,
    ).toBe("Example street 1\n10115 Berlin");
    await page
      .getByRole("tab", { name: "Rechnungserstellung", exact: true })
      .click();
    await creation
      .getByLabel("Bankname", { exact: true })
      .fill("Unsaved invoice bank");
    await page.getByRole("tab", { name: "Firma", exact: true }).click();
    await page
      .getByLabel("Firmenname", { exact: true })
      .fill("Company form company");
    await page
      .getByLabel("Firmen-E-Mail", { exact: true })
      .fill("company-form@example.test");
    await page
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/finance/settings")).json())
            .company_name,
      )
      .toBe("Company form company");
    await company
      .getByLabel("Inhaber / zusätzliche Namenszeile", { exact: true })
      .fill("Unsaved invoice owner");
    await page
      .getByRole("tab", { name: "Rechnungserstellung", exact: true })
      .click();
    await expect(company.getByLabel("Firmenname", { exact: true })).toHaveValue(
      "Company form company",
    );
    await expect(
      company.getByLabel("Firmen-E-Mail", { exact: true }),
    ).toHaveValue("company-form@example.test");
    await expect(creation.getByLabel("Bankname", { exact: true })).toHaveValue(
      "Unsaved invoice bank",
    );
    await creation
      .getByRole("button", {
        name: "Rechnungseinstellungen speichern",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/finance/creation/settings")).json())
            .bank_name,
      )
      .toBe("Unsaved invoice bank");
    await expect(
      company.getByLabel("Inhaber / zusätzliche Namenszeile", { exact: true }),
    ).toHaveValue("Unsaved invoice owner");
    expect(
      (await (await request.get("/api/finance/creation/settings")).json())
        .owner_name,
    ).toBe(initial.owner_name);
    await page.getByRole("tab", { name: "Firma", exact: true }).click();
    await company
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/finance/creation/settings")).json())
            .owner_name,
      )
      .toBe("Unsaved invoice owner");
    const saved = await (
      await request.get("/api/finance/creation/settings")
    ).json();
    expect(saved.company_name).toBe("Company form company");
    expect(saved.company_email).toBe("company-form@example.test");
    expect(saved.company_address).toBe("Example street 1\n10115 Berlin");
    for (const [key, value] of Object.entries(hiddenIssuerValues))
      expect(saved[key]).toBe(value);
  } finally {
    await request.patch("/api/finance/creation/settings", {
      data: {
        company_name: initial.company_name,
        company_email: initial.company_email,
        company_address: initial.company_address,
        bank_name: initial.bank_name,
        owner_name: initial.owner_name,
        ...Object.fromEntries(
          Object.keys(hiddenIssuerValues).map((key) => [key, initial[key]]),
        ),
      },
    });
    await request.patch("/api/finance/settings", {
      data: { model: finance.model },
    });
  }
});

test("create a collective invoice from offers, preview, issue PDF/XML and record payment", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const prefix = `Rechnung UI ${testInfo.project.name} ${randomUUID()}`;
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await request.patch("/api/settings", { data: { language: "de" } });
  async function create(resource, data) {
    const response = await request.post("/api/" + resource, { data });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }
  const resetHiddenIssuer = await request.patch(
    "/api/finance/creation/settings",
    {
      data: {
        contact_name: "",
        endpoint_id: "",
        endpoint_scheme: "",
        tax_id: "",
      },
    },
  );
  expect(resetHiddenIssuer.ok(), await resetHiddenIssuer.text()).toBe(true);
  await page.goto("/#/finance-settings?tab=company");
  const companySettings = page.locator(".finance-company-settings");
  await expect(companySettings).toBeVisible();
  for (const [label, value] of Object.entries({
    Firmenname: "Fiktive Testberatung GmbH",
    "Inhaber / zusätzliche Namenszeile": "Erika Beispiel",
    "Straße und Hausnummer": "Beispielweg 1",
    Postleitzahl: "10115",
    Ort: "Berlin",
    Ländercode: "DE",
    "Firmen-E-Mail": "invoice@example.test",
    Telefon: "+49 30 000000",
    "UID / USt-IdNr.": "DE123456789",
  }))
    await companySettings.getByLabel(label, { exact: true }).fill(value);
  await companySettings
    .getByLabel("Eigenes Rechnungslogo hochladen", { exact: true })
    .setInputFiles({
      name: "testlogo.jpg",
      mimeType: logoFormats.jpeg.mime_type,
      buffer: Buffer.from(logoFormats.jpeg.data_base64, "base64"),
    });
  await companySettings
    .getByRole("button", { name: "Einstellungen speichern", exact: true })
    .click();
  await expect(
    page.getByText("Finanz-Einstellungen gespeichert.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    companySettings.getByLabel("Firmenname", { exact: true }),
  ).toHaveValue("Fiktive Testberatung GmbH");
  await expect(
    companySettings.locator(".invoice-issuer-logo img"),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Rechnungserstellung", exact: true })
    .click();
  const settings = page.locator(".invoice-creation-settings");
  await expect(settings).toBeVisible();
  await expect(
    settings.locator(
      '[name="company_name"], [name="company_email"], [name="logo"]',
    ),
  ).toHaveCount(0);
  for (const [label, value] of Object.entries({
    Bankname: "Fiktive Testbank",
    Kontoinhaber: "Fiktive Testberatung GmbH",
    IBAN: "DE09000000000000000001",
    BIC: "TESTDEFFXXX",
    "Standardzahlungsziel (Tage)": "14",
    "Standard-Steuersatz (%)": "19",
    Nummernpräfix: `UI-${testInfo.project.name}-`,
    "Anzahl Ziffern": "5",
    "Nächster Zählerwert": "1",
  }))
    await settings.getByLabel(label, { exact: true }).fill(value);
  await settings
    .getByRole("button", {
      name: "Rechnungseinstellungen speichern",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Rechnungseinstellungen gespeichert.", { exact: true }),
  ).toBeVisible();
  const customer = await create("customers", { name: prefix });
  const offers = [];
  for (const [index, amount] of [10000, 5000].entries()) {
    const service = await create("services", {
      name: `${prefix} Leistung ${index + 1}`,
    });
    const offer = await create("customer-services", {
      customer_id: customer.id,
      service_id: service.id,
      current_offered_price_minor: amount,
    });
    for (const status of ["pitched", "accepted"]) {
      const response = await request.post(
        `/api/customer-services/${offer.id}/status`,
        { data: { status } },
      );
      expect(response.ok(), await response.text()).toBe(true);
    }
    offers.push(offer);
  }
  await page.goto("/#/customers/" + customer.id);
  await page
    .getByRole("button", { name: "Rechnungsprofil ergänzen", exact: true })
    .click();
  const profile = page.locator(".invoice-profile-editor");
  for (const [label, value] of Object.entries({
    Kundennummer: "K-UI-" + testInfo.project.name,
    "Straße und Hausnummer": "Musterstraße 2",
    Postleitzahl: "20095",
    Ort: "Hamburg",
    Ländercode: "DE",
    "E-Mail für Rechnungen": "buyer@example.test",
    "UID / USt-IdNr.": "DE987654321",
    "Elektronische Adresse": "buyer@example.test",
    Adressschema: "EM",
    "Käuferreferenz (BT-10)": "UI-ORDER-1",
    "Bisherige Freitextadresse": "Abweichende alte Adresse 99\n99999 Altstadt",
  }))
    await profile.getByLabel(label, { exact: true }).fill(value);
  await profile
    .getByRole("button", { name: "Rechnungsprofil speichern", exact: true })
    .click();
  await expect(profile).toHaveCount(0);
  await expect(page.locator("#main")).toContainText("Musterstraße 2");
  await expect(page.locator("#main")).not.toContainText(
    "Abweichende alte Adresse 99",
  );
  await page
    .getByRole("link", { name: "Rechnung erstellen", exact: true })
    .click();
  await expect(page.getByLabel("Rechnungskunde", { exact: true })).toHaveValue(
    customer.id,
  );
  await expect(page.locator(".invoice-editor")).toContainText("Musterstraße 2");
  await expect(page.locator(".invoice-editor")).not.toContainText(
    "Abweichende alte Adresse 99",
  );
  await page.getByLabel("Betreff", { exact: true }).fill(prefix);
  await page
    .getByLabel("Leistungsdatum von", { exact: true })
    .fill("2026-11-16");
  await page
    .getByLabel("Leistungsdatum bis", { exact: true })
    .fill("2026-11-16");
  await expect(
    page.locator(
      '.invoice-editor [name="recipient"], .invoice-editor [name="customer_number"], .invoice-editor [name="billing_address"], .invoice-editor [name="street"], .invoice-editor [name="endpoint_id"], .invoice-editor [name="buyer_reference"]',
    ),
  ).toHaveCount(0);
  await expect(page.getByLabel("Leistungsdatum", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: "Anschrift im Kundenprofil speichern",
      exact: true,
    }),
  ).toHaveCount(0);
  for (const offer of offers) {
    await page
      .getByLabel("Weiteres Angebot übernehmen", { exact: true })
      .selectOption(offer.id);
    await page
      .getByRole("button", { name: "Angebot übernehmen", exact: true })
      .click();
  }
  await expect(page.locator(".invoice-line")).toHaveCount(2);
  await page
    .locator(".invoice-line")
    .first()
    .getByLabel("Menge", { exact: true })
    .fill("1,5");
  await page
    .getByLabel("E-Rechnung zusätzlich erstellen", { exact: true })
    .check();
  await expect(page.locator(".invoice-totals")).toContainText("238,00");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/invoice-editor\/[0-9a-f-]{36}$/);
  const draftId = page.url().split("/invoice-editor/")[1];
  const config = await (
    await request.get("/api/finance/creation/settings")
  ).json();
  expect(config.next_number).toBe(1);
  for (const key of [
    "contact_name",
    "endpoint_id",
    "endpoint_scheme",
    "tax_id",
  ])
    expect(config[key]).toBe("");
  await page.goto("/#/invoices");
  await expect(
    page.getByRole("link", { name: prefix, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: prefix, exact: true }).click();
  await expect(page.locator(".invoice-line")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Vorschau ansehen", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "PDF-Vorschau öffnen", exact: true }),
  ).toBeVisible();
  const preview = await request.get(
    `/api/finance/creation/drafts/${draftId}/preview`,
  );
  expect(preview.ok(), await preview.text()).toBe(true);
  expect((await preview.body()).subarray(0, 5).toString()).toBe("%PDF-");
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-invoice-editor.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Rechnung verbindlich erstellen",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Verbindlich erstellen", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/, {
    timeout: 120000,
  });
  const invoiceId = page.url().split("/invoices/")[1];
  await expect(page.locator("#main")).toContainText("Musterstraße 2");
  await expect(page.locator("#main")).not.toContainText(
    "Abweichende alte Adresse 99",
  );
  const xml = await request.get(`/api/finance/invoices/${invoiceId}/xml`);
  expect(xml.ok(), await xml.text()).toBe(true);
  expect(await xml.text()).toContain("Musterstraße 2");
  expect(await xml.text()).not.toContain("Abweichende alte Adresse 99");
  expect(await xml.text()).toContain(
    '<cbc:EndpointID schemeID="EM">invoice@example.test</cbc:EndpointID>',
  );
  expect(await xml.text()).toContain(
    "<cac:Contact><cbc:Name>Erika Beispiel</cbc:Name>",
  );
  await expect(
    page.getByRole("link", {
      name: "E-Rechnung herunterladen (XML)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bearbeiten", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Erneut verarbeiten", exact: true }),
  ).toHaveCount(0);
  for (const [name, suffix] of [
    ["PDF herunterladen", ".pdf"],
    ["E-Rechnung herunterladen (XML)", ".xml"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(new RegExp(`${suffix}$`));
    expect(await download.failure()).toBeNull();
  }
  await page.getByRole("radio", { name: "Bezahlt", exact: true }).check();
  await expect(
    page.getByRole("radio", { name: "Bezahlt", exact: true }),
  ).toBeChecked();
  const invoice = await (
    await request.get(`/api/finance/invoices/${invoiceId}`)
  ).json();
  expect(invoice.status).toBe("paid");
  expect(invoice.total_amount_minor).toBe(23800);
  expect(invoice.customer_service_ids.sort()).toEqual(
    offers.map((offer) => offer.id).sort(),
  );
  for (const offer of offers) {
    const result = await (
      await request.get(`/api/finance/invoices?customer_service_id=${offer.id}`)
    ).json();
    expect(result.items.map((row) => row.id)).toContain(invoiceId);
    await page.goto("/#/relationships/" + offer.id);
    await expect(
      page.getByRole("link", { name: invoice.invoice_number, exact: true }),
    ).toBeVisible();
  }
  await page.goto("/#/invoices/" + invoiceId);
  await request.patch("/api/settings", { data: { language: "en" } });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Download e-invoice (XML)", exact: true }),
  ).toBeVisible();
  const issued = await (
    await request.get(`/api/finance/creation/drafts/${draftId}`)
  ).json();
  expect(issued.language).toBe("de");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-invoice-issued-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
  await request.patch("/api/settings", { data: { language: "de" } });
});
