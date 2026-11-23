import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { event } from "../../test/fixtures";
import { HealthBanners } from "./HealthBanners";

describe("HealthBanners", () => {
  it("renders nothing when there is no problem to act on", () => {
    const { container } = render(
      <HealthBanners reauthRequired={false} latestEvent={null} onReconnect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("never announces 'paused' or 'waiting for Valorant': the status card owns those", () => {
    const { container } = render(
      <HealthBanners reauthRequired={false} onReconnect={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/paused|waiting for valorant/i);
  });

  it("asks to reconnect only when the sign-in was refused", async () => {
    const onReconnect = vi.fn();
    const { rerender } = render(
      <HealthBanners reauthRequired={false} onReconnect={onReconnect} />,
    );
    expect(screen.queryByText(/sign-in expired/i)).toBeNull();

    rerender(<HealthBanners reauthRequired onReconnect={onReconnect} />);
    expect(screen.getByText(/sign-in expired/i)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("shows why reconnecting failed", async () => {
    render(
      <HealthBanners
        reauthRequired
        onReconnect={vi.fn().mockRejectedValue("Twitch closed the window")}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(await screen.findByText("Twitch closed the window")).toBeVisible();
  });

  it("explains a failed prediction when the newest event is an error", () => {
    render(
      <HealthBanners
        reauthRequired={false}
        latestEvent={event(9, "prediction_error", "Channel points are not enabled")}
        onReconnect={vi.fn()}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("The last prediction failed");
    expect(banner).toHaveTextContent("Channel points are not enabled");
    expect(banner).toHaveTextContent("5 min ago");
  });

  it("ignores failed resolve/cancel actions: only a failed open counts", () => {
    const { container } = render(
      <HealthBanners
        reauthRequired={false}
        latestEvent={event(9, "prediction_action_error", "Twitch said no")}
        onReconnect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("stays quiet when the newest event is not an error", () => {
    const { container } = render(
      <HealthBanners
        reauthRequired={false}
        latestEvent={event(9, "prediction_created", "Opened")}
        onReconnect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
