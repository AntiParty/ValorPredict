import { useEffect, useState } from "react";

import type { MeResponse } from "../../types";
import { Brand } from "./Brand";
import { ConnectStep } from "./ConnectStep";
import { CreateAppStep } from "./CreateAppStep";
import { CredentialsStep } from "./CredentialsStep";
import { HostedConnectStep } from "./HostedConnectStep";

const STEPS = ["Create app", "Add keys", "Connect"] as const;
type SetupStep = "create" | "credentials" | "connect";

interface Props {
  me: MeResponse;
  onAdvance: () => void;
}

export function OnboardingWizard({ me, onAdvance }: Props) {
  // The user's own Twitch application is configured (the Advanced path). The hosted
  // runtime also reports `configured`, but that means nothing here: it needs no keys.
  const ownConfigured = me.configured && me.authMode === "own";
  // Hosted sign-in is the default whenever this build ships with the shared app.
  const [advanced, setAdvanced] = useState(!me.hostedAvailable || ownConfigured);
  const [step, setStep] = useState<SetupStep>(ownConfigured ? "connect" : "create");
  const [editingCredentials, setEditingCredentials] = useState(false);
  const stepIndex = step === "create" ? 0 : step === "credentials" ? 1 : 2;

  useEffect(() => {
    if (ownConfigured && !editingCredentials) setStep("connect");
  }, [ownConfigured, editingCredentials]);

  if (!advanced) {
    return (
      <main className="companion-shell">
        <section className="card wizard-card">
          <Brand />
          <HostedConnectStep
            onConnected={onAdvance}
            onUseOwnApp={() => {
              setStep("create");
              setAdvanced(true);
            }}
          />
        </section>
      </main>
    );
  }

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

        {step === "create" && (
          <CreateAppStep
            redirectUri={me.redirectUri}
            onContinue={() => setStep("credentials")}
          />
        )}
        {step === "credentials" && (
          <CredentialsStep
            redirectUri={me.redirectUri}
            onBack={() => {
              setEditingCredentials(false);
              setStep(ownConfigured ? "connect" : "create");
            }}
            onSaved={() => {
              setEditingCredentials(false);
              setStep("connect");
              onAdvance();
            }}
          />
        )}
        {step === "connect" && (
          <ConnectStep
            onConnected={onAdvance}
            onEditCredentials={() => {
              setEditingCredentials(true);
              setStep("credentials");
            }}
          />
        )}

        {me.hostedAvailable && !ownConfigured && (
          <p className="field-note">
            <button className="link-button" type="button" onClick={() => setAdvanced(false)}>
              ← Back to simple sign-in
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
