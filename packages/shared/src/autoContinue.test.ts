import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND,
  AUTO_CONTINUE_DEFAULT_COOLDOWN_MINUTES,
  AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
  DEFAULT_AUTO_CONTINUE_MESSAGE,
  findLatestAutoContinueDelayResetActivity,
  findLatestAutoContinueSentActivity,
  getAutoContinueDelayAnchorAtMs,
  hasAutoContinueTriggeredForAssistantMessage,
  shouldStopAutoContinueWithHeuristic,
  getAutoContinueDispatchAtMs,
  normalizeAutoContinueMessages,
  normalizeAutoContinueSettings,
} from "./autoContinue";

function makeActivity(input: {
  id: string;
  createdAt: string;
  kind?: string;
  payload?: Record<string, unknown>;
}): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(input.id),
    createdAt: input.createdAt,
    tone: "info",
    kind: input.kind ?? "auto-continue.sent",
    summary: "Activity",
    payload: input.payload ?? {},
    turnId: null,
  };
}

describe("normalizeAutoContinueMessages", () => {
  it("trims, drops blanks, deduplicates, and caps message count", () => {
    const messages = normalizeAutoContinueMessages([
      "  go on  ",
      "",
      "go on",
      " keep going ",
      ...Array.from({ length: 20 }, (_, index) => `message ${index}`),
    ]);

    expect(messages[0]).toBe("go on");
    expect(messages[1]).toBe("keep going");
    expect(messages).toHaveLength(16);
  });

  it("caps each message at 200 characters", () => {
    const message = "x".repeat(250);

    expect(normalizeAutoContinueMessages([message])[0]).toHaveLength(200);
  });
});

describe("normalizeAutoContinueSettings", () => {
  it("falls back to the default message when enabled with no valid messages", () => {
    expect(
      normalizeAutoContinueSettings({
        enabled: true,
        messages: ["", "   "],
      }),
    ).toEqual({
      enabled: true,
      messages: [DEFAULT_AUTO_CONTINUE_MESSAGE],
      stopWithHeuristic: false,
      delayMinutes: AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
      cooldownMinutes: AUTO_CONTINUE_DEFAULT_COOLDOWN_MINUTES,
    });
  });

  it("keeps disabled settings disabled even with empty input", () => {
    expect(
      normalizeAutoContinueSettings({
        enabled: false,
        messages: [],
      }),
    ).toEqual({
      enabled: false,
      messages: [],
      stopWithHeuristic: false,
      delayMinutes: AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
      cooldownMinutes: AUTO_CONTINUE_DEFAULT_COOLDOWN_MINUTES,
    });
  });

  it("normalizes and clamps timer values", () => {
    expect(
      normalizeAutoContinueSettings({
        enabled: true,
        messages: ["go on"],
        delayMinutes: -1,
        cooldownMinutes: 9_999,
      }),
    ).toEqual({
      enabled: true,
      messages: ["go on"],
      stopWithHeuristic: false,
      delayMinutes: AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
      cooldownMinutes: 24 * 60,
    });
  });
});

describe("getAutoContinueDispatchAtMs", () => {
  it("waits for the configured delay", () => {
    expect(
      getAutoContinueDispatchAtMs({
        completedAt: "2026-03-08T10:00:00.000Z",
        settings: {
          enabled: true,
          messages: ["go on"],
          delayMinutes: 3,
          cooldownMinutes: 5,
        },
      }),
    ).toBe(Date.parse("2026-03-08T10:03:00.000Z"));
  });

  it("waits for cooldown if it extends past the delay window", () => {
    expect(
      getAutoContinueDispatchAtMs({
        completedAt: "2026-03-08T10:00:00.000Z",
        lastAutoContinueSentAt: "2026-03-08T09:59:00.000Z",
        settings: {
          enabled: true,
          messages: ["go on"],
          delayMinutes: 3,
          cooldownMinutes: 5,
        },
      }),
    ).toBe(Date.parse("2026-03-08T10:04:00.000Z"));
  });

  it("resets the delay window from the latest draft update", () => {
    expect(
      getAutoContinueDispatchAtMs({
        completedAt: "2026-03-08T10:00:00.000Z",
        delayResetAt: "2026-03-08T10:01:30.000Z",
        settings: {
          enabled: true,
          messages: ["go on"],
          delayMinutes: 3,
          cooldownMinutes: 5,
        },
      }),
    ).toBe(Date.parse("2026-03-08T10:04:30.000Z"));
  });
});

describe("getAutoContinueDelayAnchorAtMs", () => {
  it("anchors the timer to the latest draft reset when present", () => {
    expect(
      getAutoContinueDelayAnchorAtMs({
        completedAt: "2026-03-08T10:00:00.000Z",
        delayResetAt: "2026-03-08T10:01:30.000Z",
      }),
    ).toBe(Date.parse("2026-03-08T10:01:30.000Z"));
  });
});

describe("auto-continue activity helpers", () => {
  it("reads the latest auto-continue activity and matches triggering assistant ids", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "activity-1",
        createdAt: "2026-03-08T10:00:00.000Z",
        payload: {
          triggeringAssistantMessageId: "assistant-1",
          messageIndex: 0,
        },
      }),
      makeActivity({
        id: "activity-2",
        createdAt: "2026-03-08T10:05:00.000Z",
        payload: {
          triggeringAssistantMessageId: "assistant-2",
          messageIndex: 1,
        },
      }),
    ];

    expect(findLatestAutoContinueSentActivity(activities)?.payload.messageIndex).toBe(1);
    expect(hasAutoContinueTriggeredForAssistantMessage(activities, "assistant-2")).toBe(true);
    expect(hasAutoContinueTriggeredForAssistantMessage(activities, "assistant-3")).toBe(false);
  });

  it("finds the latest delay-reset activity", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "activity-1",
        createdAt: "2026-03-08T10:00:00.000Z",
        kind: AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND,
      }),
      makeActivity({
        id: "activity-2",
        createdAt: "2026-03-08T10:05:00.000Z",
        kind: AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND,
      }),
    ];

    expect(findLatestAutoContinueDelayResetActivity(activities)?.id).toBe(
      EventId.makeUnsafe("activity-2"),
    );
  });
});

describe("shouldStopAutoContinueWithHeuristic", () => {
  it("stops the chain when an automated turn finishes faster than the cooldown threshold", () => {
    expect(
      shouldStopAutoContinueWithHeuristic({
        messages: [
          {
            id: "auto-user-1",
            role: "user",
            createdAt: "2026-03-08T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            createdAt: "2026-03-08T10:03:00.000Z",
          },
        ],
        activities: [
          makeActivity({
            id: "activity-1",
            createdAt: "2026-03-08T10:00:00.000Z",
            payload: { messageId: "auto-user-1" },
          }),
        ],
        assistantMessageId: "assistant-1",
        completedAt: "2026-03-08T10:03:00.000Z",
        settings: {
          enabled: true,
          messages: ["go on"],
          stopWithHeuristic: true,
          delayMinutes: 1,
          cooldownMinutes: 5,
        },
      }),
    ).toBe(true);
  });

  it("keeps the chain alive for non-automated or slow-enough turns", () => {
    expect(
      shouldStopAutoContinueWithHeuristic({
        messages: [
          {
            id: "user-1",
            role: "user",
            createdAt: "2026-03-08T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            createdAt: "2026-03-08T10:03:00.000Z",
          },
        ],
        activities: [],
        assistantMessageId: "assistant-1",
        completedAt: "2026-03-08T10:03:00.000Z",
        settings: {
          enabled: true,
          messages: ["go on"],
          stopWithHeuristic: true,
          delayMinutes: 1,
          cooldownMinutes: 5,
        },
      }),
    ).toBe(false);

    expect(
      shouldStopAutoContinueWithHeuristic({
        messages: [
          {
            id: "auto-user-1",
            role: "user",
            createdAt: "2026-03-08T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            createdAt: "2026-03-08T10:06:00.000Z",
          },
        ],
        activities: [
          makeActivity({
            id: "activity-1",
            createdAt: "2026-03-08T10:00:00.000Z",
            payload: { messageId: "auto-user-1" },
          }),
        ],
        assistantMessageId: "assistant-1",
        completedAt: "2026-03-08T10:06:00.000Z",
        settings: {
          enabled: true,
          messages: ["go on"],
          stopWithHeuristic: true,
          delayMinutes: 1,
          cooldownMinutes: 5,
        },
      }),
    ).toBe(false);
  });
});
