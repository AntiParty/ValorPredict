import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MeResponse } from "../../types";
import { OnboardingWizard } from "./OnboardingWizard";

const unconfiguredMe: MeResponse = {
  user: null,
  configured: false,
  redirectUri: "http://localhost:3000/auth/twitch/callback",
};

const configuredMe: MeResponse = {
  ...unconfiguredMe,
  configured: true,
};

describe("Twitch onboarding", () => {
  it("lets an unconfigured user go back from keys to app creation", async () => {
    render(<OnboardingWizard me={unconfiguredMe} onAdvance={vi.fn()} />);

    await userEvent.click(
      screen.getByRole("button", { name: "I've created my app" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { name: "Create your Twitch app" }),
    ).toBeVisible();
  });

  it("shows eligibility and an edit path before Twitch authorization", () => {
    render(<OnboardingWizard me={configuredMe} onAdvance={vi.fn()} />);

    expect(screen.getByText(/Affiliate or Partner/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Edit credentials" }),
    ).toBeVisible();
    expect(screen.getByText(/return to ValorPredict/i)).toBeVisible();
  });

  it("explains that saved credentials remain local", async () => {
    render(<OnboardingWizard me={unconfiguredMe} onAdvance={vi.fn()} />);

    await userEvent.click(
      screen.getByRole("button", { name: "I've created my app" }),
    );

    expect(screen.getByText(/stored only on this PC/i)).toBeVisible();
  });
});
