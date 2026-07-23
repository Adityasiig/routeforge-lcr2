// Lightweight, dependency-free auth for a single username/password.
// Uses Web Crypto (works in both the Edge middleware and Node route handlers).
// Credentials and the signing secret come from environment variables:
//   AUTH_USERNAME, AUTH_PASSWORD, AUTH_SECRET

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = "rf_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

// Build a signed session token: base64url(username).expiry.signature
export async function signSession(username: string, maxAgeSec: number = SESSION_MAX_AGE): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = `${stringToB64Url(username)}.${expiry}`;
  const signature = bytesToB64Url(await hmac(requireSecret(), payload));
  return `${payload}.${signature}`;
}

// Verify a session token; returns the username or null. Never throws.
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [userB64, expiryStr, signature] = parts;
    const payload = `${userB64}.${expiryStr}`;
    const expected = bytesToB64Url(await hmac(requireSecret(), payload));
    if (!timingSafeEqual(encoder.encode(signature), encoder.encode(expected))) return null;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return null;
    return b64UrlToString(userB64);
  } catch {
    return null;
  }
}

// Constant-time credential check against the configured single user. Never throws.
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  try {
    const expectedUser = process.env.AUTH_USERNAME ?? "";
    const expectedPass = process.env.AUTH_PASSWORD ?? "";
    if (!expectedUser || !expectedPass) return false;
    const secret = requireSecret();
    const userOk = timingSafeEqual(await hmac(secret, `u:${username}`), await hmac(secret, `u:${expectedUser}`));
    const passOk = timingSafeEqual(await hmac(secret, `p:${password}`), await hmac(secret, `p:${expectedPass}`));
    return userOk && passOk;
  } catch {
    return false;
  }
}

export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD && process.env.AUTH_SECRET);
}
