import { EventId, type ThreadId } from "@t3tools/contracts";
import {
  normalizeAutoContinueSettings,
  shouldStopAutoContinueWithHeuristic,
} from "@t3tools/shared/autoContinue";
import { useEffect, useMemo, useRef } from "react";

import {
  deriveAutomationTimerSnapshot,
  findLatestAssistantMessage,
  findLatestCompletedAssistantMessage,
  resolveAutoContinueMessage,
} from "./automationStatus";
import { buildCodexProviderOptions } from "./codexProviderOptions";
import { useSettings } from "./hooks/useSettings";
import { newCommandId, newMessageId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import { isThreadReadyForDispatch, shouldRetryThreadDispatchError } from "./threadDispatch";

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

type SettingsResetState = {
  settingsKey: string;
  resetAtMs: number;
  ignoredAssistantMessageId?: string;
};

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
