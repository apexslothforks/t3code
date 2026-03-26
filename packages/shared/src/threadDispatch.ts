import type {
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";

import { derivePendingApprovals, derivePendingUserInputs } from "./threadInteractions";

export interface ThreadDispatchSessionLike {
  readonly orchestrationStatus?: OrchestrationSessionStatus | null | undefined;
  readonly activeTurnId?: TurnId | null | undefined;
}

export interface ThreadDispatchThreadLike {
  readonly session?: ThreadDispatchSessionLike | null | undefined;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export function shouldRetryThreadDispatchError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.length === 0) {
    return true;
  }
  return ![
    "does not exist",
    "already exists",
    "invalid orchestration command payload",
    "orchestration command invariant failed",
    "command previously rejected",
  ].some((snippet) => message.includes(snippet));
}

export function isThreadReadyForDispatch(
  thread: Pick<ThreadDispatchThreadLike, "session" | "activities">,
): boolean {
  const orchestrationStatus = thread.session?.orchestrationStatus;
  if (
    (orchestrationStatus !== "ready" && orchestrationStatus !== "error") ||
    thread.session?.activeTurnId != null
  ) {
    return false;
  }
  return (
    derivePendingApprovals(thread.activities).length === 0 &&
    derivePendingUserInputs(thread.activities).length === 0
  );
}
