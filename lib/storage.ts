import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeckError, validateUpload } from "./lcr2";
import { ENTITY_ID_PATTERN, primaryEntityId } from "./auth";
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

// Pre-multitenant storage locations, kept only as one-time migration sources.
const legacyVendorDirectory = path.join(dataRoot, "vendors");
const legacyMetadataPath = path.join(dataRoot, "vendors.json");
function legacyVariantRoot(variant: DeckVariant) {
  return path.join(dataRoot, "variants", variant);
}

// Validate an entity id before it is ever turned into a filesystem path. Ids
// come from trusted env config, but this is defense-in-depth against traversal.
export function safeEntityId(entityId: string): string {
  if (typeof entityId !== "string" || !ENTITY_ID_PATTERN.test(entityId)) {
    throw new DeckError("Invalid account identifier.");
  }
  return entityId;
}

function entityRoot(entityId: string) {
  return path.join(dataRoot, "entities", safeEntityId(entityId));
}

function variantPaths(entityId: string, variant: DeckVariant) {
  const root = path.join(entityRoot(entityId), "variants", variant);
  return { vendorDirectory: path.join(root, "vendors"), metadataPath: path.join(root, "vendors.json") };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

// One-time seed: the primary entity inherits vendor data that was saved before
// multi-tenancy existed. Source preference: the per-variant global store
// (variants/<variant>), then the oldest single-list legacy store (SD only).
// Runs only for the primary entity and only when its own store is still empty.
async function migrateLegacyIntoPrimary(entityId: string, variant: DeckVariant) {
  if (entityId !== primaryEntityId()) return;
  const { vendorDirectory, metadataPath } = variantPaths(entityId, variant);
  if (await exists(metadataPath)) return; // already seeded or already in use

  const globalRoot = legacyVariantRoot(variant);
  let sourceMetadata = path.join(globalRoot, "vendors.json");
  let sourceVendors = path.join(globalRoot, "vendors");

  if (!(await exists(sourceMetadata))) {
    // Fall back to the very old flat store, which only ever held SD data.
    if (variant === "sd" && (await exists(legacyMetadataPath))) {
      sourceMetadata = legacyMetadataPath;
      sourceVendors = legacyVendorDirectory;
    } else {
      return; // nothing to migrate
    }
  }

  try {
    const metadata = JSON.parse(await readFile(sourceMetadata, "utf8")) as VendorMetadata[];
    if (!Array.isArray(metadata) || !metadata.length) return;
    await mkdir(vendorDirectory, { recursive: true });
    await Promise.all(
      metadata.map((vendor) =>
        copyFile(path.join(sourceVendors, vendor.storedName), path.join(vendorDirectory, vendor.storedName)).catch(
          () => undefined,
        ),
      ),
    );
    // wx: never clobber a store that already exists (avoids a migration race).
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: "utf8", flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function ensureStorage(entityId: string, variant: DeckVariant) {
  const paths = variantPaths(entityId, variant);
  await mkdir(paths.vendorDirectory, { recursive: true });
  await migrateLegacyIntoPrimary(entityId, variant);
  return paths;
}

async function readMetadata(entityId: string, variant: DeckVariant): Promise<VendorMetadata[]> {
  const { metadataPath } = await ensureStorage(entityId, variant);
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeMetadata(entityId: string, variant: DeckVariant, metadata: VendorMetadata[]) {
  const { metadataPath } = await ensureStorage(entityId, variant);
  const temporaryPath = `${metadataPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporaryPath, metadataPath);
}

export async function listVendors(entityId: string, variant: DeckVariant) {
  const metadata = await readMetadata(entityId, variant);
  return metadata.map((vendor) => ({
    id: vendor.id,
    originalName: vendor.originalName,
    size: vendor.size,
    rows: vendor.rows,
    uploadedAt: vendor.uploadedAt,
  }));
}

export async function replaceVendors(
  entityId: string,
  variant: DeckVariant,
  files: { name: string; size: number; text: string }[],
) {
  const validated = files.map((file) => ({ ...file, ...validateUpload(file.text) }));
  const previous = await readMetadata(entityId, variant);
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
  const { vendorDirectory } = await ensureStorage(entityId, variant);
  await Promise.all(
    metadata.map((vendor, index) => writeFile(path.join(vendorDirectory, vendor.storedName), validated[index].text, "utf8")),
  );
  await writeMetadata(entityId, variant, metadata);
  await Promise.allSettled(previous.map((vendor) => unlink(path.join(vendorDirectory, vendor.storedName))));
  return listVendors(entityId, variant);
}

export async function addVendors(
  entityId: string,
  variant: DeckVariant,
  files: { name: string; size: number; text: string }[],
) {
  const validated = files.map((file) => ({ ...file, ...validateUpload(file.text) }));
  const previous = await readMetadata(entityId, variant);
  if (previous.length + validated.length > 100) throw new DeckError("A saved vendor set can contain a maximum of 100 decks.");

  const existingNames = new Set(previous.map((vendor) => vendor.originalName.trim().toLowerCase()));
  const incomingNames = new Set<string>();
  for (const file of validated) {
    const normalizedName = file.name.trim().toLowerCase();
    if (existingNames.has(normalizedName)) {
      throw new DeckError(`${file.name} is already saved. Remove the existing copy before adding an updated file with the same name.`);
    }
    if (incomingNames.has(normalizedName)) throw new DeckError(`${file.name} was selected more than once.`);
    incomingNames.add(normalizedName);
  }

  const additions: VendorMetadata[] = validated.map((file) => {
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
  const { vendorDirectory } = await ensureStorage(entityId, variant);
  await Promise.all(
    additions.map((vendor, index) => writeFile(path.join(vendorDirectory, vendor.storedName), validated[index].text, "utf8")),
  );
  try {
    await writeMetadata(entityId, variant, [...previous, ...additions]);
  } catch (error) {
    await Promise.allSettled(additions.map((vendor) => unlink(path.join(vendorDirectory, vendor.storedName))));
    throw error;
  }
  return listVendors(entityId, variant);
}

export async function removeVendor(entityId: string, variant: DeckVariant, id: string) {
  const metadata = await readMetadata(entityId, variant);
  const target = metadata.find((vendor) => vendor.id === id);
  if (!target) return listVendors(entityId, variant);
  const remaining = metadata.filter((vendor) => vendor.id !== id);
  await writeMetadata(entityId, variant, remaining);
  const { vendorDirectory } = await ensureStorage(entityId, variant);
  await unlink(path.join(vendorDirectory, target.storedName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  return listVendors(entityId, variant);
}

export async function readVendorDecks(entityId: string, variant: DeckVariant) {
  const metadata = await readMetadata(entityId, variant);
  const { vendorDirectory } = await ensureStorage(entityId, variant);
  return Promise.all(metadata.map((vendor) => readFile(path.join(vendorDirectory, vendor.storedName), "utf8")));
}

export function getDataRoot() {
  return dataRoot;
}

export async function getVendorDeckPaths(entityId: string, variant: DeckVariant) {
  const metadata = await readMetadata(entityId, variant);
  const { vendorDirectory } = await ensureStorage(entityId, variant);
  return metadata.map((vendor) => path.join(vendorDirectory, vendor.storedName));
}
