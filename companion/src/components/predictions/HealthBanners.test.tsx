import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DetectionStatus } from "../../types";
import { HealthBanners } from "./HealthBanners";

const status = { monitoring: true, valorantRunning: true } as DetectionStatus;

describe("HealthBanners", () => {
  it("asks to reconnect only when the backend says the sign-in was refused", async () => {
    const onReconnect = vi.fn();
    const { rerender } = render(
      <HealthBanners
        status={status}
        reauthRequired={false}
        onStartMonitoring={vi.fn()}
        onReconnect={onReconnect}
      />,
    );
    expect(screen.queryByText(/sign-in expired/i)).toBeNull();

    rerender(
      <HealthBanners
        status={status}
        reauthRequired
        onStartMonitoring={vi.fn()}
        onReconnect={onReconnect}
      />,
    );
    expect(screen.getByText(/sign-in expired/i)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
