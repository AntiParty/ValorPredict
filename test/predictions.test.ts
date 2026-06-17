import assert from "node:assert/strict";
import test from "node:test";

import { AppDatabase } from "../src/db.js";
import { PredictionService } from "../src/predictions.js";
import type { TwitchPredictionResponse, User } from "../src/types.js";

function setup(
  mode: "competitive" | "custom" = "competitive",
  enabled = true,
) {
  const db = new AppDatabase(":memory:");
  const user = db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
  db.ensureDefaultPresets("123");
  db.savePreset("123", mode, {
    enabled,
    titleTemplate: `Will {streamer} clutch this ${mode} match?`,
    outcomeA: `${mode} yes`,
    outcomeB: `${mode} no`,
    predictionWindow: 5000,
  });
  return { db, user };
}

function fakePrediction(
  mode: "competitive" | "custom" = "competitive",
): TwitchPredictionResponse {
  return {
    id: "prediction-1",
    title: `Will ace clutch this ${mode} match?`,
    status: "ACTIVE",
    outcomes: [
      { id: "outcome-a", title: `${mode} yes` },
      { id: "outcome-b", title: `${mode} no` },
    ],
  };
}

test("match start ignores disabled and unknown modes without Twitch calls", async () => {
  const { db } = setup("competitive", false);
  let calls = 0;
  const service = new PredictionService(db, {
    createPrediction: async () => {
      calls += 1;
      return fakePrediction();
    },
    resolvePrediction: async () => fakePrediction(),
    cancelPrediction: async () => {},
  });

  const disabled = await service.handleValorantMatchStart(
    "123",
    "manual",
    "competitive",
  );
  const unknown = await service.handleValorantMatchStart(
    "123",
    "manual",
    "unknown",
  );

  assert.equal(disabled.action, "ignored");
  assert.equal(unknown.action, "ignored");
  assert.equal(calls, 0);
});

test("match start uses only the preset matching the detected mode", async () => {
  const { db } = setup("custom");
  let received:
    | {
        user: User;
        title: string;
        predictionWindow: number;
      }
    | undefined;
  const service = new PredictionService(db, {
    createPrediction: async (user, input) => {
      received = {
        user,
        title: input.title,
        predictionWindow: input.predictionWindow,
      };
      return fakePrediction("custom");
    },
    resolvePrediction: async () => fakePrediction(),
    cancelPrediction: async () => {},
  });

  const result = await service.handleValorantMatchStart(
    "123",
    "manual",
    "custom",
  );

  assert.equal(received?.title, "Will ace clutch this custom match?");
  assert.equal(received?.predictionWindow, 1800);
  assert.equal(result.action, "prediction_created");
  assert.equal(result.session?.status, "prediction_open");
  assert.equal(result.session?.outcome_a_id, "outcome-a");

  const active = await service.handleValorantMatchStart(
    "123",
    "manual",
    "custom",
  );
  assert.equal(active.action, "ignored");
  assert.match(active.message, /already active/i);
});

test("failed Twitch creation is logged and does not remain active", async () => {
  const { db } = setup();
  const service = new PredictionService(db, {
    createPrediction: async () => {
      throw new Error("Twitch API error (400): nope");
    },
    resolvePrediction: async () => fakePrediction(),
    cancelPrediction: async () => {},
  });

  await assert.rejects(
    () =>
      service.handleValorantMatchStart("123", "manual", "competitive"),
    /Twitch API error/,
  );
  assert.equal(db.getActiveSession("123"), undefined);
  assert.match(db.getRecentEvents("123")[0]?.message ?? "", /nope/);
});

test("resolve and cancel update Twitch before closing local sessions", async () => {
  const { db } = setup();
  const actions: string[] = [];
  const service = new PredictionService(db, {
    createPrediction: async () => fakePrediction(),
    resolvePrediction: async (_user, predictionId, outcomeId) => {
      actions.push(`resolve:${predictionId}:${outcomeId}`);
      return {
        ...fakePrediction(),
        status: "RESOLVED",
        outcomes: [
          {
            id: "outcome-a",
            title: "competitive yes",
            channel_points: 3000,
          },
          {
            id: "outcome-b",
            title: "competitive no",
            channel_points: 1200,
          },
        ],
      };
    },
    cancelPrediction: async (_user, predictionId) => {
      actions.push(`cancel:${predictionId}`);
    },
  });

  await service.handleValorantMatchStart("123", "manual", "competitive");
  const resolved = await service.resolve("123", "A");
  assert.equal(actions[0], "resolve:prediction-1:outcome-a");
  assert.equal(resolved.result, "outcome_a");
  assert.equal(resolved.channel_points_wagered, 4200);

  await service.handleValorantMatchStart("123", "manual", "competitive");
  const cancelled = await service.cancel("123");
  assert.equal(actions[1], "cancel:prediction-1");
  assert.equal(cancelled.status, "cancelled");
});
