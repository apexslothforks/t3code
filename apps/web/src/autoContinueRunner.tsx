import { EventId, type ThreadId } from "@t3tools/contracts";
import {
  findLatestAutoContinueDelayResetActivity,
  findLatestAutoContinueSentActivity,
  getAutoContinueDelayAnchorAtMs,
  getAutoContinueDispatchAtMs,
  hasAutoContinueTriggeredForAssistantMessage,
  normalizeAutoContinueSettings,
  shouldStopAutoContinueWithHeuristic,
} from "@t3tools/shared/autoContinue";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@t3tools/shared/threadInteractions";
import { useEffect, useMemo, useRef } from "react";

import { buildCodexProviderOptions } from "./codexProviderOptions";
import { useSettings } from "./hooks/useSettings";
import { newCommandId, newMessageId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import { isThreadReadyForDispatch, shouldRetryThreadDispatchError } from "./threadDispatch";
import { type ChatMessage, type Thread, type ThreadSession } from "./types";

const AUTO_CONTINUE_RETRY_DELAY_MS = 5_000;
const AUTO_CONTINUE_MAX_RETRIES = 3;

type RetryState = {
  assistantMessageId: string;
  retryCount: number;
  retryAtMs: number;
};

type RecentDispatchState = {
  assistantMessageId: string;
  untilMs: number;
};

const AUTO_CONTINUE_RECENT_DISPATCH_WINDOW_MS = 10_000;

interface AutomationTimerSnapshot {
  readonly startedAt: string;
  readonly dispatchAt: string;
  readonly assistantMessageId: string;
  readonly blockedBy: "approval" | "user-input" | null;
}

type SettingsResetState = {
  settingsKey: string;
  resetAtMs: number;
  ignoredAssistantMessageId?: string;
};

export interface AutoContinueStatusSnapshot extends AutomationTimerSnapshot {
  readonly remainingMs: number;
  readonly elapsedMs: number;
  readonly totalMs: number;
  readonly progressRatio: number;
  readonly sentCount: number;
  readonly nextMessageIndex: number;
  readonly nextMessageText: string;
}

export function resolveEffectiveAutoContinueDelayResetAt(input: {
  activityDelayResetAt?: string | null | undefined;
  localDelayResetAtMs?: number | null | undefined;
}): string | undefined {
  const localDelayResetAt =
    typeof input.localDelayResetAtMs === "number" && Number.isFinite(input.localDelayResetAtMs)
      ? new Date(input.localDelayResetAtMs).toISOString()
      : undefined;
  if (input.activityDelayResetAt && localDelayResetAt) {
    return Date.parse(input.activityDelayResetAt) > Date.parse(localDelayResetAt)
      ? input.activityDelayResetAt
      : localDelayResetAt;
  }
  return input.activityDelayResetAt ?? localDelayResetAt;
}

function compareMessagesByOrder(left: ChatMessage, right: ChatMessage): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function extractAutoContinueMessageId(activity: Thread["activities"][number]): string | null {
  if (activity.kind !== "auto-continue.sent") {
    return null;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.messageId === "string" && payload.messageId.length > 0
    ? payload.messageId
    : null;
}

function findLatestAssistantMessage(thread: Pick<Thread, "messages">, assistantMessageId: string) {
  return thread.messages.find((message) => message.id === assistantMessageId) ?? null;
}

function findLatestCompletedAssistantMessage(
  messages: ReadonlyArray<ChatMessage>,
): (ChatMessage & { completedAt: string }) | null {
  const latestMessage = [...messages]
    .filter((message) => message.role !== "system")
    .toSorted(compareMessagesByOrder)
    .at(-1);
  if (!latestMessage || latestMessage.role !== "assistant") {
    return null;
  }
  if (latestMessage.streaming || !latestMessage.completedAt) {
    return null;
  }
  return {
    ...latestMessage,
    completedAt: latestMessage.completedAt,
  };
}

function deriveAutoContinueTriggerCount(
  messages: ReadonlyArray<ChatMessage>,
  activities: ReadonlyArray<Thread["activities"][number]>,
): number {
  const autoActivities = activities
    .filter((activity) => activity.kind === "auto-continue.sent")
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  if (autoActivities.length === 0) {
    return 0;
  }

  const messageById = new Map(messages.map((message) => [String(message.id), message] as const));
  const autoMessageIds = new Set(
    autoActivities
      .map((activity) => extractAutoContinueMessageId(activity))
      .filter((messageId): messageId is string => messageId !== null),
  );
  const lastHumanMessage = messages
    .filter((message) => message.role === "user" && !autoMessageIds.has(String(message.id)))
    .toSorted(compareMessagesByOrder)
    .at(-1);

  if (!lastHumanMessage) {
    return autoActivities.length;
  }

  return autoActivities.filter((activity) => {
    if (activity.createdAt > lastHumanMessage.createdAt) {
      return true;
    }
    if (activity.createdAt < lastHumanMessage.createdAt) {
      return false;
    }

    const autoMessageId = extractAutoContinueMessageId(activity);
    const autoMessage = autoMessageId ? messageById.get(autoMessageId) : undefined;
    return autoMessage ? compareMessagesByOrder(autoMessage, lastHumanMessage) > 0 : false;
  }).length;
}

function deriveAutomationTimerSnapshot(input: {
  messages: ReadonlyArray<ChatMessage>;
  activities: ReadonlyArray<Thread["activities"][number]>;
  session: Pick<ThreadSession, "orchestrationStatus" | "activeTurnId"> | null;
  autoContinue: Thread["autoContinue"];
  localDelayResetAtMs?: number | null | undefined;
  ignoredAssistantMessageId?: string | null | undefined;
}): AutomationTimerSnapshot | null {
  const settings = normalizeAutoContinueSettings(input.autoContinue);
  if (!settings.enabled || settings.messages.length === 0) {
    return null;
  }
  if (input.session?.activeTurnId != null) {
    return null;
  }
  if (input.session?.orchestrationStatus === "running") {
    return null;
  }

  const blockedBy =
    derivePendingApprovals(input.activities).length > 0
      ? "approval"
      : derivePendingUserInputs(input.activities).length > 0
        ? "user-input"
        : null;

  const latestAssistantMessage = findLatestCompletedAssistantMessage(input.messages);
  if (!latestAssistantMessage) {
    return null;
  }
  if (
    input.ignoredAssistantMessageId &&
    latestAssistantMessage.id === input.ignoredAssistantMessageId
  ) {
    return null;
  }
  if (hasAutoContinueTriggeredForAssistantMessage(input.activities, latestAssistantMessage.id)) {
    return null;
  }
  if (
    shouldStopAutoContinueWithHeuristic({
      messages: input.messages,
      activities: input.activities,
      assistantMessageId: latestAssistantMessage.id,
      completedAt: latestAssistantMessage.completedAt,
      settings,
    })
  ) {
    return null;
  }

  const effectiveDelayResetAt = resolveEffectiveAutoContinueDelayResetAt({
    activityDelayResetAt: findLatestAutoContinueDelayResetActivity(input.activities)?.createdAt,
    localDelayResetAtMs: input.localDelayResetAtMs,
  });

  const dispatchAtMs = getAutoContinueDispatchAtMs({
    completedAt: latestAssistantMessage.completedAt,
    lastAutoContinueSentAt: findLatestAutoContinueSentActivity(input.activities)?.createdAt,
    delayResetAt: effectiveDelayResetAt,
    settings,
  });
  if (!Number.isFinite(dispatchAtMs)) {
    return null;
  }

  const startedAtMs = getAutoContinueDelayAnchorAtMs({
    completedAt: latestAssistantMessage.completedAt,
    delayResetAt: effectiveDelayResetAt,
  });

  return {
    startedAt: new Date(startedAtMs).toISOString(),
    dispatchAt: new Date(dispatchAtMs).toISOString(),
    assistantMessageId: latestAssistantMessage.id,
    blockedBy,
  };
}

function resolveAutoContinueMessage(input: {
  thread: Pick<Thread, "messages" | "activities" | "autoContinue">;
}): { text: string; messageIndex: number } | null {
  const normalized = normalizeAutoContinueSettings(input.thread.autoContinue);
  if (!normalized.enabled || normalized.messages.length === 0) {
    return null;
  }
  const sentCount = deriveAutoContinueTriggerCount(input.thread.messages, input.thread.activities);
  const messageIndex = sentCount % normalized.messages.length;
  const text = normalized.messages[messageIndex];
  if (!text) {
    return null;
  }
  return { text, messageIndex };
}

export function deriveAutoContinueStatusSnapshot(input: {
  thread: Pick<Thread, "messages" | "activities" | "autoContinue" | "session">;
  nowMs: number;
  localDelayResetAtMs?: number | null | undefined;
  ignoredAssistantMessageId?: string | null | undefined;
}): AutoContinueStatusSnapshot | null {
  const timer = deriveAutomationTimerSnapshot({
    messages: input.thread.messages,
    activities: input.thread.activities,
    session: input.thread.session,
    autoContinue: input.thread.autoContinue,
    localDelayResetAtMs: input.localDelayResetAtMs,
    ignoredAssistantMessageId: input.ignoredAssistantMessageId,
  });
  if (!timer) {
    return null;
  }

  const nextMessage = resolveAutoContinueMessage({ thread: input.thread });
  if (!nextMessage) {
    return null;
  }

  const startedAtMs = Date.parse(timer.startedAt);
  const dispatchAtMs = Date.parse(timer.dispatchAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(dispatchAtMs)) {
    return null;
  }

  const totalMs = Math.max(0, dispatchAtMs - startedAtMs);
  const elapsedMs = Math.min(Math.max(0, input.nowMs - startedAtMs), totalMs);
  const remainingMs = Math.max(0, dispatchAtMs - input.nowMs);
  const progressRatio = totalMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / totalMs));

  return {
    ...timer,
    remainingMs,
    elapsedMs,
    totalMs,
    progressRatio,
    sentCount: deriveAutoContinueTriggerCount(input.thread.messages, input.thread.activities),
    nextMessageIndex: nextMessage.messageIndex,
    nextMessageText: nextMessage.text,
  };
}

export function AutoContinueRunner() {
  const settings = useSettings();
  const threads = useStore((state) => state.threads);
  const candidateThreads = useMemo(
    () => threads.filter((thread) => normalizeAutoContinueSettings(thread.autoContinue).enabled),
    [threads],
  );
  const retryStateRef = useRef(new Map<ThreadId, RetryState>());
  const recentDispatchRef = useRef(new Map<ThreadId, RecentDispatchState>());
  const settingsResetRef = useRef(new Map<ThreadId, SettingsResetState>());
  const processingRef = useRef(false);
  const rerunRef = useRef(false);

  useEffect(() => {
    if (candidateThreads.length === 0) {
      retryStateRef.current.clear();
      recentDispatchRef.current.clear();
      settingsResetRef.current.clear();
      return;
    }

    const nowMs = Date.now();
    const liveThreadIds = new Set(candidateThreads.map((thread) => thread.id));
    for (const [threadId] of settingsResetRef.current) {
      if (!liveThreadIds.has(threadId)) {
        settingsResetRef.current.delete(threadId);
      }
    }
    for (const thread of candidateThreads) {
      const normalizedSettings = normalizeAutoContinueSettings(thread.autoContinue);
      const settingsKey = JSON.stringify(normalizedSettings);
      const previous = settingsResetRef.current.get(thread.id);
      if (!previous || previous.settingsKey !== settingsKey) {
        const latestAssistantMessage = findLatestCompletedAssistantMessage(thread.messages);
        settingsResetRef.current.set(thread.id, {
          settingsKey,
          resetAtMs: nowMs,
          ...(latestAssistantMessage
            ? { ignoredAssistantMessageId: latestAssistantMessage.id }
            : {}),
        });
      }
    }

    let disposed = false;
    const isDisposed = () => disposed;

    const flushDueAutoContinue = async (): Promise<void> => {
      if (processingRef.current) {
        rerunRef.current = true;
        return;
      }
      processingRef.current = true;
      try {
        do {
          rerunRef.current = false;
          const api = readNativeApi();
          if (!api) {
            continue;
          }
          const codexProviderOptions = buildCodexProviderOptions(settings);
          const nowMs = Date.now();
          const liveThreads = useStore
            .getState()
            .threads.filter((thread) => normalizeAutoContinueSettings(thread.autoContinue).enabled);

          for (const thread of liveThreads) {
            if (disposed) {
              return;
            }

            const timer = deriveAutomationTimerSnapshot({
              messages: thread.messages,
              activities: thread.activities,
              session: thread.session,
              autoContinue: thread.autoContinue,
              localDelayResetAtMs: settingsResetRef.current.get(thread.id)?.resetAtMs,
              ignoredAssistantMessageId: settingsResetRef.current.get(thread.id)
                ?.ignoredAssistantMessageId,
            });
            if (!timer) {
              retryStateRef.current.delete(thread.id);
              recentDispatchRef.current.delete(thread.id);
              continue;
            }
            const dispatchAtMs = Date.parse(timer.dispatchAt);
            if (!Number.isFinite(dispatchAtMs) || dispatchAtMs > nowMs) {
              continue;
            }
            if (timer.blockedBy !== null || !isThreadReadyForDispatch(thread)) {
              continue;
            }

            const retryState = retryStateRef.current.get(thread.id);
            if (
              retryState &&
              retryState.assistantMessageId === timer.assistantMessageId &&
              retryState.retryAtMs > nowMs
            ) {
              continue;
            }
            const recentDispatch = recentDispatchRef.current.get(thread.id);
            if (
              recentDispatch &&
              recentDispatch.assistantMessageId === timer.assistantMessageId &&
              recentDispatch.untilMs > nowMs
            ) {
              continue;
            }

            const latestAssistantMessage = findLatestAssistantMessage(
              thread,
              timer.assistantMessageId,
            );
            if (!latestAssistantMessage?.completedAt) {
              retryStateRef.current.delete(thread.id);
              recentDispatchRef.current.delete(thread.id);
              continue;
            }
            const normalizedSettings = normalizeAutoContinueSettings(thread.autoContinue);
            if (
              shouldStopAutoContinueWithHeuristic({
                messages: thread.messages,
                activities: thread.activities,
                assistantMessageId: latestAssistantMessage.id,
                completedAt: latestAssistantMessage.completedAt,
                settings: normalizedSettings,
              })
            ) {
              retryStateRef.current.delete(thread.id);
              recentDispatchRef.current.delete(thread.id);
              continue;
            }

            const nextMessage = resolveAutoContinueMessage({ thread });
            if (!nextMessage) {
              retryStateRef.current.delete(thread.id);
              recentDispatchRef.current.delete(thread.id);
              continue;
            }

            const createdAt = new Date().toISOString();
            const messageId = newMessageId();
            try {
              await api.orchestration.dispatchCommand({
                type: "thread.turn.start",
                commandId: newCommandId(),
                threadId: thread.id,
                message: {
                  messageId,
                  role: "user",
                  text: nextMessage.text,
                  attachments: [],
                },
                modelSelection: thread.modelSelection,
                runtimeMode: thread.runtimeMode,
                interactionMode: thread.interactionMode,
                ...(codexProviderOptions ? { providerOptions: codexProviderOptions } : {}),
                createdAt,
              });
              recentDispatchRef.current.set(thread.id, {
                assistantMessageId: timer.assistantMessageId,
                untilMs: nowMs + AUTO_CONTINUE_RECENT_DISPATCH_WINDOW_MS,
              });
              try {
                await api.orchestration.dispatchCommand({
                  type: "thread.activity.append",
                  commandId: newCommandId(),
                  threadId: thread.id,
                  activity: {
                    id: EventId.makeUnsafe(crypto.randomUUID()),
                    tone: "info",
                    kind: "auto-continue.sent",
                    summary: "Auto-continue sent",
                    payload: {
                      triggeringAssistantMessageId: latestAssistantMessage.id,
                      messageId,
                      messageText: nextMessage.text,
                      messageIndex: nextMessage.messageIndex,
                    },
                    turnId: null,
                    createdAt,
                  },
                  createdAt,
                });
              } catch {
                // The turn already started. Keep the recent-dispatch guard to avoid duplicates.
              }
              retryStateRef.current.delete(thread.id);
            } catch (error) {
              if (
                shouldRetryThreadDispatchError(error) &&
                (retryState?.retryCount ?? 0) < AUTO_CONTINUE_MAX_RETRIES
              ) {
                retryStateRef.current.set(thread.id, {
                  assistantMessageId: timer.assistantMessageId,
                  retryCount: (retryState?.retryCount ?? 0) + 1,
                  retryAtMs: nowMs + AUTO_CONTINUE_RETRY_DELAY_MS,
                });
                continue;
              }
              retryStateRef.current.delete(thread.id);
            }
          }
        } while (rerunRef.current && !isDisposed());
      } finally {
        processingRef.current = false;
      }
    };

    void flushDueAutoContinue();
    const intervalId = window.setInterval(() => {
      void flushDueAutoContinue();
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [candidateThreads, settings]);

  return null;
}
