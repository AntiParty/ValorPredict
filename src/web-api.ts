import { Router, type NextFunction, type Request, type Response } from "express";

import { clampPredictionWindow } from "./config.js";
import type { AppDatabase } from "./db.js";
import type { LocalApiKeyService } from "./local-api.js";
import type { PredictionService } from "./predictions.js";
import {
  buildDuoUrl,
  consumeFlash,
  consumeLocalApiKeyReveal,
  getSessionUser,
  toSafeUser,
} from "./session-helpers.js";
import type { User, ValorantGameMode } from "./types.js";

export interface WebApiDeps {
  database: AppDatabase;
  predictions: PredictionService;
  localApiKeys: LocalApiKeyService;
  developmentMode: boolean;
}

export function createWebApiRouter(deps: WebApiDeps): Router {
  const { database, developmentMode } = deps;
  const router = Router();

  router.get("/public", (_request, response) => {
    response.json({
      stats: database.getPublicStats(),
      streamers: database.getPublicStreamers(),
    });
  });

  router.get("/me", (request, response) => {
    const user = getSessionUser(request, database);
    response.json({
      user: user ? toSafeUser(user) : null,
      flash: consumeFlash(request) ?? null,
    });
  });

  router.get("/dashboard", (request, response) => {
    const user = getSessionUser(request, database);
    if (!user) {
      response.status(401).json({ ok: false, error: "Login required." });
      return;
    }

    const twitchUserId = user.twitch_user_id;
    const duoConfig = database.ensureDuoConfig(twitchUserId);

    response.json({
      user: toSafeUser(user),
      presets: database.ensureDefaultPresets(twitchUserId),
      activeSession: database.getActiveSession(twitchUserId) ?? null,
      events: database.getRecentEvents(twitchUserId, 5),
      localApiKeyReveal: consumeLocalApiKeyReveal(request) ?? null,
      duo: {
        config: duoConfig,
        shoutouts: database.getDuoShoutouts(twitchUserId),
        url: buildDuoUrl(request, duoConfig.public_token),
      },
      developmentMode,
    });
  });

  // Mutating routes require a same-origin fetch header that cross-site HTML
  // forms cannot set, on top of the SameSite=lax session cookie. Applied
  // per-route so unmatched /api/* paths still fall through to a 404.
  router.post(
    "/settings/public-showcase",
    requireFetchHeader,
    (request, response) => {
      const user = requireUser(request, response, deps);
      if (!user) return;

      const enabled = request.body?.enabled === true;
      database.setPublicShowcaseEnabled(user.twitch_user_id, enabled);
      response.json({ ok: true, publicShowcaseEnabled: enabled });
    },
  );

  router.post("/presets/:gameMode", requireFetchHeader, (request, response) => {
    const user = requireUser(request, response, deps);
    if (!user) return;

    const gameMode = parseGameMode(request.params.gameMode);
    if (!gameMode) {
      response.status(400).json({ ok: false, error: "Unsupported game mode." });
      return;
    }

    const parsed = parsePresetBody(request.body);
    if ("error" in parsed) {
      response.status(400).json({ ok: false, error: parsed.error });
      return;
    }

    const preset = database.savePreset(user.twitch_user_id, gameMode, parsed.value);
    response.json({ ok: true, preset });
  });

  router.post("/settings/duo", requireFetchHeader, (request, response) => {
    const user = requireUser(request, response, deps);
    if (!user) return;

    const parsed = parseDuoBody(request.body);
    if ("error" in parsed) {
      response.status(400).json({ ok: false, error: parsed.error });
      return;
    }

    const config = database.saveDuoConfig(user.twitch_user_id, {
      enabled: parsed.value.enabled,
      template: parsed.value.template,
      fallbackText: parsed.value.fallbackText,
    });
    const shoutouts = database.setDuoShoutouts(
      user.twitch_user_id,
      parsed.value.shoutouts,
    );
    response.json({ ok: true, duo: { config, shoutouts } });
  });

  router.post(
    "/settings/duo/regenerate",
    requireFetchHeader,
    (request, response) => {
      const user = requireUser(request, response, deps);
      if (!user) return;

      const token = database.regenerateDuoToken(user.twitch_user_id);
      response.json({
        ok: true,
        publicToken: token,
        url: buildDuoUrl(request, token),
      });
    },
  );

  router.post(
    "/predictions/resolve",
    requireFetchHeader,
    async (request, response) => {
      const user = requireUser(request, response, deps);
      if (!user) return;

      const winner = request.body?.winner;
      if (winner !== "A" && winner !== "B") {
        response.status(400).json({ ok: false, error: "Winner must be A or B." });
        return;
      }

      try {
        await deps.predictions.resolve(user.twitch_user_id, winner);
        response.json({
          ok: true,
          message: `Prediction resolved with outcome ${winner}.`,
        });
      } catch (error) {
        response.status(400).json({ ok: false, error: errorMessage(error) });
      }
    },
  );

  router.post(
    "/predictions/cancel",
    requireFetchHeader,
    async (request, response) => {
      const user = requireUser(request, response, deps);
      if (!user) return;

      try {
        await deps.predictions.cancel(user.twitch_user_id);
        response.json({ ok: true, message: "Prediction cancelled." });
      } catch (error) {
        response.status(400).json({ ok: false, error: errorMessage(error) });
      }
    },
  );

  if (developmentMode) {
    router.post(
      "/predictions/simulate-match-start/:gameMode",
      requireFetchHeader,
      async (request, response) => {
        const user = requireUser(request, response, deps);
        if (!user) return;

        const gameMode = parseGameMode(request.params.gameMode);
        if (!gameMode) {
          response.status(400).json({ ok: false, error: "Unsupported game mode." });
          return;
        }

        try {
          const result = await deps.predictions.handleValorantMatchStart(
            user.twitch_user_id,
            "manual",
            gameMode,
          );
          response.json({ ok: true, ...result });
        } catch (error) {
          response.status(500).json({ ok: false, error: errorMessage(error) });
        }
      },
    );
  }

  return router;
}

function requireFetchHeader(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!request.get("X-Requested-With")) {
    response
      .status(403)
      .json({ ok: false, error: "Missing X-Requested-With header." });
    return;
  }
  next();
}

function requireUser(
  request: Request,
  response: Response,
  deps: WebApiDeps,
): User | undefined {
  const user = getSessionUser(request, deps.database);
  if (!user) {
    response.status(401).json({ ok: false, error: "Login required." });
    return undefined;
  }
  return user;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseGameMode(value: unknown): ValorantGameMode | undefined {
  return value === "competitive" || value === "custom" ? value : undefined;
}

interface PresetValue {
  enabled: boolean;
  titleTemplate: string;
  outcomeA: string;
  outcomeB: string;
  predictionWindow: number;
}

function parsePresetBody(
  body: unknown,
): { value: PresetValue } | { error: string } {
  const value = (body ?? {}) as Record<string, unknown>;
  const titleTemplate = String(value.titleTemplate ?? "").trim();
  const outcomeA = String(value.outcomeA ?? "").trim();
  const outcomeB = String(value.outcomeB ?? "").trim();

  if (!titleTemplate || titleTemplate.length > 45) {
    return { error: "Prediction title must be between 1 and 45 characters." };
  }
  if (!outcomeA || !outcomeB || outcomeA.length > 25 || outcomeB.length > 25) {
    return { error: "Each outcome must be between 1 and 25 characters." };
  }

  return {
    value: {
      enabled: value.enabled === true,
      titleTemplate,
      outcomeA,
      outcomeB,
      predictionWindow: clampPredictionWindow(Number(value.predictionWindow)),
    },
  };
}

interface DuoValue {
  enabled: boolean;
  template: string;
  fallbackText: string;
  shoutouts: Array<{ riotId: string; display: string }>;
}

function parseDuoBody(body: unknown): { value: DuoValue } | { error: string } {
  const value = (body ?? {}) as Record<string, unknown>;
  const template = String(value.template ?? "").trim();
  const fallbackText = String(value.fallbackText ?? "").trim();

  if (!template || template.length > 120) {
    return { error: "Duo template must be between 1 and 120 characters." };
  }
  if (!fallbackText || fallbackText.length > 120) {
    return { error: "Duo fallback text must be between 1 and 120 characters." };
  }

  const shoutouts: Array<{ riotId: string; display: string }> = [];
  const rawShoutouts = Array.isArray(value.shoutouts) ? value.shoutouts : [];
  for (const entry of rawShoutouts) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const riotId = String(row.riotId ?? "").trim();
    const display = String(row.display ?? "").trim();
    if (!riotId) continue;
    if (riotId.length > 64 || !display || display.length > 120) {
      return {
        error:
          "Each shoutout needs a Riot ID (max 64) and message (max 120 characters).",
      };
    }
    shoutouts.push({ riotId, display });
    if (shoutouts.length >= 10) break;
  }

  return {
    value: {
      enabled: value.enabled === true,
      template,
      fallbackText,
      shoutouts,
    },
  };
}
