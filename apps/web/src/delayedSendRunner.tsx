import { type ProviderInteractionMode, type RuntimeMode } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { toastManager } from "./components/ui/toast";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT } from "./chatSend";
import { buildCodexProviderOptions } from "./codexProviderOptions";
import { type DelayedSendEntry, useDelayedSendStore } from "./delayedSendStore";
import { useSettings } from "./hooks/useSettings";
import { newCommandId, newMessageId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import { isThreadReadyForDispatch, shouldRetryThreadDispatchError } from "./threadDispatch";
import { type Thread } from "./types";

function isDelayedSendEntry(value: DelayedSendEntry | undefined): value is DelayedSendEntry {
  return value !== undefined;
}

const DELAYED_SEND_RETRY_DELAY_MS = 5_000;

export function isThreadReadyForDelayedSend(
  thread: Pick<Thread, "session" | "activities">,
): boolean {
  return isThreadReadyForDispatch(thread);
}

async function persistThreadSettingsForDelayedSend(input: {
  readonly api: NonNullable<ReturnType<typeof readNativeApi>>;
  readonly thread: Pick<Thread, "id" | "modelSelection" | "runtimeMode" | "interactionMode">;
  readonly entry: Pick<DelayedSendEntry, "modelSelection" | "runtimeMode" | "interactionMode">;
  readonly createdAt: string;
}): Promise<void> {
  if (
    input.entry.modelSelection &&
    JSON.stringify(input.entry.modelSelection) !== JSON.stringify(input.thread.modelSelection)
  ) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.meta.update",
      commandId: newCommandId(),
      threadId: input.thread.id,
      modelSelection: input.entry.modelSelection,
    });
  }

  if (input.entry.runtimeMode !== input.thread.runtimeMode) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.runtime-mode.set",
      commandId: newCommandId(),
      threadId: input.thread.id,
      runtimeMode: input.entry.runtimeMode as RuntimeMode,
      createdAt: input.createdAt,
    });
  }

  if (input.entry.interactionMode !== input.thread.interactionMode) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.interaction-mode.set",
      commandId: newCommandId(),
      threadId: input.thread.id,
      interactionMode: input.entry.interactionMode as ProviderInteractionMode,
      createdAt: input.createdAt,
    });
  }
}

async function ensureThreadExistsForDelayedSend(input: {
  readonly api: NonNullable<ReturnType<typeof readNativeApi>>;
  readonly entry: DelayedSendEntry;
}): Promise<void> {
  if (!input.entry.createThread) {
    return;
  }

  await input.api.orchestration.dispatchCommand({
    type: "thread.create",
    commandId: newCommandId(),
    threadId: input.entry.threadId,
    projectId: input.entry.createThread.projectId,
    title: input.entry.createThread.title,
    modelSelection: input.entry.createThread.modelSelection,
    runtimeMode: input.entry.createThread.runtimeMode,
    interactionMode: input.entry.createThread.interactionMode,
    branch: input.entry.createThread.branch,
    worktreePath: input.entry.createThread.worktreePath,
    autoContinue: input.entry.createThread.autoContinue,
    createdAt: input.entry.createThread.createdAt,
  });
}

export function DelayedSendRunner() {
  const settings = useSettings();
  const scheduledByThreadId = useDelayedSendStore((state) => state.scheduledByThreadId);
  const scheduledEntries = useMemo(
    () => Object.values(scheduledByThreadId).filter(isDelayedSendEntry),
    [scheduledByThreadId],
  );
  const processingRef = useRef(false);
  const rerunRef = useRef(false);

  useEffect(() => {
    if (scheduledEntries.length === 0) {
      return;
    }

    let disposed = false;
    const isDisposed = () => disposed;

    const flushDueSends = async (): Promise<void> => {
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
          const entries = Object.values(useDelayedSendStore.getState().scheduledByThreadId)
            .filter(isDelayedSendEntry)
            .toSorted((left, right) => left.dueAt.localeCompare(right.dueAt));

          for (const entry of entries) {
            if (disposed) {
              return;
            }
            const dueAtMs = Date.parse(entry.dueAt);
            if (Number.isNaN(dueAtMs) || dueAtMs > nowMs) {
              continue;
            }
            const retryAtMs = entry.retryAt !== undefined ? Date.parse(entry.retryAt) : Number.NaN;
            if (Number.isFinite(retryAtMs) && retryAtMs > nowMs) {
              continue;
            }

            let thread = useStore
              .getState()
              .threads.find((candidate) => candidate.id === entry.threadId);
            if (!thread && entry.createThread) {
              await ensureThreadExistsForDelayedSend({ api, entry });
              thread = useStore
                .getState()
                .threads.find((candidate) => candidate.id === entry.threadId);
            }
            if (!thread && !entry.createThread) {
              useDelayedSendStore.getState().clearScheduledSend(entry.threadId);
              toastManager.add({
                type: "warning",
                title: "Delayed send cancelled",
                description: "The target thread no longer exists.",
              });
              continue;
            }

            if (thread && !isThreadReadyForDelayedSend(thread)) {
              useDelayedSendStore
                .getState()
                .markScheduledSendWaiting(
                  entry.threadId,
                  entry.waitingForReadySince ?? new Date(nowMs).toISOString(),
                );
              continue;
            }

            useDelayedSendStore.getState().clearScheduledSendWaiting(entry.threadId);
            useDelayedSendStore.getState().clearScheduledSendRetry(entry.threadId);
            const createdAt = new Date().toISOString();

            try {
              await persistThreadSettingsForDelayedSend({
                api,
                thread: thread ?? {
                  id: entry.threadId,
                  modelSelection: entry.createThread?.modelSelection ??
                    entry.modelSelection ?? {
                      provider: "codex",
                      model: "gpt-5.4",
                    },
                  runtimeMode: entry.createThread?.runtimeMode ?? entry.runtimeMode,
                  interactionMode: entry.createThread?.interactionMode ?? entry.interactionMode,
                },
                entry,
                createdAt,
              });
              await api.orchestration.dispatchCommand({
                type: "thread.turn.start",
                commandId: newCommandId(),
                threadId: entry.threadId,
                message: {
                  messageId: newMessageId(),
                  role: "user",
                  text: entry.text || IMAGE_ONLY_BOOTSTRAP_PROMPT,
                  attachments: entry.attachments,
                },
                ...(entry.modelSelection ? { modelSelection: entry.modelSelection } : {}),
                runtimeMode: entry.runtimeMode,
                interactionMode: entry.interactionMode,
                ...(codexProviderOptions ? { providerOptions: codexProviderOptions } : {}),
                createdAt,
              });
              useStore.getState().setError(entry.threadId, null);
              useDelayedSendStore.getState().clearScheduledSend(entry.threadId);
            } catch (error) {
              const detail =
                error instanceof Error ? error.message : "Failed to dispatch delayed send.";
              useStore.getState().setError(entry.threadId, detail);
              if (shouldRetryThreadDispatchError(error)) {
                useDelayedSendStore.getState().markScheduledSendRetry(entry.threadId, {
                  retryAt: new Date(nowMs + DELAYED_SEND_RETRY_DELAY_MS).toISOString(),
                  retryCount: (entry.retryCount ?? 0) + 1,
                  lastError: detail,
                });
                toastManager.add({
                  type: "warning",
                  title: "Delayed send retrying",
                  description: detail,
                });
                continue;
              }
              useDelayedSendStore.getState().clearScheduledSend(entry.threadId);
              toastManager.add({
                type: "error",
                title: "Delayed send failed",
                description: detail,
              });
            }
          }
        } while (rerunRef.current && !isDisposed());
      } finally {
        processingRef.current = false;
      }
    };

    void flushDueSends();
    const intervalId = window.setInterval(() => {
      void flushDueSends();
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [scheduledEntries, settings]);

  return null;
}
