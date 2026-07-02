import { useMutation } from "@tanstack/react-query";
import { useState, type CSSProperties, type FormEvent } from "react";

import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";

const panel: CSSProperties = { maxWidth: 540, margin: "56px auto" };

export function Settings() {
  const { refresh } = useAuth();
  const { push } = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const save = useMutation({
    mutationFn: () => api.saveTwitchCredentials(clientId.trim(), clientSecret.trim()),
    onSuccess: () => {
      push({ kind: "success", message: "Twitch credentials saved." });
      refresh();
    },
    onError: (error) => {
      push({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save credentials.",
      });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const redirectUri = `${window.location.origin}/auth/twitch/callback`;

  return (
    <main className="dashboard-shell">
      <section className="card" style={panel}>
        <Brand />
        <div className="card-heading">
          <div>
            <span className="card-kicker">First-time setup</span>
            <h2>Connect your Twitch app</h2>
          </div>
        </div>
        <p>
          Create an application in the{" "}
          <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
            Twitch Developer Console
          </a>{" "}
          and paste its Client ID and Secret. They are stored only on this PC.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Client ID</span>
            <input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <label className="field">
            <span>Client Secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <button className="button button-primary" type="submit" disabled={save.isPending}>
            Save credentials
          </button>
        </form>
        <p className="field-note">
          Add this exact OAuth Redirect URL to your Twitch app:{" "}
          <code>{redirectUri}</code>
        </p>
      </section>
    </main>
  );
}
