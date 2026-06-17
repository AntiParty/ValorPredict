import { useState } from "react";

import { useDashboardMutation } from "../../hooks/useDashboardMutation";
import { formatDate } from "../../lib/format";
import { api } from "../../lib/api";
import type { LocalApiKeyReveal, SafeUser } from "../../types";
import { CopyRow } from "../CopyRow";

export function CompanionCard({
  user,
  localApiKeyReveal,
}: {
  user: SafeUser;
  localApiKeyReveal?: LocalApiKeyReveal | null;
}) {
  const [reveal, setReveal] = useState<LocalApiKeyReveal | null>(
    localApiKeyReveal ?? null,
  );

  const generate = useDashboardMutation(() => api.generateLocalKey(), {
    successMessage: "Companion key generated.",
    onSuccess: (data) => setReveal({ apiKey: data.apiKey, createdAt: data.createdAt }),
  });

  return (
    <section className="card companion-card">
      <div className="card-heading">
        <div>
          <span className="card-kicker">Desktop connection</span>
          <h2>Local Companion App</h2>
        </div>
        <span className={`status-pill ${user.has_local_api_key ? "ready" : ""}`}>
          <i />
          {user.has_local_api_key ? "Key ready" : "Not connected"}
        </span>
      </div>
      <p>
        Paste this backend key into the desktop companion. It can start predictions, but
        it never stores or receives Twitch tokens.
      </p>
      <div className="companion-actions">
        <div>
          <span>Local API key</span>
          <strong>
            {user.local_api_key_created_at
              ? `Created ${formatDate(user.local_api_key_created_at)}`
              : "Not generated"}
          </strong>
        </div>
        <button
          className={`button ${user.has_local_api_key ? "button-secondary" : "button-primary"}`}
          type="button"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
        >
          {user.has_local_api_key
            ? "Regenerate Local API Key"
            : "Generate Local API Key"}
        </button>
      </div>
      {reveal ? (
        <div className="key-reveal">
          <div>
            <strong>Copy this key now</strong>
            <span>For security, this key is shown only once.</span>
          </div>
          <CopyRow value={reveal.apiKey} inputId="local-api-key" label="Copy key" />
        </div>
      ) : null}
      {user.has_local_api_key ? (
        <p className="warning-note">
          Regenerating invalidates the key currently saved in the companion.
        </p>
      ) : null}
    </section>
  );
}
