import type { DetectionStatus } from "../types";

interface Props {
  status: DetectionStatus;
}

function statusTone(value: boolean) {
  return value ? "good" : "bad";
}

export function StatusGrid({ status }: Props) {
  const cards = [
    ["Backend", status.backendConnected ? "Connected" : "Disconnected", statusTone(status.backendConnected)],
    ["Riot lockfile", status.riotLockfileFound ? "Found" : "Not found", statusTone(status.riotLockfileFound)],
    ["Riot Client", status.riotClientRunning ? "Running" : "Stopped", statusTone(status.riotClientRunning)],
    ["Valorant", status.valorantRunning ? "Running" : "Stopped", statusTone(status.valorantRunning)],
    ["Game mode", status.gameMode, status.gameMode === "unknown" ? "neutral" : "good"],
    ["Region", status.region, status.region === "unknown" ? "neutral" : "good"],
    ["Shard", status.shard, status.shard === "unknown" ? "neutral" : "good"],
  ] as const;

  return (
    <section className="status-grid">
      {cards.map(([label, value, tone]) => (
        <article className="status-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <i className={tone} />
        </article>
      ))}
    </section>
  );
}
