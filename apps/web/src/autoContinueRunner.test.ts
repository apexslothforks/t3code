import { describe, expect, it } from "vitest";

import type { ThreadAutoContinueSettings } from "@t3tools/contracts";
import {
  deriveDelayedSendStatus,
  deriveAutoContinueStatusSnapshot,
  resolveEffectiveAutoContinueDelayResetAt,
} from "./automationStatus";
import type { Thread } from "./types";

describe("resolveEffectiveAutoContinueDelayResetAt", () => {
  it("prefers the newer local reset when automation was just armed", () => {
    const effectiveResetAt = resolveEffectiveAutoContinueDelayResetAt({
      activityDelayResetAt: "2026-03-26T10:00:00.000Z",
      localDelayResetAtMs: Date.parse("2026-03-26T10:05:00.000Z"),
    });

    expect(effectiveResetAt).toBe("2026-03-26T10:05:00.000Z");
  });

  it("keeps the newer activity reset when it is more recent than the local one", () => {
    const effectiveResetAt = resolveEffectiveAutoContinueDelayResetAt({
      activityDelayResetAt: "2026-03-26T10:06:00.000Z",
      localDelayResetAtMs: Date.parse("2026-03-26T10:05:00.000Z"),
    });

    expect(effectiveResetAt).toBe("2026-03-26T10:06:00.000Z");
  });
});

describe("deriveAutoContinueStatusSnapshot", () => {
  const autoContinue: ThreadAutoContinueSettings = {
    enabled: true,
    messages: ["go on"],
    stopWithHeuristic: false,
    delayMinutes: 0,
    cooldownMinutes: 1,
  };

  const baseThread: Pick<Thread, "messages" | "activities" | "autoContinue" | "session"> = {
    messages: [
      {
        id: "assistant-1" as never,
        role: "assistant",
        text: "done",
        streaming: false,
        createdAt: "2026-03-26T10:00:00.000Z",
        completedAt: "2026-03-26T10:00:10.000Z",
      },
    ],
    activities: [],
    autoContinue,
    session: {
      provider: "codex",
      status: "ready",
      orchestrationStatus: "ready",
      activeTurnId: null as never,
      createdAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:10.000Z",
    },
  };

  it("does not arm against the already-completed assistant message when settings just changed", () => {
    const status = deriveAutoContinueStatusSnapshot({
      thread: baseThread,
      nowMs: Date.parse("2026-03-26T10:00:12.000Z"),
      localDelayResetAtMs: Date.parse("2026-03-26T10:00:12.000Z"),
      ignoredAssistantMessageId: "assistant-1",
    });

    expect(status).toBeNull();
  });

  it("waits for cooldown after an auto-send, then arms again for the next assistant reply", () => {
    const threadAfterOneAutoSend: Pick<
      Thread,
      "messages" | "activities" | "autoContinue" | "session"
    > = {
      ...baseThread,
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "first done",
          streaming: false,
          createdAt: "2026-03-26T10:00:00.000Z",
          completedAt: "2026-03-26T10:00:10.000Z",
        },
        {
          id: "auto-user-1" as never,
          role: "user",
          text: "go on",
          streaming: false,
          createdAt: "2026-03-26T10:00:12.000Z",
        },
        {
          id: "assistant-2" as never,
          role: "assistant",
          text: "second done",
          streaming: false,
          createdAt: "2026-03-26T10:00:20.000Z",
          completedAt: "2026-03-26T10:00:30.000Z",
        },
      ],
      activities: [
        {
          id: "activity-1" as never,
          tone: "info",
          kind: "auto-continue.sent",
          summary: "Auto-continue sent",
          payload: {
            triggeringAssistantMessageId: "assistant-1",
            messageId: "auto-user-1",
            messageText: "go on",
            messageIndex: 0,
          },
          turnId: null,
          createdAt: "2026-03-26T10:00:12.000Z",
        },
      ],
    };

    const beforeCooldown = deriveAutoContinueStatusSnapshot({
      thread: threadAfterOneAutoSend,
      nowMs: Date.parse("2026-03-26T10:00:40.000Z"),
    });
    expect(beforeCooldown?.remainingMs).toBeGreaterThan(0);

    const afterCooldown = deriveAutoContinueStatusSnapshot({
      thread: threadAfterOneAutoSend,
      nowMs: Date.parse("2026-03-26T10:01:13.000Z"),
    });
    expect(afterCooldown).not.toBeNull();
    expect(afterCooldown?.assistantMessageId).toBe("assistant-2");
  });
});

describe("deriveDelayedSendStatus", () => {
  it("derives delayed send display state from the thread snapshot", () => {
    const status = deriveDelayedSendStatus({
      delayedSend: {
        threadId: "thread-1" as never,
        messageId: "message-1" as never,
        text: "ship it",
        attachments: [],
        dueAt: "2026-03-26T10:05:00.000Z",
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: "2026-03-26T10:00:00.000Z",
      },
      nowMs: Date.parse("2026-03-26T10:04:30.000Z"),
    });

    expect(status).toEqual({
      scheduledAt: "2026-03-26T10:00:00.000Z",
      dispatchAtMs: Date.parse("2026-03-26T10:05:00.000Z"),
      message: "ship it",
      remainingMs: 30_000,
    });
  });

  it("returns null when no delayed send is scheduled", () => {
    expect(deriveDelayedSendStatus({ delayedSend: undefined, nowMs: Date.now() })).toBeNull();
  });
});
