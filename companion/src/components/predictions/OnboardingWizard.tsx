import { useEffect, useState } from "react";

import type { MeResponse } from "../../types";
import { Brand } from "./Brand";
import { ConnectStep } from "./ConnectStep";
import { CreateAppStep } from "./CreateAppStep";
import { CredentialsStep } from "./CredentialsStep";

const STEPS = ["Create app", "Add keys", "Connect"] as const;
type SetupStep = "create" | "credentials" | "connect";

interface Props {
  me: MeResponse;
  onAdvance: () => void;
}

export function OnboardingWizard({ me, onAdvance }: Props) {
  const [step, setStep] = useState<SetupStep>(
    me.configured ? "connect" : "create",
  );
  const [editingCredentials, setEditingCredentials] = useState(false);
  const stepIndex = step === "create" ? 0 : step === "credentials" ? 1 : 2;

  useEffect(() => {
    if (me.configured && !editingCredentials) setStep("connect");
  }, [me.configured, editingCredentials]);

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
              setStep(me.configured ? "connect" : "create");
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
      </section>
    </main>
  );
}
