import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:3107";

const vendor1 = `code,interrate,intrarate,ijrate
1123456,0.015,0.025,0.050
1123458,0.010,0.020,0.030
1123459,0.010,0.020,0.030
`;

const vendor2 = `code,interrate,intrarate,ijrate
1123456,0.016,0.026,0.035
1123458,0.011,0.021,0.031
1123459,0.011,0.021,0.031
`;

const customer = `code,interrate,intrarate,ijrate
1123456,0.0200,0.0300,0.0400
1123457,0.0100,0.0100,0.0100
`;

const vendorsForm = new FormData();
vendorsForm.append("variant", "sd");
vendorsForm.append("operation", "replace");
vendorsForm.append("files", new File([vendor1], "vendor-1.csv", { type: "text/csv" }));
const vendorResponse = await fetch(`${baseUrl}/api/vendors`, { method: "POST", body: vendorsForm });
if (!vendorResponse.ok) throw new Error(`Vendor upload failed: ${await vendorResponse.text()}`);
assert.equal(vendorResponse.status, 200);

const addVendorForm = new FormData();
addVendorForm.append("variant", "sd");
addVendorForm.append("operation", "add");
addVendorForm.append("files", new File([vendor2], "vendor-2.csv", { type: "text/csv" }));
const addVendorResponse = await fetch(`${baseUrl}/api/vendors`, { method: "POST", body: addVendorForm });
if (!addVendorResponse.ok) throw new Error(`Vendor add failed: ${await addVendorResponse.text()}`);
assert.equal((await addVendorResponse.json()).vendors.length, 2, "Adding one vendor must preserve the previously saved vendor.");

const convoResponse = await fetch(`${baseUrl}/api/vendors?variant=convo`);
assert.equal(convoResponse.status, 200);
assert.equal((await convoResponse.json()).vendors.length, 0, "Convo must not reuse SD vendor defaults.");

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Current Traffic");
sheet.addRow(["NPANXX", "Attempts", "Completions"]);
sheet.addRow([1123456, 10, 4]);
sheet.addRow([1123459, 3, 1]);
const workbookBytes = await workbook.xlsx.writeBuffer();

const buildForm = new FormData();
buildForm.append("variant", "sd");
buildForm.append("customer", new File([customer], "customer.csv", { type: "text/csv" }));
buildForm.append("traffic", new File([workbookBytes], "current-traffic.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}));
buildForm.append("markup", "40");
buildForm.append("singleVendor", "fallback");
const buildResponse = await fetch(`${baseUrl}/api/build`, { method: "POST", body: buildForm });
if (!buildResponse.ok) throw new Error(`Deck build failed: ${await buildResponse.text()}`);
assert.equal(buildResponse.status, 200);

const output = await buildResponse.text();
assert.match(output, /1123456,0\.0200,0\.0300,0\.0400/, "A positive-attempt code must remain unchanged.");
assert.match(output, /1123458,0\.0154,0\.0294,0\.0434/, "An eligible new code must receive LCR 2 plus markup.");
assert.doesNotMatch(output, /1123459,/, "A positive-attempt code absent from the customer deck must not be newly priced.");

const encodedSummary = buildResponse.headers.get("X-LCR-Summary");
assert.ok(encodedSummary);
const summary = JSON.parse(Buffer.from(encodedSummary, "base64").toString("utf8"));
assert.equal(summary.trafficProtectedCodes, 1);
assert.equal(summary.positiveTrafficNewCodesSkipped, 1);
assert.equal(summary.validation.trafficProtectedCodesChanged, 0);
assert.equal(summary.validation.status, "PASS");

console.log("API E2E PASS: incremental vendor add, SD/Convo isolation, XLSX parsing, traffic locks, markup, and validation verified.");
