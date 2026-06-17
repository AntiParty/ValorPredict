import { Link } from "react-router-dom";

import type { SafeUser } from "../../types";

interface TrialCtaProps {
  user: SafeUser | null;
  className: string;
  withArrow?: boolean;
}

// Logged-in visitors stay inside the SPA (router Link to the dashboard);
// logged-out visitors hit the Express OAuth route with a real navigation.
export function TrialCta({ user, className, withArrow }: TrialCtaProps) {
  const label = user ? "Open Dashboard" : "Start free trial";
  const arrow = withArrow ? (
    <>
      {" "}
      <span aria-hidden="true">&rarr;</span>
    </>
  ) : null;

  if (user) {
    return (
      <Link className={className} to="/dashboard">
        {label}
        {arrow}
      </Link>
    );
  }

  return (
    <a className={className} href="/auth/twitch">
      {label}
      {arrow}
    </a>
  );
}
