import { clampPredictionWindow } from "./config.js";
import type { AppDatabase } from "./db.js";
import type {
  PredictionSession,
  TwitchPredictionResponse,
  User,
  ValorantGameMode,
} from "./types.js";

interface CreatePredictionInput {
  title: string;
  outcomeA: string;
  outcomeB: string;
  predictionWindow: number;
}

export interface TwitchPredictionActions {
  createPrediction(
    user: User,
    input: CreatePredictionInput,
  ): Promise<TwitchPredictionResponse>;
  resolvePrediction(
    user: User,
    predictionId: string,
    winningOutcomeId: string,
  ): Promise<TwitchPredictionResponse>;
  cancelPrediction(user: User, predictionId: string): Promise<void>;
}

export type MatchStartResult =
  | {
      action: "prediction_created";
      message: string;
      session: PredictionSession;
    }
  | {
      action: "ignored";
      message: string;
      session: null;
    };

export class PredictionService {
  constructor(
    private readonly database: AppDatabase,
    private readonly twitch: TwitchPredictionActions,
  ) {}

  async handleValorantMatchStart(
    twitchUserId: string,
    source: string,
    gameMode: ValorantGameMode | "unknown",
  ): Promise<MatchStartResult> {
    const user = this.requireUser(twitchUserId);
    this.database.ensureDefaultPresets(twitchUserId);
    const preset =
      gameMode === "unknown"
        ? undefined
        : this.database.getPreset(twitchUserId, gameMode);
    if (!preset?.enabled) {
      return {
        action: "ignored",
        message: "No enabled preset exists for this game mode.",
        session: null,
      };
    }
    if (this.database.getActiveSession(twitchUserId)) {
      return {
        action: "ignored",
        message: "A prediction is already active.",
        session: null,
      };
    }

    const title = preset.title_template.replaceAll(
      "{streamer}",
      user.twitch_login,
    );
    let session: PredictionSession;
    try {
      session = this.database.createPredictionSession(twitchUserId, title);
    } catch {
      throw new Error("A prediction is already active.");
    }

    try {
      const prediction = await this.twitch.createPrediction(user, {
        title,
        outcomeA: preset.outcome_a,
        outcomeB: preset.outcome_b,
        predictionWindow: clampPredictionWindow(preset.prediction_window),
      });
      const outcomeA =
        prediction.outcomes.find(
          (outcome) => outcome.title === preset.outcome_a,
        ) ?? prediction.outcomes[0];
      const outcomeB =
        prediction.outcomes.find(
          (outcome) => outcome.title === preset.outcome_b,
        ) ?? prediction.outcomes[1];
      if (!outcomeA || !outcomeB) {
        throw new Error("Twitch returned an invalid prediction outcome list.");
      }

      const opened = this.database.updatePredictionSession(session.id, {
        status: "prediction_open",
        twitchPredictionId: prediction.id,
        outcomeAId: outcomeA.id,
        outcomeBId: outcomeB.id,
        startedAt: new Date().toISOString(),
      });
      this.database.addEvent(
        twitchUserId,
        session.id,
        "prediction_created",
        `Prediction opened from ${source} for ${gameMode}: ${title}`,
      );
      return {
        action: "prediction_created",
        message: "Twitch prediction created.",
        session: opened,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.database.updatePredictionSession(session.id, {
        status: "failed",
        resolvedAt: new Date().toISOString(),
        result: "create_failed",
      });
      this.database.addEvent(
        twitchUserId,
        session.id,
        "prediction_error",
        message,
      );
      throw error;
    }
  }

  async resolve(
    twitchUserId: string,
    winner: "A" | "B",
  ): Promise<PredictionSession> {
    const user = this.requireUser(twitchUserId);
    const session = this.requireOpenSession(twitchUserId);
    const outcomeId =
      winner === "A" ? session.outcome_a_id : session.outcome_b_id;
    if (!outcomeId || !session.twitch_prediction_id) {
      throw new Error("The active prediction is missing Twitch identifiers.");
    }

    try {
      const twitchPrediction = await this.twitch.resolvePrediction(
        user,
        session.twitch_prediction_id,
        outcomeId,
      );
      const channelPointsWagered = twitchPrediction.outcomes.reduce(
        (total, outcome) => total + (outcome.channel_points ?? 0),
        0,
      );
      const result = winner === "A" ? "outcome_a" : "outcome_b";
      const resolved = this.database.updatePredictionSession(session.id, {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
        result,
        channelPointsWagered,
      });
      this.database.addEvent(
        twitchUserId,
        session.id,
        "prediction_resolved",
        `Prediction resolved with ${result}.`,
      );
      return resolved;
    } catch (error) {
      this.logActionError(twitchUserId, session.id, error);
      throw error;
    }
  }

  async cancel(twitchUserId: string): Promise<PredictionSession> {
    const user = this.requireUser(twitchUserId);
    const session = this.requireOpenSession(twitchUserId);
    if (!session.twitch_prediction_id) {
      throw new Error("The active prediction is missing its Twitch ID.");
    }

    try {
      await this.twitch.cancelPrediction(user, session.twitch_prediction_id);
      const cancelled = this.database.updatePredictionSession(session.id, {
        status: "cancelled",
        resolvedAt: new Date().toISOString(),
        result: "cancelled",
      });
      this.database.addEvent(
        twitchUserId,
        session.id,
        "prediction_cancelled",
        "Prediction cancelled.",
      );
      return cancelled;
    } catch (error) {
      this.logActionError(twitchUserId, session.id, error);
      throw error;
    }
  }

  private requireUser(twitchUserId: string): User {
    const user = this.database.getUserByTwitchId(twitchUserId);
    if (!user) throw new Error("Twitch user is not connected.");
    return user;
  }

  private requireOpenSession(twitchUserId: string): PredictionSession {
    const session = this.database.getActiveSession(twitchUserId);
    if (!session || session.status !== "prediction_open") {
      throw new Error("There is no open prediction.");
    }
    return session;
  }

  private logActionError(
    twitchUserId: string,
    sessionId: number,
    error: unknown,
  ): void {
    this.database.addEvent(
      twitchUserId,
      sessionId,
      "prediction_error",
      error instanceof Error ? error.message : String(error),
    );
  }
}
