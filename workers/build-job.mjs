import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildLcr2Deck, parseCsvMatrix, parseTrafficMatrix, DeckError } from "../lib/lcr2.ts";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("A build manifest path is required.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), "utf8");
  await rename(temporaryPath, filePath);
}

async function status(state, extra = {}) {
  await writeJsonAtomic(manifest.statusPath, {
    jobId: manifest.jobId,
    state,
    createdAt: manifest.createdAt,
    updatedAt: new Date().toISOString(),
    variant: manifest.variant,
    filename: manifest.filename,
    ...extra,
  });
}

function excelCellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "result" in value && value.result !== undefined) return excelCellText(value.result);
  if (typeof value === "object" && "text" in value) return value.text;
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return "";
}

// Parse the traffic file here, in the background worker, instead of in the HTTP
// request handler. A large .xlsx no longer blocks the web server's event loop
// and no longer counts against Cloudflare's request timeout.
async function parseTrafficFile(trafficPath, trafficFilename) {
  const lowerName = String(trafficFilename || "").toLowerCase();
  if (lowerName.endsWith(".csv") || trafficPath.toLowerCase().endsWith(".csv")) {
    return parseTrafficMatrix(parseCsvMatrix(await readFile(trafficPath, "utf8")));
  }
  // Load exceljs lazily and defensively: it is only needed for .xlsx files, and
  // a dynamic import lets us turn a missing-module failure into a clear message
  // instead of an uncatchable import-time crash ("could not start").
  let ExcelJS;
  try {
    ({ default: ExcelJS } = await import("exceljs"));
  } catch {
    throw new DeckError("The server could not load the Excel parser. Re-save the traffic file as CSV, or redeploy so exceljs is bundled with the worker.");
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(trafficPath);
  } catch {
    throw new DeckError("The current traffic Excel file could not be read.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new DeckError("The current traffic Excel workbook has no worksheets.");
  const matrix = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const width = Math.max(worksheet.columnCount, row.cellCount);
    matrix.push(Array.from({ length: width }, (_, index) => excelCellText(row.getCell(index + 1).value).trim()));
  });
  return parseTrafficMatrix(matrix);
}

const started = Date.now();
try {
  await status("running");
  const [customerText, vendorTexts] = await Promise.all([
    readFile(manifest.customerPath, "utf8"),
    Promise.all(manifest.vendorPaths.map((vendorPath) => readFile(vendorPath, "utf8"))),
  ]);
  const trafficRows = await parseTrafficFile(manifest.trafficPath, manifest.trafficFilename);
  const result = buildLcr2Deck(customerText, vendorTexts, manifest.options, trafficRows);
  await writeFile(manifest.outputPath, result.csv, "utf8");
  await status("completed", { summary: result.summary, durationMs: Date.now() - started });
} catch (error) {
  const reference = manifest.jobId.slice(0, 8);
  await writeFile(`${manifest.jobDirectory}/error.log`, error instanceof Error ? (error.stack || error.message) : String(error), "utf8").catch(() => undefined);
  // Surface validation / input errors (which carry a user-meaningful message)
  // to the UI; keep infrastructure errors generic with a reference code.
  const isDeckError = error instanceof DeckError;
  await status("failed", {
    durationMs: Date.now() - started,
    error: isDeckError ? error.message : `The background build failed. Reference: ${reference}.`,
  });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    unlink(manifest.customerPath),
    unlink(manifest.trafficPath),
    unlink(manifestPath),
  ]);
}
