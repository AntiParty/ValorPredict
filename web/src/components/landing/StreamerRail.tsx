import { streamerInitials } from "../../lib/format";
import type { PublicStreamer } from "../../types";

function StreamerCard({ streamer, index }: { streamer: PublicStreamer; index: number }) {
  const name = streamer.twitch_display_name || streamer.twitch_login;
  return (
    <a
      key={`${streamer.twitch_login}-${index}`}
      className="streamer-card"
      href={`https://twitch.tv/${encodeURIComponent(streamer.twitch_login)}`}
      target="_blank"
      rel="noreferrer"
    >
      <span className="streamer-avatar">
        {streamer.twitch_profile_image_url ? (
          <img src={streamer.twitch_profile_image_url} alt="" />
        ) : (
          <span>{streamerInitials(name)}</span>
        )}
      </span>
      <span>
        <strong>
          {name}
          <i aria-hidden="true">&#10022;</i>
        </strong>
        <small>Auto Predictions enabled</small>
      </span>
    </a>
  );
}

export function StreamerRail({ streamers }: { streamers: PublicStreamer[] }) {
  return (
    <section className="streamer-showcase">
      <div className="section-heading centered">
        <span className="eyebrow">Made for live channels</span>
        <h2>Built to disappear into your stream.</h2>
        <p>Set it once, then let each match create its own engagement moment.</p>
      </div>
      <div className="streamer-window">
        {streamers.length ? (
          <StreamerTrack streamers={streamers} />
        ) : (
          <div className="streamer-empty">
            <div>
              <strong>Early access channels are connecting now.</strong>
              <p>Streamers choose whether their channel appears here.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StreamerTrack({ streamers }: { streamers: PublicStreamer[] }) {
  // Repeat the roster to fill the marquee, then duplicate the whole loop so the
  // CSS animation can scroll seamlessly (matches the server-rendered rail).
  const loopLength = Math.max(6, streamers.length);
  const loop = Array.from(
    { length: loopLength },
    (_, index) => streamers[index % streamers.length]!,
  );
  const marquee = [...loop, ...loop];

  return (
    <div className="streamer-track">
      {marquee.map((streamer, index) => (
        <StreamerCard
          key={`${streamer.twitch_login}-${index}`}
          streamer={streamer}
          index={index}
        />
      ))}
    </div>
  );
}
