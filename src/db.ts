import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { DEFAULT_DUO_FALLBACK, DEFAULT_DUO_TEMPLATE } from "./duo.js";
import type {
  AutoPredictionPreset,
  AutoPredictionSettings,
  DuoConfig,
  DuoMember,
  DuoPartySnapshot,
  DuoShoutout,
  PredictionEvent,
  PredictionSession,
  PredictionSessionStatus,
  PublicStats,
  PublicStreamer,
  SafeUser,
  User,
  ValorantGameMode,
} from "./types.js";

interface UpsertUserInput {
  twitchUserId: string;
  twitchLogin: string;
  twitchDisplayName?: string;
  twitchProfileImageUrl?: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
}

interface SettingsInput {
  enabled: boolean;
  titleTemplate: string;
  outcomeA: string;
  outcomeB: string;
  predictionWindow: number;
}

type PresetInput = SettingsInput;

interface SessionUpdate {
  status: PredictionSessionStatus;
  twitchPredictionId?: string;
  outcomeAId?: string;
  outcomeBId?: string;
  startedAt?: string;
  resolvedAt?: string;
  result?: string;
  channelPointsWagered?: number;
}

export class AppDatabase {
  private readonly sqlite: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }

    this.sqlite = new Database(databasePath);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.sqlite.close();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitch_user_id TEXT NOT NULL UNIQUE,
        twitch_login TEXT NOT NULL,
        twitch_display_name TEXT NOT NULL DEFAULT '',
        twitch_profile_image_url TEXT,
        public_showcase_enabled INTEGER NOT NULL DEFAULT 0,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_expires_at TEXT NOT NULL,
        local_api_key_hash TEXT,
        local_api_key_created_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS auto_prediction_settings (
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

      CREATE TABLE IF NOT EXISTS auto_prediction_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitch_user_id TEXT NOT NULL,
        game_mode TEXT NOT NULL CHECK(game_mode IN ('competitive', 'custom')),
        enabled INTEGER NOT NULL DEFAULT 0,
        title_template TEXT NOT NULL,
        outcome_a TEXT NOT NULL,
        outcome_b TEXT NOT NULL,
        prediction_window INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(twitch_user_id, game_mode)
      );

      CREATE TABLE IF NOT EXISTS prediction_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitch_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        twitch_prediction_id TEXT,
        outcome_a_id TEXT,
        outcome_b_id TEXT,
        title TEXT NOT NULL,
        started_at TEXT,
        resolved_at TEXT,
        result TEXT,
        channel_points_wagered INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_active_prediction_per_streamer
        ON prediction_sessions(twitch_user_id)
        WHERE status IN ('creating', 'prediction_open');

      CREATE TABLE IF NOT EXISTS prediction_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitch_user_id TEXT NOT NULL,
        session_id INTEGER,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES prediction_sessions(id)
      );

      CREATE TABLE IF NOT EXISTS duo_config (
        twitch_user_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        public_token TEXT NOT NULL UNIQUE,
        template TEXT NOT NULL,
        fallback_text TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS duo_shoutouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitch_user_id TEXT NOT NULL,
        riot_id TEXT NOT NULL,
        display TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS duo_party_snapshot (
        twitch_user_id TEXT PRIMARY KEY,
        in_party INTEGER NOT NULL DEFAULT 0,
        members_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.ensureUserColumn("local_api_key_hash", "TEXT");
    this.ensureUserColumn("local_api_key_created_at", "TEXT");
    this.ensureUserColumn("twitch_display_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureUserColumn("twitch_profile_image_url", "TEXT");
    this.ensureUserColumn(
      "public_showcase_enabled",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureSessionColumn(
      "channel_points_wagered",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.sqlite.exec(`
      UPDATE users
      SET twitch_display_name = twitch_login
      WHERE twitch_display_name = '';
    `);
    this.sqlite.exec(`
      INSERT OR IGNORE INTO auto_prediction_presets (
        twitch_user_id, game_mode, enabled, title_template,
        outcome_a, outcome_b, prediction_window, created_at, updated_at
      )
      SELECT
        twitch_user_id, 'competitive', enabled, title_template,
        outcome_a, outcome_b, prediction_window, created_at, updated_at
      FROM auto_prediction_settings;

      INSERT OR IGNORE INTO auto_prediction_presets (
        twitch_user_id, game_mode, enabled, title_template,
        outcome_a, outcome_b, prediction_window
      )
      SELECT
        twitch_user_id, 'custom', 0, 'Will {streamer} win this Valorant match?',
        'Yes', 'No', 90
      FROM auto_prediction_settings;
    `);
  }

  private ensureUserColumn(name: string, definition: string): void {
    const columns = this.sqlite
      .prepare("PRAGMA table_info(users)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.sqlite.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
  }

  private ensureSessionColumn(name: string, definition: string): void {
    const columns = this.sqlite
      .prepare("PRAGMA table_info(prediction_sessions)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.sqlite.exec(
        `ALTER TABLE prediction_sessions ADD COLUMN ${name} ${definition}`,
      );
    }
  }

  upsertUser(input: UpsertUserInput): User {
    this.sqlite
      .prepare(
        `INSERT INTO users (
          twitch_user_id, twitch_login, twitch_display_name,
          twitch_profile_image_url, access_token, refresh_token, token_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(twitch_user_id) DO UPDATE SET
          twitch_login = excluded.twitch_login,
          twitch_display_name = excluded.twitch_display_name,
          twitch_profile_image_url = excluded.twitch_profile_image_url,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          token_expires_at = excluded.token_expires_at,
          updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        input.twitchUserId,
        input.twitchLogin,
        input.twitchDisplayName || input.twitchLogin,
        input.twitchProfileImageUrl ?? null,
        input.accessToken,
        input.refreshToken,
        input.tokenExpiresAt,
      );

    return this.getUserByTwitchId(input.twitchUserId)!;
  }

  getUserById(id: number): User | undefined {
    return this.sqlite
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id) as User | undefined;
  }

  getUserByTwitchId(twitchUserId: string): User | undefined {
    return this.sqlite
      .prepare("SELECT * FROM users WHERE twitch_user_id = ?")
      .get(twitchUserId) as User | undefined;
  }

  updateTokens(
    twitchUserId: string,
    accessToken: string,
    refreshToken: string,
    tokenExpiresAt: string,
  ): void {
    this.sqlite
      .prepare(
        `UPDATE users SET
          access_token = ?, refresh_token = ?, token_expires_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE twitch_user_id = ?`,
      )
      .run(accessToken, refreshToken, tokenExpiresAt, twitchUserId);
  }

  saveLocalApiKey(
    twitchUserId: string,
    keyHash: string,
    createdAt: string,
  ): void {
    this.sqlite
      .prepare(
        `UPDATE users SET
          local_api_key_hash = ?, local_api_key_created_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE twitch_user_id = ?`,
      )
      .run(keyHash, createdAt, twitchUserId);
  }

  getUserByLocalApiKeyHash(keyHash: string): User | undefined {
    return this.sqlite
      .prepare("SELECT * FROM users WHERE local_api_key_hash = ?")
      .get(keyHash) as User | undefined;
  }

  setPublicShowcaseEnabled(twitchUserId: string, enabled: boolean): void {
    this.sqlite
      .prepare(
        `UPDATE users SET public_showcase_enabled = ?, updated_at = CURRENT_TIMESTAMP
         WHERE twitch_user_id = ?`,
      )
      .run(enabled ? 1 : 0, twitchUserId);
  }

  getPublicStats(): PublicStats {
    const users = this.sqlite
      .prepare("SELECT COUNT(*) AS count FROM users")
      .get() as { count: number };
    const sessions = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS count,
          COALESCE(SUM(channel_points_wagered), 0) AS points
         FROM prediction_sessions
         WHERE twitch_prediction_id IS NOT NULL`,
      )
      .get() as { count: number; points: number };
    return {
      connectedStreamers: users.count,
      predictionsRun: sessions.count,
      channelPointsWagered: sessions.points,
    };
  }

  getPublicStreamers(limit = 12): PublicStreamer[] {
    return this.sqlite
      .prepare(
        `SELECT twitch_login, twitch_display_name, twitch_profile_image_url
         FROM users
         WHERE public_showcase_enabled = 1
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as PublicStreamer[];
  }

  ensureDuoConfig(twitchUserId: string): DuoConfig {
    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO duo_config (
          twitch_user_id, enabled, public_token, template, fallback_text
        ) VALUES (?, 0, ?, ?, ?)`,
      )
      .run(
        twitchUserId,
        generateDuoToken(),
        DEFAULT_DUO_TEMPLATE,
        DEFAULT_DUO_FALLBACK,
      );
    return this.getDuoConfig(twitchUserId)!;
  }

  getDuoConfig(twitchUserId: string): DuoConfig | undefined {
    return this.sqlite
      .prepare("SELECT * FROM duo_config WHERE twitch_user_id = ?")
      .get(twitchUserId) as DuoConfig | undefined;
  }

  getDuoConfigByToken(token: string): DuoConfig | undefined {
    return this.sqlite
      .prepare("SELECT * FROM duo_config WHERE public_token = ?")
      .get(token) as DuoConfig | undefined;
  }

  saveDuoConfig(
    twitchUserId: string,
    input: { enabled: boolean; template: string; fallbackText: string },
  ): DuoConfig {
    this.ensureDuoConfig(twitchUserId);
    this.sqlite
      .prepare(
        `UPDATE duo_config SET
          enabled = ?, template = ?, fallback_text = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE twitch_user_id = ?`,
      )
      .run(
        input.enabled ? 1 : 0,
        input.template,
        input.fallbackText,
        twitchUserId,
      );
    return this.getDuoConfig(twitchUserId)!;
  }

  regenerateDuoToken(twitchUserId: string): string {
    this.ensureDuoConfig(twitchUserId);
    const token = generateDuoToken();
    this.sqlite
      .prepare(
        `UPDATE duo_config SET public_token = ?, updated_at = CURRENT_TIMESTAMP
         WHERE twitch_user_id = ?`,
      )
      .run(token, twitchUserId);
    return token;
  }

  getDuoShoutouts(twitchUserId: string): DuoShoutout[] {
    return this.sqlite
      .prepare(
        "SELECT * FROM duo_shoutouts WHERE twitch_user_id = ? ORDER BY id",
      )
      .all(twitchUserId) as DuoShoutout[];
  }

  setDuoShoutouts(
    twitchUserId: string,
    shoutouts: Array<{ riotId: string; display: string }>,
  ): DuoShoutout[] {
    const replace = this.sqlite.transaction(() => {
      this.sqlite
        .prepare("DELETE FROM duo_shoutouts WHERE twitch_user_id = ?")
        .run(twitchUserId);
      const insert = this.sqlite.prepare(
        `INSERT INTO duo_shoutouts (twitch_user_id, riot_id, display)
         VALUES (?, ?, ?)`,
      );
      for (const shoutout of shoutouts) {
        insert.run(twitchUserId, shoutout.riotId, shoutout.display);
      }
    });
    replace();
    return this.getDuoShoutouts(twitchUserId);
  }

  saveDuoPartySnapshot(
    twitchUserId: string,
    input: { inParty: boolean; members: DuoMember[] },
  ): DuoPartySnapshot {
    this.sqlite
      .prepare(
        `INSERT INTO duo_party_snapshot (
          twitch_user_id, in_party, members_json, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(twitch_user_id) DO UPDATE SET
          in_party = excluded.in_party,
          members_json = excluded.members_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        twitchUserId,
        input.inParty ? 1 : 0,
        JSON.stringify(input.members),
        new Date().toISOString(),
      );
    return this.getDuoPartySnapshot(twitchUserId)!;
  }

  getDuoPartySnapshot(twitchUserId: string): DuoPartySnapshot | undefined {
    return this.sqlite
      .prepare("SELECT * FROM duo_party_snapshot WHERE twitch_user_id = ?")
      .get(twitchUserId) as DuoPartySnapshot | undefined;
  }

  ensureDefaultSettings(twitchUserId: string): AutoPredictionSettings {
    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO auto_prediction_settings (
          twitch_user_id, enabled, title_template, outcome_a, outcome_b, prediction_window
        ) VALUES (?, 0, ?, 'Yes', 'No', 90)`,
      )
      .run(twitchUserId, "Will {streamer} win this Valorant match?");

    return this.getSettings(twitchUserId)!;
  }

  ensureDefaultPresets(twitchUserId: string): AutoPredictionPreset[] {
    const insert = this.sqlite.prepare(
      `INSERT OR IGNORE INTO auto_prediction_presets (
        twitch_user_id, game_mode, enabled, title_template,
        outcome_a, outcome_b, prediction_window
      ) VALUES (?, ?, 0, ?, 'Yes', 'No', 90)`,
    );
    const title = "Will {streamer} win this Valorant match?";
    insert.run(twitchUserId, "competitive", title);
    insert.run(twitchUserId, "custom", title);
    return this.getPresets(twitchUserId);
  }

  getPresets(twitchUserId: string): AutoPredictionPreset[] {
    return this.sqlite
      .prepare(
        `SELECT * FROM auto_prediction_presets
         WHERE twitch_user_id = ?
         ORDER BY CASE game_mode WHEN 'competitive' THEN 0 ELSE 1 END`,
      )
      .all(twitchUserId) as AutoPredictionPreset[];
  }

  getPreset(
    twitchUserId: string,
    gameMode: ValorantGameMode,
  ): AutoPredictionPreset | undefined {
    return this.sqlite
      .prepare(
        `SELECT * FROM auto_prediction_presets
         WHERE twitch_user_id = ? AND game_mode = ?`,
      )
      .get(twitchUserId, gameMode) as AutoPredictionPreset | undefined;
  }

  savePreset(
    twitchUserId: string,
    gameMode: ValorantGameMode,
    input: PresetInput,
  ): AutoPredictionPreset {
    this.ensureDefaultPresets(twitchUserId);
    this.sqlite
      .prepare(
        `UPDATE auto_prediction_presets SET
          enabled = ?, title_template = ?, outcome_a = ?, outcome_b = ?,
          prediction_window = ?, updated_at = CURRENT_TIMESTAMP
        WHERE twitch_user_id = ? AND game_mode = ?`,
      )
      .run(
        input.enabled ? 1 : 0,
        input.titleTemplate,
        input.outcomeA,
        input.outcomeB,
        input.predictionWindow,
        twitchUserId,
        gameMode,
      );
    return this.getPreset(twitchUserId, gameMode)!;
  }

  getSettings(twitchUserId: string): AutoPredictionSettings | undefined {
    return this.sqlite
      .prepare(
        "SELECT * FROM auto_prediction_settings WHERE twitch_user_id = ?",
      )
      .get(twitchUserId) as AutoPredictionSettings | undefined;
  }

  saveSettings(
    twitchUserId: string,
    input: SettingsInput,
  ): AutoPredictionSettings {
    this.ensureDefaultSettings(twitchUserId);
    this.sqlite
      .prepare(
        `UPDATE auto_prediction_settings SET
          enabled = ?, title_template = ?, outcome_a = ?, outcome_b = ?,
          prediction_window = ?, updated_at = CURRENT_TIMESTAMP
        WHERE twitch_user_id = ?`,
      )
      .run(
        input.enabled ? 1 : 0,
        input.titleTemplate,
        input.outcomeA,
        input.outcomeB,
        input.predictionWindow,
        twitchUserId,
      );
    return this.getSettings(twitchUserId)!;
  }

  createPredictionSession(
    twitchUserId: string,
    title: string,
  ): PredictionSession {
    const result = this.sqlite
      .prepare(
        `INSERT INTO prediction_sessions (twitch_user_id, status, title)
         VALUES (?, 'creating', ?)`,
      )
      .run(twitchUserId, title);
    return this.getSession(Number(result.lastInsertRowid))!;
  }

  getSession(id: number): PredictionSession | undefined {
    return this.sqlite
      .prepare("SELECT * FROM prediction_sessions WHERE id = ?")
      .get(id) as PredictionSession | undefined;
  }

  getActiveSession(twitchUserId: string): PredictionSession | undefined {
    return this.sqlite
      .prepare(
        `SELECT * FROM prediction_sessions
         WHERE twitch_user_id = ? AND status IN ('creating', 'prediction_open')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(twitchUserId) as PredictionSession | undefined;
  }

  updatePredictionSession(id: number, input: SessionUpdate): PredictionSession {
    const current = this.getSession(id);
    if (!current) throw new Error("Prediction session not found.");

    this.sqlite
      .prepare(
        `UPDATE prediction_sessions SET
          status = ?,
          twitch_prediction_id = ?,
          outcome_a_id = ?,
          outcome_b_id = ?,
          started_at = ?,
          resolved_at = ?,
          result = ?,
          channel_points_wagered = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(
        input.status,
        input.twitchPredictionId ?? current.twitch_prediction_id,
        input.outcomeAId ?? current.outcome_a_id,
        input.outcomeBId ?? current.outcome_b_id,
        input.startedAt ?? current.started_at,
        input.resolvedAt ?? current.resolved_at,
        input.result ?? current.result,
        input.channelPointsWagered ?? current.channel_points_wagered,
        id,
      );

    return this.getSession(id)!;
  }

  addEvent(
    twitchUserId: string,
    sessionId: number | null,
    type: string,
    message: string,
  ): PredictionEvent {
    const result = this.sqlite
      .prepare(
        `INSERT INTO prediction_events (twitch_user_id, session_id, type, message)
         VALUES (?, ?, ?, ?)`,
      )
      .run(twitchUserId, sessionId, type, message);
    return this.sqlite
      .prepare("SELECT * FROM prediction_events WHERE id = ?")
      .get(result.lastInsertRowid) as PredictionEvent;
  }

  getRecentEvents(twitchUserId: string, limit = 12): PredictionEvent[] {
    return this.sqlite
      .prepare(
        `SELECT * FROM prediction_events WHERE twitch_user_id = ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(twitchUserId, limit) as PredictionEvent[];
  }

  getDebugState(twitchUserId: string): {
    user: SafeUser | undefined;
    presets: AutoPredictionPreset[];
    activeSession: PredictionSession | undefined;
    recentEvents: PredictionEvent[];
  } {
    const row = this.sqlite
      .prepare(
        `SELECT id, twitch_user_id, twitch_login, token_expires_at,
          local_api_key_hash IS NOT NULL AS has_local_api_key,
          local_api_key_created_at, created_at, updated_at
         FROM users WHERE twitch_user_id = ?`,
      )
      .get(twitchUserId) as
      | (Omit<SafeUser, "has_local_api_key"> & {
          has_local_api_key: number;
        })
      | undefined;
    const user = row
      ? { ...row, has_local_api_key: Boolean(row.has_local_api_key) }
      : undefined;

    return {
      user,
      presets: this.getPresets(twitchUserId),
      activeSession: this.getActiveSession(twitchUserId),
      recentEvents: this.getRecentEvents(twitchUserId),
    };
  }
}

function generateDuoToken(): string {
  return `duo_${crypto.randomBytes(24).toString("base64url")}`;
}
