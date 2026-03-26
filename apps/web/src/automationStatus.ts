import { type ThreadDelayedSend } from "@t3tools/contracts";
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

import { type ChatMessage, type Thread, type ThreadSession } from "./types";

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

export function findLatestAssistantMessage(
  thread: Pick<Thread, "messages">,
  assistantMessageId: string,
) {
  return thread.messages.find((message) => message.id === assistantMessageId) ?? null;
}

export function findLatestCompletedAssistantMessage(
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

export interface AutomationTimerSnapshot {
  readonly startedAt: string;
  readonly dispatchAt: string;
  readonly assistantMessageId: string;
  readonly blockedBy: "approval" | "user-input" | null;
}

export interface AutoContinueStatusSnapshot extends AutomationTimerSnapshot {
  readonly remainingMs: number;
  readonly elapsedMs: number;
  readonly totalMs: number;
  readonly progressRatio: number;
  readonly sentCount: number;
  readonly nextMessageIndex: number;
  readonly nextMessageText: string;
}

export interface DelayedSendStatus {
  readonly scheduledAt: string;
  readonly dispatchAtMs: number;
  readonly message: string;
  readonly remainingMs: number;
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

export function deriveAutoContinueTriggerCount(
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

export function deriveAutomationTimerSnapshot(input: {
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

export function resolveAutoContinueMessage(input: {
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

export function deriveDelayedSendStatus(input: {
  delayedSend: ThreadDelayedSend | null | undefined;
  nowMs: number;
}): DelayedSendStatus | null {
  if (!input.delayedSend) {
    return null;
  }

  const scheduledAtMs = Date.parse(input.delayedSend.createdAt);
  const dispatchAtMs = Date.parse(input.delayedSend.dueAt);
  if (!Number.isFinite(scheduledAtMs) || !Number.isFinite(dispatchAtMs)) {
    return null;
  }

  return {
    scheduledAt: input.delayedSend.createdAt,
    dispatchAtMs,
    message: input.delayedSend.text,
    remainingMs: dispatchAtMs - input.nowMs,
  };
}
