import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import path from "node:path";
import { DeckError, type BuildOptions, type BuildSummary } from "./lcr2";
import { getDataRoot } from "./storage";
import type { DeckVariant } from "./variants";

// NOTE: exceljs is used only by the background worker (workers/build-job.mjs),
// which resolves it from its own node_modules bundled by the Dockerfile. The
// web server does not import exceljs.

export type BuildJobState = "queued" | "running" | "completed" | "failed";

export type BuildJobStatus = {
  jobId: string;
  state: BuildJobState;
  createdAt: string;
  updatedAt: string;
  variant: DeckVariant;
  filename: string;
  summary?: BuildSummary;
  durationMs?: number;
  error?: string;
};

type BuildJobManifest = {
  jobId: string;
  jobDirectory: string;
  customerPath: string;
  trafficPath: string;
  trafficFilename: string;
  vendorPaths: string[];
  outputPath: string;
  statusPath: string;
  filename: string;
  variant: DeckVariant;
  options: BuildOptions;
  createdAt: string;
};

const jobsRoot = path.join(getDataRoot(), "build-jobs");
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STALE_RUNNING_MS = 30 * 60 * 1000;
const EXPIRED_JOB_MS = 24 * 60 * 60 * 1000;

function jobPaths(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) throw new DeckError("The build job identifier is invalid.");
  const directory = path.join(jobsRoot, jobId);
  return {
    directory,
    statusPath: path.join(directory, "status.json"),
    outputPath: path.join(directory, "result.csv"),
  };
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), "utf8");
  await rename(temporaryPath, filePath);
}

// Stream a web File straight to disk without ever buffering or decoding it in
// memory. This is the key change: a 100 MB customer CSV or a large .xlsx is
// persisted as raw bytes on the request path (fast, I/O-bound) and parsed later
// by the worker, instead of being decoded/parsed inside the HTTP handler.
async function streamFileToDisk(file: File, destinationPath: string) {
  // file.stream() is typed as the DOM ReadableStream (lib.dom), but Node's
  // Readable.fromWeb expects the node:stream/web ReadableStream. Cast across.
  const webStream = file.stream() as unknown as WebReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(webStream), createWriteStream(destinationPath));
}

async function readStatusFile(statusPath: string): Promise<BuildJobStatus | null> {
  try {
    return JSON.parse(await readFile(statusPath, "utf8")) as BuildJobStatus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function findActiveJob() {
  await mkdir(jobsRoot, { recursive: true });
  const entries = await readdir(jobsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
    const statusPath = path.join(jobsRoot, entry.name, "status.json");
    const status = await readStatusFile(statusPath);
    if (!status || (status.state !== "queued" && status.state !== "running")) continue;
    if (Date.now() - Date.parse(status.updatedAt) <= STALE_RUNNING_MS) return status;
    await writeJsonAtomic(statusPath, {
      ...status,
      state: "failed",
      updatedAt: new Date().toISOString(),
      error: "This build stopped before completion. Start a new build.",
    } satisfies BuildJobStatus);
  }
  return null;
}

async function cleanupExpiredJobs() {
  await mkdir(jobsRoot, { recursive: true });
  const entries = await readdir(jobsRoot, { withFileTypes: true });
  await Promise.allSettled(entries.map(async (entry) => {
    if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) return;
    const directory = path.join(jobsRoot, entry.name);
    const details = await stat(directory);
    if (Date.now() - details.mtimeMs > EXPIRED_JOB_MS) await rm(directory, { recursive: true, force: true });
  }));
}

async function markLaunchFailure(statusPath: string, error: unknown) {
  const current = await readStatusFile(statusPath);
  if (!current || current.state === "completed" || current.state === "failed") return;
  console.error(`[LCR2 worker ${current.jobId.slice(0, 8)}]`, error);
  await writeJsonAtomic(statusPath, {
    ...current,
    state: "failed",
    updatedAt: new Date().toISOString(),
    error: `The background build could not start. Reference: ${current.jobId.slice(0, 8)}.`,
  } satisfies BuildJobStatus);
}

function launchWorker(manifestPath: string, statusPath: string) {
  const workerPath = process.env.BUILD_WORKER_PATH || path.join(process.cwd(), "workers", "build-job.mjs");
  const child = spawn(process.execPath, ["--experimental-strip-types", "--max-old-space-size=1024", workerPath, manifestPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.on("error", (error) => { void markLaunchFailure(statusPath, error); });
  child.on("exit", (code) => {
    if (code !== 0) void markLaunchFailure(statusPath, new Error(stderr.trim() || `Worker exited with code ${code}.`));
  });
}

export async function createBuildJob(input: {
  variant: DeckVariant;
  filename: string;
  customer: File;
  traffic: File;
  vendorPaths: string[];
  options: BuildOptions;
}) {
  if (!input.vendorPaths.length) throw new DeckError("No saved vendor decks are available.");
  await cleanupExpiredJobs();
  const active = await findActiveJob();
  if (active) throw new DeckError(`Build ${active.jobId.slice(0, 8)} is already running. Wait for it to finish before starting another build.`);

  const jobId = randomUUID();
  const { directory, statusPath, outputPath } = jobPaths(jobId);
  await mkdir(directory, { recursive: true });
  const customerPath = path.join(directory, "customer.csv");
  const trafficExtension = input.traffic.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
  const trafficPath = path.join(directory, `traffic.${trafficExtension}`);
  const manifestPath = path.join(directory, "manifest.json");
  const createdAt = new Date().toISOString();
  const status: BuildJobStatus = {
    jobId,
    state: "queued",
    createdAt,
    updatedAt: createdAt,
    variant: input.variant,
    filename: input.filename,
  };
  const manifest: BuildJobManifest = {
    jobId,
    jobDirectory: directory,
    customerPath,
    trafficPath,
    trafficFilename: input.traffic.name,
    vendorPaths: input.vendorPaths,
    outputPath,
    statusPath,
    filename: input.filename,
    variant: input.variant,
    options: input.options,
    createdAt,
  };
  // Publish the "queued" status first so the client can start polling, then
  // stream the raw uploads to disk (no parsing), then write the manifest and
  // launch the worker. Streaming raw bytes is fast; the heavy work is deferred.
  await writeJsonAtomic(statusPath, status);
  await Promise.all([
    streamFileToDisk(input.customer, customerPath),
    streamFileToDisk(input.traffic, trafficPath),
  ]);
  await writeJsonAtomic(manifestPath, manifest);
  launchWorker(manifestPath, statusPath);
  return status;
}

export async function getBuildJobStatus(jobId: string) {
  const { statusPath } = jobPaths(jobId);
  const status = await readStatusFile(statusPath);
  if (!status) throw new DeckError("This build job was not found or has expired.");
  return status;
}

export async function getCompletedBuild(jobId: string) {
  const { outputPath } = jobPaths(jobId);
  const status = await getBuildJobStatus(jobId);
  if (status.state !== "completed") throw new DeckError("This build is not ready to download.");
  return { status, csv: await readFile(outputPath, "utf8") };
}
