import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../api";
import { user } from "../test/fixtures";
import { AccountMenu } from "./AccountMenu";

vi.mock("../api", () => ({ companionApi: { disconnectTwitch: vi.fn() } }));

describe("account menu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is closed until the account button is used", async () => {
    render(<AccountMenu user={user} onDisconnected={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /test_streamer/ });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Disconnect Twitch" })).toBeVisible();
  });

  it("opens from the keyboard and puts focus on the first item", async () => {
    render(<AccountMenu user={user} onDisconnected={vi.fn()} />);

    await userEvent.tab();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByRole("menuitem", { name: "Disconnect Twitch" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the button", async () => {
    render(<AccountMenu user={user} onDisconnected={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /test_streamer/ });
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on a click outside", async () => {
    render(
      <div>
        <AccountMenu user={user} onDisconnected={vi.fn()} />
        <p>Elsewhere</p>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: /test_streamer/ }));
    expect(screen.getByRole("menu")).toBeVisible();

    await userEvent.click(screen.getByText("Elsewhere"));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disconnects, then asks the app to reload its account", async () => {
    vi.mocked(companionApi.disconnectTwitch).mockResolvedValue(null);
    const onDisconnected = vi.fn();
    render(<AccountMenu user={user} onDisconnected={onDisconnected} />);

    await userEvent.click(screen.getByRole("button", { name: /test_streamer/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Disconnect Twitch" }));

    await waitFor(() => expect(onDisconnected).toHaveBeenCalledTimes(1));
    expect(companionApi.disconnectTwitch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open and explains when disconnecting fails", async () => {
    vi.mocked(companionApi.disconnectTwitch).mockRejectedValue("database is locked");
    const onDisconnected = vi.fn();
    render(<AccountMenu user={user} onDisconnected={onDisconnected} />);

    await userEvent.click(screen.getByRole("button", { name: /test_streamer/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Disconnect Twitch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it("disables Disconnect and says why while a prediction is open", async () => {
    render(<AccountMenu user={user} predictionOpen onDisconnected={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /test_streamer/ }));

    expect(screen.getByRole("menuitem", { name: "Disconnect Twitch" })).toBeDisabled();
    expect(screen.getByText("Resolve or cancel the open prediction first.")).toBeVisible();
    expect(companionApi.disconnectTwitch).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal if it still comes back", async () => {
    vi.mocked(companionApi.disconnectTwitch).mockRejectedValue(
      "Resolve or cancel the open prediction before disconnecting.",
    );
    const onDisconnected = vi.fn();
    render(<AccountMenu user={user} onDisconnected={onDisconnected} />);

    await userEvent.click(screen.getByRole("button", { name: /test_streamer/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Disconnect Twitch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Resolve or cancel the open prediction before disconnecting.",
    );
    expect(onDisconnected).not.toHaveBeenCalled();
  });
});
