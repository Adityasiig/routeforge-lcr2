// Lightweight, dependency-free auth for multiple env-configured accounts.
// Uses Web Crypto (works in both the Edge middleware and Node route handlers).
//
// Accounts are defined in one environment variable, AUTH_ACCOUNTS — a JSON array:
//   AUTH_ACCOUNTS='[
//     {"id":"entity-a","label":"Entity A","username":"a_user","password":"...","primary":true},
//     {"id":"entity-b","label":"Entity B","username":"b_user","password":"..."}
//   ]'
// Each account is one isolated tenant ("entity"): its `id` is the stable storage
// key (never change it once data exists), `label` is the display name, and the
// primary account inherits any pre-existing shared vendor data on first boot.
//
// AUTH_SECRET signs the session cookie (a long random value).
//
// Backward compatible: if AUTH_ACCOUNTS is unset, a single legacy account is
// synthesized from AUTH_USERNAME / AUTH_PASSWORD with id "default".

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = "rf_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Entity ids become filesystem paths, so keep them to a safe, bounded charset.
export const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type Account = {
  id: string;
  label: string;
  username: string;
  password: string;
  primary: boolean;
};

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(value: string): Uint8Array {
  let s = value.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function stringToB64Url(value: string): string {
  return bytesToB64Url(encoder.encode(value));
}

function b64UrlToString(value: string): string {
  return decoder.decode(b64UrlToBytes(value));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

// Derive a filesystem-safe entity id from a username when no explicit id is set.
function slugify(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return ENTITY_ID_PATTERN.test(s) ? s : "";
}

// Parse and cache the account list. process.env is stable per process, so we
// re-parse only if AUTH_ACCOUNTS changes (never, in practice).
let cachedAccounts: Account[] | null = null;
let cachedRaw: string | undefined;

function loadAccounts(): Account[] {
  const raw = process.env.AUTH_ACCOUNTS;
  if (cachedAccounts && cachedRaw === raw) return cachedAccounts;

  const accounts: Account[] = [];
  const seen = new Set<string>();

  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const username = typeof record.username === "string" ? record.username.trim() : "";
          const password = typeof record.password === "string" ? record.password : "";
          const explicitId =
            typeof record.id === "string" && record.id.trim() ? record.id.trim().toLowerCase() : "";
          const id = explicitId || slugify(username);
          const label =
            typeof record.label === "string" && record.label.trim() ? record.label.trim() : username;
          if (!username || !password || !ENTITY_ID_PATTERN.test(id) || seen.has(id)) continue;
          seen.add(id);
          accounts.push({ id, label, username, password, primary: record.primary === true });
        }
      }
    } catch {
      // Malformed JSON — fall through to the legacy single-account path below.
    }
  }

  if (!accounts.length) {
    const username = process.env.AUTH_USERNAME?.trim();
    const password = process.env.AUTH_PASSWORD;
    if (username && password) {
      accounts.push({ id: "default", label: username, username, password, primary: true });
    }
  }

  // Guarantee exactly one primary (the migration target for pre-existing data).
  if (accounts.length && !accounts.some((a) => a.primary)) accounts[0].primary = true;

  cachedAccounts = accounts;
  cachedRaw = raw;
  return accounts;
}

export function listAccounts(): Account[] {
  return loadAccounts();
}

export function getAccount(entityId: string | null | undefined): Account | null {
  if (!entityId) return null;
  return loadAccounts().find((a) => a.id === entityId) ?? null;
}

// The entity that inherits any pre-multitenant shared vendor data on first boot.
export function primaryEntityId(): string | null {
  const accounts = loadAccounts();
  const primary = accounts.find((a) => a.primary) ?? accounts[0];
  return primary?.id ?? null;
}

export function accountsConfigured(): boolean {
  return loadAccounts().length > 0 && Boolean(process.env.AUTH_SECRET);
}

// Backward-compatible alias (older callers imported authConfigured).
export function authConfigured(): boolean {
  return accountsConfigured();
}

// Build a signed session token: base64url(entityId).expiry.signature
export async function signSession(entityId: string, maxAgeSec: number = SESSION_MAX_AGE): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = `${stringToB64Url(entityId)}.${expiry}`;
  const signature = bytesToB64Url(await hmac(requireSecret(), payload));
  return `${payload}.${signature}`;
}

// Verify a session token; returns the entity id or null. Never throws.
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [subjectB64, expiryStr, signature] = parts;
    const payload = `${subjectB64}.${expiryStr}`;
    const expected = bytesToB64Url(await hmac(requireSecret(), payload));
    if (!timingSafeEqual(encoder.encode(signature), encoder.encode(expected))) return null;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return null;
    return b64UrlToString(subjectB64);
  } catch {
    return null;
  }
}

// Constant-time credential check across all accounts. Returns the matched
// account or null. Never throws. Compares HMACs (which hide length/content)
// against every account without an early break to avoid a per-account timing
// signal.
export async function verifyCredentials(username: string, password: string): Promise<Account | null> {
  try {
    const secret = requireSecret();
    const accounts = loadAccounts();
    if (!accounts.length) return null;
    const userMac = await hmac(secret, `u:${username}`);
    const passMac = await hmac(secret, `p:${password}`);
    let match: Account | null = null;
    for (const account of accounts) {
      const userOk = timingSafeEqual(userMac, await hmac(secret, `u:${account.username}`));
      const passOk = timingSafeEqual(passMac, await hmac(secret, `p:${account.password}`));
      if (userOk && passOk) match = account;
    }
    return match;
  } catch {
    return null;
  }
}

// Read a named cookie from a raw Cookie header. Dependency-free.
function readCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

// Resolve the logged-in account from a Node route-handler Request. Returns null
// when there is no valid session or the session's entity no longer exists.
export async function resolveEntityFromRequest(request: Request): Promise<Account | null> {
  const token = readCookie(request.headers.get("cookie") ?? "", SESSION_COOKIE);
  const entityId = await verifySession(token);
  return getAccount(entityId);
}
