import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { renderWithProviders } from "../../test/harness";
import type { SafeUser } from "../../types";
import { PublicShowcaseCard } from "./PublicShowcaseCard";

vi.mock("../../lib/api", () => ({
  api: { setShowcase: vi.fn() },
}));

const setShowcaseMock = vi.mocked(api.setShowcase);

const user = {
  twitch_login: "ace",
  twitch_display_name: "Ace",
  twitch_profile_image_url: null,
  public_showcase_enabled: false,
} as SafeUser;

beforeEach(() => {
  setShowcaseMock.mockReset();
  setShowcaseMock.mockResolvedValue({ ok: true, publicShowcaseEnabled: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PublicShowcaseCard", () => {
  it("saves the toggled visibility choice", async () => {
    renderWithProviders(<PublicShowcaseCard user={user} />);

    await userEvent.click(screen.getByLabelText(/Feature my channel publicly/i));
    await userEvent.click(screen.getByRole("button", { name: /Save visibility/i }));

    await waitFor(() => expect(setShowcaseMock).toHaveBeenCalledTimes(1));
    expect(setShowcaseMock).toHaveBeenCalledWith(true);
  });
});
