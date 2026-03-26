import {
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@t3tools/shared/threadInteractions";

import { type Thread } from "./types";

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

export function isThreadReadyForDispatch(thread: Pick<Thread, "session" | "activities">): boolean {
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
