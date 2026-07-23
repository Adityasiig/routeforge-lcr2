import { buildLcr2Deck, parseDeck } from "../lib/lcr2.ts";

const rowCount = Number(process.env.BENCHMARK_ROWS || "50000");
const vendorCount = Number(process.env.BENCHMARK_VENDORS || "6");
if (!Number.isInteger(rowCount) || rowCount < 1 || !Number.isInteger(vendorCount) || vendorCount < 1) {
  throw new Error("BENCHMARK_ROWS and BENCHMARK_VENDORS must be positive integers.");
}

const header = "code,interrate,intrarate,ijrate\n";
const customerLines = [header.trimEnd()];
for (let index = 0; index < rowCount; index += 1) {
  customerLines.push(`${1000000 + index},0.0500,0.0500,0.0500`);
}
const customer = `${customerLines.join("\n")}\n`;

const vendors = Array.from({ length: vendorCount }, (_, vendorIndex) => {
  const rate = (0.01 + vendorIndex * 0.001).toFixed(4);
  const lines = [header.trimEnd()];
  for (let index = 0; index < rowCount; index += 1) {
    lines.push(`${1000000 + index},${rate},${rate},${rate}`);
  }
  return `${lines.join("\n")}\n`;
});

const started = performance.now();
const result = buildLcr2Deck(customer, vendors, { markup: "40", singleVendor: "fallback", decimals: 4 });
const elapsedSeconds = (performance.now() - started) / 1000;
const outputRows = parseDeck(result.csv).rows.length;
const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;

if (outputRows !== rowCount || result.summary.validation.status !== "PASS") throw new Error("Large build validation failed.");
console.log(JSON.stringify({ rowCount, vendorCount, sourceRows: rowCount * vendorCount, outputRows, elapsedSeconds, heapMb }, null, 2));
