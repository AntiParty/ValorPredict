import type { Request } from "express";

import type { AppDatabase } from "./db.js";
import type { SafeUser, User } from "./types.js";

export type FlashMessage = {
  kind: "success" | "error";
  message: string;
};

export type LocalApiKeyReveal = {
  apiKey: string;
  createdAt: string;
};

export function getSessionUser(
  request: Request,
  database: AppDatabase,
): User | undefined {
  const userId = request.session.userId;
  return userId ? database.getUserById(userId) : undefined;
}

export function toSafeUser(user: User): SafeUser {
  const {
    access_token: _accessToken,
    refresh_token: _refreshToken,
    local_api_key_hash: localApiKeyHash,
    ...safe
  } = user;

  return {
    ...safe,
    has_local_api_key: Boolean(localApiKeyHash),
    public_showcase_enabled: Boolean(safe.public_showcase_enabled),
  };
}

export function setFlash(request: Request, flash: FlashMessage): void {
  request.session.flash = flash;
}

export function setErrorFlash(request: Request, error: unknown): void {
  setFlash(request, {
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

export function consumeFlash(request: Request): FlashMessage | undefined {
  const flash = request.session.flash;
  delete request.session.flash;
  return flash;
}

export function consumeLocalApiKeyReveal(
  request: Request,
): LocalApiKeyReveal | undefined {
  const reveal = request.session.localApiKeyReveal;
  delete request.session.localApiKeyReveal;
  return reveal;
}

export function buildDuoUrl(request: Request, token: string): string {
  return `${request.protocol}://${request.get("host")}/duo/${token}`;
}
