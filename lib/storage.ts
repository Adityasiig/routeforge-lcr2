import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateUpload } from "./lcr2";

export type VendorMetadata = {
  id: string;
  originalName: string;
  storedName: string;
  size: number;
  rows: number;
  uploadedAt: string;
};

const dataRoot = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const vendorDirectory = path.join(dataRoot, "vendors");
const metadataPath = path.join(dataRoot, "vendors.json");

async function ensureStorage() {
  await mkdir(vendorDirectory, { recursive: true });
}

async function readMetadata(): Promise<VendorMetadata[]> {
  await ensureStorage();
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeMetadata(metadata: VendorMetadata[]) {
  await ensureStorage();
  const temporaryPath = `${metadataPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporaryPath, metadataPath);
}

export async function listVendors() {
  const metadata = await readMetadata();
  return metadata.map((vendor) => ({
    id: vendor.id,
    originalName: vendor.originalName,
    size: vendor.size,
    rows: vendor.rows,
    uploadedAt: vendor.uploadedAt,
  }));
}

export async function replaceVendors(files: { name: string; size: number; text: string }[]) {
  const validated = files.map((file) => ({ ...file, ...validateUpload(file.text) }));
  const previous = await readMetadata();
  const metadata: VendorMetadata[] = validated.map((file) => {
    const id = randomUUID();
    return {
      id,
      originalName: file.name,
      storedName: `${id}.csv`,
      size: file.size,
      rows: file.rows,
      uploadedAt: new Date().toISOString(),
    };
  });
  await ensureStorage();
  await Promise.all(metadata.map((vendor, index) => writeFile(path.join(vendorDirectory, vendor.storedName), validated[index].text, "utf8")));
  await writeMetadata(metadata);
  await Promise.allSettled(previous.map((vendor) => unlink(path.join(vendorDirectory, vendor.storedName))));
  return listVendors();
}

export async function removeVendor(id: string) {
  const metadata = await readMetadata();
  const target = metadata.find((vendor) => vendor.id === id);
  if (!target) return listVendors();
  const remaining = metadata.filter((vendor) => vendor.id !== id);
  await writeMetadata(remaining);
  await unlink(path.join(vendorDirectory, target.storedName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  return listVendors();
}

export async function readVendorDecks() {
  const metadata = await readMetadata();
  return Promise.all(metadata.map((vendor) => readFile(path.join(vendorDirectory, vendor.storedName), "utf8")));
}
