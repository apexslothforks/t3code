---
id: t3c-fptw
status: closed
deps: [t3c-vepd, t3c-sxfv]
links: []
created: 2026-03-26T17:11:54Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-02es
tags: [automation, server]
---

# Implement ScheduledDispatchReactor for auto-continue

Implement the auto-continue half of ScheduledDispatchReactor. Port the logic from .worktrees/tb-rwpj/apps/server/src/orchestration/Layers/AutoContinueReactor.ts to the new unified reactor.

File: apps/server/src/orchestration/Layers/ScheduledDispatchReactor.ts

Key behavior:

- Subscribe to domain events: thread.message-sent, thread.auto-continue-set, thread.session-set, thread.activity-appended
- Maintain in-memory candidates Map<ThreadId, AutoContinueCandidate>
- Schedule Effect fiber wake-ups at dispatchAtMs using Effect.sleep
- On wake: re-check conditions (thread idle, no pending approvals, no active turn), dispatch thread.turn.start via orchestrationEngine.dispatch
- On startup: rebuild candidates from current read model (survive restart)
- Retry logic: 3 retries with 3s delay for transient errors
- Record auto-continue.sent activity on success, auto-continue.failed on permanent failure
- Use shared timing math from @t3tools/shared/autoContinue

Reference: .worktrees/tb-rwpj/apps/server/src/orchestration/Layers/AutoContinueReactor.ts (490 lines). Port and adapt, don't copy blindly — the unified reactor structure may differ.

Acceptance: unit tests covering arm/disarm on assistant message, wake scheduling, retry, heuristic stop, approval blocking.
