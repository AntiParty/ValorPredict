import { formatMetric } from "../../lib/format";
import type { PublicStats } from "../../types";

export function Metrics({ stats }: { stats: PublicStats }) {
  return (
    <section className="metrics-section" aria-label="Platform activity">
      <div className="section-label">Live platform activity</div>
      <p className="metrics-headline">
        Powering <strong>{formatMetric(stats.predictionsRun)}</strong> predictions across{" "}
        <strong>{formatMetric(stats.connectedStreamers)}</strong> streamers
      </p>
      <div className="metrics-grid">
        <div>
          <strong>{formatMetric(stats.predictionsRun)}</strong>
          <span>Predictions run</span>
        </div>
        <div>
          <strong>{formatMetric(stats.channelPointsWagered)}</strong>
          <span>Channel Points wagered</span>
        </div>
        <div>
          <strong>{formatMetric(stats.connectedStreamers)}</strong>
          <span>Connected streamers</span>
        </div>
      </div>
    </section>
  );
}
