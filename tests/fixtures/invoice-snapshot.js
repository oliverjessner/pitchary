export function invoiceSnapshot(category = "S", count = 2) {
  const tax_rate = category === "S" ? "19" : "0";
  const tax_reason =
    category === "AE"
      ? "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)."
      : category === "E"
        ? "Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG."
        : "";
  const items = Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    name: `Fiktive Beratungsleistung ${i + 1}`,
    description:
      "Konzeption und Dokumentation für ein fiktives Testprojekt. Keine realen Kunden- oder Kontodaten.",
    quantity: "1.5",
    unit: "HUR",
    unit_price: "100.00",
    tax_category: category,
    tax_rate,
    tax_reason,
    net_amount_minor: 15000,
    customer_service_id: null,
  }));
  const net_amount_minor = count * 15000;
  const tax_amount_minor =
    category === "S" ? Math.round((net_amount_minor * 19) / 100) : 0;
  return {
    invoice_number: "TEST-00001",
    invoice_date: "2026-11-16",
    due_date: "2026-11-30",
    service_period_start: "2026-11-01",
    service_period_end: "2026-11-15",
    service_date: "",
    currency: "EUR",
    language: "de",
    subject: "Beratung für das fiktive Beispielprojekt",
    note: "Vielen Dank für die Zusammenarbeit.",
    payment_text:
      "Bitte überweisen Sie den Gesamtbetrag bis zum Fälligkeitsdatum.",
    tax_text: tax_reason,
    buyer_reference: "BEISPIEL-AUFTRAG-2026",
    e_invoice: true,
    seller: {
      name: "Fiktive Beratung GmbH",
      additional_name: "Erika Beispiel",
      street: "Beispielweg 1",
      postal_code: "10115",
      city: "Berlin",
      country_code: "DE",
      email: "rechnung@example.test",
      phone: "+49 30 000000",
      website: "https://example.test",
      vat_id: "DE123456789",
      endpoint_id: "rechnung@example.test",
      endpoint_scheme: "EM",
      contact_name: "Erika Beispiel",
      logo: null,
    },
    recipient: {
      name: "Fiktiver Auftraggeber GmbH",
      street: "Musterstraße 2",
      postal_code: "20095",
      city: "Hamburg",
      country_code: "DE",
      vat_id: "DE987654321",
      endpoint_id: "buchhaltung@example.test",
      endpoint_scheme: "EM",
      customer_number: "K-TEST-1",
    },
    bank: {
      name: "Fiktive Testbank",
      account_holder: "Fiktive Beratung GmbH",
      iban: "DE09000000000000000001",
      bic: "TESTDEFFXXX",
    },
    items,
    totals: {
      net_amount_minor,
      tax_amount_minor,
      total_amount_minor: net_amount_minor + tax_amount_minor,
      tax_breakdown: [
        {
          tax_category: category,
          tax_rate,
          tax_reason,
          net_amount_minor,
          tax_amount_minor,
        },
      ],
    },
  };
}
