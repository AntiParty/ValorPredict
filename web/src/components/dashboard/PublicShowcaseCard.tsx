import { useState, type FormEvent } from "react";

import { useDashboardMutation } from "../../hooks/useDashboardMutation";
import { streamerInitials } from "../../lib/format";
import { api } from "../../lib/api";
import type { SafeUser } from "../../types";

export function PublicShowcaseCard({ user }: { user: SafeUser }) {
  const [enabled, setEnabled] = useState(user.public_showcase_enabled);

  const save = useDashboardMutation((value: boolean) => api.setShowcase(value), {
    successMessage: "Visibility saved.",
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(enabled);
  }

  return (
    <form className="card showcase-card" onSubmit={handleSubmit}>
      <div className="card-heading">
        <div>
          <span className="card-kicker">Public profile</span>
          <h2>Streamer showcase</h2>
        </div>
        <span className={`status-pill ${user.public_showcase_enabled ? "ready" : ""}`}>
          <i />
          {user.public_showcase_enabled ? "Visible" : "Private"}
        </span>
      </div>
      <div className="showcase-profile">
        <span className="streamer-avatar">
          {user.twitch_profile_image_url ? (
            <img src={user.twitch_profile_image_url} alt="" />
          ) : (
            <span>{streamerInitials(user.twitch_display_name)}</span>
          )}
        </span>
        <div>
          <strong>{user.twitch_display_name}</strong>
          <span>twitch.tv/{user.twitch_login}</span>
        </div>
      </div>
      <label className="showcase-choice">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          <strong>Feature my channel publicly</strong>
          <small>
            Show my Twitch name and profile picture in the landing-page streamer rotation.
          </small>
        </span>
      </label>
      <button className="button button-secondary" type="submit" disabled={save.isPending}>
        Save visibility
      </button>
    </form>
  );
}
