import "dotenv/config";

import { createServer } from "node:http";
import path from "node:path";

import { createServer as createViteServer } from "vite";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { TwitchClient } from "./twitch.js";

const config = loadConfig();
const database = new AppDatabase(config.databasePath);
const twitch = new TwitchClient(config, database);
const app = createApp(config, database, twitch, {
  developmentMode: true,
  serveStatic: false,
});

const httpServer = createServer(app);

const vite = await createViteServer({
  root: path.resolve("web"),
  server: { middlewareMode: true, hmr: { server: httpServer } },
  appType: "spa",
});

app.use(vite.middlewares);

httpServer.listen(config.port, () => {
  console.log(
    `Valorant Auto Predictions running at http://localhost:${config.port}`,
  );
});
