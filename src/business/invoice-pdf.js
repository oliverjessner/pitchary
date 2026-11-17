import PDFDocument from "pdfkit";
import { invalid } from "./validation.js";

const copy = {
  de: {
    invoice: "Rechnung",
    draft: "ENTWURF",
    subject: "Betreff",
    number: "Rechnungsnummer",
    customer: "Kundennummer",
    recipient_vat: "UID/USt-IdNr. Kunde",
    reference: "Käuferreferenz",
    date: "Rechnungsdatum",
    service: "Leistung",
    due: "Fällig am",
    position: "Pos.",
    description: "Beschreibung",
    quantity: "Menge",
    unit: "Einheit",
    tax: "USt.",
    price: "Einzelpreis",
    total: "Gesamt",
    net: "Nettosumme",
    payment: "Zahlungsbedingungen",
    remarks: "Hinweise",
    contact: "Kontakt",
    bank_details: "Bankverbindung",
    page: "Seite",
    of: "von",
    continued: "Fortsetzung",
  },
  en: {
    invoice: "Invoice",
    draft: "DRAFT",
    subject: "Subject",
    number: "Invoice number",
    customer: "Customer number",
    recipient_vat: "Customer VAT ID",
    reference: "Buyer reference",
    date: "Invoice date",
    service: "Service",
    due: "Due date",
    position: "No.",
    description: "Description",
    quantity: "Qty",
    unit: "Unit",
    tax: "VAT",
    price: "Unit price",
    total: "Total",
    net: "Net total",
    payment: "Payment terms",
    remarks: "Notes",
    contact: "Contact",
    bank_details: "Bank details",
    page: "Page",
    of: "of",
    continued: "Continued",
  },
};

export async function renderInvoicePDF(snapshot, { draft = false } = {}) {
  const s = snapshot,
    labels = copy[s.language] || copy.de;
  const locale = s.language === "en" ? "en-GB" : "de-AT";
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: s.currency,
  });
  const amount = (minor) =>
    format.format(minor / 100).replace(/\u00a0|\u202f/g, " ");
  const integerFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });
  const decimalSeparator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === "decimal").value;
  const currencyParts = format.formatToParts(0);
  const currencySymbol = currencyParts.find(
    (part) => part.type === "currency",
  ).value;
  const currencyFirst =
    currencyParts.findIndex((part) => part.type === "currency") <
    currencyParts.findIndex((part) => part.type === "integer");
  const decimalText = (value, minimum = 0) => {
    const [whole, fraction = ""] = String(value).split(".");
    const tail = fraction.replace(/0+$/, "").padEnd(minimum, "0");
    return (
      integerFormat.format(BigInt(whole)) +
      (tail ? decimalSeparator + tail : "")
    );
  };
  const priceText = (value) =>
    currencyFirst
      ? currencySymbol + decimalText(value, 2)
      : decimalText(value, 2) + " " + currencySymbol;
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(
          new Date(value + "T00:00:00.000Z"),
        )
      : "";
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: {
      Title: `${labels.invoice} ${s.invoice_number || labels.draft}`,
      Author: s.seller.name,
      Subject: s.subject || "",
    },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = 42,
    right = 553.28,
    width = right - left;
  let bottom = 709,
    footerTop = 737;
  let y = 42;
  function text(value, x, top, options = {}) {
    doc
      .font(options.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(options.size || 9)
      .fillColor(options.color || "#222222");
    doc.text(String(value ?? ""), x, top, {
      lineGap: 1.2,
      ...options,
      continued: false,
    });
  }
  function rule(top, color = "#dddddd") {
    doc.moveTo(left, top).lineTo(right, top).lineWidth(0.5).stroke(color);
  }
  function lines(value, lineWidth, size = 9, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    const output = [];
    for (const paragraph of String(value ?? "").split(/\r?\n/)) {
      let current = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (current && doc.widthOfString(current + " " + word) > lineWidth) {
          output.push(current);
          current = "";
        }
        let rest = word;
        while (doc.widthOfString(rest) > lineWidth) {
          let cut = rest.length - 1;
          while (cut > 1 && doc.widthOfString(rest.slice(0, cut)) > lineWidth)
            cut--;
          if (current) {
            output.push(current);
            current = "";
          }
          output.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        current += (current ? " " : "") + rest;
      }
      output.push(current);
    }
    return output;
  }
  function newPage() {
    doc.addPage();
    y = 42;
    text(labels.invoice, left, y, { bold: true, size: 11, width: 330 });
    text(`${labels.invoice} ${s.invoice_number || labels.draft}`, 375, y, {
      width: right - 375,
      align: "right",
    });
    if (draft)
      text(labels.draft, left, 62, { bold: true, color: "#777777", size: 9 });
    rule(82);
    y = 98;
  }
  function paragraph(value, options = {}) {
    const wrapped = lines(
      value,
      options.width || width,
      options.size || 9,
      options.bold,
    );
    for (const line of wrapped) {
      if (y + 12 > bottom) newPage();
      text(line, options.x || left, y, {
        ...options,
        width: options.width || width,
      });
      y += (options.size || 9) + 3;
    }
    y += 6;
  }
  const sellerAddress = s.seller.street
    ? [
        s.seller.street,
        [s.seller.postal_code, s.seller.city].filter(Boolean).join(" "),
        s.seller.country_code,
      ].filter(Boolean)
    : (s.seller.billing_address || "").split(/\r?\n/).filter(Boolean);
  const footer = [
    {
      heading: s.seller.name,
      entries: [
        s.seller.additional_name,
        ...sellerAddress,
        s.seller.vat_id,
        s.seller.tax_id,
      ],
    },
    {
      heading: labels.contact,
      entries: [s.seller.email, s.seller.phone, s.seller.website],
    },
    {
      heading: labels.bank_details,
      entries: [s.bank.name, s.bank.account_holder, s.bank.iban, s.bank.bic],
    },
  ].map(({ heading, entries }) => ({
    heading: lines(heading, 155, 8, true),
    body: entries.filter(Boolean).flatMap((entry) => lines(entry, 155, 7)),
  }));
  footerTop = Math.min(
    737,
    813 -
      Math.max(
        ...footer.map(
          (column) => column.heading.length * 11 + 4 + column.body.length * 9,
        ),
      ) -
      13,
  );
  if (footerTop < 500)
    invalid(
      "Die Angaben für die Rechnungsfußzeile sind zu lang. Bitte Namen und Kontaktangaben kürzen.",
      "seller",
    );
  bottom = footerTop - 28;
  if (s.seller.logo?.data_base64) {
    const logo = Buffer.from(s.seller.logo.data_base64, "base64");
    doc.image(logo, left, 40, {
      fit: [185, 64],
      align: "left",
      valign: "center",
    });
    y = 110;
  } else paragraph(s.seller.name, { bold: true, size: 17, width: 295 });
  text(labels.invoice, 350, 42, {
    bold: true,
    size: 25,
    width: right - 350,
    align: "right",
  });
  if (draft)
    text(labels.draft, 350, 76, {
      bold: true,
      color: "#777777",
      size: 13,
      width: right - 350,
      align: "right",
    });
  const senderAddress = sellerAddress.join(", ");
  y = Math.max(122, y + 12);
  paragraph(
    [s.seller.name, senderAddress.replace(/\r?\n/g, ", ")]
      .filter(Boolean)
      .join(" · "),
    { size: 7, color: "#666666" },
  );
  y += 6;
  const recipientAddress = s.recipient.street
    ? [
        s.recipient.street,
        [s.recipient.postal_code, s.recipient.city].filter(Boolean).join(" "),
        s.recipient.country_code,
      ]
        .filter(Boolean)
        .join("\n")
    : s.recipient.billing_address || "";
  paragraph(s.recipient.name, { bold: true, width: 310, size: 11 });
  if (s.contact?.name) paragraph(s.contact.name, { width: 310 });
  if (s.recipient.additional_name)
    paragraph(s.recipient.additional_name, { width: 310 });
  paragraph(recipientAddress, { width: 310 });
  y = Math.max(y + 16, 248);
  if (s.subject) paragraph(s.subject, { bold: true, size: 11 });
  const service = s.service_date
    ? date(s.service_date)
    : [date(s.service_period_start), date(s.service_period_end)]
        .filter(Boolean)
        .join(" - ");
  const metadata = [
    [labels.number, s.invoice_number || labels.draft],
    [labels.date, date(s.invoice_date)],
    [labels.customer, s.recipient.customer_number],
    [labels.recipient_vat, s.recipient.vat_id],
    [labels.reference, s.buyer_reference || s.recipient.buyer_reference],
    [labels.service, service],
    [labels.due, date(s.due_date)],
  ].filter(([, value]) => value);
  for (let i = 0; i < metadata.length; i += 2) {
    if (y + 29 > bottom) newPage();
    for (let column = 0; column < 2; column++) {
      const entry = metadata[i + column];
      if (!entry) continue;
      const x = left + column * 264;
      text(entry[0], x, y, { size: 7.5, color: "#777777", width: 250 });
      text(entry[1], x, y + 12, { size: 9, width: 250 });
    }
    y += 32;
  }
  y += 12;
  const columns = [24, 201.28, 46, 34, 36, 85, 85];
  // Columns are scaled to the A4 content area so every amount stays on the page.
  const factor = width / columns.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < columns.length; i++) columns[i] *= factor;
  const xs = columns.map(
    (_, i) => left + columns.slice(0, i).reduce((sum, value) => sum + value, 0),
  );
  function tableHeader() {
    if (y + 38 > bottom) newPage();
    doc.rect(left, y, width, 25).fill("#eeeeee");
    [
      labels.position,
      labels.description,
      labels.quantity,
      labels.unit,
      labels.tax,
      labels.price,
      labels.total,
    ].forEach((label, i) =>
      text(label, xs[i] + 4, y + 8, {
        bold: true,
        size: 7.1,
        width: columns[i] - 8,
        align: i >= 2 && i !== 3 ? "right" : "left",
      }),
    );
    y += 30;
  }
  tableHeader();
  for (const [index, item] of s.items.entries()) {
    const values = [
      index + 1,
      null,
      decimalText(item.quantity),
      item.unit,
      `${item.tax_rate}%`,
      priceText(item.unit_price),
      amount(item.net_amount_minor),
    ];
    doc.font("Helvetica").fontSize(8.1);
    const numericSizes = values.map((value, i) =>
      value === null
        ? 8.1
        : Math.min(
            8.1,
            (8.1 * (columns[i] - 8)) /
              Math.max(1, doc.widthOfString(String(value))),
          ),
    );
    const numericHeight = Math.max(
      29,
      ...values.map((value, i) =>
        value === null
          ? 0
          : doc.heightOfString(String(value), {
              width: columns[i] - 8,
              lineGap: 1.2,
            }) + 12,
      ),
    );
    const descriptions = [
      ...lines(item.name, columns[1] - 8, 8.3, true).map((value) => ({
        value,
        bold: true,
      })),
      ...lines(item.description || "", columns[1] - 8, 8.3)
        .filter(Boolean)
        .map((value) => ({ value, bold: false })),
    ];
    let offset = 0;
    while (offset < descriptions.length) {
      if (y + Math.max(35, numericHeight) > bottom) {
        newPage();
        tableHeader();
      }
      const maxLines = Math.max(1, Math.floor((bottom - y - 14) / 11.5));
      const part = descriptions.slice(offset, offset + maxLines);
      const height = Math.max(
        offset ? 29 : numericHeight,
        part.length * 11.5 + 14,
      );
      if (!offset) {
        values.forEach((value, i) => {
          if (value !== null)
            text(value, xs[i] + 4, y + 6, {
              size: numericSizes[i],
              lineBreak: false,
              width: columns[i] - 8,
              align: i >= 2 && i !== 3 ? "right" : "left",
            });
        });
      }
      part.forEach((line, i) =>
        text(line.value, xs[1] + 4, y + 6 + i * 11.5, {
          bold: line.bold,
          size: 8.3,
          width: columns[1] - 8,
        }),
      );
      y += height;
      rule(y - 4);
      offset += part.length;
      if (offset < descriptions.length) {
        newPage();
        tableHeader();
      }
    }
  }
  const totalsHeight = 60 + s.totals.tax_breakdown.length * 19;
  if (y + totalsHeight > bottom) newPage();
  y += 12;
  const totalX = 307,
    totalWidth = right - totalX;
  function totalRow(label, value, bold = false) {
    if (y + (bold ? 30 : 24) > bottom) newPage();
    text(label, totalX, y, {
      bold,
      size: bold ? 11 : 9,
      width: totalWidth - 95,
    });
    text(amount(value), right - 100, y, {
      bold,
      size: bold ? 11 : 9,
      width: 100,
      align: "right",
    });
    y += bold ? 25 : 19;
  }
  totalRow(labels.net, s.totals.net_amount_minor);
  for (const row of s.totals.tax_breakdown)
    totalRow(
      `${labels.tax} ${row.tax_rate}% (${row.tax_category})`,
      row.tax_amount_minor,
    );
  doc
    .moveTo(totalX, y - 5)
    .lineTo(right, y - 5)
    .stroke("#aaaaaa");
  totalRow(labels.total, s.totals.total_amount_minor, true);
  y += 13;
  if (s.payment_text) {
    paragraph(labels.payment, { bold: true });
    paragraph(s.payment_text);
  }
  const reasons = [
    ...new Set(
      [s.tax_text, ...s.items.map((item) => item.tax_reason)].filter(Boolean),
    ),
  ];
  if (reasons.length || s.note) {
    paragraph(labels.remarks, { bold: true });
    for (const reason of reasons) paragraph(reason);
    if (s.note) paragraph(s.note);
  }
  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    rule(footerTop);
    footer.forEach((entries, column) => {
      let top = footerTop + 13;
      for (const line of entries.heading) {
        text(line, left + column * 175, top, {
          bold: true,
          size: 8,
          color: "#333333",
          width: 155,
        });
        top += 11;
      }
      top += 4;
      for (const line of entries.body) {
        text(line, left + column * 175, top, {
          size: 7,
          color: "#666666",
          width: 155,
        });
        top += 9;
      }
    });
    text(`${labels.page} ${index + 1} ${labels.of} ${pages.count}`, left, 818, {
      size: 7,
      color: "#777777",
      width,
      align: "right",
    });
  }
  doc.end();
  return completed;
}
