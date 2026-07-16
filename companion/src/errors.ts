export interface UserFacingError {
  title: string;
  message: string;
  detail: string;
}

export function friendlyError(error: unknown, fallback: string): UserFacingError {
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();

  if (
    lower.includes("twitch") &&
    (lower.includes("expired") ||
      lower.includes("unauthorized") ||
      lower.includes("401"))
  ) {
    return {
      title: "Twitch needs to reconnect",
      message: "Reconnect Twitch to keep predictions working.",
      detail,
    };
  }

  return {
    title: "ValorPredict couldn't start",
    message: fallback,
    detail,
  };
}
