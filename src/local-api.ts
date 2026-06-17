import crypto from "node:crypto";

import { Router, type Request } from "express";

import type { AppDatabase } from "./db.js";
import type { MatchStartResult } from "./predictions.js";
import type { User, ValorantGameMode } from "./types.js";

interface MatchStartActions {
  handleValorantMatchStart(
    twitchUserId: string,
    source: string,
    gameMode: ValorantGameMode | "unknown",
  ): Promise<MatchStartResult>;
}

interface GeneratedLocalApiKey {
  apiKey: string;
  createdAt: string;
}

export class LocalApiKeyService {
  constructor(private readonly database: AppDatabase) {}

  generateForUser(twitchUserId: string): GeneratedLocalApiKey {
    const apiKey = `vap_${crypto.randomBytes(32).toString("base64url")}`;
    const createdAt = new Date().toISOString();
    this.database.saveLocalApiKey(
      twitchUserId,
      this.hash(apiKey),
      createdAt,
    );
    return { apiKey, createdAt };
  }

  authenticate(apiKey: string): User | undefined {
    if (!/^vap_[A-Za-z0-9_-]{43}$/.test(apiKey)) return undefined;
    const candidateHash = this.hash(apiKey);
    const user = this.database.getUserByLocalApiKeyHash(candidateHash);
    if (!user?.local_api_key_hash) return undefined;

    const candidate = Buffer.from(candidateHash, "hex");
    const stored = Buffer.from(user.local_api_key_hash, "hex");
    return candidate.length === stored.length &&
      crypto.timingSafeEqual(candidate, stored)
      ? user
      : undefined;
  }

  authenticateRequest(request: Request): User | undefined {
    const authorization = request.get("Authorization");
    const match = authorization?.match(/^Bearer (vap_[A-Za-z0-9_-]{43})$/);
    return match?.[1] ? this.authenticate(match[1]) : undefined;
  }

  private hash(apiKey: string): string {
    return crypto.createHash("sha256").update(apiKey).digest("hex");
  }
}

export function createLocalApiRouter(
  database: AppDatabase,
  keys: LocalApiKeyService,
  predictions: MatchStartActions,
): Router {
  const router = Router();

  router.post("/generate-key", (request, response) => {
    const user = request.session.userId
      ? database.getUserById(request.session.userId)
      : undefined;
    if (!user) {
      if (acceptsJson(request)) {
        response.status(401).json({ ok: false, error: "Login required." });
      } else {
        request.session.flash = {
          kind: "error",
          message: "Connect Twitch first.",
        };
        response.redirect("/dashboard");
      }
      return;
    }

    const generated = keys.generateForUser(user.twitch_user_id);
    if (acceptsJson(request)) {
      response.json({ ok: true, ...generated });
      return;
    }

    request.session.localApiKeyReveal = generated;
    response.redirect("/dashboard");
  });

  router.get("/ping", (request, response) => {
    const user = keys.authenticateRequest(request);
    if (!user) {
      response
        .status(401)
        .json({ ok: false, error: "Invalid local API key." });
      return;
    }
    response.json({
      ok: true,
      twitchUserId: user.twitch_user_id,
      twitchLogin: user.twitch_login,
      duoEnabled: Boolean(database.getDuoConfig(user.twitch_user_id)?.enabled),
    });
  });

  router.post("/duo", (request, response) => {
    const user = keys.authenticateRequest(request);
    if (!user) {
      response
        .status(401)
        .json({ ok: false, error: "Invalid local API key." });
      return;
    }

    const payload = validateDuoPayload(request.body);
    if (!payload) {
      response.status(400).json({
        ok: false,
        action: "error",
        message: "Invalid or unsafe duo payload.",
      });
      return;
    }

    if (!database.getDuoConfig(user.twitch_user_id)?.enabled) {
      response.json({
        ok: true,
        action: "ignored",
        message: "Duo command is disabled.",
      });
      return;
    }

    database.saveDuoPartySnapshot(user.twitch_user_id, payload);
    response.json({
      ok: true,
      action: "stored",
      accepted: payload.members.length,
    });
  });

  router.post("/valorant-match-start", async (request, response) => {
    const user = keys.authenticateRequest(request);
    if (!user) {
      response
        .status(401)
        .json({ ok: false, error: "Invalid local API key." });
      return;
    }

    const gameMode = supportedGameMode(request.body?.gameMode);
    if (!gameMode) {
      response.json({
        ok: true,
        action: "ignored",
        message: "No enabled preset exists for this game mode.",
        session: null,
      });
      return;
    }
    await respondToMatchStart(
      response,
      predictions,
      user.twitch_user_id,
      gameMode,
    );
  });

  router.post("/valorant-state", async (request, response) => {
    const user = keys.authenticateRequest(request);
    if (!user) {
      response
        .status(401)
        .json({ ok: false, error: "Invalid local API key." });
      return;
    }
    const payload = validateValorantStatePayload(request.body);
    if (!payload) {
      response.status(400).json({
        ok: false,
        action: "error",
        message: "Invalid or unsafe Valorant state payload.",
        session: null,
      });
      return;
    }

    if (payload.state !== "current_game") {
      response.json({
        ok: true,
        action: "state_recorded",
        message: `Valorant state recorded: ${payload.state}.`,
        session: null,
      });
      return;
    }

    await respondToMatchStart(
      response,
      predictions,
      user.twitch_user_id,
      payload.gameMode,
    );
  });

  return router;
}

function acceptsJson(request: Request): boolean {
  return request.get("Accept")?.includes("application/json") ?? false;
}

const valorantStates = new Set([
  "unknown",
  "not_running",
  "menus",
  "pre_game",
  "current_game",
  "post_game",
]);
const valorantGameModes = new Set(["competitive", "custom", "unknown"]);

function validateValorantStatePayload(body: unknown):
  | {
      source: "local_companion";
      state: string;
      gameMode: ValorantGameMode | "unknown";
      confidence: number;
      matchIdHash?: string;
    }
  | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  const allowedTopLevel = new Set([
    "source",
    "state",
    "gameMode",
    "confidence",
    "matchIdHash",
    "details",
  ]);
  if (Object.keys(value).some((key) => !allowedTopLevel.has(key))) return undefined;
  if (
    value.source !== "local_companion" ||
    typeof value.state !== "string" ||
    !valorantStates.has(value.state) ||
    typeof value.gameMode !== "string" ||
    !valorantGameModes.has(value.gameMode) ||
    typeof value.confidence !== "number" ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    return undefined;
  }
  if (
    value.matchIdHash !== undefined &&
    (typeof value.matchIdHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.matchIdHash))
  ) {
    return undefined;
  }
  if (!value.details || typeof value.details !== "object" || Array.isArray(value.details)) {
    return undefined;
  }
  const details = value.details as Record<string, unknown>;
  const allowedDetails = new Set([
    "detectionMethod",
    "region",
    "shard",
    "evidence",
  ]);
  if (Object.keys(details).some((key) => !allowedDetails.has(key))) return undefined;
  if (
    typeof details.detectionMethod !== "string" ||
    typeof details.region !== "string" ||
    typeof details.shard !== "string" ||
    !Array.isArray(details.evidence) ||
    !details.evidence.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return {
    source: "local_companion",
    state: value.state,
    gameMode: value.gameMode as ValorantGameMode | "unknown",
    confidence: value.confidence,
    ...(typeof value.matchIdHash === "string"
      ? { matchIdHash: value.matchIdHash }
      : {}),
  };
}

function validateDuoPayload(
  body: unknown,
): { inParty: boolean; members: Array<{ riotId: string; name: string }> } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  const allowedTopLevel = new Set(["inParty", "members"]);
  if (Object.keys(value).some((key) => !allowedTopLevel.has(key))) {
    return undefined;
  }
  if (typeof value.inParty !== "boolean" || !Array.isArray(value.members)) {
    return undefined;
  }
  if (value.members.length > 5) return undefined;

  const members: Array<{ riotId: string; name: string }> = [];
  for (const entry of value.members) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const member = entry as Record<string, unknown>;
    const allowedMember = new Set(["riotId", "name"]);
    if (Object.keys(member).some((key) => !allowedMember.has(key))) {
      return undefined;
    }
    if (
      typeof member.riotId !== "string" ||
      member.riotId.length < 1 ||
      member.riotId.length > 64 ||
      typeof member.name !== "string" ||
      member.name.length < 1 ||
      member.name.length > 64
    ) {
      return undefined;
    }
    members.push({ riotId: member.riotId, name: member.name });
  }

  return { inParty: value.inParty, members };
}

async function respondToMatchStart(
  response: import("express").Response,
  predictions: MatchStartActions,
  twitchUserId: string,
  gameMode: ValorantGameMode | "unknown",
): Promise<void> {
  try {
    const result = await predictions.handleValorantMatchStart(
      twitchUserId,
      "local_companion",
      gameMode,
    );
    response.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response
      .status(500)
      .json({ ok: false, action: "error", message, session: null });
  }
}

function supportedGameMode(value: unknown): ValorantGameMode | undefined {
  return value === "competitive" || value === "custom" ? value : undefined;
}
