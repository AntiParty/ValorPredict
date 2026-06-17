import assert from "node:assert/strict";
import test from "node:test";

import { AppDatabase } from "../src/db.js";
import { TwitchClient } from "../src/twitch.js";

const config = {
  twitchClientId: "client-id",
  twitchClientSecret: "client-secret",
  twitchRedirectUri: "http://localhost:3000/auth/twitch/callback",
  sessionSecret: "session-secret",
  databasePath: ":memory:",
  port: 3000,
};

test("buildAuthorizationUrl includes required scopes and state", () => {
  const client = new TwitchClient(config, new AppDatabase(":memory:"));
  const url = new URL(client.buildAuthorizationUrl("random-state"));

  assert.equal(url.searchParams.get("state"), "random-state");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.deepEqual(
    url.searchParams.get("scope")?.split(" ").sort(),
    ["channel:manage:predictions", "channel:read:predictions"],
  );
});

test("createPrediction refreshes an expiring token and persists it", async () => {
  const db = new AppDatabase(":memory:");
  db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
  });

  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get("Authorization"),
    });

    if (url.includes("/oauth2/token")) {
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: ["channel:manage:predictions"],
        token_type: "bearer",
      });
    }

    return Response.json({
      data: [
        {
          id: "prediction-1",
          title: "Will ace win?",
          status: "ACTIVE",
          outcomes: [
            { id: "outcome-a", title: "Yes" },
            { id: "outcome-b", title: "No" },
          ],
        },
      ],
    });
  };

  const client = new TwitchClient(config, db, fakeFetch);
  const prediction = await client.createPrediction(
    db.getUserByTwitchId("123")!,
    {
      title: "Will ace win?",
      outcomeA: "Yes",
      outcomeB: "No",
      predictionWindow: 90,
    },
  );

  assert.equal(prediction.id, "prediction-1");
  assert.equal(requests[1]?.authorization, "Bearer new-access");
  assert.equal(db.getUserByTwitchId("123")?.access_token, "new-access");
});

test("Helix errors include Twitch's response message", async () => {
  const db = new AppDatabase(":memory:");
  const user = db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const fakeFetch: typeof fetch = async () =>
    Response.json(
      { error: "Bad Request", status: 400, message: "Prediction already active" },
      { status: 400 },
    );

  const client = new TwitchClient(config, db, fakeFetch);

  await assert.rejects(
    () =>
      client.createPrediction(user, {
        title: "Will ace win?",
        outcomeA: "Yes",
        outcomeB: "No",
        predictionWindow: 90,
      }),
    /Twitch API error \(400\): Prediction already active/,
  );
});

test("resolvePrediction returns Twitch outcome point totals", async () => {
  const db = new AppDatabase(":memory:");
  const user = db.upsertUser({
    twitchUserId: "123",
    twitchLogin: "ace",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const fakeFetch: typeof fetch = async () =>
    Response.json({
      data: [
        {
          id: "prediction-1",
          title: "Will ace win?",
          status: "RESOLVED",
          outcomes: [
            { id: "outcome-a", title: "Yes", channel_points: 900 },
            { id: "outcome-b", title: "No", channel_points: 600 },
          ],
        },
      ],
    });
  const client = new TwitchClient(config, db, fakeFetch);

  const prediction = await client.resolvePrediction(
    user,
    "prediction-1",
    "outcome-a",
  );

  assert.equal(prediction.status, "RESOLVED");
  assert.equal(
    prediction.outcomes.reduce(
      (total, outcome) => total + (outcome.channel_points ?? 0),
      0,
    ),
    1500,
  );
});
