import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateUpload } from "./lcr2";
import type { DeckVariant } from "./variants";

export type VendorMetadata = {
  id: string;
  originalName: string;
  storedName: string;
  size: number;
  rows: number;
  uploadedAt: string;
};

const dataRoot = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data");
const legacyVendorDirectory = path.join(dataRoot, "vendors");
const legacyMetadataPath = path.join(dataRoot, "vendors.json");

function variantPaths(variant: DeckVariant) {
  const root = path.join(dataRoot, "variants", variant);
  return { vendorDirectory: path.join(root, "vendors"), metadataPath: path.join(root, "vendors.json") };
}

async function migrateLegacyDefaultsToSd() {
  const { vendorDirectory, metadataPath } = variantPaths("sd");
  try {
    await access(metadataPath);
    return;
  } catch {
    // Continue only when the SD metadata does not exist yet.
  }
  try {
    const metadata = JSON.parse(await readFile(legacyMetadataPath, "utf8")) as VendorMetadata[];
    if (!Array.isArray(metadata)) return;
    await Promise.all(metadata.map((vendor) => copyFile(path.join(legacyVendorDirectory, vendor.storedName), path.join(vendorDirectory, vendor.storedName))));
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function ensureStorage(variant: DeckVariant) {
  const paths = variantPaths(variant);
  await mkdir(paths.vendorDirectory, { recursive: true });
  if (variant === "sd") await migrateLegacyDefaultsToSd();
  return paths;
}

async function readMetadata(variant: DeckVariant): Promise<VendorMetadata[]> {
  const { metadataPath } = await ensureStorage(variant);
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeMetadata(variant: DeckVariant, metadata: VendorMetadata[]) {
  const { metadataPath } = await ensureStorage(variant);
  const temporaryPath = `${metadataPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporaryPath, metadataPath);
}

export async function listVendors(variant: DeckVariant) {
  const metadata = await readMetadata(variant);
  return metadata.map((vendor) => ({
    id: vendor.id,
    originalName: vendor.originalName,
    size: vendor.size,
    rows: vendor.rows,
    uploadedAt: vendor.uploadedAt,
  }));
}

export async function replaceVendors(variant: DeckVariant, files: { name: string; size: number; text: string }[]) {
  const validated = files.map((file) => ({ ...file, ...validateUpload(file.text) }));
  const previous = await readMetadata(variant);
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
  const { vendorDirectory } = await ensureStorage(variant);
  await Promise.all(metadata.map((vendor, index) => writeFile(path.join(vendorDirectory, vendor.storedName), validated[index].text, "utf8")));
  await writeMetadata(variant, metadata);
  await Promise.allSettled(previous.map((vendor) => unlink(path.join(vendorDirectory, vendor.storedName))));
  return listVendors(variant);
}

export async function removeVendor(variant: DeckVariant, id: string) {
  const metadata = await readMetadata(variant);
  const target = metadata.find((vendor) => vendor.id === id);
  if (!target) return listVendors(variant);
  const remaining = metadata.filter((vendor) => vendor.id !== id);
  await writeMetadata(variant, remaining);
  const { vendorDirectory } = await ensureStorage(variant);
  await unlink(path.join(vendorDirectory, target.storedName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  return listVendors(variant);
}

export async function readVendorDecks(variant: DeckVariant) {
  const metadata = await readMetadata(variant);
  const { vendorDirectory } = await ensureStorage(variant);
  return Promise.all(metadata.map((vendor) => readFile(path.join(vendorDirectory, vendor.storedName), "utf8")));
}
