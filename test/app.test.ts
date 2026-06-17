import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const webDistPath = path.join(here, "fixtures", "web-dist");

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
      scope: ["channel:manage:predictions", "channel:read:predictions"],
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

function createTestApp(overrides: { developmentMode?: boolean } = {}) {
  return createApp(config, new AppDatabase(":memory:"), new FakeTwitch(), {
    webDistPath,
    ...overrides,
  });
}

test("serves the SPA shell at the root", async () => {
  const app = createTestApp({ developmentMode: false });

  const response = await request(app).get("/");

  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /text\/html/);
  assert.match(response.text, /<div id="root"><\/div>/);
  assert.match(response.text, /Valorant Auto Predictions/);
});

test("serves the SPA shell for deep links so the client router can take over", async () => {
  const app = createTestApp({ developmentMode: false });

  // Even unauthenticated: the SPA's ProtectedRoute decides what to render.
  const response = await request(app).get("/dashboard");

  assert.equal(response.status, 200);
  assert.match(response.text, /<div id="root"><\/div>/);
});

test("serves built static assets", async () => {
  const app = createTestApp({ developmentMode: false });

  const response = await request(app).get("/assets/index.js");

  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /javascript/);
});

test("unknown API routes 404 instead of falling back to the SPA shell", async () => {
  const app = createTestApp({ developmentMode: false });

  const response = await request(app).get("/api/does-not-exist");

  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text ?? "", /<div id="root">/);
});

test("development debug endpoint works while logged out", async () => {
  const app = createTestApp({ developmentMode: true });

  const debug = await request(app).get("/api/debug");

  assert.equal(debug.status, 200);
  assert.deepEqual(debug.body, {
    user: null,
    presets: [],
    activeSession: null,
    recentEvents: [],
  });
});

test("production omits the debug endpoint", async () => {
  const app = createTestApp({ developmentMode: false });

  const debug = await request(app).get("/api/debug");

  assert.equal(debug.status, 404);
});

test("OAuth login redirects into the SPA dashboard route", async () => {
  const app = createTestApp({ developmentMode: false });
  const agent = request.agent(app);

  const authorization = await agent.get("/auth/twitch");
  assert.ok(authorization.headers.location);
  const state = new URL(authorization.headers.location).searchParams.get("state");

  const callback = await agent.get(
    `/auth/twitch/callback?code=oauth-code&state=${state}`,
  );

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, "/dashboard");
});

test("OAuth callback rejects a mismatched state", async () => {
  const app = createTestApp();

  const response = await request(app).get(
    "/auth/twitch/callback?code=oauth-code&state=wrong",
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/");
});

test("public duo endpoint serves chatbot plain text with shoutouts", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), {
    developmentMode: false,
    webDistPath,
  });

  db.saveDuoConfig("123", {
    enabled: true,
    template: "Duo: {names}",
    fallbackText: "Solo grind.",
  });
  db.setDuoShoutouts("123", [
    { riotId: "TenZ#NA1", display: "the legend TenZ" },
  ]);
  db.saveDuoPartySnapshot("123", {
    inParty: true,
    members: [
      { riotId: "TenZ#NA1", name: "TenZ" },
      { riotId: "Shroud#000", name: "Shroud" },
    ],
  });
  const token = db.getDuoConfig("123")!.public_token;

  const response = await request(app).get(`/duo/${token}`);

  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /text\/plain/);
  assert.equal(response.text, "Duo: the legend TenZ, Shroud");
});

test("public duo endpoint serves the fallback when disabled", async () => {
  const db = new AppDatabase(":memory:");
  const app = createApp(config, db, new FakeTwitch(), {
    developmentMode: false,
    webDistPath,
  });
  const duo = db.saveDuoConfig("123", {
    enabled: false,
    template: "Duo: {names}",
    fallbackText: "Solo grind.",
  });

  const response = await request(app).get(`/duo/${duo.public_token}`);

  assert.equal(response.status, 200);
  assert.equal(response.text, "Solo grind.");
});

test("public duo endpoint 404s an unknown token", async () => {
  const app = createTestApp({ developmentMode: false });

  const response = await request(app).get("/duo/duo_unknown_token");

  assert.equal(response.status, 404);
});
