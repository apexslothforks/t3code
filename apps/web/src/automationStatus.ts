import { type OrchestrationAutoContinueStatus, type ThreadDelayedSend } from "@t3tools/contracts";

export interface AutoContinueStatusSnapshot extends OrchestrationAutoContinueStatus {
  readonly remainingMs: number;
  readonly elapsedMs: number;
  readonly totalMs: number;
  readonly progressRatio: number;
}

export interface DelayedSendStatus {
  readonly scheduledAt: string;
  readonly dispatchAtMs: number;
  readonly message: string;
  readonly remainingMs: number;
}

export function deriveAutoContinueStatusSnapshot(input: {
  status: OrchestrationAutoContinueStatus | null | undefined;
  nowMs: number;
}): AutoContinueStatusSnapshot | null {
  if (!input.status) {
    return null;
  }

  const startedAtMs = Date.parse(input.status.startedAt);
  const dispatchAtMs = Date.parse(input.status.dispatchAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(dispatchAtMs)) {
    return null;
  }

  const totalMs = Math.max(0, dispatchAtMs - startedAtMs);
  const elapsedMs = Math.min(Math.max(0, input.nowMs - startedAtMs), totalMs);
  const remainingMs = Math.max(0, dispatchAtMs - input.nowMs);
  const progressRatio = totalMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / totalMs));

  return {
    ...input.status,
    remainingMs,
    elapsedMs,
    totalMs,
    progressRatio,
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
