export const COLUMNS = ["code", "interrate", "intrarate", "ijrate"] as const;
export const RATE_COLUMNS = ["interrate", "intrarate", "ijrate"] as const;

type Column = (typeof COLUMNS)[number];
type RateColumn = (typeof RATE_COLUMNS)[number];
export type DeckRow = Record<Column, string>;

export type TrafficRow = {
  code: string;
  attempts: string;
  completions: string;
};

type FixedDecimal = { coefficient: bigint; scale: number };
type Rate = { value: FixedDecimal; raw: string };
type BestTwo = { lowest: Rate | null; second: Rate | null };

export type BuildOptions = {
  markup: string;
  singleVendor: "fallback" | "require2";
  decimals?: number;
  codeLength?: number;
};

export type BuildSummary = {
  markupPercent: string;
  singleVendorMode: string;
  codeLength: number;
  validExistingCodesPreserved: number;
  existingRateFieldsLowered: number;
  existingRateFieldsRaised: number;
  newCodesAdded: number;
  newCodesSkippedIncompleteCoverage: number;
  singleVendorNewCodesAdded: number;
  invalidCustomerRowsDropped: number;
  duplicateCustomerRowsDeduped: number;
  invalidVendorRowsIgnored: number;
  duplicateVendorRowsConsolidated: number;
  trafficRowsRead: number;
  trafficCodesMatched: number;
  trafficProtectedCodes: number;
  trafficDuplicateRowsConsolidated: number;
  invalidTrafficRowsIgnored: number;
  unmatchedTrafficCodes: number;
  positiveTrafficNewCodesSkipped: number;
  validation: {
    exactColumns: boolean;
    duplicateCodes: number;
    missingCustomerCodes: number;
    existingRatesIncreased: number;
    existingRatesLowered: number;
    trafficProtectedCodesChanged: number;
    status: "PASS" | "FAIL";
  };
};

export class DeckError extends Error {}

const POW10_CACHE: bigint[] = [];
function pow10(power: number) {
  if (!Number.isInteger(power) || power < 0 || power > 200) throw new DeckError("A numeric value has unsupported precision.");
  return (POW10_CACHE[power] ??= 10n ** BigInt(power));
}

// Manual scanner equivalent to /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/
// (no regex-match allocation; hot path called once per rate).
function parseDecimal(raw: string): FixedDecimal | null {
  const text = raw.trim();
  const len = text.length;
  if (len === 0) return null;
  let i = 0;
  let sign = 1n;
  const first = text.charCodeAt(0);
  if (first === 43 || first === 45) { if (first === 45) sign = -1n; i = 1; }
  const intStart = i;
  while (i < len) { const c = text.charCodeAt(i); if (c < 48 || c > 57) break; i += 1; }
  if (i === intStart) return null; // integer part requires at least one digit
  const intDigits = text.slice(intStart, i);
  let fraction = "";
  if (i < len && text.charCodeAt(i) === 46) {
    i += 1;
    const fracStart = i;
    while (i < len) { const c = text.charCodeAt(i); if (c < 48 || c > 57) break; i += 1; }
    fraction = text.slice(fracStart, i);
  }
  let exponent = 0;
  if (i < len && (text.charCodeAt(i) === 101 || text.charCodeAt(i) === 69)) {
    i += 1;
    let expSign = 1;
    if (i < len && (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45)) { if (text.charCodeAt(i) === 45) expSign = -1; i += 1; }
    const expStart = i;
    while (i < len) { const c = text.charCodeAt(i); if (c < 48 || c > 57) break; i += 1; }
    if (i === expStart) return null; // exponent requires at least one digit
    exponent = expSign * Number(text.slice(expStart, i));
  }
  if (i !== len) return null; // trailing characters -> not a valid number
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 200) return null;
  let scale = fraction.length - exponent;
  let coefficient = sign * BigInt(`${intDigits}${fraction}` || "0");
  if (scale < 0) {
    coefficient *= pow10(-scale);
    scale = 0;
  }
  if (scale > 200) return null;
  return { coefficient, scale };
}

function compare(left: FixedDecimal, right: FixedDecimal) {
  const scale = Math.max(left.scale, right.scale);
  const leftAligned = left.coefficient * pow10(scale - left.scale);
  const rightAligned = right.coefficient * pow10(scale - right.scale);
  return leftAligned < rightAligned ? -1 : leftAligned > rightAligned ? 1 : 0;
}

function multiply(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  return { coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale };
}

function roundTo(value: FixedDecimal, decimals: number, halfUp: boolean): FixedDecimal {
  if (value.scale <= decimals) {
    return { coefficient: value.coefficient * pow10(decimals - value.scale), scale: decimals };
  }
  const divisor = pow10(value.scale - decimals);
  let coefficient = value.coefficient / divisor;
  const remainder = value.coefficient < 0n ? -(value.coefficient % divisor) : value.coefficient % divisor;
  if (halfUp && remainder * 2n >= divisor) coefficient += value.coefficient < 0n ? -1n : 1n;
  return { coefficient, scale: decimals };
}

// Ceiling to a fixed number of decimals (rates are always non-negative). Used to
// guarantee a raised/kept existing rate is never rounded below its original.
function ceilTo(value: FixedDecimal, decimals: number): FixedDecimal {
  if (value.scale <= decimals) {
    return { coefficient: value.coefficient * pow10(decimals - value.scale), scale: decimals };
  }
  const divisor = pow10(value.scale - decimals);
  const coefficient = value.coefficient / divisor;
  const remainder = value.coefficient - coefficient * divisor;
  return { coefficient: remainder > 0n ? coefficient + 1n : coefficient, scale: decimals };
}

function fixedString(value: FixedDecimal) {
  const negative = value.coefficient < 0n;
  let digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale > 0) {
    digits = digits.padStart(value.scale + 1, "0");
    digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
  }
  return `${negative ? "-" : ""}${digits}`;
}

function naturalString(value: FixedDecimal) {
  const formatted = fixedString(value);
  return formatted.includes(".") ? formatted.replace(/0+$/, "").replace(/\.$/, "") : formatted;
}

function formatComputed(value: FixedDecimal, decimals?: number) {
  return decimals === undefined ? naturalString(value) : fixedString(roundTo(value, decimals, true));
}

function formatExisting(value: FixedDecimal, original: FixedDecimal, decimals: number) {
  let rounded = roundTo(value, decimals, true);
  if (compare(rounded, original) > 0) rounded = roundTo(original, decimals, false);
  return fixedString(rounded);
}

// Format `value` at the requested precision but never below `original`. Protects
// the "never decrease an existing rate" guarantee when the customer deck carries
// more decimal places than the chosen output precision.
function formatNoLower(value: FixedDecimal, original: FixedDecimal, decimals: number) {
  let rounded = roundTo(value, decimals, true);
  if (compare(rounded, original) < 0) rounded = ceilTo(original, decimals);
  return fixedString(rounded);
}

function markupFactor(markup: string) {
  const percentage = parseDecimal(markup);
  if (!percentage || percentage.coefficient < 0n) throw new DeckError("Markup must be a finite, non-negative percentage.");
  const scale = percentage.scale + 2;
  return { coefficient: pow10(scale) + percentage.coefficient, scale };
}

export function parseCsvMatrix(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw new DeckError("CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

const TRAFFIC_CODE_HEADERS = new Set(["code", "npanxx", "prefix", "destinationcode"]);
const TRAFFIC_ATTEMPT_HEADERS = new Set(["attempt", "attempts", "totalattempt", "totalattempts"]);
const TRAFFIC_COMPLETION_HEADERS = new Set([
  "completion",
  "completions",
  "completed",
  "connect",
  "connects",
  "answered",
  "complition",
  "complitions",
]);

function normalizedTrafficHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findTrafficHeader(headers: string[], candidates: Set<string>) {
  return headers.findIndex((header) => candidates.has(normalizedTrafficHeader(header)));
}

export function parseTrafficMatrix(matrix: string[][]): TrafficRow[] {
  const nonEmptyRows = matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (!nonEmptyRows.length) throw new DeckError("The current traffic file is empty.");
  const headers = nonEmptyRows[0];
  const codeIndex = findTrafficHeader(headers, TRAFFIC_CODE_HEADERS);
  const attemptsIndex = findTrafficHeader(headers, TRAFFIC_ATTEMPT_HEADERS);
  const completionsIndex = findTrafficHeader(headers, TRAFFIC_COMPLETION_HEADERS);
  const missing = [
    codeIndex < 0 ? "code/NPANXX" : "",
    attemptsIndex < 0 ? "attempts" : "",
    completionsIndex < 0 ? "completions" : "",
  ].filter(Boolean);
  if (missing.length) throw new DeckError(`The current traffic file is missing required columns: ${missing.join(", ")}.`);
  return nonEmptyRows.slice(1).map((row) => ({
    code: (row[codeIndex] ?? "").trim(),
    attempts: (row[attemptsIndex] ?? "").trim(),
    completions: (row[completionsIndex] ?? "").trim(),
  }));
}

export function parseDeck(text: string) {
  // Single-pass CSV parse straight into rows \u2014 no intermediate string[][] matrix.
  // Semantics match parseCsvMatrix + the previous parseDeck exactly: quote handling
  // (a quote is special only at field start; "" escapes a quote), \r ignored,
  // rows with no non-empty cell skipped, unterminated quote is an error.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const len = source.length;
  let headers: string[] | null = null;
  let codeAt = -1, interAt = -1, intraAt = -1, ijAt = -1;
  const rows: DeckRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;

  const finishRow = () => {
    cells.push(field);
    field = "";
    let hasContent = false;
    for (let k = 0; k < cells.length; k += 1) if (cells[k].length > 0) { hasContent = true; break; }
    if (hasContent) {
      if (headers === null) {
        headers = cells.map((header) => header.trim().toLowerCase());
        if (new Set(headers).size !== headers.length) throw new DeckError("CSV contains duplicate header names.");
        const missing = COLUMNS.filter((column) => !headers!.includes(column));
        if (missing.length) throw new DeckError(`CSV is missing required columns: ${missing.join(", ")}.`);
        codeAt = headers.indexOf("code");
        interAt = headers.indexOf("interrate");
        intraAt = headers.indexOf("intrarate");
        ijAt = headers.indexOf("ijrate");
      } else {
        rows.push({
          code: (cells[codeAt] ?? "").trim(),
          interrate: (cells[interAt] ?? "").trim(),
          intrarate: (cells[intraAt] ?? "").trim(),
          ijrate: (cells[ijAt] ?? "").trim(),
        });
      }
    }
    cells = [];
  };

  for (let index = 0; index < len; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") { cells.push(field); field = ""; }
    else if (character === "\n") finishRow();
    else if (character !== "\r") field += character;
  }
  if (quoted) throw new DeckError("CSV contains an unclosed quoted field.");
  finishRow();

  if (headers === null) throw new DeckError("CSV is empty.");
  return { headers, rows };
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function serializeDeck(rows: DeckRow[]) {
  return `${COLUMNS.join(",")}\n${rows.map((row) => COLUMNS.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

function detectCodeLength(rows: DeckRow[]) {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (/^\d+$/.test(row.code)) counts.set(row.code.length, (counts.get(row.code.length) ?? 0) + 1);
  }
  if (!counts.size) throw new DeckError("Customer deck has no digit-only codes from which to detect code length.");
  const highest = Math.max(...counts.values());
  return Math.max(...Array.from(counts).filter(([, count]) => count === highest).map(([length]) => length));
}

function validCode(code: string, length: number) {
  return code.length === length && /^\d+$/.test(code);
}

function trafficCount(raw: string) {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return 0;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function vendorRate(raw: string): Rate | null {
  const value = parseDecimal(raw);
  return value && value.coefficient > 0n ? { value, raw: raw.trim() } : null;
}

function addQuote(pair: BestTwo, candidate: Rate) {
  if (!pair.lowest || compare(candidate.value, pair.lowest.value) < 0) {
    pair.second = pair.lowest;
    pair.lowest = candidate;
  } else if (!pair.second || compare(candidate.value, pair.second.value) < 0) {
    pair.second = candidate;
  }
}

function chooseLcr(pair: BestTwo, mode: BuildOptions["singleVendor"]) {
  if (pair.second) return { rate: pair.second, single: false };
  if (pair.lowest && mode === "fallback") return { rate: pair.lowest, single: true };
  return { rate: null, single: false };
}

export function validateUpload(text: string) {
  const deck = parseDeck(text);
  return { rows: deck.rows.length };
}

export function buildLcr2Deck(customerText: string, vendorTexts: string[], options: BuildOptions, trafficRows: TrafficRow[] = []) {
  if (!vendorTexts.length) throw new DeckError("No saved vendor decks are available.");
  const customerDeck = parseDeck(customerText);
  const codeLength = options.codeLength ?? detectCodeLength(customerDeck.rows);
  if (!Number.isInteger(codeLength) || codeLength < 1) throw new DeckError("Code length must be a positive integer.");
  if (options.decimals !== undefined && (!Number.isInteger(options.decimals) || options.decimals < 0 || options.decimals > 12)) {
    throw new DeckError("Decimal places must be a whole number from 0 to 12.");
  }
  const factor = markupFactor(options.markup);

  const customer = new Map<string, DeckRow>();
  let invalidCustomerRows = 0;
  let duplicateCustomerRows = 0;
  for (const row of customerDeck.rows) {
    if (!validCode(row.code, codeLength)) invalidCustomerRows += 1;
    else if (customer.has(row.code)) duplicateCustomerRows += 1;
    else customer.set(row.code, row);
  }


  const traffic = new Map<string, { attempts: number; completions: number }>();
  let invalidTrafficRows = 0;
  let duplicateTrafficRows = 0;
  for (const row of trafficRows) {
    let code = row.code.trim();
    // Traffic exports commonly list USA destinations as 6-digit NPA-NXX, while the
    // rate decks use 7-digit 1+NPA-NXX. When a traffic code is exactly one digit
    // short of the deck's code length, prepend the country code "1" so it matches.
    // NANP area codes never begin with 0 or 1, so this is unambiguous.
    if (code.length === codeLength - 1 && /^\d+$/.test(code)) code = `1${code}`;
    const attempts = trafficCount(row.attempts);
    if (!validCode(code, codeLength)) {
      invalidTrafficRows += 1;
      continue;
    }
    if (attempts === null) throw new DeckError(`Traffic attempts for code ${code} must be a non-negative number.`);
    const completions = trafficCount(row.completions) ?? 0;
    const current = traffic.get(code);
    if (current) {
      duplicateTrafficRows += 1;
      current.attempts += attempts;
      current.completions += completions;
    } else {
      traffic.set(code, { attempts, completions });
    }
  }
  const trafficCodesMatched = Array.from(traffic.keys()).filter((code) => customer.has(code)).length;
  const trafficProtectedCodes = Array.from(traffic).filter(([code, totals]) => customer.has(code) && totals.attempts > 0).length;
  const unmatchedTrafficCodes = Array.from(traffic.keys()).filter((code) => !customer.has(code)).length;

  const vendorQuotes = new Map<string, Record<RateColumn, BestTwo>>();
  let invalidVendorRows = 0;
  let duplicateVendorRows = 0;
  for (const vendorText of vendorTexts) {
    const vendorDeck = parseDeck(vendorText);
    const aggregate = new Map<string, Partial<Record<RateColumn, Rate>>>();
    for (const row of vendorDeck.rows) {
      if (!validCode(row.code, codeLength)) {
        invalidVendorRows += 1;
        continue;
      }
      if (aggregate.has(row.code)) duplicateVendorRows += 1;
      const fields = aggregate.get(row.code) ?? {};
      for (const column of RATE_COLUMNS) {
        const candidate = vendorRate(row[column]);
        const current = fields[column];
        if (candidate && (!current || compare(candidate.value, current.value) < 0)) fields[column] = candidate;
      }
      aggregate.set(row.code, fields);
    }
    for (const [code, fields] of aggregate) {
      const destination = vendorQuotes.get(code) ?? {
        interrate: { lowest: null, second: null },
        intrarate: { lowest: null, second: null },
        ijrate: { lowest: null, second: null },
      };
      for (const column of RATE_COLUMNS) if (fields[column]) addQuote(destination[column], fields[column]!);
      vendorQuotes.set(code, destination);
    }
  }

  const output: DeckRow[] = [];
  let loweredFields = 0;
  let raisedFields = 0;
  for (const [code, originalRow] of customer) {
    const result = { ...originalRow };
    if ((traffic.get(code)?.attempts ?? 0) > 0) {
      // Codes carrying current attempts are frozen: rates stay exactly as-is.
      output.push(result);
      continue;
    }
    for (const column of RATE_COLUMNS) {
      const pair = vendorQuotes.get(code)?.[column];
      const selected = pair ? chooseLcr(pair, options.singleVendor).rate : null;
      const original = parseDecimal(originalRow[column]);
      // Raise the existing rate up to the LCR 2 sell price = LCR 2 x (1 + markup),
      // but only when that target is higher than what the customer pays now. An
      // existing rate is never decreased.
      if (selected && original) {
        const target = multiply(selected.value, factor);
        if (compare(target, original) > 0) {
          raisedFields += 1;
          result[column] = options.decimals === undefined
            ? naturalString(target)
            : formatNoLower(target, original, options.decimals);
        } else if (options.decimals !== undefined) {
          result[column] = formatNoLower(original, original, options.decimals);
        }
      } else if (options.decimals !== undefined && original) {
        result[column] = formatNoLower(original, original, options.decimals);
      }
    }
    output.push(result);
  }

  let newCodesAdded = 0;
  let newCodesSkipped = 0;
  let singleVendorNewCodes = 0;
  let positiveTrafficNewCodesSkipped = 0;
  const newCodes = Array.from(vendorQuotes.keys()).filter((code) => !customer.has(code)).sort();
  for (const code of newCodes) {
    if ((traffic.get(code)?.attempts ?? 0) > 0) {
      positiveTrafficNewCodesSkipped += 1;
      continue;
    }
    const pairs = vendorQuotes.get(code)!;
    const fields = {
      interrate: chooseLcr(pairs.interrate, options.singleVendor),
      intrarate: chooseLcr(pairs.intrarate, options.singleVendor),
      ijrate: chooseLcr(pairs.ijrate, options.singleVendor),
    };
    if (RATE_COLUMNS.some((column) => !fields[column].rate)) {
      newCodesSkipped += 1;
      continue;
    }
    const result = { code, interrate: "", intrarate: "", ijrate: "" } satisfies DeckRow;
    for (const column of RATE_COLUMNS) result[column] = formatComputed(multiply(fields[column].rate!.value, factor), options.decimals);
    output.push(result);
    newCodesAdded += 1;
    if (RATE_COLUMNS.some((column) => fields[column].single)) singleVendorNewCodes += 1;
  }

  const csv = serializeDeck(output);
  // Validate on the in-memory output rows. All emitted values are already trimmed
  // and quote-free, so serialize -> parse would round-trip to the same rows; we skip
  // that full extra parse of the entire deck.
  const outputCounts = new Map<string, number>();
  for (const row of output) outputCounts.set(row.code, (outputCounts.get(row.code) ?? 0) + 1);
  const duplicateCodes = Array.from(outputCounts.values()).filter((count) => count > 1).length;
  const outputByCode = new Map(output.map((row) => [row.code, row]));
  const missingCustomerCodes = Array.from(customer.keys()).filter((code) => !outputByCode.has(code)).length;
  let existingRatesIncreased = 0;
  let existingRatesLowered = 0;
  let trafficProtectedCodesChanged = 0;
  for (const [code, originalRow] of customer) {
    const result = outputByCode.get(code);
    if (!result) continue;
    if ((traffic.get(code)?.attempts ?? 0) > 0 && RATE_COLUMNS.some((column) => result[column] !== originalRow[column])) {
      trafficProtectedCodesChanged += 1;
    }
    for (const column of RATE_COLUMNS) {
      const original = parseDecimal(originalRow[column]);
      const built = parseDecimal(result[column]);
      if (original && built && compare(built, original) > 0) existingRatesIncreased += 1;
      if (original && built && compare(built, original) < 0) existingRatesLowered += 1;
    }
  }
  const exactColumns = true; // serializeDeck always emits exactly COLUMNS, in order.
  // Safety guarantee for the raise workflow: an existing customer rate must never
  // be decreased, and traffic-protected codes must never move.
  const passed = exactColumns && duplicateCodes === 0 && missingCustomerCodes === 0 && existingRatesLowered === 0 && trafficProtectedCodesChanged === 0;

  const summary: BuildSummary = {
    markupPercent: options.markup,
    singleVendorMode: options.singleVendor,
    codeLength,
    validExistingCodesPreserved: customer.size,
    existingRateFieldsLowered: loweredFields,
    existingRateFieldsRaised: raisedFields,
    newCodesAdded,
    newCodesSkippedIncompleteCoverage: newCodesSkipped,
    singleVendorNewCodesAdded: singleVendorNewCodes,
    invalidCustomerRowsDropped: invalidCustomerRows,
    duplicateCustomerRowsDeduped: duplicateCustomerRows,
    invalidVendorRowsIgnored: invalidVendorRows,
    duplicateVendorRowsConsolidated: duplicateVendorRows,
    trafficRowsRead: trafficRows.length,
    trafficCodesMatched,
    trafficProtectedCodes,
    trafficDuplicateRowsConsolidated: duplicateTrafficRows,
    invalidTrafficRowsIgnored: invalidTrafficRows,
    unmatchedTrafficCodes,
    positiveTrafficNewCodesSkipped,
    validation: {
      exactColumns,
      duplicateCodes,
      missingCustomerCodes,
      existingRatesIncreased,
      existingRatesLowered,
      trafficProtectedCodesChanged,
      status: passed ? "PASS" : "FAIL",
    },
  };
  if (!passed) throw new DeckError("Validation failed; no deck was released.");
  return { csv, summary };
}

export type VendorLcr2Options = {
  markup?: string;
  singleVendor: "fallback" | "require2";
  decimals?: number;
  codeLength?: number;
};

export type VendorLcr2Summary = {
  markupPercent: string;
  singleVendorMode: string;
  codeLength: number;
  vendorCount: number;
  codesPriced: number;
  singleVendorCodes: number;
  skippedIncompleteCoverage: number;
  invalidVendorRowsIgnored: number;
  duplicateVendorRowsConsolidated: number;
};

// Build an LCR 2 deck from the vendor decks alone (no customer deck or traffic).
// For each NPANXX it takes the second-lowest vendor rate per column (fallback to
// the only rate for single-vendor codes). Markup is optional: omit it for the raw
// LCR 2 cost deck, or supply it for an LCR 2 + markup sell deck.
export function buildVendorLcr2Deck(vendorTexts: string[], options: VendorLcr2Options) {
  if (!vendorTexts.length) throw new DeckError("No saved vendor decks are available.");
  if (options.decimals !== undefined && (!Number.isInteger(options.decimals) || options.decimals < 0 || options.decimals > 12)) {
    throw new DeckError("Decimal places must be a whole number from 0 to 12.");
  }
  const markupProvided = options.markup !== undefined && options.markup.trim() !== "";
  const factor = markupProvided ? markupFactor(options.markup!.trim()) : null;

  const vendorQuotes = new Map<string, Record<RateColumn, BestTwo>>();
  const lengthCounts = new Map<number, number>();
  let invalidVendorRows = 0;
  let duplicateVendorRows = 0;

  for (const vendorText of vendorTexts) {
    const vendorDeck = parseDeck(vendorText);
    const aggregate = new Map<string, Partial<Record<RateColumn, Rate>>>();
    for (const row of vendorDeck.rows) {
      if (!/^\d+$/.test(row.code)) {
        invalidVendorRows += 1;
        continue;
      }
      if (aggregate.has(row.code)) duplicateVendorRows += 1;
      const fields = aggregate.get(row.code) ?? {};
      for (const column of RATE_COLUMNS) {
        const candidate = vendorRate(row[column]);
        const current = fields[column];
        if (candidate && (!current || compare(candidate.value, current.value) < 0)) fields[column] = candidate;
      }
      aggregate.set(row.code, fields);
    }
    for (const [code, fields] of aggregate) {
      if (!vendorQuotes.has(code)) lengthCounts.set(code.length, (lengthCounts.get(code.length) ?? 0) + 1);
      const destination = vendorQuotes.get(code) ?? {
        interrate: { lowest: null, second: null },
        intrarate: { lowest: null, second: null },
        ijrate: { lowest: null, second: null },
      };
      for (const column of RATE_COLUMNS) if (fields[column]) addQuote(destination[column], fields[column]!);
      vendorQuotes.set(code, destination);
    }
  }

  if (!lengthCounts.size) throw new DeckError("The vendor decks contain no valid numeric codes.");
  const codeLength = options.codeLength ?? Array.from(lengthCounts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];

  const output: DeckRow[] = [];
  let singleVendorCodes = 0;
  let skipped = 0;
  const codes = Array.from(vendorQuotes.keys()).filter((code) => code.length === codeLength).sort();
  for (const code of codes) {
    const pairs = vendorQuotes.get(code)!;
    const fields = {
      interrate: chooseLcr(pairs.interrate, options.singleVendor),
      intrarate: chooseLcr(pairs.intrarate, options.singleVendor),
      ijrate: chooseLcr(pairs.ijrate, options.singleVendor),
    };
    if (RATE_COLUMNS.some((column) => !fields[column].rate)) {
      skipped += 1;
      continue;
    }
    const result = { code, interrate: "", intrarate: "", ijrate: "" } satisfies DeckRow;
    for (const column of RATE_COLUMNS) {
      const rate = fields[column].rate!;
      if (markupProvided) result[column] = formatComputed(multiply(rate.value, factor!), options.decimals);
      else result[column] = options.decimals === undefined ? rate.raw : formatComputed(rate.value, options.decimals);
    }
    output.push(result);
    if (RATE_COLUMNS.some((column) => fields[column].single)) singleVendorCodes += 1;
  }

  const csv = serializeDeck(output);
  const summary: VendorLcr2Summary = {
    markupPercent: markupProvided ? options.markup!.trim() : "",
    singleVendorMode: options.singleVendor,
    codeLength,
    vendorCount: vendorTexts.length,
    codesPriced: output.length,
    singleVendorCodes,
    skippedIncompleteCoverage: skipped,
    invalidVendorRowsIgnored: invalidVendorRows,
    duplicateVendorRowsConsolidated: duplicateVendorRows,
  };
  return { csv, summary };
}
