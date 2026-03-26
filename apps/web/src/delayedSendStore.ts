import type {
  ModelSelection,
  ProviderInteractionMode,
  ProjectId,
  RuntimeMode,
  ThreadAutoContinueSettings,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

export interface DelayedSendImageAttachment {
  readonly type: "image";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
}

export interface DelayedSendEntry {
  readonly threadId: ThreadId;
  readonly createdAt: string;
  readonly dueAt: string;
  readonly delayMinutes: number;
  readonly displayText: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<DelayedSendImageAttachment>;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly createThread?:
    | {
        readonly projectId: ProjectId;
        readonly title: string;
        readonly modelSelection: ModelSelection;
        readonly runtimeMode: RuntimeMode;
        readonly interactionMode: ProviderInteractionMode;
        readonly branch: string | null;
        readonly worktreePath: string | null;
        readonly autoContinue: ThreadAutoContinueSettings;
        readonly createdAt: string;
      }
    | undefined;
  readonly waitingForReadySince?: string | undefined;
  readonly retryAt?: string | undefined;
  readonly retryCount?: number | undefined;
  readonly lastError?: string | undefined;
}

interface DelayedSendStoreState {
  readonly scheduledByThreadId: Partial<Record<ThreadId, DelayedSendEntry>>;
  readonly scheduleSend: (entry: DelayedSendEntry) => void;
  readonly cancelScheduledSend: (threadId: ThreadId) => void;
  readonly markScheduledSendWaiting: (threadId: ThreadId, waitingSince: string) => void;
  readonly clearScheduledSendWaiting: (threadId: ThreadId) => void;
  readonly markScheduledSendRetry: (
    threadId: ThreadId,
    input: {
      readonly retryAt: string;
      readonly retryCount: number;
      readonly lastError: string;
    },
  ) => void;
  readonly clearScheduledSendRetry: (threadId: ThreadId) => void;
  readonly clearScheduledSend: (threadId: ThreadId) => void;
}

export const useDelayedSendStore = create<DelayedSendStoreState>((set) => ({
  scheduledByThreadId: {},
  scheduleSend: (entry) =>
    set((state) => ({
      scheduledByThreadId: {
        ...state.scheduledByThreadId,
        [entry.threadId]: entry,
      },
    })),
  cancelScheduledSend: (threadId) =>
    set((state) => {
      const next = { ...state.scheduledByThreadId };
      delete next[threadId];
      return { scheduledByThreadId: next };
    }),
  markScheduledSendWaiting: (threadId, waitingSince) =>
    set((state) => {
      const existing = state.scheduledByThreadId[threadId];
      if (!existing || existing.waitingForReadySince === waitingSince) {
        return state;
      }
      return {
        scheduledByThreadId: {
          ...state.scheduledByThreadId,
          [threadId]: {
            ...existing,
            waitingForReadySince: waitingSince,
          },
        },
      };
    }),
  clearScheduledSendWaiting: (threadId) =>
    set((state) => {
      const existing = state.scheduledByThreadId[threadId];
      if (!existing || existing.waitingForReadySince === undefined) {
        return state;
      }
      return {
        scheduledByThreadId: {
          ...state.scheduledByThreadId,
          [threadId]: {
            ...existing,
            waitingForReadySince: undefined,
          },
        },
      };
    }),
  markScheduledSendRetry: (threadId, input) =>
    set((state) => {
      const existing = state.scheduledByThreadId[threadId];
      if (
        !existing ||
        (existing.retryAt === input.retryAt &&
          existing.retryCount === input.retryCount &&
          existing.lastError === input.lastError)
      ) {
        return state;
      }
      return {
        scheduledByThreadId: {
          ...state.scheduledByThreadId,
          [threadId]: {
            ...existing,
            retryAt: input.retryAt,
            retryCount: input.retryCount,
            lastError: input.lastError,
          },
        },
      };
    }),
  clearScheduledSendRetry: (threadId) =>
    set((state) => {
      const existing = state.scheduledByThreadId[threadId];
      if (
        !existing ||
        (existing.retryAt === undefined &&
          existing.retryCount === undefined &&
          existing.lastError === undefined)
      ) {
        return state;
      }
      return {
        scheduledByThreadId: {
          ...state.scheduledByThreadId,
          [threadId]: {
            ...existing,
            retryAt: undefined,
            retryCount: undefined,
            lastError: undefined,
          },
        },
      };
    }),
  clearScheduledSend: (threadId) =>
    set((state) => {
      const next = { ...state.scheduledByThreadId };
      delete next[threadId];
      return { scheduledByThreadId: next };
    }),
}));
