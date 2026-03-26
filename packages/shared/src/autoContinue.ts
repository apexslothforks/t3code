import {
  AUTO_CONTINUE_DEFAULT_COOLDOWN_MINUTES,
  AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
  AUTO_CONTINUE_MAX_MESSAGES,
  AUTO_CONTINUE_MAX_MESSAGE_LENGTH,
  AUTO_CONTINUE_MAX_TIMER_MINUTES,
  DEFAULT_AUTO_CONTINUE_MESSAGE,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

export {
  AUTO_CONTINUE_DEFAULT_COOLDOWN_MINUTES,
  AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
  AUTO_CONTINUE_MAX_MESSAGES,
  AUTO_CONTINUE_MAX_MESSAGE_LENGTH,
  AUTO_CONTINUE_MAX_TIMER_MINUTES,
  DEFAULT_AUTO_CONTINUE_MESSAGE,
} from "@t3tools/contracts";

export interface AutoContinueSettingsLike {
  readonly enabled: boolean;
  readonly messages: ReadonlyArray<string>;
  readonly stopWithHeuristic?: boolean | null | undefined;
  readonly delayMinutes?: number | null | undefined;
  readonly cooldownMinutes?: number | null | undefined;
}

export interface NormalizedAutoContinueSettings {
  readonly enabled: boolean;
  readonly messages: ReadonlyArray<string>;
  readonly stopWithHeuristic: boolean;
  readonly delayMinutes: number;
  readonly cooldownMinutes: number;
}

export interface AutoContinueSentActivityPayload {
  readonly triggeringAssistantMessageId?: string;
  readonly triggeringTurnId?: string;
  readonly messageId?: string;
  readonly messageText?: string;
  readonly messageIndex?: number;
}

export interface AutoContinueMessageLike {
  readonly id: string;
  readonly role: string;
  readonly createdAt: string;
}

export const AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND = "composer.draft.updated";

function normalizeAutoContinueMessage(message: string | null | undefined): string | null {
  if (typeof message !== "string") {
    return null;
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, AUTO_CONTINUE_MAX_MESSAGE_LENGTH);
}

function normalizeAutoContinueTimerMinutes(
  value: number | null | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value === null || value === undefined) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  if (normalized < 0) {
    return fallback;
  }
  if (normalized > AUTO_CONTINUE_MAX_TIMER_MINUTES) {
    return AUTO_CONTINUE_MAX_TIMER_MINUTES;
  }
  return normalized;
}

export function normalizeAutoContinueMessages(
  messages: Iterable<string | null | undefined>,
): string[] {
  const normalizedMessages: string[] = [];
  const seen = new Set<string>();

  for (const candidate of messages) {
    const normalized = normalizeAutoContinueMessage(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    normalizedMessages.push(normalized);
    if (normalizedMessages.length >= AUTO_CONTINUE_MAX_MESSAGES) {
      break;
    }
  }

  return normalizedMessages;
}

export function normalizeAutoContinueSettings(
  settings: AutoContinueSettingsLike | null | undefined,
): NormalizedAutoContinueSettings {
  const enabled = settings?.enabled === true;
  const normalizedMessages = normalizeAutoContinueMessages(settings?.messages ?? []);
  const stopWithHeuristic = settings?.stopWithHeuristic === true;
  const delayMinutes = normalizeAutoContinueTimerMinutes(
    settings?.delayMinutes,
    AUTO_CONTINUE_DEFAULT_DELAY_MINUTES,
  );
  const cooldownMinutes = normalizeAutoContinueTimerMinutes(
    settings?.cooldownMinutes,
    AUTO_CONTINUE_DEFAULT_COOLDOWN_MINUTES,
  );
  if (!enabled) {
    return {
      enabled: false,
      messages: normalizedMessages,
      stopWithHeuristic,
      delayMinutes,
      cooldownMinutes,
    };
  }
  return {
    enabled: true,
    messages: normalizedMessages.length > 0 ? normalizedMessages : [DEFAULT_AUTO_CONTINUE_MESSAGE],
    stopWithHeuristic,
    delayMinutes,
    cooldownMinutes,
  };
}

export function getAutoContinueDispatchAtMs(input: {
  readonly completedAt: string | number;
  readonly lastAutoContinueSentAt?: string | number | null | undefined;
  readonly delayResetAt?: string | number | null | undefined;
  readonly settings: AutoContinueSettingsLike | null | undefined;
}): number {
  const settings = normalizeAutoContinueSettings(input.settings);
  const completedAtMs = getAutoContinueDelayAnchorAtMs({
    completedAt: input.completedAt,
    delayResetAt: input.delayResetAt,
  });
  const lastAutoContinueSentAtMs =
    typeof input.lastAutoContinueSentAt === "number"
      ? input.lastAutoContinueSentAt
      : typeof input.lastAutoContinueSentAt === "string"
        ? Date.parse(input.lastAutoContinueSentAt)
        : Number.NaN;
  const delayReadyAtMs = Number.isFinite(completedAtMs)
    ? completedAtMs + settings.delayMinutes * 60_000
    : Date.now();
  const cooldownReadyAtMs = Number.isFinite(lastAutoContinueSentAtMs)
    ? lastAutoContinueSentAtMs + settings.cooldownMinutes * 60_000
    : Number.NEGATIVE_INFINITY;
  return Math.max(delayReadyAtMs, cooldownReadyAtMs);
}

export function getAutoContinueDelayAnchorAtMs(input: {
  readonly completedAt: string | number;
  readonly delayResetAt?: string | number | null | undefined;
}): number {
  const completedAtMs =
    typeof input.completedAt === "number" ? input.completedAt : Date.parse(input.completedAt);
  const delayResetAtMs =
    typeof input.delayResetAt === "number"
      ? input.delayResetAt
      : typeof input.delayResetAt === "string"
        ? Date.parse(input.delayResetAt)
        : Number.NaN;
  if (!Number.isFinite(completedAtMs)) {
    return Date.now();
  }
  if (!Number.isFinite(delayResetAtMs)) {
    return completedAtMs;
  }
  return Math.max(completedAtMs, delayResetAtMs);
}

export function readAutoContinueSentActivityPayload(
  activity: OrchestrationThreadActivity,
): AutoContinueSentActivityPayload | null {
  if (activity.kind !== "auto-continue.sent") {
    return null;
  }
  if (!activity.payload || typeof activity.payload !== "object") {
    return null;
  }
  const payload = activity.payload as Record<string, unknown>;
  return {
    ...(typeof payload.triggeringAssistantMessageId === "string"
      ? { triggeringAssistantMessageId: payload.triggeringAssistantMessageId }
      : {}),
    ...(typeof payload.triggeringTurnId === "string"
      ? { triggeringTurnId: payload.triggeringTurnId }
      : {}),
    ...(typeof payload.messageId === "string" ? { messageId: payload.messageId } : {}),
    ...(typeof payload.messageText === "string" ? { messageText: payload.messageText } : {}),
    ...(typeof payload.messageIndex === "number" && Number.isInteger(payload.messageIndex)
      ? { messageIndex: payload.messageIndex }
      : {}),
  };
}

export function findLatestAutoContinueSentActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): (OrchestrationThreadActivity & { payload: AutoContinueSentActivityPayload }) | null {
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const activity = ordered[index];
    if (!activity) {
      continue;
    }
    const payload = readAutoContinueSentActivityPayload(activity);
    if (!payload) {
      continue;
    }
    return {
      ...activity,
      payload,
    };
  }
  return null;
}

export function findLatestAutoContinueDelayResetActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity | null {
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const activity = ordered[index];
    if (!activity || activity.kind !== AUTO_CONTINUE_DELAY_RESET_ACTIVITY_KIND) {
      continue;
    }
    return activity;
  }
  return null;
}

export function hasAutoContinueTriggeredForAssistantMessage(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  assistantMessageId: string,
): boolean {
  return activities.some((activity) => {
    const payload = readAutoContinueSentActivityPayload(activity);
    return payload?.triggeringAssistantMessageId === assistantMessageId;
  });
}

export function shouldStopAutoContinueWithHeuristic(input: {
  readonly messages: ReadonlyArray<AutoContinueMessageLike>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly assistantMessageId: string;
  readonly completedAt: string | number;
  readonly settings: AutoContinueSettingsLike | null | undefined;
}): boolean {
  const settings = normalizeAutoContinueSettings(input.settings);
  if (!settings.enabled || !settings.stopWithHeuristic || settings.cooldownMinutes <= 0) {
    return false;
  }

  const thresholdMs = settings.cooldownMinutes * 60_000;
  const completedAtMs =
    typeof input.completedAt === "number" ? input.completedAt : Date.parse(input.completedAt);
  if (!Number.isFinite(completedAtMs)) {
    return false;
  }

  const orderedMessages = [...input.messages]
    .filter((message) => message.role !== "system")
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  const assistantIndex = orderedMessages.findIndex(
    (message) => message.role === "assistant" && message.id === input.assistantMessageId,
  );
  if (assistantIndex <= 0) {
    return false;
  }

  const previousMessage = orderedMessages[assistantIndex - 1];
  if (!previousMessage || previousMessage.role !== "user") {
    return false;
  }

  const autoContinueActivity = input.activities.find((activity) => {
    const payload = readAutoContinueSentActivityPayload(activity);
    return payload?.messageId === previousMessage.id;
  });
  if (!autoContinueActivity) {
    return false;
  }

  const previousMessageAtMs = Date.parse(previousMessage.createdAt);
  if (!Number.isFinite(previousMessageAtMs)) {
    return false;
  }

  return completedAtMs - previousMessageAtMs < thresholdMs;
}
