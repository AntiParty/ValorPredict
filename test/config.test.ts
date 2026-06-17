import assert from "node:assert/strict";
import test from "node:test";

import { clampPredictionWindow, loadConfig } from "../src/config.js";

test("clampPredictionWindow limits values to Twitch bounds", () => {
  assert.equal(clampPredictionWindow(10), 30);
  assert.equal(clampPredictionWindow(90), 90);
  assert.equal(clampPredictionWindow(5000), 1800);
});

test("loadConfig rejects missing Twitch credentials", () => {
  assert.throws(
    () =>
      loadConfig({
        TWITCH_CLIENT_ID: "",
        TWITCH_CLIENT_SECRET: "",
        TWITCH_REDIRECT_URI: "http://localhost:3000/auth/twitch/callback",
        SESSION_SECRET: "test-secret",
      }),
    /TWITCH_CLIENT_ID/,
  );
});

test("loadConfig applies local defaults", () => {
  const config = loadConfig({
    TWITCH_CLIENT_ID: "client",
    TWITCH_CLIENT_SECRET: "secret",
    TWITCH_REDIRECT_URI: "http://localhost:3000/auth/twitch/callback",
    SESSION_SECRET: "session",
  });

  assert.equal(config.port, 3000);
  assert.equal(config.databasePath, "./data/valorant-auto-predictions.sqlite");
});
