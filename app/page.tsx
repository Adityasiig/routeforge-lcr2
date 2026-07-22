"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Variant = "sd" | "convo";

type Vendor = {
  id: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  rows: number;
};

type Summary = {
  markupPercent: string;
  singleVendorMode: string;
  codeLength: number;
  validExistingCodesPreserved: number;
  existingRateFieldsLowered: number;
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
    trafficProtectedCodesChanged: number;
    status: "PASS" | "FAIL";
  };
};

const VARIANT_COPY = {
  sd: {
    short: "SD",
    title: "Short Duration",
    description: "Independent vendor defaults and customer pricing for short-duration traffic.",
  },
  convo: {
    short: "Convo",
    title: "Conversational",
    description: "Independent vendor defaults and customer pricing for conversational traffic.",
  },
} as const;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DeckDropzone({
  id,
  multiple,
  files,
  onFiles,
  eyebrow,
  title,
  description,
  accept,
  extensions,
  icon,
  chooseLabel,
}: {
  id: string;
  multiple?: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
  eyebrow: string;
  title: string;
  description: string;
  accept: string;
  extensions: string[];
  icon: string;
  chooseLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const takeFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = Array.from(list).filter((file) => extensions.some((extension) => file.name.toLowerCase().endsWith(extension)));
    onFiles(multiple ? accepted : accepted.slice(0, 1));
  };

  return (
    <div
      className={`dropzone ${dragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        takeFiles(event.dataTransfer.files);
      }}
    >
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event: ChangeEvent<HTMLInputElement>) => takeFiles(event.target.files)}
      />
      <div className="drop-icon" aria-hidden="true">{icon}</div>
      <div className="drop-copy">
        <span className="eyebrow">{eyebrow}</span>
        <strong>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : title}</strong>
        <p>{files.length ? files.map((file) => file.name).join(" · ") : description}</p>
      </div>
      <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>
        {files.length ? "Change" : chooseLabel}
      </button>
    </div>
  );
}

function VariantWorkspace({ variant }: { variant: Variant }) {
  const copy = VARIANT_COPY[variant];
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorFiles, setVendorFiles] = useState<File[]>([]);
  const [customerFiles, setCustomerFiles] = useState<File[]>([]);
  const [trafficFiles, setTrafficFiles] = useState<File[]>([]);
  const [markup, setMarkup] = useState("");
  const [mode, setMode] = useState<"fallback" | "require2">("fallback");
  const [fixedPrecision, setFixedPrecision] = useState(false);
  const [decimals, setDecimals] = useState("4");
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState(`Customer_USA_${copy.short.toUpperCase()}_LCR2_Rate_Deck.csv`);

  useEffect(() => {
    let active = true;
    fetch(`/api/vendors?variant=${variant}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Could not load ${copy.short} vendor decks.`);
        return payload;
      })
      .then((payload) => { if (active) setVendors(payload.vendors); })
      .catch((error) => {
        if (active) setNotice({ type: "error", text: error instanceof Error ? error.message : `Could not load ${copy.short} vendor decks.` });
      })
      .finally(() => { if (active) setLoadingVendors(false); });
    return () => { active = false; };
  }, [copy.short, variant]);

  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const totalVendorRows = useMemo(() => vendors.reduce((sum, vendor) => sum + vendor.rows, 0), [vendors]);

  const saveVendorDefaults = async () => {
    if (!vendorFiles.length) return setNotice({ type: "error", text: `Choose at least one ${copy.short} vendor CSV first.` });
    setSaving(true);
    setNotice(null);
    const form = new FormData();
    form.append("variant", variant);
    vendorFiles.forEach((file) => form.append("files", file));
    try {
      const response = await fetch("/api/vendors", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Vendor decks could not be saved.");
      setVendors(payload.vendors);
      setVendorFiles([]);
      setNotice({ type: "success", text: `${copy.short} now has ${payload.vendors.length} saved default vendor deck${payload.vendors.length === 1 ? "" : "s"}.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Vendor decks could not be saved." });
    } finally {
      setSaving(false);
    }
  };

  const removeVendor = async (id: string) => {
    setNotice(null);
    try {
      const response = await fetch(`/api/vendors/${encodeURIComponent(id)}?variant=${variant}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Vendor deck could not be removed.");
      setVendors(payload.vendors);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Vendor deck could not be removed." });
    }
  };

  const buildDeck = async () => {
    if (!vendors.length) return setNotice({ type: "error", text: `Save the ${copy.short} vendor decks before building.` });
    if (!trafficFiles.length) return setNotice({ type: "error", text: "Choose the current traffic Excel or CSV file." });
    if (!customerFiles.length) return setNotice({ type: "error", text: "Choose the customer CSV rate deck." });
    if (markup.trim() === "") return setNotice({ type: "error", text: "Enter the markup percentage for new codes." });
    setBuilding(true);
    setNotice(null);
    setSummary(null);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    const form = new FormData();
    form.append("variant", variant);
    form.append("customer", customerFiles[0]);
    form.append("traffic", trafficFiles[0]);
    form.append("markup", markup);
    form.append("singleVendor", mode);
    if (fixedPrecision) form.append("decimals", decimals);
    try {
      const response = await fetch("/api/build", { method: "POST", body: form });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Build failed." }));
        throw new Error(payload.error || "Build failed.");
      }
      const summaryHeader = response.headers.get("X-LCR-Summary");
      const filenameHeader = response.headers.get("X-LCR-Filename");
      if (!summaryHeader) throw new Error("The build completed without a validation summary.");
      const resultSummary = JSON.parse(atob(summaryHeader)) as Summary;
      const blob = await response.blob();
      setSummary(resultSummary);
      setDownloadUrl(URL.createObjectURL(blob));
      setDownloadName(filenameHeader || `Customer_USA_${copy.short.toUpperCase()}_LCR2_Rate_Deck.csv`);
      setNotice({ type: "success", text: `${copy.short} LCR 2 deck built, traffic-protected, and validated.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Build failed." });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <section className="variant-workspace" aria-label={`${copy.title} rate-deck workspace`}>
      <div className="workspace-intro">
        <div>
          <span className="kicker">Active rate-deck workspace</span>
          <h2>{copy.short} — {copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="workspace-count">
          <strong>{loadingVendors ? "—" : vendors.length}</strong>
          <span>saved vendors</span>
          <small>{totalVendorRows.toLocaleString()} source rows</small>
        </div>
      </div>

      {notice && <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.text}</div>}

      <section className="workspace-grid">
        <article className="panel vendor-panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">01</span>
              <div><span className="eyebrow">Saved separately for {copy.short}</span><h2>Vendor defaults</h2></div>
            </div>
            <span className={`status-pill ${vendors.length ? "ready" : "waiting"}`}>{vendors.length ? "Ready" : "Not set"}</span>
          </div>

          <DeckDropzone
            id={`${variant}-vendor-files`}
            multiple
            files={vendorFiles}
            onFiles={setVendorFiles}
            eyebrow={`${copy.short} vendor cost decks`}
            title="Drop all vendor CSVs here"
            description="Required: code, interrate, intrarate, ijrate. Each file counts as one vendor."
            accept=".csv,text/csv"
            extensions={[".csv"]}
            icon="CSV"
            chooseLabel="Choose CSVs"
          />
          <button className="primary-button full" type="button" disabled={saving || !vendorFiles.length} onClick={saveVendorDefaults}>
            {saving ? "Validating and saving…" : vendors.length ? `Replace ${copy.short} vendor set` : `Save ${copy.short} vendor set`}
          </button>

          <div className="saved-list">
            <div className="list-heading"><span>Saved {copy.short} vendor decks</span><span>{vendors.length}</span></div>
            {loadingVendors ? <p className="empty-state">Loading the default set…</p> : vendors.length ? vendors.map((vendor, index) => (
              <div className="vendor-row" key={vendor.id}>
                <span className="vendor-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{vendor.originalName}</strong><small>{vendor.rows.toLocaleString()} rows · {formatBytes(vendor.size)}</small></div>
                <button type="button" className="icon-button" onClick={() => removeVendor(vendor.id)} aria-label={`Remove ${vendor.originalName}`}>Remove</button>
              </div>
            )) : <p className="empty-state">No {copy.short} defaults yet. Upload two or more vendor decks for true LCR 2 coverage.</p>}
          </div>
        </article>

        <article className="panel traffic-panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">02</span>
              <div><span className="eyebrow">Required for every build</span><h2>Current Traffic on Codes</h2></div>
            </div>
            <span className={`status-pill ${trafficFiles.length ? "ready" : "waiting"}`}>{trafficFiles.length ? "Selected" : "Waiting"}</span>
          </div>
          <DeckDropzone
            id={`${variant}-traffic-file`}
            files={trafficFiles}
            onFiles={setTrafficFiles}
            eyebrow="Traffic protection file"
            title="Drop Excel or CSV here"
            description="Required columns: code/NPANXX, attempts, completions. Duplicate code rows are combined."
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            extensions={[".xlsx", ".csv"]}
            icon="XLSX"
            chooseLabel="Choose traffic file"
          />
          <div className="rule-note traffic-rule">
            <strong>Attempts lock the complete code</strong>
            <p>When combined attempts are greater than zero, interrate, intrarate, and ijrate stay exactly as they are in the customer deck.</p>
          </div>
        </article>

        <article className="panel customer-panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">03</span>
              <div><span className="eyebrow">Build whenever needed</span><h2>{copy.short} customer deck</h2></div>
            </div>
            <span className={`status-pill ${vendors.length && trafficFiles.length ? "ready" : "waiting"}`}>
              {vendors.length && trafficFiles.length ? "Ready to price" : "Inputs needed"}
            </span>
          </div>

          <DeckDropzone
            id={`${variant}-customer-file`}
            files={customerFiles}
            onFiles={setCustomerFiles}
            eyebrow="Existing customer deck"
            title="Drop the customer CSV here"
            description="Every valid existing code is kept. Unlocked prices can only stay the same or go down."
            accept=".csv,text/csv"
            extensions={[".csv"]}
            icon="CSV"
            chooseLabel="Choose CSV"
          />

          <div className="controls-grid">
            <label className="field">
              <span>New-code markup <b>Required</b></span>
              <div className="input-with-suffix">
                <input type="number" min="0" step="0.01" placeholder="40" value={markup} onChange={(event) => setMarkup(event.target.value)} />
                <span>%</span>
              </div>
            </label>
            <fieldset className="field">
              <legend>Single-vendor handling</legend>
              <div className="segmented">
                <button type="button" className={mode === "fallback" ? "active" : ""} onClick={() => setMode("fallback")}>Fallback</button>
                <button type="button" className={mode === "require2" ? "active" : ""} onClick={() => setMode("require2")}>Require 2</button>
              </div>
            </fieldset>
          </div>

          <div className="precision-row">
            <label className="switch-label">
              <input type="checkbox" checked={fixedPrecision} onChange={(event) => setFixedPrecision(event.target.checked)} />
              <span className="switch" aria-hidden="true" />
              Fixed decimal precision
            </label>
            <label className={`decimal-input ${fixedPrecision ? "enabled" : ""}`}>
              <input type="number" min="0" max="12" value={decimals} disabled={!fixedPrecision} onChange={(event) => setDecimals(event.target.value)} />
              places
            </label>
          </div>

          <div className="rule-note">
            <strong>Traffic first, then LCR 2</strong>
            <p>Positive-attempt codes are frozen. Remaining existing fields may decrease to LCR 2, and eligible new codes receive the markup.</p>
          </div>

          <button className="build-button" type="button" disabled={building || !vendors.length} onClick={buildDeck}>
            <span>{building ? "Building and validating…" : `Build ${copy.short} LCR 2 customer deck`}</span>
            <span aria-hidden="true">→</span>
          </button>
        </article>
      </section>

      {summary && (
        <section className="results" aria-live="polite">
          <div className="result-title">
            <div className="pass-mark">✓</div>
            <div>
              <span className="eyebrow">{copy.short} validation passed</span>
              <h2>Your traffic-protected deck is complete.</h2>
              <p>{summary.trafficProtectedCodes.toLocaleString()} traffic codes locked unchanged · {summary.newCodesAdded.toLocaleString()} new codes added at {summary.markupPercent}% markup.</p>
            </div>
          </div>
          <div className="metrics">
            <div><span>Traffic-locked codes</span><strong>{summary.trafficProtectedCodes.toLocaleString()}</strong></div>
            <div><span>Rate fields lowered</span><strong>{summary.existingRateFieldsLowered.toLocaleString()}</strong></div>
            <div><span>New codes</span><strong>{summary.newCodesAdded.toLocaleString()}</strong></div>
            <div><span>Rates increased</span><strong>{summary.validation.existingRatesIncreased}</strong></div>
          </div>
          <div className="validation-line">
            <span>Protected codes changed <b>{summary.validation.trafficProtectedCodesChanged}</b></span>
            <span>Duplicates <b>{summary.validation.duplicateCodes}</b></span>
            <span>Missing customer codes <b>{summary.validation.missingCustomerCodes}</b></span>
            <span>Traffic rows combined <b>{summary.trafficDuplicateRowsConsolidated}</b></span>
            {summary.unmatchedTrafficCodes > 0 && <span className="warning">Unmatched traffic codes <b>{summary.unmatchedTrafficCodes}</b></span>}
            {summary.positiveTrafficNewCodesSkipped > 0 && <span className="warning">Positive-traffic new codes skipped <b>{summary.positiveTrafficNewCodesSkipped}</b></span>}
            {summary.singleVendorNewCodesAdded > 0 && <span className="warning">No-redundancy new codes <b>{summary.singleVendorNewCodesAdded}</b></span>}
          </div>
          {downloadUrl && <a className="download-button" href={downloadUrl} download={downloadName}>Download {copy.short} CSV deck</a>}
        </section>
      )}
    </section>
  );
}

export default function Home() {
  const [activeVariant, setActiveVariant] = useState<Variant>("sd");

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RouteForge home"><span className="brand-mark">RF</span><span>RouteForge</span></a>
        <div className="topbar-meta"><span className="live-dot" aria-hidden="true" />USA NPANXX · LCR 2</div>
      </header>

      <section className="hero" id="top">
        <div>
          <span className="kicker">Wholesale voice pricing console</span>
          <h1>Two rate-deck lanes. One protected pricing workflow.</h1>
          <p>Keep Short Duration and Conversational pricing completely separate, and freeze every customer code carrying current attempts before LCR 2 is applied.</p>
        </div>
        <div className="hero-stat"><span>Independent variants</span><strong>2</strong><small>SD + Convo</small></div>
      </section>

      <nav className="variant-switcher" aria-label="Choose rate-deck variant">
        {(["sd", "convo"] as Variant[]).map((variant) => {
          const copy = VARIANT_COPY[variant];
          return (
            <button key={variant} type="button" className={activeVariant === variant ? "active" : ""} onClick={() => setActiveVariant(variant)} aria-pressed={activeVariant === variant}>
              <span>{copy.short}</span><strong>{copy.title}</strong><small>{variant === "sd" ? "Short-duration pricing" : "Conversational pricing"}</small>
            </button>
          );
        })}
      </nav>

      <div hidden={activeVariant !== "sd"}><VariantWorkspace variant="sd" /></div>
      <div hidden={activeVariant !== "convo"}><VariantWorkspace variant="convo" /></div>

      <footer>
        <span>RouteForge LCR 2</span>
        <span>SD and Convo vendor defaults remain isolated in your persistent Coolify volume.</span>
      </footer>
    </main>
  );
}
