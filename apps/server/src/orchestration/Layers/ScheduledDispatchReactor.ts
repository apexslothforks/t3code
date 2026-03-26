import {
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ThreadDelayedSend,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import {
  AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND,
  findLatestAutoContinueDelayResetActivity,
  findLatestAutoContinueSentActivity,
  getAutoContinueDispatchAtMs,
  hasAutoContinueTriggeredForAssistantMessage,
  normalizeAutoContinueSettings,
  shouldStopAutoContinueWithHeuristic,
} from "@t3tools/shared/autoContinue";
import {
  isThreadReadyForDispatch,
  shouldRetryThreadDispatchError,
} from "@t3tools/shared/threadDispatch";
import { Effect, Fiber, Layer, Queue, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ScheduledDispatchReactor,
  type ScheduledDispatchReactorShape,
} from "../Services/ScheduledDispatchReactor.ts";

type DelayedSendEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.activity-appended"
      | "thread.created"
      | "thread.delayed-send-cancelled"
      | "thread.delayed-send-dispatched"
      | "thread.delayed-send-scheduled"
      | "thread.session-set";
  }
>;

type AutoContinueEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.activity-appended"
      | "thread.auto-continue-set"
      | "thread.deleted"
      | "thread.message-sent"
      | "thread.session-set";
  }
>;

interface DelayedSendCandidate extends ThreadDelayedSend {
  readonly retryCount: number;
  readonly retryAtMs: number | null;
}

interface AutoContinueCandidate {
  readonly assistantMessageId: MessageId;
  readonly turnId: TurnId | null;
  readonly completedAt: string;
  readonly retryCount: number;
  readonly retryAtMs: number | null;
}

type ScheduledDispatchSignal =
  | DelayedSendEvent
  | AutoContinueEvent
  | {
      readonly type: "delayed-send.wake";
      readonly threadId: ThreadId;
      readonly wakeAtMs: number;
    }
  | {
      readonly type: "auto-continue.wake";
      readonly threadId: ThreadId;
      readonly assistantMessageId: MessageId;
    };

const DELAYED_SEND_RETRY_DELAY_MS = 5_000;
const DELAYED_SEND_MAX_RETRIES = 3;
const DELAYED_SEND_WAIT_POLL_MS = 1_000;
const AUTO_CONTINUE_RETRY_DELAY_MS = 3_000;
const AUTO_CONTINUE_MAX_RETRIES = 3;

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const sameModelSelection = (left: ModelSelection, right: ModelSelection | undefined) =>
  JSON.stringify(left) === JSON.stringify(right ?? left);

const findLatestNonSystemMessage = (
  thread: Readonly<{
    messages: ReadonlyArray<{
      id: MessageId;
      role: string;
      createdAt: string;
      updatedAt: string;
      turnId: TurnId | null;
      streaming: boolean;
    }>;
  }>,
) =>
  [...thread.messages]
    .filter((message) => message.role !== "system")
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .at(-1) ?? null;

const findLatestSettledAssistantMessage = (
  thread: Pick<OrchestrationThread, "messages">,
): {
  readonly id: MessageId;
  readonly turnId: TurnId | null;
  readonly completedAt: string;
} | null => {
  const latestMessage = findLatestNonSystemMessage(thread);
  if (!latestMessage || latestMessage.role !== "assistant" || latestMessage.streaming) {
    return null;
  }
  return {
    id: latestMessage.id,
    turnId: latestMessage.turnId,
    completedAt: latestMessage.updatedAt,
  };
};

const isThreadDispatchReady = (thread: Pick<OrchestrationThread, "activities" | "session">) =>
  isThreadReadyForDispatch({
    session: thread.session
      ? {
          orchestrationStatus: thread.session.status,
          activeTurnId: thread.session.activeTurnId,
        }
      : null,
    activities: thread.activities,
  });

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

  const delayedSendByThreadId = new Map<ThreadId, DelayedSendCandidate>();
  const delayedSendWakeByThreadId = new Map<
    ThreadId,
    {
      wakeAtMs: number;
      fiber: Fiber.Fiber<void, never>;
    }
  >();

  const autoContinueCandidatesByThreadId = new Map<ThreadId, AutoContinueCandidate>();
  const autoContinueWakeByThreadId = new Map<
    ThreadId,
    {
      assistantMessageId: MessageId;
      dispatchAtMs: number;
      fiber: Fiber.Fiber<void, never>;
    }
  >();

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    return readModel.threads.find((entry) => entry.id === threadId) ?? null;
  });

  const clearDelayedSendWake = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const scheduledWake = delayedSendWakeByThreadId.get(threadId);
      if (!scheduledWake) {
        return;
      }
      delayedSendWakeByThreadId.delete(threadId);
      yield* Fiber.interrupt(scheduledWake.fiber).pipe(Effect.asVoid);
    });

  const clearDelayedSendCandidate = (threadId: ThreadId) =>
    Effect.gen(function* () {
      delayedSendByThreadId.delete(threadId);
      yield* clearDelayedSendWake(threadId);
    });

  const ensureDelayedSendWake = (input: {
    readonly queue: Queue.Queue<ScheduledDispatchSignal>;
    readonly threadId: ThreadId;
    readonly wakeAtMs: number;
  }) =>
    Effect.gen(function* () {
      const existingWake = delayedSendWakeByThreadId.get(input.threadId);
      if (existingWake?.wakeAtMs === input.wakeAtMs) {
        return;
      }
      yield* clearDelayedSendWake(input.threadId);
      const fiber = yield* Effect.forkScoped(
        Effect.sleep(`${Math.max(0, input.wakeAtMs - Date.now())} millis`).pipe(
          Effect.flatMap(() => Queue.offer(input.queue, { type: "delayed-send.wake", ...input })),
          Effect.asVoid,
        ),
      );
      delayedSendWakeByThreadId.set(input.threadId, {
        wakeAtMs: input.wakeAtMs,
        fiber,
      });
    });

  const cancelDelayedSend = (threadId: ThreadId, createdAt: string) =>
    orchestrationEngine.dispatch({
      type: "thread.delayed-send.cancel",
      commandId: serverCommandId("delayed-send-cancel"),
      threadId,
      createdAt,
    });

  const appendDelayedSendFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly messageId: ThreadDelayedSend["messageId"];
    readonly dueAt: string;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("delayed-send-failed"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: "delayed-send.failed",
        summary: "Delayed send failed",
        payload: {
          messageId: input.messageId,
          dueAt: input.dueAt,
          detail: input.detail,
        },
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const persistThreadSettingsForDelayedSend = (input: {
    readonly candidate: DelayedSendCandidate;
    readonly thread: Pick<
      OrchestrationThread,
      "id" | "interactionMode" | "modelSelection" | "runtimeMode"
    >;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      if (!sameModelSelection(input.thread.modelSelection, input.candidate.modelSelection)) {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: serverCommandId("delayed-send-thread-meta"),
          threadId: input.thread.id,
          modelSelection: input.candidate.modelSelection,
        });
      }
      if (input.thread.runtimeMode !== input.candidate.runtimeMode) {
        yield* orchestrationEngine.dispatch({
          type: "thread.runtime-mode.set",
          commandId: serverCommandId("delayed-send-runtime-mode"),
          threadId: input.thread.id,
          runtimeMode: input.candidate.runtimeMode,
          createdAt: input.createdAt,
        });
      }
      if (input.thread.interactionMode !== input.candidate.interactionMode) {
        yield* orchestrationEngine.dispatch({
          type: "thread.interaction-mode.set",
          commandId: serverCommandId("delayed-send-interaction-mode"),
          threadId: input.thread.id,
          interactionMode: input.candidate.interactionMode,
          createdAt: input.createdAt,
        });
      }
    });

  const ensureThreadExists = (candidate: DelayedSendCandidate) =>
    Effect.gen(function* () {
      const existingThread = yield* resolveThread(candidate.threadId);
      if (existingThread) {
        return existingThread;
      }
      if (!candidate.createThread) {
        return null;
      }
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: serverCommandId("delayed-send-thread-create"),
        threadId: candidate.threadId,
        projectId: candidate.createThread.projectId,
        title: candidate.createThread.title,
        modelSelection: candidate.createThread.modelSelection,
        runtimeMode: candidate.createThread.runtimeMode,
        interactionMode: candidate.createThread.interactionMode,
        branch: candidate.createThread.branch,
        worktreePath: candidate.createThread.worktreePath,
        autoContinue: candidate.createThread.autoContinue,
        createdAt: candidate.createThread.createdAt,
      });
      return yield* resolveThread(candidate.threadId);
    });

  const scheduleDelayedSendRetry = (input: {
    readonly queue: Queue.Queue<ScheduledDispatchSignal>;
    readonly candidate: DelayedSendCandidate;
  }) =>
    Effect.gen(function* () {
      const retryCount = input.candidate.retryCount + 1;
      if (retryCount > DELAYED_SEND_MAX_RETRIES) {
        return false;
      }
      const retryAtMs = Date.now() + DELAYED_SEND_RETRY_DELAY_MS;
      delayedSendByThreadId.set(input.candidate.threadId, {
        ...input.candidate,
        retryCount,
        retryAtMs,
      });
      yield* ensureDelayedSendWake({
        queue: input.queue,
        threadId: input.candidate.threadId,
        wakeAtMs: retryAtMs,
      });
      return true;
    });

  const tryDispatchDelayedSend = (
    queue: Queue.Queue<ScheduledDispatchSignal>,
    threadId: ThreadId,
  ) =>
    Effect.gen(function* () {
      const candidate = delayedSendByThreadId.get(threadId);
      if (!candidate) {
        return;
      }

      const dueAtMs = Date.parse(candidate.dueAt);
      const nextWakeAtMs = candidate.retryAtMs ?? dueAtMs;
      if (Number.isFinite(nextWakeAtMs) && Date.now() < nextWakeAtMs) {
        yield* ensureDelayedSendWake({ queue, threadId, wakeAtMs: nextWakeAtMs });
        return;
      }

      const dispatchFailure = yield* Effect.gen(function* () {
        const thread = yield* ensureThreadExists(candidate);
        if (!thread) {
          yield* clearDelayedSendCandidate(threadId);
          yield* cancelDelayedSend(threadId, new Date().toISOString()).pipe(
            Effect.catch(() => Effect.void),
          );
          return null;
        }

        const createdAt = new Date().toISOString();
        yield* persistThreadSettingsForDelayedSend({
          candidate,
          thread,
          createdAt,
        });

        const refreshedThread = (yield* resolveThread(threadId)) ?? thread;
        if (!isThreadDispatchReady(refreshedThread)) {
          yield* ensureDelayedSendWake({
            queue,
            threadId,
            wakeAtMs: Date.now() + DELAYED_SEND_WAIT_POLL_MS,
          });
          return null;
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.delayed-send.dispatch",
          commandId: serverCommandId("delayed-send-dispatch"),
          threadId,
          createdAt,
        });
        yield* clearDelayedSendCandidate(threadId);
        return null;
      }).pipe(Effect.catch((error) => Effect.succeed(error)));

      if (dispatchFailure === null) {
        return;
      }
      if (shouldRetryThreadDispatchError(dispatchFailure)) {
        const didScheduleRetry = yield* scheduleDelayedSendRetry({ queue, candidate });
        if (didScheduleRetry) {
          return;
        }
      }

      yield* clearDelayedSendCandidate(threadId);
      const detail =
        dispatchFailure instanceof Error
          ? dispatchFailure.message
          : "Delayed send dispatch failed.";
      const createdAt = new Date().toISOString();
      yield* appendDelayedSendFailureActivity({
        threadId,
        messageId: candidate.messageId,
        dueAt: candidate.dueAt,
        detail,
        createdAt,
      }).pipe(Effect.catch(() => Effect.void));
      yield* cancelDelayedSend(threadId, createdAt).pipe(Effect.catch(() => Effect.void));
    });

  const syncDelayedSendCandidate = (
    queue: Queue.Queue<ScheduledDispatchSignal>,
    delayedSend: ThreadDelayedSend,
  ) =>
    Effect.gen(function* () {
      delayedSendByThreadId.set(delayedSend.threadId, {
        ...delayedSend,
        retryCount: 0,
        retryAtMs: null,
      });
      yield* tryDispatchDelayedSend(queue, delayedSend.threadId);
    });

  const clearAutoContinueWake = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const scheduledWake = autoContinueWakeByThreadId.get(threadId);
      if (!scheduledWake) {
        return;
      }
      autoContinueWakeByThreadId.delete(threadId);
      yield* Fiber.interrupt(scheduledWake.fiber).pipe(Effect.asVoid);
    });

  const clearAutoContinueCandidate = (threadId: ThreadId) =>
    Effect.gen(function* () {
      autoContinueCandidatesByThreadId.delete(threadId);
      yield* clearAutoContinueWake(threadId);
    });

  const ensureAutoContinueWake = (input: {
    readonly queue: Queue.Queue<ScheduledDispatchSignal>;
    readonly threadId: ThreadId;
    readonly assistantMessageId: MessageId;
    readonly dispatchAtMs: number;
  }) =>
    Effect.gen(function* () {
      const existingWake = autoContinueWakeByThreadId.get(input.threadId);
      if (
        existingWake?.assistantMessageId === input.assistantMessageId &&
        existingWake.dispatchAtMs === input.dispatchAtMs
      ) {
        return;
      }
      yield* clearAutoContinueWake(input.threadId);
      const fiber = yield* Effect.forkScoped(
        Effect.sleep(`${Math.max(0, input.dispatchAtMs - Date.now())} millis`).pipe(
          Effect.flatMap(() =>
            Queue.offer(input.queue, {
              type: "auto-continue.wake",
              threadId: input.threadId,
              assistantMessageId: input.assistantMessageId,
            }),
          ),
          Effect.asVoid,
        ),
      );
      autoContinueWakeByThreadId.set(input.threadId, {
        assistantMessageId: input.assistantMessageId,
        dispatchAtMs: input.dispatchAtMs,
        fiber,
      });
    });

  const appendAutoContinueFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly triggeringAssistantMessageId: MessageId;
    readonly triggeringTurnId: TurnId | null;
    readonly messageText: string;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("auto-continue-failed"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: "auto-continue.failed",
        summary: "Auto-continue failed",
        payload: {
          triggeringAssistantMessageId: input.triggeringAssistantMessageId,
          ...(input.triggeringTurnId ? { triggeringTurnId: input.triggeringTurnId } : {}),
          messageText: input.messageText,
          detail: input.detail,
        },
        turnId: input.triggeringTurnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const syncAutoContinueCandidate = (
    queue: Queue.Queue<ScheduledDispatchSignal>,
    thread: Pick<OrchestrationThread, "deletedAt" | "id" | "messages">,
  ) =>
    Effect.gen(function* () {
      if (thread.deletedAt !== null) {
        yield* clearAutoContinueCandidate(thread.id);
        return;
      }
      const latestAssistantMessage = findLatestSettledAssistantMessage(thread);
      if (!latestAssistantMessage) {
        yield* clearAutoContinueCandidate(thread.id);
        return;
      }
      autoContinueCandidatesByThreadId.set(thread.id, {
        assistantMessageId: latestAssistantMessage.id,
        turnId: latestAssistantMessage.turnId,
        completedAt: latestAssistantMessage.completedAt,
        retryCount: 0,
        retryAtMs: null,
      });
      yield* tryTriggerAutoContinue(queue, thread.id);
    });

  const refreshAutoContinueCandidate = (
    queue: Queue.Queue<ScheduledDispatchSignal>,
    threadId: ThreadId,
  ) =>
    Effect.gen(function* () {
      const thread = yield* resolveThread(threadId);
      if (!thread) {
        yield* clearAutoContinueCandidate(threadId);
        return;
      }
      yield* syncAutoContinueCandidate(queue, thread);
    });

  const tryTriggerAutoContinue = (
    queue: Queue.Queue<ScheduledDispatchSignal>,
    threadId: ThreadId,
  ) =>
    Effect.gen(function* () {
      const candidate = autoContinueCandidatesByThreadId.get(threadId);
      if (!candidate) {
        return;
      }

      const nowMs = Date.now();
      if (candidate.retryAtMs !== null && nowMs < candidate.retryAtMs) {
        yield* ensureAutoContinueWake({
          queue,
          threadId,
          assistantMessageId: candidate.assistantMessageId,
          dispatchAtMs: candidate.retryAtMs,
        });
        return;
      }

      const activeCandidate =
        candidate.retryAtMs === null
          ? candidate
          : {
              ...candidate,
              retryAtMs: null,
            };
      if (activeCandidate !== candidate) {
        autoContinueCandidatesByThreadId.set(threadId, activeCandidate);
      }

      const thread = yield* resolveThread(threadId);
      if (!thread || thread.deletedAt !== null) {
        yield* clearAutoContinueCandidate(threadId);
        return;
      }

      const autoContinue = normalizeAutoContinueSettings(thread.autoContinue);
      if (!autoContinue.enabled || autoContinue.messages.length === 0) {
        yield* clearAutoContinueCandidate(threadId);
        return;
      }

      const latestNonSystemMessage = findLatestNonSystemMessage(thread);
      if (
        !latestNonSystemMessage ||
        latestNonSystemMessage.role !== "assistant" ||
        latestNonSystemMessage.id !== activeCandidate.assistantMessageId
      ) {
        yield* clearAutoContinueCandidate(threadId);
        return;
      }

      if (
        hasAutoContinueTriggeredForAssistantMessage(
          thread.activities,
          activeCandidate.assistantMessageId,
        )
      ) {
        yield* clearAutoContinueCandidate(threadId);
        return;
      }

      if (
        shouldStopAutoContinueWithHeuristic({
          messages: thread.messages,
          activities: thread.activities,
          assistantMessageId: activeCandidate.assistantMessageId,
          completedAt: activeCandidate.completedAt,
          settings: autoContinue,
        })
      ) {
        yield* clearAutoContinueCandidate(threadId);
        return;
      }

      const latestAutoContinue = findLatestAutoContinueSentActivity(thread.activities);
      const latestDelayReset = findLatestAutoContinueDelayResetActivity(thread.activities);
      const dispatchAtMs = getAutoContinueDispatchAtMs({
        completedAt: activeCandidate.completedAt,
        lastAutoContinueSentAt: latestAutoContinue?.createdAt,
        delayResetAt: latestDelayReset?.createdAt,
        settings: autoContinue,
      });
      if (nowMs < dispatchAtMs) {
        yield* ensureAutoContinueWake({
          queue,
          threadId,
          assistantMessageId: activeCandidate.assistantMessageId,
          dispatchAtMs,
        });
        return;
      }

      yield* clearAutoContinueWake(threadId);

      if (!isThreadDispatchReady(thread)) {
        return;
      }

      const lastMessageIndex = latestAutoContinue?.payload.messageIndex;
      const messageIndex =
        typeof lastMessageIndex === "number" && Number.isInteger(lastMessageIndex)
          ? (lastMessageIndex + 1) % autoContinue.messages.length
          : 0;
      const messageText = autoContinue.messages[messageIndex];
      if (!messageText) {
        return;
      }

      const createdAt = new Date().toISOString();
      const dispatchFailure = yield* orchestrationEngine
        .dispatch({
          type: "thread.auto-continue.trigger",
          commandId: serverCommandId("auto-continue-trigger"),
          threadId,
          messageId: MessageId.makeUnsafe(`auto-continue:${threadId}:${crypto.randomUUID()}`),
          text: messageText,
          triggeringAssistantMessageId: activeCandidate.assistantMessageId,
          ...(activeCandidate.turnId ? { triggeringTurnId: activeCandidate.turnId } : {}),
          messageIndex,
          createdAt,
        })
        .pipe(
          Effect.as<unknown | null>(null),
          Effect.catch((error) => Effect.succeed(error)),
        );

      autoContinueCandidatesByThreadId.delete(threadId);
      if (dispatchFailure === null) {
        return;
      }

      if (shouldRetryThreadDispatchError(dispatchFailure)) {
        const retryCount = activeCandidate.retryCount + 1;
        if (retryCount < AUTO_CONTINUE_MAX_RETRIES) {
          const retryAtMs = Date.now() + AUTO_CONTINUE_RETRY_DELAY_MS;
          autoContinueCandidatesByThreadId.set(threadId, {
            ...activeCandidate,
            retryCount,
            retryAtMs,
          });
          yield* ensureAutoContinueWake({
            queue,
            threadId,
            assistantMessageId: activeCandidate.assistantMessageId,
            dispatchAtMs: retryAtMs,
          });
          return;
        }
      }

      const detail =
        dispatchFailure instanceof Error && dispatchFailure.message.length > 0
          ? dispatchFailure.message
          : "Auto-continue dispatch failed.";

      yield* appendAutoContinueFailureActivity({
        threadId,
        triggeringAssistantMessageId: activeCandidate.assistantMessageId,
        triggeringTurnId: activeCandidate.turnId,
        messageText,
        detail,
        createdAt,
      }).pipe(Effect.catch(() => Effect.void));
    });

  const processSignal = (
    queue: Queue.Queue<ScheduledDispatchSignal>,
    signal: ScheduledDispatchSignal,
  ) =>
    Effect.gen(function* () {
      if (signal.type === "delayed-send.wake") {
        const scheduledWake = delayedSendWakeByThreadId.get(signal.threadId);
        if (scheduledWake?.wakeAtMs !== signal.wakeAtMs) {
          return;
        }
        yield* tryDispatchDelayedSend(queue, signal.threadId);
        return;
      }

      if (signal.type === "auto-continue.wake") {
        const candidate = autoContinueCandidatesByThreadId.get(signal.threadId);
        if (!candidate || candidate.assistantMessageId !== signal.assistantMessageId) {
          return;
        }
        yield* tryTriggerAutoContinue(queue, signal.threadId);
        return;
      }

      switch (signal.type) {
        case "thread.delayed-send-scheduled":
          yield* syncDelayedSendCandidate(queue, signal.payload);
          return;
        case "thread.delayed-send-cancelled":
        case "thread.delayed-send-dispatched":
          yield* clearDelayedSendCandidate(signal.payload.threadId);
          return;
        case "thread.created":
          if (delayedSendByThreadId.has(signal.payload.threadId)) {
            yield* tryDispatchDelayedSend(queue, signal.payload.threadId);
          }
          return;
        case "thread.deleted":
          yield* clearAutoContinueCandidate(signal.payload.threadId);
          return;
        case "thread.auto-continue-set":
          yield* refreshAutoContinueCandidate(queue, signal.payload.threadId);
          return;
        case "thread.message-sent":
          if (signal.payload.role === "user") {
            yield* clearAutoContinueCandidate(signal.payload.threadId);
            return;
          }
          if (signal.payload.role === "assistant" && signal.payload.streaming === false) {
            yield* refreshAutoContinueCandidate(queue, signal.payload.threadId);
          }
          return;
        case "thread.session-set":
          if (delayedSendByThreadId.has(signal.payload.threadId)) {
            yield* tryDispatchDelayedSend(queue, signal.payload.threadId);
          }
          if (autoContinueCandidatesByThreadId.has(signal.payload.threadId)) {
            yield* tryTriggerAutoContinue(queue, signal.payload.threadId);
          }
          return;
        case "thread.activity-appended":
          if (delayedSendByThreadId.has(signal.payload.threadId)) {
            yield* tryDispatchDelayedSend(queue, signal.payload.threadId);
          }
          if (
            signal.payload.activity.kind === "approval.resolved" ||
            signal.payload.activity.kind === "user-input.resolved" ||
            signal.payload.activity.kind === AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND
          ) {
            if (autoContinueCandidatesByThreadId.has(signal.payload.threadId)) {
              yield* tryTriggerAutoContinue(queue, signal.payload.threadId);
            }
          }
          return;
      }
    });

  const start: ScheduledDispatchReactorShape["start"] = Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ScheduledDispatchSignal>();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.forEach([...delayedSendWakeByThreadId.keys()], clearDelayedSendWake, {
          discard: true,
        });
        yield* Effect.forEach([...autoContinueWakeByThreadId.keys()], clearAutoContinueWake, {
          discard: true,
        });
        yield* Queue.shutdown(queue).pipe(Effect.asVoid);
      }),
    );

    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(queue).pipe(Effect.flatMap((signal) => processSignal(queue, signal))),
      ),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.activity-appended" &&
          event.type !== "thread.auto-continue-set" &&
          event.type !== "thread.created" &&
          event.type !== "thread.deleted" &&
          event.type !== "thread.delayed-send-cancelled" &&
          event.type !== "thread.delayed-send-dispatched" &&
          event.type !== "thread.delayed-send-scheduled" &&
          event.type !== "thread.message-sent" &&
          event.type !== "thread.session-set"
        ) {
          return Effect.void;
        }
        return Queue.offer(queue, event).pipe(Effect.asVoid);
      }),
    );

    const readModel = yield* orchestrationEngine.getReadModel();
    yield* Effect.forEach(
      readModel.delayedSends ?? [],
      (delayedSend) => syncDelayedSendCandidate(queue, delayedSend),
      {
        concurrency: "unbounded",
        discard: true,
      },
    );
    yield* Effect.forEach(readModel.threads, (thread) => syncAutoContinueCandidate(queue, thread), {
      concurrency: "unbounded",
      discard: true,
    });
  });

  return {
    start,
  } satisfies ScheduledDispatchReactorShape;
});

export const ScheduledDispatchReactorLive = Layer.effect(ScheduledDispatchReactor, make);
