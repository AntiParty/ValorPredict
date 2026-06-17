import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../auth/AuthContext";
import { LandingHeader } from "../components/landing/LandingHeader";
import { LandingHero } from "../components/landing/LandingHero";
import { Metrics } from "../components/landing/Metrics";
import { SiteFooter } from "../components/landing/SiteFooter";
import { StreamerRail } from "../components/landing/StreamerRail";
import {
  Faq,
  FeatureGrid,
  FinalCta,
  Pricing,
  SafetySection,
  Workflow,
} from "../components/landing/StaticSections";
import { useReveal } from "../hooks/useReveal";
import { api } from "../lib/api";
import type { PublicStats } from "../types";

const EMPTY_STATS: PublicStats = {
  connectedStreamers: 0,
  predictionsRun: 0,
  channelPointsWagered: 0,
};

export function Landing() {
  const { user, flash } = useAuth();
  const { data } = useQuery({
    queryKey: ["public"],
    queryFn: api.public,
    staleTime: 60_000,
  });

  // Keep every section mounted from the first render so the reveal observer
  // (set up once below) can track them even before the public stats resolve.
  useReveal();

  const stats = data?.stats ?? EMPTY_STATS;
  const streamers = data?.streamers ?? [];

  return (
    <>
      <LandingHeader user={user} />
      <main>
        {flash ? (
          <div className={`flash ${flash.kind} landing-flash`}>{flash.message}</div>
        ) : null}
        <LandingHero user={user} />
        <Metrics stats={stats} />
        <StreamerRail streamers={streamers} />
        <FeatureGrid />
        <SafetySection />
        <Workflow />
        <Pricing user={user} />
        <Faq />
        <FinalCta user={user} />
      </main>
      <SiteFooter />
    </>
  );
}
