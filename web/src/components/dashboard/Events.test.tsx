import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PredictionEvent } from "../../types";
import { Events } from "./Events";

const event: PredictionEvent = {
  id: 1,
  twitch_user_id: "u1",
  session_id: 1,
  type: "prediction_created",
  message: "Prediction opened for Competitive.",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("Events", () => {
  it("renders events with a friendly title and message", () => {
    render(<Events events={[event]} developmentMode={false} />);

    expect(screen.getByText("Prediction started")).toBeInTheDocument();
    expect(screen.getByText("Prediction opened for Competitive.")).toBeInTheDocument();
  });

  it("shows an empty state when there are no events", () => {
    render(<Events events={[]} developmentMode={false} />);

    expect(
      screen.getByText(/Your prediction activity will appear here/i),
    ).toBeInTheDocument();
  });
});
