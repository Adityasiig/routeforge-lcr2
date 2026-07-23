import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildLcr2Deck } from "../lib/lcr2.ts";

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

const started = Date.now();
try {
  await status("running");
  const [customerText, trafficText, vendorTexts] = await Promise.all([
    readFile(manifest.customerPath, "utf8"),
    readFile(manifest.trafficPath, "utf8"),
    Promise.all(manifest.vendorPaths.map((vendorPath) => readFile(vendorPath, "utf8"))),
  ]);
  const result = buildLcr2Deck(customerText, vendorTexts, manifest.options, JSON.parse(trafficText));
  await writeFile(manifest.outputPath, result.csv, "utf8");
  await status("completed", { summary: result.summary, durationMs: Date.now() - started });
} catch (error) {
  const reference = manifest.jobId.slice(0, 8);
  await writeFile(`${manifest.jobDirectory}/error.log`, error instanceof Error ? (error.stack || error.message) : String(error), "utf8").catch(() => undefined);
  await status("failed", {
    durationMs: Date.now() - started,
    error: `The background build failed. Reference: ${reference}.`,
  });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    unlink(manifest.customerPath),
    unlink(manifest.trafficPath),
    unlink(manifestPath),
  ]);
}
