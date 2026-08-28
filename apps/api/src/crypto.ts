/**
 * Envelope encryption for per-user OAuth refresh tokens.
 *
 * D1 is encrypted at rest, but that defends only against physical compromise.
 * It does nothing against SQL injection, a leaked Cloudflare API token with
 * D1:Edit, or a careless `SELECT *` - and any of those against plaintext tokens
 * means permanent calendar access for every user. Application-layer encryption
 * is what turns a database read into a non-event.
 *
 * Shape: one root key (in Secrets Store, ~100 secrets per account so it must
 * not be per-user), a per-user key derived from it with HKDF, AES-GCM for the
 * value, and a `keyVersion` column so rotation never needs downtime.
 */

export interface Sealed {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

export const CURRENT_KEY_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Derive this user's data key from the root key. Distinct info per user means
 *  one compromised derived key cannot decrypt anyone else's tokens. */
async function deriveKey(
  rootKeyBase64: string,
  userId: string,
): Promise<CryptoKey> {
  const rootKey = await crypto.subtle.importKey(
    "raw",
    fromBase64(rootKeyBase64) as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("wiseroutine.oauth.v1"),
      info: encoder.encode(userId),
    },
    rootKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(
  rootKeyBase64: string,
  userId: string,
  plaintext: string,
): Promise<Sealed> {
  const key = await deriveKey(rootKeyBase64, userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export async function open(
  rootKeyBase64: string,
  userId: string,
  sealed: Sealed,
): Promise<string> {
  const key = await deriveKey(rootKeyBase64, userId);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource },
    key,
    fromBase64(sealed.ciphertext) as BufferSource,
  );
  return decoder.decode(plaintext);
}

/** A 32-byte root key, base64. Generate once per environment and put it in
 *  Secrets Store - never in wrangler.jsonc, never in the repo. */
export function generateRootKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

/** Opaque session token. 32 bytes of CSPRNG, url-safe. */
export function generateToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Constant-time compare for shared secrets echoed back by a provider
 *  (Google's channel token, Graph's clientState). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
