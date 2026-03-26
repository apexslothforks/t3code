import { describe, expect, it } from "vitest";

import { isThreadReadyForDispatch, shouldRetryThreadDispatchError } from "./threadDispatch";

describe("shouldRetryThreadDispatchError", () => {
  it("retries generic transport and timeout failures", () => {
    expect(shouldRetryThreadDispatchError(new Error("Request timed out: thread.turn.start"))).toBe(
      true,
    );
    expect(shouldRetryThreadDispatchError(new Error("Transport disposed"))).toBe(true);
  });

  it("does not retry invariant failures", () => {
    expect(
      shouldRetryThreadDispatchError(
        new Error("Orchestration command invariant failed (thread.turn.start): thread missing"),
      ),
    ).toBe(false);
    expect(
      shouldRetryThreadDispatchError(new Error("Command previously rejected (cmd-1): nope")),
    ).toBe(false);
  });
});

describe("isThreadReadyForDispatch", () => {
  it("allows dispatch while the session is in error", () => {
    expect(
      isThreadReadyForDispatch({
        session: {
          orchestrationStatus: "error",
        },
        activities: [],
      }),
    ).toBe(true);
  });

  it("treats a null active turn as idle", () => {
    expect(
      isThreadReadyForDispatch({
        session: {
          orchestrationStatus: "ready",
          activeTurnId: null,
        },
        activities: [],
      }),
    ).toBe(true);
  });
});
