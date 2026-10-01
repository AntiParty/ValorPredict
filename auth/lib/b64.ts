// Small encoding helpers shared by the sealing and state code.

export const utf8 = new TextEncoder();
export const utf8d = new TextDecoder();

export function toB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Strict base64url decode: rejects anything outside the URL-safe alphabet. */
export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  return new Uint8Array(Buffer.from(value, "base64url"));
}

export function fromB64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
