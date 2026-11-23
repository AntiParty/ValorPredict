import { titleCase } from "../format";
import type { DetectionMetrics, DetectionStatus } from "../types";

interface Props {
  status: DetectionStatus;
  metrics: DetectionMetrics | null;
}

function statusTone(value: boolean) {
  return value ? "good" : "bad";
}

export function StatusGrid({ status, metrics }: Props) {
  const tiles: ReadonlyArray<readonly [string, string, "good" | "bad" | "neutral"]> = [
    ["Riot lockfile", status.riotLockfileFound ? "Found" : "Not found", statusTone(status.riotLockfileFound)],
    ["Riot Client", status.riotClientRunning ? "Running" : "Stopped", statusTone(status.riotClientRunning)],
    ["Valorant", status.valorantRunning ? "Running" : "Stopped", statusTone(status.valorantRunning)],
    ["Game mode", titleCase(status.gameMode), status.gameMode === "unknown" ? "neutral" : "good"],
    ["Region", status.region.toUpperCase(), status.region === "unknown" ? "neutral" : "good"],
    ["Shard", status.shard.toUpperCase(), status.shard === "unknown" ? "neutral" : "good"],
    ...(metrics
      ? ([
          ["Last poll", metrics.lastPollMs === null ? "None yet" : `${metrics.lastPollMs} ms`, "neutral"],
          ["Process scans / min", String(metrics.processScansLastMinute), "neutral"],
          ["Loopback calls / min", String(metrics.loopbackCallsLastMinute), "neutral"],
          ["Riot server calls / min", String(metrics.riotServerCallsLastMinute), "neutral"],
          ["Log reads / min", String(metrics.logReadsLastMinute), "neutral"],
        ] as const)
      : []),
  ];

  return (
    <section className="diag-grid">
      {tiles.map(([label, value, tone]) => (
        <article className="diag-tile" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <i className={tone} />
        </article>
      ))}
    </section>
  );
}
