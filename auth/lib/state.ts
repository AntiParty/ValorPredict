// OAuth `state`, bound to the browser that started the login.
//
// /api/login sets a signed, HttpOnly cookie containing the state and sends the
// same state to Twitch. /api/callback only continues if the cookie's signature
// is valid AND it matches the `state` Twitch echoed back. That stops someone
// from feeding a victim a login (or callback link) the victim didn't start.

import { timingSafeEqual } from "node:crypto";
import { fromB64, fromB64url, toB64url, utf8 } from "./b64.js";
import type { Env } from "./env.js";

export const STATE_MAX_AGE_S = 600;

export function stateCookieName(isHttps: boolean): string {
  // The __Host- prefix makes browsers insist on Secure + Path=/ + no Domain.
  return isHttps ? "__Host-vp_state" : "vp_state";
}

function hmacKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(keyB64), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function cookieAttributes(env: Env, maxAge: number): string {
  return `Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${env.isHttps ? "; Secure" : ""}`;
}

export async function createState(env: Env): Promise<{ state: string; setCookie: string }> {
  const state = toB64url(crypto.getRandomValues(new Uint8Array(24)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(env.stateKey), utf8.encode(state)),
  );
  const value = `${state}.${toB64url(signature)}`;
  return {
    state,
    setCookie: `${stateCookieName(env.isHttps)}=${value}; ${cookieAttributes(env, STATE_MAX_AGE_S)}`,
  };
}

export function clearStateCookie(env: Env): string {
  return `${stateCookieName(env.isHttps)}=; ${cookieAttributes(env, 0)}`;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function verifyState(
  env: Env,
  cookieHeader: string | null,
  stateParam: string | null,
): Promise<boolean> {
  if (!stateParam) return false;
  const cookie = readCookie(cookieHeader, stateCookieName(env.isHttps));
  if (!cookie) return false;

  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return false;
  const state = cookie.slice(0, dot);
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromB64url(cookie.slice(dot + 1));
  } catch {
    return false;
  }

  const genuine = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(env.stateKey),
    signature,
    utf8.encode(state),
  );
  return genuine && safeEqual(state, stateParam);
}
