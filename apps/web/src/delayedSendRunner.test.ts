import { describe, expect, it } from "vitest";

import { isThreadReadyForDelayedSend } from "./delayedSendRunner";

describe("isThreadReadyForDelayedSend", () => {
  it("allows delayed send to dispatch while the session is in error", () => {
    expect(
      isThreadReadyForDelayedSend({
        session: {
          provider: "codex",
          status: "error",
          orchestrationStatus: "error",
          createdAt: "2026-03-13T00:00:00.000Z",
          updatedAt: "2026-03-13T00:00:00.000Z",
        },
        activities: [],
      }),
    ).toBe(true);
  });

  it("treats a null active turn as idle", () => {
    expect(
      isThreadReadyForDelayedSend({
        session: {
          provider: "codex",
          status: "ready",
          orchestrationStatus: "ready",
          activeTurnId: null as never,
          createdAt: "2026-03-13T00:00:00.000Z",
          updatedAt: "2026-03-13T00:00:00.000Z",
        },
        activities: [],
      }),
    ).toBe(true);
  });
});
