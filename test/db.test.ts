import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { AppDatabase } from "../src/db.js";

function createDatabase() {
  return new AppDatabase(":memory:");
}

test("upserts users and creates one disabled preset per supported mode", () => {
  const db = createDatabase();
  const user = db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    twitchDisplayName: "Ace Player",
    twitchProfileImageUrl: "https://static.example/ace.png",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });

  const presets = db.ensureDefaultPresets("123");
  db.ensureDefaultPresets("123");

  assert.equal(user.twitch_login, "ace");
  assert.equal(user.twitch_display_name, "Ace Player");
  assert.equal(user.public_showcase_enabled, 0);
  assert.deepEqual(
    presets.map((preset) => preset.game_mode),
    ["competitive", "custom"],
  );
  assert.ok(presets.every((preset) => preset.enabled === 0));
  assert.equal(
    db.getPreset("123", "competitive")?.title_template,
    "Will {streamer} win this Valorant match?",
  );
  assert.equal(db.getPreset("123", "custom")?.prediction_window, 90);
  assert.equal(db.getPresets("123").length, 2);
});

test("saves Competitive and Custom presets independently", () => {
  const db = createDatabase();
  db.ensureDefaultPresets("123");

  db.savePreset("123", "custom", {
    enabled: true,
    titleTemplate: "Will {streamer} win the custom?",
    outcomeA: "Custom yes",
    outcomeB: "Custom no",
    predictionWindow: 120,
  });

  assert.equal(db.getPreset("123", "custom")?.enabled, 1);
  assert.equal(db.getPreset("123", "custom")?.outcome_a, "Custom yes");
  assert.equal(db.getPreset("123", "competitive")?.enabled, 0);
  assert.equal(db.getPreset("123", "competitive")?.outcome_a, "Yes");
});

test("migrates legacy settings into Competitive and creates disabled Custom", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vap-presets-"));
  const databasePath = path.join(directory, "legacy.sqlite");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE auto_prediction_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twitch_user_id TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      title_template TEXT NOT NULL,
      outcome_a TEXT NOT NULL,
      outcome_b TEXT NOT NULL,
      prediction_window INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO auto_prediction_settings (
      twitch_user_id, enabled, title_template, outcome_a, outcome_b, prediction_window
    ) VALUES (
      '123', 1, 'Legacy {streamer} title', 'Legacy A', 'Legacy B', 300
    );
  `);
  legacy.close();

  const db = new AppDatabase(databasePath);
  const competitive = db.getPreset("123", "competitive");
  const custom = db.getPreset("123", "custom");

  assert.equal(competitive?.enabled, 1);
  assert.equal(competitive?.title_template, "Legacy {streamer} title");
  assert.equal(competitive?.prediction_window, 300);
  assert.equal(custom?.enabled, 0);
  assert.equal(db.getPresets("123").length, 2);

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("finds only active prediction sessions", () => {
  const db = createDatabase();
  const session = db.createPredictionSession("123", "A title");

  assert.equal(db.getActiveSession("123")?.id, session.id);

  db.updatePredictionSession(session.id, {
    status: "cancelled",
    resolvedAt: "2030-01-01T00:00:00.000Z",
    result: "cancelled",
  });

  assert.equal(db.getActiveSession("123"), undefined);
});

test("debug state never exposes OAuth tokens", () => {
  const db = createDatabase();
  db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
  db.ensureDefaultPresets("123");

  const state = db.getDebugState("123");
  const serialized = JSON.stringify(state);

  assert.equal(state.user?.twitch_login, "ace");
  assert.doesNotMatch(serialized, /secret-access|secret-refresh/);
});

test("migrates existing user tables with local API key columns", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vap-db-"));
  const databasePath = path.join(directory, "legacy.sqlite");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twitch_user_id TEXT NOT NULL UNIQUE,
      twitch_login TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  legacy.close();

  const db = new AppDatabase(databasePath);
  db.close();

  const migrated = new Database(databasePath);
  const columns = migrated
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((column) => (column as { name: string }).name);
  migrated.close();
  fs.rmSync(directory, { recursive: true, force: true });

  assert.ok(columns.includes("local_api_key_hash"));
  assert.ok(columns.includes("local_api_key_created_at"));
  assert.ok(columns.includes("twitch_display_name"));
  assert.ok(columns.includes("twitch_profile_image_url"));
  assert.ok(columns.includes("public_showcase_enabled"));
});

test("stores and finds local API key hashes without exposing them", () => {
  const db = createDatabase();
  db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });

  db.saveLocalApiKey("123", "hash-secret", "2030-01-02T00:00:00.000Z");

  assert.equal(
    db.getUserByLocalApiKeyHash("hash-secret")?.twitch_login,
    "ace",
  );
  const state = db.getDebugState("123");
  assert.equal(state.user?.has_local_api_key, true);
  assert.equal(
    state.user?.local_api_key_created_at,
    "2030-01-02T00:00:00.000Z",
  );
  assert.doesNotMatch(JSON.stringify(state), /hash-secret/);
});

test("public stats count real predictions, wagered points, and opted-in streamers", () => {
  const db = createDatabase();
  db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    twitchDisplayName: "Ace Player",
    twitchProfileImageUrl: "https://static.example/ace.png",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
  db.upsertUser({
    twitchUserId: "456",
    twitchLogin: "hidden",
    twitchDisplayName: "Hidden User",
    twitchProfileImageUrl: null,
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
  db.setPublicShowcaseEnabled("123", true);
  const session = db.createPredictionSession("123", "Will ace win?");
  db.updatePredictionSession(session.id, {
    status: "resolved",
    twitchPredictionId: "prediction-1",
    resolvedAt: "2030-01-01T00:00:00.000Z",
    result: "outcome_a",
    channelPointsWagered: 4200,
  });

  assert.deepEqual(db.getPublicStats(), {
    connectedStreamers: 2,
    predictionsRun: 1,
    channelPointsWagered: 4200,
  });
  assert.deepEqual(db.getPublicStreamers(), [
    {
      twitch_login: "ace",
      twitch_display_name: "Ace Player",
      twitch_profile_image_url: "https://static.example/ace.png",
    },
  ]);
});

test("ensures a duo config with a unique token and safe defaults", () => {
  const db = createDatabase();

  const first = db.ensureDuoConfig("123");
  const again = db.ensureDuoConfig("123");

  assert.match(first.public_token, /^duo_[A-Za-z0-9_-]{32}$/);
  assert.equal(first.enabled, 0);
  assert.equal(first.template, "Currently queued with: {names}");
  assert.equal(first.fallback_text, "Not queued with anyone right now.");
  assert.equal(again.public_token, first.public_token);
});

test("saves duo config fields and regenerates the public token", () => {
  const db = createDatabase();
  const original = db.ensureDuoConfig("123").public_token;

  db.saveDuoConfig("123", {
    enabled: true,
    template: "Duo: {names}",
    fallbackText: "Solo queue grind.",
  });

  const saved = db.getDuoConfig("123");
  assert.equal(saved?.enabled, 1);
  assert.equal(saved?.template, "Duo: {names}");
  assert.equal(saved?.fallback_text, "Solo queue grind.");
  assert.equal(db.getDuoConfigByToken(original)?.twitch_user_id, "123");

  const regenerated = db.regenerateDuoToken("123");
  assert.notEqual(regenerated, original);
  assert.equal(db.getDuoConfigByToken(original), undefined);
  assert.equal(db.getDuoConfigByToken(regenerated)?.twitch_user_id, "123");
});

test("replaces duo shoutouts as a set", () => {
  const db = createDatabase();
  db.ensureDuoConfig("123");

  db.setDuoShoutouts("123", [
    { riotId: "TenZ#NA1", display: "the legend TenZ" },
    { riotId: "Shroud#000", display: "Shroud himself" },
  ]);
  assert.equal(db.getDuoShoutouts("123").length, 2);

  db.setDuoShoutouts("123", [{ riotId: "TenZ#NA1", display: "TenZ <3" }]);
  const shoutouts = db.getDuoShoutouts("123");
  assert.equal(shoutouts.length, 1);
  assert.equal(shoutouts[0]?.riot_id, "TenZ#NA1");
  assert.equal(shoutouts[0]?.display, "TenZ <3");
});

test("records and reads the duo party snapshot", () => {
  const db = createDatabase();

  db.saveDuoPartySnapshot("123", {
    inParty: true,
    members: [{ riotId: "TenZ#NA1", name: "TenZ" }],
  });

  const snapshot = db.getDuoPartySnapshot("123");
  assert.equal(snapshot?.in_party, 1);
  assert.deepEqual(JSON.parse(snapshot?.members_json ?? "[]"), [
    { riotId: "TenZ#NA1", name: "TenZ" },
  ]);
  assert.ok(snapshot?.updated_at);
});
