import crypto from "node:crypto";

import { Router } from "express";

import type { AppDatabase } from "./db.js";
import type {
  TwitchTokenResponse,
  TwitchUserResponse,
} from "./types.js";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    oauthState?: string;
    flash?: { kind: "success" | "error"; message: string };
    localApiKeyReveal?: { apiKey: string; createdAt: string };
  }
}

export interface TwitchAuthActions {
  buildAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<TwitchTokenResponse>;
  getCurrentUser(accessToken: string): Promise<TwitchUserResponse>;
  tokenExpiresAt(expiresInSeconds: number): string;
}

export function createAuthRouter(
  database: AppDatabase,
  twitch: TwitchAuthActions,
): Router {
  const router = Router();

  router.get("/twitch", (request, response) => {
    const state = crypto.randomBytes(24).toString("hex");
    request.session.oauthState = state;
    response.redirect(twitch.buildAuthorizationUrl(state));
  });

  router.get("/twitch/callback", async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const state =
      typeof request.query.state === "string" ? request.query.state : "";

    if (!code || !state || state !== request.session.oauthState) {
      request.session.flash = {
        kind: "error",
        message: "Twitch login could not be verified. Please try again.",
      };
      delete request.session.oauthState;
      response.redirect("/");
      return;
    }

    try {
      const token = await twitch.exchangeCode(code);
      if (!token.scope.includes("channel:manage:predictions")) {
        throw new Error("Twitch did not grant prediction management access.");
      }
      const twitchUser = await twitch.getCurrentUser(token.access_token);
      const user = database.upsertUser({
        twitchUserId: twitchUser.id,
        twitchLogin: twitchUser.login,
        twitchDisplayName: twitchUser.display_name,
        twitchProfileImageUrl: twitchUser.profile_image_url,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: twitch.tokenExpiresAt(token.expires_in),
      });
      database.ensureDefaultSettings(twitchUser.id);
      request.session.userId = user.id;
      request.session.flash = {
        kind: "success",
        message: `Connected to Twitch as ${twitchUser.login}.`,
      };
    } catch (error) {
      request.session.flash = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      delete request.session.oauthState;
    }

    response.redirect(request.session.userId ? "/dashboard" : "/");
  });

  return router;
}
