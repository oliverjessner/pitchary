import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { AppError } from "./validation.js";
import { xrechnungProfile } from "./invoice-xml.js";

const execute = promisify(execFile);
const repository = fileURLToPath(
  new URL("../../vendor/xrechnung/", import.meta.url),
);
const bundledJava = fileURLToPath(
  new URL("../../../java/Contents/Home/bin/java", import.meta.url),
);
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
});
let verifiedResources;

async function verifyResources() {
  const manifest = JSON.parse(
    await readFile(path.join(repository, "PITCHARY-MANIFEST.json"), "utf8"),
  );
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = createHash("sha256")
      .update(await readFile(path.join(repository, name)))
      .digest("hex");
    if (actual !== expected)
      throw new Error("KoSIT resource checksum mismatch.");
  }
}

async function javaExecutable() {
  if (process.env.PITCHARY_JAVA) return process.env.PITCHARY_JAVA;
  try {
    await access(bundledJava, constants.X_OK);
    return bundledJava;
  } catch {
    return "java";
  }
}

function messages(node, output = []) {
  if (!node || typeof node !== "object") return output;
  if (node.message) {
    for (const entry of [node.message].flat())
      if (entry?.["#text"] && entry["@_level"])
        output.push(`${entry["@_code"] || "XML"}: ${entry["#text"]}`);
  }
  if (node["failed-assert"]) {
    for (const failure of [node["failed-assert"]].flat()) {
      const text = failure.text;
      const content = typeof text === "object" ? text["#text"] : text;
      if (content) output.push(`${failure["@_id"] || "XML"}: ${content}`);
    }
  }
  for (const value of Object.values(node))
    if (typeof value === "object") messages(value, output);
  return output;
}

export async function validateInvoiceXML(data) {
  const bytes = Buffer.from(data);
  if (
    bytes.length > 8 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(bytes.toString("utf8"))
  )
    throw new AppError(
      422,
      "invoice_xml_invalid",
      "E-Rechnung: Ungültiges XML-Dokument.",
    );
  try {
    await (verifiedResources ??= verifyResources());
  } catch {
    throw new AppError(
      503,
      "invoice_validator_unavailable",
      "Die lokale E-Rechnungsprüfung ist nicht verfügbar. Java und KoSIT-Ressourcen prüfen.",
    );
  }
  const directory = await mkdtemp(path.join(tmpdir(), "pitchary-xrechnung-"));
  try {
    await writeFile(path.join(directory, "invoice.xml"), bytes, {
      mode: 0o600,
    });
    try {
      await execute(
        await javaExecutable(),
        [
          "-Xmx512m",
          "-Djava.awt.headless=true",
          "-jar",
          path.join(repository, "validator-1.6.3-standalone.jar"),
          "-s",
          path.join(repository, "scenarios.xml"),
          "-r",
          repository,
          "-o",
          directory,
          path.join(directory, "invoice.xml"),
        ],
        { timeout: 90000, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
      );
    } catch (error) {
      // KoSIT may exit nonzero for a rejected invoice; its report remains authoritative.
      try {
        await access(path.join(directory, "invoice-report.xml"));
      } catch {
        throw new AppError(
          503,
          "invoice_validator_unavailable",
          "Die lokale E-Rechnungsprüfung ist nicht verfügbar. Java und KoSIT-Ressourcen prüfen.",
        );
      }
    }
    const reportXML = await readFile(
      path.join(directory, "invoice-report.xml"),
      "utf8",
    );
    const report = parser.parse(reportXML).report;
    if (!report?.assessment || !Object.hasOwn(report.assessment, "accept")) {
      const details = [...new Set(messages(report))].slice(0, 12);
      throw new AppError(
        422,
        "invoice_xml_invalid",
        `E-Rechnung nicht konform: ${details.join("; ") || "Schema oder Geschäftsregeln nicht erfüllt."}`,
        { e_invoice: details },
      );
    }
    return {
      valid: true,
      profile: xrechnungProfile,
      checked_at: new Date().toISOString(),
      warnings: [...new Set(messages(report))],
      report_xml: reportXML,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
