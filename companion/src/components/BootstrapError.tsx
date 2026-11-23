import type { UserFacingError } from "../errors";

interface Props {
  error: UserFacingError;
  onRetry: () => void;
  retrying: boolean;
}

export function BootstrapError({ error, onRetry, retrying }: Props) {
  return (
    <section className="bootstrap-error" role="alert">
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
  );
}
