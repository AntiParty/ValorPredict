import type { PredictionEvent } from "../../types";
import { RelativeTime } from "../RelativeTime";

const EVENT_TITLES: Record<string, string> = {
  prediction_created: "Prediction started",
  prediction_resolved: "Prediction resolved",
  prediction_cancelled: "Prediction cancelled",
  prediction_error: "Prediction error",
  prediction_action_error: "Couldn't update prediction",
};

function friendlyEventTitle(type: string): string {
  return EVENT_TITLES[type] ?? type.replaceAll("_", " ");
}

export function EventsCard({ events }: { events: PredictionEvent[] }) {
  return (
    <section className="events-card">
      <h3>Recent activity</h3>
      <ul className="events">
        {events.length ? (
          events.map((event) => (
            <li key={event.id} className={event.type === "prediction_error" ? "is-error" : ""}>
              <span className="event-icon" aria-hidden="true" />
              <div>
                <strong>{friendlyEventTitle(event.type)}</strong>
                <p>{event.message}</p>
              </div>
              <RelativeTime value={event.created_at} />
            </li>
          ))
        ) : (
          <li className="no-events">No predictions yet</li>
        )}
      </ul>
    </section>
  );
}
