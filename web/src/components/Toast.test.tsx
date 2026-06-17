import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const { push } = useToast();
  return (
    <button type="button" onClick={() => push({ kind: "success", message: "Saved." })}>
      fire
    </button>
  );
}

describe("ToastProvider", () => {
  it("renders a pushed toast and lets the user dismiss it", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByText("Saved.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });
});
