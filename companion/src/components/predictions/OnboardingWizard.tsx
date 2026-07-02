import { useState } from "react";

import type { MeResponse } from "../../types";
import { Brand } from "./Brand";
import { ConnectStep } from "./ConnectStep";
import { CreateAppStep } from "./CreateAppStep";
import { CredentialsStep } from "./CredentialsStep";

const STEPS = ["Create app", "Add keys", "Connect"] as const;

interface Props {
  me: MeResponse;
  // Re-reads auth state after each step (saving keys flips `configured`,
  // connecting sets `user`), which drives the wizard forward.
  onAdvance: () => void;
}

// One continuous setup flow for the self-hosted Twitch app. The current step is
// derived from auth state where possible — once credentials are saved the
// backend reports `configured`, so we jump straight to Connect — with a single
// piece of local state to move from "create app" to "add keys" before anything
// has been persisted.
export function OnboardingWizard({ me, onAdvance }: Props) {
  const [createdApp, setCreatedApp] = useState(false);
  const stepIndex = me.configured ? 2 : createdApp ? 1 : 0;

  return (
    <main className="companion-shell">
      <section className="card wizard-card">
        <Brand />

        <ol className="wizard-steps" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={
                index === stepIndex ? "current" : index < stepIndex ? "done" : ""
              }
              aria-current={index === stepIndex ? "step" : undefined}
            >
              <span className="wizard-steps__dot">{index < stepIndex ? "✓" : index + 1}</span>
              <span className="wizard-steps__label">{label}</span>
            </li>
          ))}
        </ol>

        {stepIndex === 0 && (
          <CreateAppStep redirectUri={me.redirectUri} onContinue={() => setCreatedApp(true)} />
        )}
        {stepIndex === 1 && (
          <CredentialsStep redirectUri={me.redirectUri} onSaved={onAdvance} />
        )}
        {stepIndex === 2 && <ConnectStep onConnected={onAdvance} />}
      </section>
    </main>
  );
}
