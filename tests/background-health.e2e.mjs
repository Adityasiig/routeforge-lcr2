import assert from "node:assert/strict";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:3107";
const rowCount = Number(process.env.BACKGROUND_TEST_ROWS || "50000");
const header = "code,interrate,intrarate,ijrate";

const vendorFiles = Array.from({ length: 6 }, (_, vendorIndex) => {
  const rate = (0.01 + vendorIndex * 0.001).toFixed(4);
  const rows = [header];
  for (let index = 0; index < rowCount; index += 1) rows.push(`${1000000 + index},${rate},${rate},${rate}`);
  return new File([`${rows.join("\n")}\n`], `background-vendor-${vendorIndex + 1}.csv`, { type: "text/csv" });
});

const vendorForm = new FormData();
vendorForm.append("variant", "sd");
vendorForm.append("operation", "replace");
for (const file of vendorFiles) vendorForm.append("files", file);
const vendorResponse = await fetch(`${baseUrl}/api/vendors`, { method: "POST", body: vendorForm });
if (!vendorResponse.ok) throw new Error(`Large vendor upload failed: ${await vendorResponse.text()}`);

const customerRows = [header];
for (let index = 0; index < rowCount; index += 1) customerRows.push(`${1000000 + index},0.0500,0.0500,0.0500`);
const buildForm = new FormData();
buildForm.append("variant", "sd");
buildForm.append("customer", new File([`${customerRows.join("\n")}\n`], "background-customer.csv", { type: "text/csv" }));
buildForm.append("traffic", new File(["code,attempts,completions\n"], "background-traffic.csv", { type: "text/csv" }));
buildForm.append("markup", "40");
buildForm.append("singleVendor", "fallback");

const createResponse = await fetch(`${baseUrl}/api/build`, { method: "POST", body: buildForm });
if (!createResponse.ok) throw new Error(`Background build creation failed: ${await createResponse.text()}`);
assert.equal(createResponse.status, 202);
const created = await createResponse.json();

let completed;
let healthChecks = 0;
for (let attempt = 0; attempt < 600; attempt += 1) {
  const healthResponse = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
  assert.equal(healthResponse.status, 200, "The web-server health route must remain responsive while the worker builds.");
  healthChecks += 1;
  const statusResponse = await fetch(`${baseUrl}/api/build/${created.jobId}`, { cache: "no-store" });
  if (!statusResponse.ok) throw new Error(`Background status failed: ${await statusResponse.text()}`);
  const status = await statusResponse.json();
  if (status.state === "failed") throw new Error(status.error || "Background worker failed.");
  if (status.state === "completed") {
    completed = status;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

assert.ok(completed, "The background health test did not complete within 60 seconds.");
assert.equal(completed.summary.validation.status, "PASS");
assert.equal(completed.summary.validExistingCodesPreserved, rowCount);
assert.ok(healthChecks > 1);
console.log(JSON.stringify({ status: "PASS", rowCount, sourceRows: rowCount * 6, healthChecks, durationMs: completed.durationMs }, null, 2));
