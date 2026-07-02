import { formatDate } from "../../format";
import type { PredictionEvent } from "../../types";

const EVENT_TITLES: Record<string, string> = {
  prediction_created: "Prediction started",
  prediction_resolved: "Prediction resolved",
  prediction_cancelled: "Prediction cancelled",
  prediction_error: "Prediction error",
};

function friendlyEventTitle(type: string): string {
  return EVENT_TITLES[type] ?? type.replaceAll("_", " ");
}

export function EventsCard({ events }: { events: PredictionEvent[] }) {
  return (
    <section className="card events-card">
      <div className="preset-head">
        <div>
          <span className="card-kicker">At a glance</span>
          <h3>Recent prediction activity</h3>
        </div>
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
