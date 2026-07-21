import assert from "node:assert/strict";
import test from "node:test";
import { buildLcr2Deck, parseDeck } from "../lib/lcr2.ts";

const customer = `code,interrate,intrarate,ijrate
1123456,0.0200,0.0300,0.0400
1123457,0.0100,0.0100,0.0100
1123461,0.01006,0.0200,0.0300
9999,0.1,0.1,0.1
1123456,9,9,9
`;

const vendor1 = `code,interrate,intrarate,ijrate
1123456,0.015,0.025,0.050
1123457,0.011,0.009,0.012
1123458,0.010,0.020,0.030
1123458,0.009,0.018,0.029
1123459,0.005,,0.010
1123460,0.010,0.010,0.010
1234,0.1,0.1,0.1
`;

const vendor2 = `CODE,InterRate,IntraRate,IJRate
1123456,0.016,0.026,0.035
1123457,0.012,0.008,0.011
1123458,0.011,0.021,0.031
`;

test("fallback builds, rounds, and validates the protected deck", () => {
  const result = buildLcr2Deck(customer, [vendor1, vendor2], { markup: "40", singleVendor: "fallback", decimals: 4 });
  const rows = parseDeck(result.csv).rows;
  assert.deepEqual(rows, [
    { code: "1123456", interrate: "0.0160", intrarate: "0.0260", ijrate: "0.0400" },
    { code: "1123457", interrate: "0.0100", intrarate: "0.0090", ijrate: "0.0100" },
    { code: "1123461", interrate: "0.0100", intrarate: "0.0200", ijrate: "0.0300" },
    { code: "1123458", interrate: "0.0154", intrarate: "0.0294", ijrate: "0.0434" },
    { code: "1123460", interrate: "0.0140", intrarate: "0.0140", ijrate: "0.0140" },
  ]);
  assert.equal(result.summary.validation.status, "PASS");
  assert.equal(result.summary.validation.existingRatesIncreased, 0);
  assert.equal(result.summary.singleVendorNewCodesAdded, 1);
  assert.equal(result.summary.duplicateVendorRowsConsolidated, 1);
});

test("require2 omits new codes without two-vendor coverage", () => {
  const result = buildLcr2Deck(customer, [vendor1, vendor2], { markup: "40", singleVendor: "require2" });
  const codes = parseDeck(result.csv).rows.map((row) => row.code);
  assert.deepEqual(codes, ["1123456", "1123457", "1123461", "1123458"]);
  assert.equal(result.summary.newCodesSkippedIncompleteCoverage, 2);
  assert.equal(result.summary.validation.status, "PASS");
});

test("quoted CSV fields are parsed safely", () => {
  const parsed = parseDeck('code,interrate,intrarate,ijrate,description\n1123456,"0.01",0.02,0.03,"New York, NY"\n');
  assert.equal(parsed.rows[0].interrate, "0.01");
});
