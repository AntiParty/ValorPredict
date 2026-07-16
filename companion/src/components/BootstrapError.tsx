import type { UserFacingError } from "../errors";
import { Brand } from "./predictions/Brand";

interface Props {
  error: UserFacingError;
  onRetry: () => void;
  retrying: boolean;
}

export function BootstrapError({ error, onRetry, retrying }: Props) {
  return (
    <main className="companion-shell bootstrap-shell">
      <section className="card bootstrap-error" role="alert">
        <Brand />
        <span className="card-kicker">Connection check</span>
        <h1>{error.title}</h1>
        <p>{error.message}</p>
        <button
          type="button"
          className="button primary"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? "Trying again…" : "Try again"}
        </button>
        <details>
          <summary>Technical details</summary>
          <code>{error.detail}</code>
        </details>
      </section>
    </main>
  );
}
