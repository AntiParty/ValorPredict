// Connection codes: Twitch tokens encrypted with a server-only key.
//
// The browser shows the user one opaque string ("vp1_…"). Only this service can
// read it, and only for CODE_MAX_AGE_S after it was issued, so a code left in
// clipboard history, a screenshot or a chat message is useless soon after.
// The scheme is stateless (no database), so it is not strictly single-use.

import { concat, fromB64, fromB64url, toB64url, utf8, utf8d } from "./b64.js";

export const CODE_PREFIX = "vp1_";
export const CODE_MAX_AGE_S = 600;
const CLOCK_SKEW_S = 60;
const MAX_CODE_LENGTH = 4096;
const AAD = utf8.encode("valorpredict-connection-code-v1");

export interface SealedTokens {
  /** access token */
  at: string;
  /** refresh token */
  rt: string;
  /** access token lifetime in seconds, as of `iat` */
  exp: number;
  /** issued-at, unix seconds */
  iat: number;
}

export type CodeErrorReason = "format" | "invalid" | "expired";

export class CodeError extends Error {
  readonly reason: CodeErrorReason;
  constructor(reason: CodeErrorReason) {
    super(`connection code ${reason}`);
    this.name = "CodeError";
    this.reason = reason;
  }
}

function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(payload: SealedTokens, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      utf8.encode(JSON.stringify(payload)),
    ),
  );
  return CODE_PREFIX + toB64url(concat(iv, ciphertext));
}

function isSealedTokens(value: unknown): value is SealedTokens {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.at === "string" &&
    typeof v.rt === "string" &&
    typeof v.exp === "number" &&
    typeof v.iat === "number"
  );
}

export async function unseal(
  code: string,
  keyB64: string,
  nowS: number = Date.now() / 1000,
): Promise<SealedTokens> {
  if (typeof code !== "string" || !code.startsWith(CODE_PREFIX) || code.length > MAX_CODE_LENGTH) {
    throw new CodeError("format");
  }
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromB64url(code.slice(CODE_PREFIX.length));
  } catch {
    throw new CodeError("format");
  }
  // 12-byte IV + at least the 16-byte GCM tag.
  if (raw.length < 12 + 16) throw new CodeError("format");

  const key = await importKey(keyB64);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: AAD },
      key,
      raw.slice(12),
    );
  } catch {
    throw new CodeError("invalid");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(utf8d.decode(plain));
  } catch {
    throw new CodeError("invalid");
  }
  if (!isSealedTokens(payload)) throw new CodeError("invalid");

  const age = nowS - payload.iat;
  if (age > CODE_MAX_AGE_S || age < -CLOCK_SKEW_S) throw new CodeError("expired");
  return payload;
}
