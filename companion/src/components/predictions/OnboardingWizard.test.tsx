import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../../api";
import type { MeResponse } from "../../types";
import { OnboardingWizard } from "./OnboardingWizard";

vi.mock("../../api", () => ({
  companionApi: {
    startHostedLogin: vi.fn(),
    importConnectionCodeFromClipboard: vi.fn(),
    importConnectionCode: vi.fn(),
    connectTwitch: vi.fn(),
    saveTwitchCredentials: vi.fn(),
  },
}));

// A build without the shared Twitch app: only the "own application" flow exists.
const unconfiguredMe: MeResponse = {
  user: null,
  configured: false,
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  authMode: "own",
  hostedAvailable: false,
  reauthRequired: false,
};

const configuredMe: MeResponse = {
  ...unconfiguredMe,
  configured: true,
};

// The normal build: hosted sign-in is available and active.
const hostedMe: MeResponse = {
  ...unconfiguredMe,
  configured: true,
  authMode: "hosted",
  hostedAvailable: true,
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

  describe("hosted sign-in", () => {
    beforeEach(() => {
      for (const fn of Object.values(companionApi)) vi.mocked(fn).mockReset();
    });

    it("starts on a single Connect step with no developer-app setup", () => {
      render(<OnboardingWizard me={hostedMe} onAdvance={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Connect Twitch" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Paste from clipboard" })).toBeVisible();
      expect(screen.queryByText(/Create your Twitch app/)).toBeNull();
      expect(screen.queryByRole("list", { name: "Setup progress" })).toBeNull();
    });

    it("opens the sign-in page, then imports the clipboard code", async () => {
      const onAdvance = vi.fn();
      vi.mocked(companionApi.startHostedLogin).mockResolvedValue(undefined);
      vi.mocked(companionApi.importConnectionCodeFromClipboard).mockResolvedValue({} as never);
      render(<OnboardingWizard me={hostedMe} onAdvance={onAdvance} />);

      await userEvent.click(screen.getByRole("button", { name: "Connect Twitch" }));
      expect(companionApi.startHostedLogin).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));
      expect(companionApi.importConnectionCodeFromClipboard).toHaveBeenCalledTimes(1);
      expect(onAdvance).toHaveBeenCalledTimes(1);
    });

    it("shows the backend's message when the code is wrong or expired", async () => {
      const onAdvance = vi.fn();
      vi.mocked(companionApi.importConnectionCodeFromClipboard).mockRejectedValue(
        "That code expired — click Connect Twitch again.",
      );
      render(<OnboardingWizard me={hostedMe} onAdvance={onAdvance} />);

      await userEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("That code expired");
      expect(onAdvance).not.toHaveBeenCalled();
    });

    it("masks the manual field and clears it after submitting", async () => {
      vi.mocked(companionApi.importConnectionCode).mockRejectedValue("nope");
      render(<OnboardingWizard me={hostedMe} onAdvance={vi.fn()} />);

      await userEvent.click(screen.getByText("Paste manually"));
      const field = screen.getByLabelText("Connection code");
      expect(field).toHaveAttribute("type", "password");

      await userEvent.type(field, "vp1_secretvalue");
      await userEvent.click(screen.getByRole("button", { name: "Connect" }));

      expect(companionApi.importConnectionCode).toHaveBeenCalledWith("vp1_secretvalue");
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(field).toHaveValue("");
      // The code must never be echoed into the page, even in the error.
      expect(document.body.textContent).not.toContain("vp1_secretvalue");
    });

    it("keeps the own-application path behind an advanced link and back again", async () => {
      render(<OnboardingWizard me={hostedMe} onAdvance={vi.fn()} />);

      await userEvent.click(
        screen.getByRole("button", { name: "Use my own Twitch application" }),
      );
      expect(screen.getByRole("heading", { name: "Create your Twitch app" })).toBeVisible();

      await userEvent.click(screen.getByRole("button", { name: /Back to simple sign-in/ }));
      expect(screen.getByRole("button", { name: "Paste from clipboard" })).toBeVisible();
    });

    it("explains honestly who holds the Twitch secret", () => {
      render(<OnboardingWizard me={hostedMe} onAdvance={vi.fn()} />);
      expect(screen.getByText(/open-source sign-in service/i)).toBeVisible();
      expect(screen.getByText(/never sees your Twitch password/i)).toBeVisible();
    });
  });
});
