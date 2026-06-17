import { formatDate } from "../../lib/format";
import type { PredictionEvent } from "../../types";

const EVENT_TITLES: Record<string, string> = {
  prediction_created: "Prediction started",
  prediction_resolved: "Prediction resolved",
  prediction_canceled: "Prediction canceled",
  match_start_ignored: "Match start ignored",
  preset_updated: "Preset updated",
  local_api_key_generated: "Companion key generated",
};

function friendlyEventTitle(type: string): string {
  return EVENT_TITLES[type] ?? type.replaceAll("_", " ");
}

export function Events({
  events,
  developmentMode,
}: {
  events: PredictionEvent[];
  developmentMode: boolean;
}) {
  return (
    <section className="card activity-card">
      <div className="card-heading">
        <div>
          <span className="card-kicker">
            {developmentMode ? "Runtime events" : "At a glance"}
          </span>
          <h2>{developmentMode ? "Latest actions" : "Recent activity"}</h2>
        </div>
        {developmentMode ? (
          <a className="quiet-link" href="/api/debug">
            View JSON
          </a>
        ) : null}
      </div>
      <ul className="events">
        {events.length ? (
          events.map((event) => (
            <li key={event.id}>
              <span className="event-icon" />
              <div>
                <strong>{friendlyEventTitle(event.type)}</strong>
                <p>{event.message}</p>
              </div>
              <time>{formatDate(event.created_at)}</time>
            </li>
          ))
        ) : (
          <li className="no-events">Your prediction activity will appear here.</li>
        )}
      </ul>
    </section>
  );
}
