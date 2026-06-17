import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import session from "express-session";
import request from "supertest";

import { AppDatabase } from "../src/db.js";
import {
  createLocalApiRouter,
  LocalApiKeyService,
} from "../src/local-api.js";
import type { MatchStartResult } from "../src/predictions.js";
import type { PredictionSession } from "../src/types.js";

function createUser(db: AppDatabase) {
  return db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "twitch-access-secret",
    refreshToken: "twitch-refresh-secret",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
}

function createTestApp(
  db: AppDatabase,
  handleValorantMatchStart: (
    twitchUserId: string,
    source: string,
    gameMode: "competitive" | "custom" | "unknown",
  ) => Promise<MatchStartResult>,
) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-session",
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.get("/login", (req, res) => {
    req.session.userId = createUser(db).id;
    res.sendStatus(204);
  });
  app.use(
    "/api/local",
    createLocalApiRouter(
      db,
      new LocalApiKeyService(db),
      { handleValorantMatchStart },
    ),
  );
  return app;
}

function predictionSession(): PredictionSession {
  return {
    id: 1,
    twitch_user_id: "123",
    status: "prediction_open",
    twitch_prediction_id: "prediction-1",
    outcome_a_id: "outcome-a",
    outcome_b_id: "outcome-b",
    title: "Will ace win?",
    started_at: "2030-01-01T00:00:00.000Z",
    resolved_at: null,
    result: null,
    channel_points_wagered: 0,
    created_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2030-01-01T00:00:00.000Z",
  };
}

function createdResult(): MatchStartResult {
  return {
    action: "prediction_created",
    message: "Twitch prediction created.",
    session: predictionSession(),
  };
}

test("generates vap keys while storing only their hash", () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const keys = new LocalApiKeyService(db);

  const generated = keys.generateForUser("123");
  const stored = db.getUserByTwitchId("123");

  assert.match(generated.apiKey, /^vap_[A-Za-z0-9_-]{43}$/);
  assert.ok(stored?.local_api_key_hash);
  assert.notEqual(stored?.local_api_key_hash, generated.apiKey);
  assert.equal(keys.authenticate(generated.apiKey)?.twitch_login, "ace");
});

test("regenerating a key invalidates the previous key", () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const keys = new LocalApiKeyService(db);

  const first = keys.generateForUser("123").apiKey;
  const second = keys.generateForUser("123").apiKey;

  assert.equal(keys.authenticate(first), undefined);
  assert.equal(keys.authenticate(second)?.twitch_user_id, "123");
});

test("JSON key generation requires login and returns the key once", async () => {
  const db = new AppDatabase(":memory:");
  const app = createTestApp(db, async () => createdResult());

  const unauthorized = await request(app)
    .post("/api/local/generate-key")
    .set("Accept", "application/json");
  assert.equal(unauthorized.status, 401);

  const agent = request.agent(app);
  await agent.get("/login");
  const response = await agent
    .post("/api/local/generate-key")
    .set("Accept", "application/json");
  const serialized = JSON.stringify(response.body);

  assert.equal(response.status, 200);
  assert.match(response.body.apiKey, /^vap_/);
  assert.doesNotMatch(
    serialized,
    /twitch-access-secret|twitch-refresh-secret|local_api_key_hash/,
  );
});

test("ping rejects invalid bearer keys and identifies valid users", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const keys = new LocalApiKeyService(db);
  const apiKey = keys.generateForUser("123").apiKey;
  const app = createTestApp(db, async () => createdResult());

  const missing = await request(app).get("/api/local/ping");
  const invalid = await request(app)
    .get("/api/local/ping")
    .set("Authorization", "Bearer vap_invalid");
  const valid = await request(app)
    .get("/api/local/ping")
    .set("Authorization", `Bearer ${apiKey}`);

  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
  assert.deepEqual(valid.body, {
    ok: true,
    twitchUserId: "123",
    twitchLogin: "ace",
    duoEnabled: false,
  });
});

test("ping reflects when the duo command is enabled", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  db.saveDuoConfig("123", {
    enabled: true,
    template: "Duo: {names}",
    fallbackText: "Solo.",
  });
  const app = createTestApp(db, async () => createdResult());

  const response = await request(app)
    .get("/api/local/ping")
    .set("Authorization", `Bearer ${apiKey}`);

  assert.equal(response.body.duoEnabled, true);
});

test("duo upload stores the party snapshot when enabled", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  db.saveDuoConfig("123", {
    enabled: true,
    template: "Duo: {names}",
    fallbackText: "Solo.",
  });
  const app = createTestApp(db, async () => createdResult());

  const response = await request(app)
    .post("/api/local/duo")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({
      inParty: true,
      members: [
        { riotId: "TenZ#NA1", name: "TenZ" },
        { riotId: "Shroud#000", name: "Shroud" },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.action, "stored");
  const snapshot = db.getDuoPartySnapshot("123");
  assert.equal(snapshot?.in_party, 1);
  assert.deepEqual(JSON.parse(snapshot?.members_json ?? "[]"), [
    { riotId: "TenZ#NA1", name: "TenZ" },
    { riotId: "Shroud#000", name: "Shroud" },
  ]);
});

test("duo upload is ignored when the duo command is disabled", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  const app = createTestApp(db, async () => createdResult());

  const response = await request(app)
    .post("/api/local/duo")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ inParty: true, members: [{ riotId: "TenZ#NA1", name: "TenZ" }] });

  assert.equal(response.status, 200);
  assert.equal(response.body.action, "ignored");
  assert.equal(db.getDuoPartySnapshot("123"), undefined);
});

test("duo upload rejects unauthenticated requests", async () => {
  const db = new AppDatabase(":memory:");
  const app = createTestApp(db, async () => createdResult());

  const response = await request(app)
    .post("/api/local/duo")
    .send({ inParty: false, members: [] });

  assert.equal(response.status, 401);
});

test("duo upload rejects malformed or oversized payloads", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  db.saveDuoConfig("123", {
    enabled: true,
    template: "Duo: {names}",
    fallbackText: "Solo.",
  });
  const app = createTestApp(db, async () => createdResult());

  const tooMany = await request(app)
    .post("/api/local/duo")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({
      inParty: true,
      members: Array.from({ length: 6 }, (_, index) => ({
        riotId: `P${index}#EU`,
        name: `P${index}`,
      })),
    });
  const unknownKey = await request(app)
    .post("/api/local/duo")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ inParty: true, members: [], puuid: "must-not-be-accepted" });
  const badMember = await request(app)
    .post("/api/local/duo")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ inParty: true, members: [{ riotId: "TenZ#NA1" }] });

  assert.equal(tooMany.status, 400);
  assert.equal(unknownKey.status, 400);
  assert.equal(badMember.status, 400);
});

test("match start creates a prediction through the shared service", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const keys = new LocalApiKeyService(db);
  const apiKey = keys.generateForUser("123").apiKey;
  let received:
    | { twitchUserId: string; source: string; gameMode: string }
    | undefined;
  const app = createTestApp(db, async (twitchUserId, source, gameMode) => {
    received = { twitchUserId, source, gameMode };
    return createdResult();
  });

  const response = await request(app)
    .post("/api/local/valorant-match-start")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ gameMode: "competitive" });

  assert.equal(response.status, 200);
  assert.equal(response.body.action, "prediction_created");
  assert.equal(response.body.session.id, 1);
  assert.deepEqual(received, {
    twitchUserId: "123",
    source: "local_companion",
    gameMode: "competitive",
  });
});

test("match start returns ignored service results", async () => {
  for (const message of [
    "No enabled preset exists for this game mode.",
    "A prediction is already active.",
  ]) {
    const db = new AppDatabase(":memory:");
    createUser(db);
    const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
    const app = createTestApp(db, async () => ({
      action: "ignored",
      message,
      session: null,
    }));

    const response = await request(app)
      .post("/api/local/valorant-match-start")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ gameMode: "custom" });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      ok: true,
      action: "ignored",
      message,
      session: null,
    });
  }
});

test("match start returns an error action for unexpected failures", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  const app = createTestApp(db, async () => {
    throw new Error("Twitch API error (500): unavailable");
  });

  const response = await request(app)
    .post("/api/local/valorant-match-start")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ gameMode: "competitive" });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    ok: false,
    action: "error",
    message: "Twitch API error (500): unavailable",
    session: null,
  });
});

test("valorant state records pre-game without creating a prediction", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  let calls = 0;
  const app = createTestApp(db, async () => {
    calls += 1;
    return createdResult();
  });

  const response = await request(app)
    .post("/api/local/valorant-state")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({
      source: "local_companion",
      state: "pre_game",
      gameMode: "competitive",
      confidence: 0.85,
      matchIdHash: "a".repeat(64),
      details: {
        detectionMethod: "simulation",
        region: "na",
        shard: "na",
        evidence: ["simulated_pre_game"],
      },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.action, "state_recorded");
  assert.equal(calls, 0);
});

test("valorant current-game state creates a prediction", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  let received: { source: string; gameMode: string } | undefined;
  const app = createTestApp(
    db,
    async (_twitchUserId, receivedSource, gameMode) => {
      received = { source: receivedSource, gameMode };
      return createdResult();
    },
  );

  const response = await request(app)
    .post("/api/local/valorant-state")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({
      source: "local_companion",
      state: "current_game",
      gameMode: "custom",
      confidence: 0.95,
      matchIdHash: "b".repeat(64),
      details: {
        detectionMethod: "simulation",
        region: "unknown",
        shard: "unknown",
        evidence: ["simulated_current_game"],
      },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.action, "prediction_created");
  assert.deepEqual(received, {
    source: "local_companion",
    gameMode: "custom",
  });
});

test("valorant state accepts unknown as ignored but rejects unsupported modes", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  let calls = 0;
  const app = createTestApp(db, async () => {
    calls += 1;
    return {
      action: "ignored",
      message: "No enabled preset exists for this game mode.",
      session: null,
    };
  });
  const base = {
    source: "local_companion",
    state: "current_game",
    confidence: 0.95,
    matchIdHash: "c".repeat(64),
    details: {
      detectionMethod: "simulation",
      region: "unknown",
      shard: "unknown",
      evidence: ["simulation"],
    },
  };

  const unknown = await request(app)
    .post("/api/local/valorant-state")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ ...base, gameMode: "unknown" });
  const unsupported = await request(app)
    .post("/api/local/valorant-state")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ ...base, gameMode: "unrated" });

  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.action, "ignored");
  assert.equal(unsupported.status, 400);
  assert.equal(calls, 1);
});

test("valorant state rejects unsafe or malformed payloads", async () => {
  const db = new AppDatabase(":memory:");
  createUser(db);
  const apiKey = new LocalApiKeyService(db).generateForUser("123").apiKey;
  const app = createTestApp(db, async () => createdResult());

  const response = await request(app)
    .post("/api/local/valorant-state")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({
      source: "local_companion",
      state: "current_game",
      gameMode: "competitive",
      confidence: 2,
      matchIdHash: "raw-match-id",
      riotToken: "must-not-be-accepted",
      details: { evidence: [] },
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});
