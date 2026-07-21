"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

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
  validation: {
    exactColumns: boolean;
    duplicateCodes: number;
    missingCustomerCodes: number;
    existingRatesIncreased: number;
    status: "PASS" | "FAIL";
  };
};

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
}: {
  id: string;
  multiple?: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const takeFiles = (list: FileList | null) => {
    if (!list) return;
    const csvFiles = Array.from(list).filter((file) => file.name.toLowerCase().endsWith(".csv"));
    onFiles(multiple ? csvFiles : csvFiles.slice(0, 1));
  };

  return (
    <div
      className={`dropzone ${dragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
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
        accept=".csv,text/csv"
        multiple={multiple}
        onChange={(event: ChangeEvent<HTMLInputElement>) => takeFiles(event.target.files)}
      />
      <div className="drop-icon" aria-hidden="true">CSV</div>
      <div className="drop-copy">
        <span className="eyebrow">{eyebrow}</span>
        <strong>{files.length ? `${files.length} deck${files.length === 1 ? "" : "s"} selected` : title}</strong>
        <p>{files.length ? files.map((file) => file.name).join(" · ") : description}</p>
      </div>
      <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>
        {files.length ? "Change" : "Choose CSV"}
      </button>
    </div>
  );
}

export default function Home() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorFiles, setVendorFiles] = useState<File[]>([]);
  const [customerFiles, setCustomerFiles] = useState<File[]>([]);
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
  const [downloadName, setDownloadName] = useState("Customer_USA_LCR2_Rate_Deck.csv");

  useEffect(() => {
    let active = true;
    fetch("/api/vendors", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load vendor decks.");
        return payload;
      })
      .then((payload) => { if (active) setVendors(payload.vendors); })
      .catch((error) => { if (active) setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not load vendor decks." }); })
      .finally(() => { if (active) setLoadingVendors(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const totalVendorRows = useMemo(() => vendors.reduce((sum, vendor) => sum + vendor.rows, 0), [vendors]);

  const saveVendorDefaults = async () => {
    if (!vendorFiles.length) return setNotice({ type: "error", text: "Choose at least one vendor CSV first." });
    setSaving(true);
    setNotice(null);
    const form = new FormData();
    vendorFiles.forEach((file) => form.append("files", file));
    form.append("replace", "true");
    try {
      const response = await fetch("/api/vendors", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Vendor decks could not be saved.");
      setVendors(payload.vendors);
      setVendorFiles([]);
      setNotice({ type: "success", text: `${payload.vendors.length} vendor deck${payload.vendors.length === 1 ? " is" : "s are"} now saved as the default routing set.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Vendor decks could not be saved." });
    } finally {
      setSaving(false);
    }
  };

  const removeVendor = async (id: string) => {
    setNotice(null);
    try {
      const response = await fetch(`/api/vendors/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Vendor deck could not be removed.");
      setVendors(payload.vendors);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Vendor deck could not be removed." });
    }
  };

  const buildDeck = async () => {
    if (!vendors.length) return setNotice({ type: "error", text: "Save the vendor decks before building a customer deck." });
    if (!customerFiles.length) return setNotice({ type: "error", text: "Choose the customer CSV rate deck." });
    if (markup.trim() === "") return setNotice({ type: "error", text: "Enter the markup percentage for new codes." });
    setBuilding(true);
    setNotice(null);
    setSummary(null);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    const form = new FormData();
    form.append("customer", customerFiles[0]);
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
      setDownloadName(filenameHeader || downloadName);
      setNotice({ type: "success", text: "LCR 2 deck built and validated. It is ready to download." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Build failed." });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RouteForge home">
          <span className="brand-mark">RF</span>
          <span>RouteForge</span>
        </a>
        <div className="topbar-meta">
          <span className="live-dot" aria-hidden="true" />
          USA NPANXX · LCR 2
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <span className="kicker">Wholesale voice pricing console</span>
          <h1>Turn vendor costs into a protected customer sell deck.</h1>
          <p>Save your vendor rate decks once. Then price every customer file against the second-lowest route—without ever increasing an existing customer rate.</p>
        </div>
        <div className="hero-stat">
          <span>Default vendor set</span>
          <strong>{loadingVendors ? "—" : vendors.length}</strong>
          <small>{totalVendorRows.toLocaleString()} source rows ready</small>
        </div>
      </section>

      {notice && <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.text}</div>}

      <section className="workspace-grid">
        <article className="panel vendor-panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">01</span>
              <div>
                <span className="eyebrow">Set once, reuse anytime</span>
                <h2>Vendor defaults</h2>
              </div>
            </div>
            <span className={`status-pill ${vendors.length ? "ready" : "waiting"}`}>{vendors.length ? "Ready" : "Not set"}</span>
          </div>

          <DeckDropzone
            id="vendor-files"
            multiple
            files={vendorFiles}
            onFiles={setVendorFiles}
            eyebrow="Vendor cost decks"
            title="Drop all vendor CSVs here"
            description="Each file is treated as one vendor. Required columns: code, interrate, intrarate, ijrate."
          />
          <button className="primary-button full" type="button" disabled={saving || !vendorFiles.length} onClick={saveVendorDefaults}>
            {saving ? "Validating and saving…" : vendors.length ? "Replace default vendor set" : "Save as default vendor set"}
          </button>

          <div className="saved-list">
            <div className="list-heading">
              <span>Saved vendor decks</span>
              <span>{vendors.length}</span>
            </div>
            {loadingVendors ? (
              <p className="empty-state">Loading the default set…</p>
            ) : vendors.length ? vendors.map((vendor, index) => (
              <div className="vendor-row" key={vendor.id}>
                <span className="vendor-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{vendor.originalName}</strong>
                  <small>{vendor.rows.toLocaleString()} rows · {formatBytes(vendor.size)}</small>
                </div>
                <button type="button" className="icon-button" onClick={() => removeVendor(vendor.id)} aria-label={`Remove ${vendor.originalName}`}>Remove</button>
              </div>
            )) : <p className="empty-state">No defaults yet. Upload two or more vendor decks for true LCR 2 coverage.</p>}
          </div>
        </article>

        <article className="panel customer-panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">02</span>
              <div>
                <span className="eyebrow">Run whenever needed</span>
                <h2>Customer build</h2>
              </div>
            </div>
            <span className={`status-pill ${vendors.length ? "ready" : "waiting"}`}>{vendors.length ? "Vendor set linked" : "Waiting for vendors"}</span>
          </div>

          <DeckDropzone
            id="customer-file"
            files={customerFiles}
            onFiles={setCustomerFiles}
            eyebrow="Existing customer deck"
            title="Drop the customer CSV here"
            description="Every valid existing customer code is preserved. Existing prices can only stay the same or go down."
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
            <strong>LCR 2 guardrail</strong>
            <p>Second-lowest valid vendor rate per field. New codes receive the markup; existing customer rates are never increased.</p>
          </div>

          <button className="build-button" type="button" disabled={building || !vendors.length} onClick={buildDeck}>
            <span>{building ? "Building and validating…" : "Build LCR 2 customer deck"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </article>
      </section>

      {summary && (
        <section className="results" aria-live="polite">
          <div className="result-title">
            <div className="pass-mark">✓</div>
            <div>
              <span className="eyebrow">Validation passed</span>
              <h2>Your switch-ready deck is complete.</h2>
              <p>{summary.validExistingCodesPreserved.toLocaleString()} existing codes protected · {summary.newCodesAdded.toLocaleString()} new codes added at {summary.markupPercent}% markup.</p>
            </div>
          </div>
          <div className="metrics">
            <div><span>Existing codes</span><strong>{summary.validExistingCodesPreserved.toLocaleString()}</strong></div>
            <div><span>Rate fields lowered</span><strong>{summary.existingRateFieldsLowered.toLocaleString()}</strong></div>
            <div><span>New codes</span><strong>{summary.newCodesAdded.toLocaleString()}</strong></div>
            <div><span>Rates increased</span><strong>{summary.validation.existingRatesIncreased}</strong></div>
          </div>
          <div className="validation-line">
            <span>Columns <b>{summary.validation.exactColumns ? "Exact" : "Failed"}</b></span>
            <span>Duplicates <b>{summary.validation.duplicateCodes}</b></span>
            <span>Missing customer codes <b>{summary.validation.missingCustomerCodes}</b></span>
            {summary.singleVendorNewCodesAdded > 0 && <span className="warning">No-redundancy new codes <b>{summary.singleVendorNewCodesAdded}</b></span>}
          </div>
          {downloadUrl && <a className="download-button" href={downloadUrl} download={downloadName}>Download CSV rate deck</a>}
        </section>
      )}

      <footer>
        <span>RouteForge LCR 2</span>
        <span>Pricing logic runs on your server. Vendor decks remain in your persistent Coolify volume.</span>
      </footer>
    </main>
  );
}
