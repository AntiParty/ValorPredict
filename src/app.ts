import path from "node:path";

import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";

import { createAuthRouter, type TwitchAuthActions } from "./auth.js";
import { type AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { renderDuoText } from "./duo.js";
import { createLocalApiRouter, LocalApiKeyService } from "./local-api.js";
import {
  PredictionService,
  type TwitchPredictionActions,
} from "./predictions.js";
import { getSessionUser } from "./session-helpers.js";
import type { DuoMember } from "./types.js";
import { createWebApiRouter } from "./web-api.js";

type TwitchActions = TwitchAuthActions & TwitchPredictionActions;

interface AppRuntimeOptions {
  developmentMode?: boolean;
  webDistPath?: string;
  serveStatic?: boolean;
}

export function createApp(
  config: AppConfig,
  database: AppDatabase,
  twitch: TwitchActions,
  options: AppRuntimeOptions = {},
) {
  const app = express();

  const predictions = new PredictionService(database, twitch);
  const localApiKeys = new LocalApiKeyService(database);

  const developmentMode =
    options.developmentMode ?? process.env.NODE_ENV !== "production";
  const webDistPath = options.webDistPath ?? path.resolve("web", "dist");

  app.disable("x-powered-by");

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use("/auth", createAuthRouter(database, twitch));
  app.use("/api/local", createLocalApiRouter(database, localApiKeys, predictions));
  app.use(
    "/api",
    createWebApiRouter({ database, predictions, localApiKeys, developmentMode }),
  );

  // Public chatbot endpoint: plain text the streamer's bot can urlfetch. Stays
  // server-rendered (never part of the SPA).
  app.get("/duo/:token", (request, response) => {
    const duoConfig = database.getDuoConfigByToken(request.params.token);
    if (!duoConfig) {
      response.status(404).type("text/plain; charset=utf-8").send("Not found.");
      return;
    }

    response.type("text/plain; charset=utf-8");
    response.set("Cache-Control", "no-store");

    if (!duoConfig.enabled) {
      response.send(duoConfig.fallback_text);
      return;
    }

    const snapshot = database.getDuoPartySnapshot(duoConfig.twitch_user_id);
    const shoutouts = Object.fromEntries(
      database
        .getDuoShoutouts(duoConfig.twitch_user_id)
        .map((shoutout) => [shoutout.riot_id, shoutout.display]),
    );

    response.send(
      renderDuoText({
        template: duoConfig.template,
        fallbackText: duoConfig.fallback_text,
        inParty: Boolean(snapshot?.in_party),
        members: parseDuoMembers(snapshot?.members_json),
        shoutouts,
        updatedAt: snapshot?.updated_at ?? null,
      }),
    );
  });

  if (developmentMode) {
    registerDevelopmentRoutes(app, database);
  }

  if (options.serveStatic !== false) {
    // Serve the built React SPA. Static assets win first; everything else falls
    // back to index.html so the client-side router owns page routing. API, auth,
    // and duo routes are registered above, so they never reach this fallback.
    app.use(express.static(webDistPath));
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        next();
        return;
      }
      if (
        request.path === "/api" ||
        request.path.startsWith("/api/") ||
        request.path.startsWith("/auth/") ||
        request.path.startsWith("/duo/")
      ) {
        next();
        return;
      }
      response.sendFile(path.join(webDistPath, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  // Final safety net: never leak stack traces or internals to the client.
  app.use(
    (error: unknown, _request: Request, response: Response, next: NextFunction) => {
      if (response.headersSent) {
        next(error);
        return;
      }
      if (developmentMode) {
        console.error(error);
      }
      response.status(500).json({ ok: false, error: "Internal server error." });
    },
  );

  return app;
}

function registerDevelopmentRoutes(
  app: express.Express,
  database: AppDatabase,
): void {
  app.get("/api/debug", (request, response) => {
    const user = getSessionUser(request, database);

    response.json(
      user
        ? database.getDebugState(user.twitch_user_id)
        : {
            user: null,
            presets: [],
            activeSession: null,
            recentEvents: [],
          },
    );
  });
}

function parseDuoMembers(membersJson: string | undefined): DuoMember[] {
  if (!membersJson) return [];
  try {
    const parsed = JSON.parse(membersJson);
    return Array.isArray(parsed) ? (parsed as DuoMember[]) : [];
  } catch {
    return [];
  }
}
