import { formatRelative } from "../../format";
import { useNotice } from "../../hooks/useNotice";
import type { PredictionEvent } from "../../types";
import { Notice } from "../Notice";

interface Props {
  /** Own-app sign-in only: hosted accounts get the compact reconnect panel instead. */
  reauthRequired: boolean;
  /** Newest prediction event, if any; only a `prediction_error` produces a banner. */
  latestEvent?: PredictionEvent | null;
  /** Rejects with the reason when reconnecting fails; it is shown under the banner. */
  onReconnect: () => Promise<void> | void;
}

interface Banner {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

// Problems that need action and that nothing else on screen explains. "Paused" and
// "waiting for Valorant" are not problems: the status card already says them.
export function HealthBanners({ reauthRequired, latestEvent, onReconnect }: Props) {
  const banners: Banner[] = [];
  const { notice, showError, clear } = useNotice();

  if (reauthRequired) {
    banners.push({
      id: "twitch",
      message: "Your Twitch sign-in expired. Reconnect to keep predictions working.",
      actionLabel: "Reconnect",
      onAction: async () => {
        clear();
        try {
          await onReconnect();
        } catch (error) {
          showError(String(error));
        }
      },
    });
  }

  // The newest event being an error means nothing has worked since (a later started or
  // resolved prediction would be newer). This is how a streamer without channel points
  // finds out why nothing opened.
  if (latestEvent?.type === "prediction_error") {
    banners.push({
      id: "prediction-error",
      message: `The last prediction failed (${formatRelative(latestEvent.created_at)}): ${latestEvent.message}`,
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="health-banners">
      {banners.map((banner) => (
        <div key={banner.id} className="health-banner" role="alert">
          <span className="health-banner__dot" aria-hidden="true" />
          <p>{banner.message}</p>
          {banner.actionLabel && banner.onAction && (
            <button type="button" className="button secondary" onClick={banner.onAction}>
              {banner.actionLabel}
            </button>
          )}
        </div>
      ))}
      <Notice notice={notice} />
    </div>
  );
}
