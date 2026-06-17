import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { renderWithProviders } from "../../test/harness";
import type { SafeUser } from "../../types";
import { CompanionCard } from "./CompanionCard";

vi.mock("../../lib/api", () => ({
  api: { generateLocalKey: vi.fn() },
}));

const generateMock = vi.mocked(api.generateLocalKey);

const newUser = {
  has_local_api_key: false,
  local_api_key_created_at: null,
} as SafeUser;

beforeEach(() => {
  generateMock.mockReset().mockResolvedValue({
    ok: true,
    apiKey: "vap_secret_key",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CompanionCard", () => {
  it("generates a key and reveals it exactly once", async () => {
    renderWithProviders(<CompanionCard user={newUser} />);

    expect(screen.queryByDisplayValue("vap_secret_key")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Generate Local API Key/i }),
    );

    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByDisplayValue("vap_secret_key")).toBeInTheDocument();
  });
});
