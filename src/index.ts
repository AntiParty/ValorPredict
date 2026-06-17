import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { TwitchClient } from "./twitch.js";

const config = loadConfig();
const database = new AppDatabase(config.databasePath);
const twitch = new TwitchClient(config, database);
const app = createApp(config, database, twitch);

app.listen(config.port, () => {
  console.log(
    `Valorant Auto Predictions running at http://localhost:${config.port}`,
  );
});
