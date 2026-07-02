import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { TwitchClient } from "./twitch.js";

const config = loadConfig();
const database = new AppDatabase(config.databasePath);
const twitch = new TwitchClient(config, database);

// Production runs the compiled server (dist/src/index.js) with the SPA folded
// into dist/public, so resolve it relative to this file rather than the cwd.
// Development serves the latest local web build from web/dist.
const isProduction = process.env.NODE_ENV === "production";
const webDistPath = isProduction
  ? fileURLToPath(new URL("../public", import.meta.url))
  : path.resolve("web", "dist");

const app = createApp(config, database, twitch, { webDistPath });

app.listen(config.port, () => {
  console.log(
    `Valorant Auto Predictions running at http://localhost:${config.port}`,
  );
});
