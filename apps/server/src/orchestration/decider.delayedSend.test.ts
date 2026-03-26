import { describe, expect, it } from "vitest";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-03-08T10:00:00.000Z";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  updatedAt: now,
  projects: [
    {
      id: ProjectId.makeUnsafe("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      autoContinue: {
        enabled: false,
        messages: [],
        stopWithHeuristic: false,
        delayMinutes: 3,
        cooldownMinutes: 5,
      },
      delayedSend: null,
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      messages: [],
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      session: null,
    },
  ],
  delayedSends: [],
};

describe("decideOrchestrationCommand delayed-send", () => {
  it("emits thread.delayed-send-scheduled", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.delayed-send.schedule",
          commandId: CommandId.makeUnsafe("cmd-delayed-send-schedule"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: MessageId.makeUnsafe("message-1"),
          text: "later",
          attachments: [],
          dueAt: "2026-03-08T10:10:00.000Z",
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) {
      return;
    }
    const event = result as { type: string; payload: unknown };
    expect(event.type).toBe("thread.delayed-send-scheduled");
    expect(event.payload).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      messageId: MessageId.makeUnsafe("message-1"),
      text: "later",
      dueAt: "2026-03-08T10:10:00.000Z",
    });
  });

  it("emits thread.delayed-send-cancelled when a delayed send exists", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.delayed-send.cancel",
          commandId: CommandId.makeUnsafe("cmd-delayed-send-cancel"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          createdAt: now,
        },
        readModel: {
          ...readModel,
          delayedSends: [
            {
              threadId: ThreadId.makeUnsafe("thread-1"),
              messageId: MessageId.makeUnsafe("message-1"),
              text: "later",
              attachments: [],
              dueAt: "2026-03-08T10:10:00.000Z",
              runtimeMode: "full-access",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              createdAt: now,
            },
          ],
        },
      }),
    );

    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) {
      return;
    }
    const event = result as { type: string; payload: unknown };
    expect(event.type).toBe("thread.delayed-send-cancelled");
    expect(event.payload).toEqual({
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: now,
    });
  });
});
