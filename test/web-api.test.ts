import assert from "node:assert/strict";
import test from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { AppDatabase } from "../src/db.js";
import type {
  TwitchPredictionResponse,
  TwitchTokenResponse,
  TwitchUserResponse,
  User,
} from "../src/types.js";

const config = {
  twitchClientId: "client",
  twitchClientSecret: "secret",
  twitchRedirectUri: "http://localhost:3000/auth/twitch/callback",
  sessionSecret: "session-secret",
  databasePath: ":memory:",
  port: 3000,
};

class FakeTwitch {
  buildAuthorizationUrl(state: string): string {
    return `https://id.twitch.tv/oauth2/authorize?state=${state}`;
  }

  async exchangeCode(): Promise<TwitchTokenResponse> {
    return {
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope: ["channel:manage:predictions"],
      token_type: "bearer",
    };
  }

  async getCurrentUser(): Promise<TwitchUserResponse> {
    return {
      id: "123",
      login: "ace",
      display_name: "Ace Player",
      profile_image_url: "https://static.example/ace.png",
    };
  }

  tokenExpiresAt(): string {
    return "2030-01-01T00:00:00.000Z";
  }

  async createPrediction(
    _user: User,
    input: { title: string; outcomeA: string; outcomeB: string },
  ): Promise<TwitchPredictionResponse> {
    return {
      id: "prediction-1",
      title: input.title,
      status: "ACTIVE",
      outcomes: [
        { id: "outcome-a", title: input.outcomeA },
        { id: "outcome-b", title: input.outcomeB },
      ],
    };
  }

  async resolvePrediction(): Promise<TwitchPredictionResponse> {
    return {
      id: "prediction-1",
      title: "Resolved prediction",
      status: "RESOLVED",
      outcomes: [
        { id: "outcome-a", title: "Yes", channel_points: 1250 },
        { id: "outcome-b", title: "No", channel_points: 750 },
      ],
    };
  }

  async cancelPrediction(): Promise<void> {}
}

async function loginAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const authorization = await agent.get("/auth/twitch");
  assert.ok(authorization.headers.location);
  const state = new URL(authorization.headers.location).searchParams.get(
    "state",
  );
  await agent.get(`/auth/twitch/callback?code=oauth-code&state=${state}`);
  return agent;
}

test("GET /api/public returns stats and showcased streamers as JSON", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), {
    developmentMode: false,
  });

  const before = await request(app).get("/api/public");
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, {
    stats: { connectedStreamers: 0, predictionsRun: 0, channelPointsWagered: 0 },
    streamers: [],
  });

  const agent = await loginAgent(app);
  await agent
    .post("/api/settings/public-showcase")
    .set("X-Requested-With", "fetch")
    .send({ enabled: true });

  const after = await request(app).get("/api/public");
  assert.equal(after.body.stats.connectedStreamers, 1);
  assert.equal(after.body.streamers.length, 1);
  assert.equal(after.body.streamers[0].twitch_login, "ace");
});

test("GET /api/me returns null user when logged out and drains the flash", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });

  const response = await request(app).get("/api/me");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { user: null, flash: null });
});

test("GET /api/me exposes the logged-in user and the one-shot OAuth flash once", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });
  const agent = await loginAgent(app);

  const first = await agent.get("/api/me");
  assert.equal(first.status, 200);
  assert.equal(first.body.user.twitch_login, "ace");
  assert.equal(first.body.user.twitch_display_name, "Ace Player");
  assert.equal(first.body.flash.kind, "success");
  assert.match(first.body.flash.message, /Connected to Twitch as ace/);
  assert.equal(first.body.user.access_token, undefined);
  assert.equal(JSON.stringify(first.body).includes("access-secret"), false);

  const second = await agent.get("/api/me");
  assert.equal(second.body.flash, null);
});

test("GET /api/dashboard requires authentication", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });

  const response = await request(app).get("/api/dashboard");
  assert.equal(response.status, 401);
  assert.equal(response.body.ok, false);
});

test("GET /api/dashboard returns presets, duo config, and an absolute duo URL", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: true,
  });
  const agent = await loginAgent(app);

  const response = await agent.get("/api/dashboard");
  assert.equal(response.status, 200);
  assert.equal(response.body.user.twitch_login, "ace");
  assert.equal(response.body.presets.length, 2);
  assert.ok(response.body.duo.config.public_token);
  assert.match(response.body.duo.url, /\/duo\/duo_[A-Za-z0-9_-]+$/);
  assert.equal(response.body.developmentMode, true);
  assert.equal(JSON.stringify(response.body).includes("access-secret"), false);
});

test("mutations reject requests missing the X-Requested-With header", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/presets/competitive")
    .send({ enabled: true });
  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
});

test("POST /api/presets/:gameMode saves a preset and returns the saved record", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), { developmentMode: false });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/presets/competitive")
    .set("X-Requested-With", "fetch")
    .send({
      enabled: true,
      titleTemplate: "Comp for {streamer}?",
      outcomeA: "Win",
      outcomeB: "Loss",
      predictionWindow: 120,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.preset.game_mode, "competitive");
  assert.equal(response.body.preset.outcome_a, "Win");
  assert.equal(response.body.preset.enabled, 1);
  assert.equal(db.getPreset("123", "competitive")?.title_template, "Comp for {streamer}?");
});

test("POST /api/presets/:gameMode rejects an unsupported game mode", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/presets/deathmatch")
    .set("X-Requested-With", "fetch")
    .send({
      enabled: true,
      titleTemplate: "x",
      outcomeA: "a",
      outcomeB: "b",
      predictionWindow: 90,
    });
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("POST /api/presets/:gameMode validates field lengths", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/presets/competitive")
    .set("X-Requested-With", "fetch")
    .send({
      enabled: true,
      titleTemplate: "x".repeat(46),
      outcomeA: "a",
      outcomeB: "b",
      predictionWindow: 90,
    });
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("POST /api/settings/duo saves config and non-blank shoutouts", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), { developmentMode: false });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/settings/duo")
    .set("X-Requested-With", "fetch")
    .send({
      enabled: true,
      template: "Queued with {names}",
      fallbackText: "Just me.",
      shoutouts: [
        { riotId: "TenZ#NA1", display: "the legend TenZ" },
        { riotId: "", display: "blank row ignored" },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(db.getDuoConfig("123")?.enabled, 1);
  assert.equal(db.getDuoConfig("123")?.template, "Queued with {names}");
  const shoutouts = db.getDuoShoutouts("123");
  assert.equal(shoutouts.length, 1);
  assert.equal(shoutouts[0]?.riot_id, "TenZ#NA1");
});

test("POST /api/settings/duo rejects an empty template", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), { developmentMode: false });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/settings/duo")
    .set("X-Requested-With", "fetch")
    .send({ enabled: true, template: "   ", fallbackText: "Solo." });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.equal(db.getDuoConfig("123")?.enabled ?? 0, 0);
});

test("POST /api/settings/duo/regenerate rotates the token and returns the new URL", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), { developmentMode: false });
  const agent = await loginAgent(app);
  const before = db.ensureDuoConfig("123").public_token;

  const response = await agent
    .post("/api/settings/duo/regenerate")
    .set("X-Requested-With", "fetch")
    .send({});

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.notEqual(db.getDuoConfig("123")?.public_token, before);
  assert.match(response.body.url, new RegExp(`/duo/${db.getDuoConfig("123")?.public_token}$`));
});

test("dev simulate route creates a prediction, then resolve and cancel work as JSON", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), { developmentMode: true });
  const agent = await loginAgent(app);

  await agent
    .post("/api/presets/competitive")
    .set("X-Requested-With", "fetch")
    .send({
      enabled: true,
      titleTemplate: "Will {streamer} win?",
      outcomeA: "Yes",
      outcomeB: "No",
      predictionWindow: 90,
    });

  const simulated = await agent
    .post("/api/predictions/simulate-match-start/competitive")
    .set("X-Requested-With", "fetch")
    .send({});
  assert.equal(simulated.status, 200);
  assert.equal(simulated.body.action, "prediction_created");
  assert.equal(db.getActiveSession("123")?.status, "prediction_open");

  const resolved = await agent
    .post("/api/predictions/resolve")
    .set("X-Requested-With", "fetch")
    .send({ winner: "A" });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.ok, true);
  assert.equal(db.getActiveSession("123"), undefined);
});

test("POST /api/predictions/resolve rejects an invalid winner", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/predictions/resolve")
    .set("X-Requested-With", "fetch")
    .send({ winner: "C" });
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("dev-only simulate route is absent in production", async () => {
  const app = createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    developmentMode: false,
  });
  const agent = await loginAgent(app);

  const response = await agent
    .post("/api/predictions/simulate-match-start/competitive")
    .set("X-Requested-With", "fetch")
    .send({});
  assert.equal(response.status, 404);
});
