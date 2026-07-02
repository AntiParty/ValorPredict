import type { DetectionStatus, SafeUser } from "../../types";

interface Props {
  status: DetectionStatus;
  user: SafeUser | null;
  onStartMonitoring: () => void;
  onReconnect: () => void;
}

interface Banner {
  id: string;
  tone: "info" | "warn";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function twitchExpired(user: SafeUser | null): boolean {
  if (!user?.token_expires_at) return false;
  const expires = Date.parse(user.token_expires_at);
  // Only flag once actually expired — if the backend refreshed the token this
  // value would be in the future, so a past value means a real reconnect need.
  return Number.isFinite(expires) && expires <= Date.now();
}

// Plain-language nudges shown under the status card, only when something needs
// attention. When all is well, nothing renders and the status card's
// "Watching Valorant" is the all-clear.
export function HealthBanners({ status, user, onStartMonitoring, onReconnect }: Props) {
  const banners: Banner[] = [];

  if (twitchExpired(user)) {
    banners.push({
      id: "twitch",
      tone: "warn",
      message: "Your Twitch sign-in expired — reconnect to keep predictions working.",
      actionLabel: "Reconnect",
      onAction: onReconnect,
    });
  }

  if (!status.monitoring) {
    banners.push({
      id: "monitoring",
      tone: "info",
      message: "Monitoring is paused — start it to open predictions automatically.",
      actionLabel: "Start monitoring",
      onAction: onStartMonitoring,
    });
  } else if (!status.valorantRunning) {
    banners.push({
      id: "valorant",
      tone: "info",
      message: "Waiting for Valorant to launch — you're all set, just hop into a match.",
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="health-banners">
      {banners.slice(0, 2).map((banner) => (
        <div key={banner.id} className={`health-banner ${banner.tone}`}>
          <span className="health-banner__dot" aria-hidden="true" />
          <p>{banner.message}</p>
          {banner.actionLabel && banner.onAction && (
            <button type="button" className="button ghost" onClick={banner.onAction}>
              {banner.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
