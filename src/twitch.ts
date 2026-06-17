import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import type {
  TwitchPredictionResponse,
  TwitchTokenResponse,
  TwitchUserResponse,
  User,
} from "./types.js";

interface CreatePredictionInput {
  title: string;
  outcomeA: string;
  outcomeB: string;
  predictionWindow: number;
}

interface HelixEnvelope<T> {
  data: T[];
}

export class TwitchClient {
  constructor(
    private readonly config: AppConfig,
    private readonly database: AppDatabase,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  buildAuthorizationUrl(state: string): string {
    const parameters = new URLSearchParams({
      client_id: this.config.twitchClientId,
      redirect_uri: this.config.twitchRedirectUri,
      response_type: "code",
      scope: "channel:manage:predictions channel:read:predictions",
      state,
    });
    return `https://id.twitch.tv/oauth2/authorize?${parameters}`;
  }

  async exchangeCode(code: string): Promise<TwitchTokenResponse> {
    const parameters = new URLSearchParams({
      client_id: this.config.twitchClientId,
      client_secret: this.config.twitchClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.config.twitchRedirectUri,
    });
    return this.requestJson<TwitchTokenResponse>(
      `https://id.twitch.tv/oauth2/token?${parameters}`,
      { method: "POST" },
      "Twitch OAuth",
    );
  }

  async getCurrentUser(accessToken: string): Promise<TwitchUserResponse> {
    const response = await this.requestJson<HelixEnvelope<TwitchUserResponse>>(
      "https://api.twitch.tv/helix/users",
      {
        headers: {
          "Client-Id": this.config.twitchClientId,
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "Twitch API",
    );
    const user = response.data[0];
    if (!user) throw new Error("Twitch did not return a user for this token.");
    return user;
  }

  async createPrediction(
    user: User,
    input: CreatePredictionInput,
  ): Promise<TwitchPredictionResponse> {
    const currentUser = await this.ensureFreshUser(user);
    const response = await this.helixRequest<
      HelixEnvelope<TwitchPredictionResponse>
    >(currentUser, "https://api.twitch.tv/helix/predictions", {
      method: "POST",
      body: JSON.stringify({
        broadcaster_id: currentUser.twitch_user_id,
        title: input.title,
        outcomes: [{ title: input.outcomeA }, { title: input.outcomeB }],
        prediction_window: input.predictionWindow,
      }),
    });
    const prediction = response.data[0];
    if (!prediction) throw new Error("Twitch did not return the new prediction.");
    return prediction;
  }

  async resolvePrediction(
    user: User,
    predictionId: string,
    winningOutcomeId: string,
  ): Promise<TwitchPredictionResponse> {
    const currentUser = await this.ensureFreshUser(user);
    const response = await this.helixRequest<
      HelixEnvelope<TwitchPredictionResponse>
    >(currentUser, "https://api.twitch.tv/helix/predictions", {
      method: "PATCH",
      body: JSON.stringify({
        broadcaster_id: currentUser.twitch_user_id,
        id: predictionId,
        status: "RESOLVED",
        winning_outcome_id: winningOutcomeId,
      }),
    });
    const prediction = response.data[0];
    if (!prediction) throw new Error("Twitch did not return the resolved prediction.");
    return prediction;
  }

  async cancelPrediction(user: User, predictionId: string): Promise<void> {
    const currentUser = await this.ensureFreshUser(user);
    await this.helixRequest(currentUser, "https://api.twitch.tv/helix/predictions", {
      method: "PATCH",
      body: JSON.stringify({
        broadcaster_id: currentUser.twitch_user_id,
        id: predictionId,
        status: "CANCELED",
      }),
    });
  }

  tokenExpiresAt(expiresInSeconds: number): string {
    return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  }

  private async ensureFreshUser(user: User): Promise<User> {
    const refreshThreshold = Date.now() + 60_000;
    if (new Date(user.token_expires_at).getTime() > refreshThreshold) {
      return user;
    }

    const parameters = new URLSearchParams({
      client_id: this.config.twitchClientId,
      client_secret: this.config.twitchClientSecret,
      grant_type: "refresh_token",
      refresh_token: user.refresh_token,
    });
    const token = await this.requestJson<TwitchTokenResponse>(
      `https://id.twitch.tv/oauth2/token?${parameters}`,
      { method: "POST" },
      "Twitch OAuth",
    );
    const expiresAt = this.tokenExpiresAt(token.expires_in);
    this.database.updateTokens(
      user.twitch_user_id,
      token.access_token,
      token.refresh_token || user.refresh_token,
      expiresAt,
    );
    return this.database.getUserByTwitchId(user.twitch_user_id)!;
  }

  private helixRequest<T>(
    user: User,
    url: string,
    init: RequestInit,
  ): Promise<T> {
    return this.requestJson<T>(
      url,
      {
        ...init,
        headers: {
          "Client-Id": this.config.twitchClientId,
          Authorization: `Bearer ${user.access_token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      "Twitch API",
    );
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<T> {
    const response = await this.fetcher(url, init);
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `${label} error (${response.status}): ${
          body.message || response.statusText || "Unknown error"
        }`,
      );
    }
    return body as T;
  }
}
