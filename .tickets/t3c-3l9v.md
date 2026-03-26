---
id: t3c-3l9v
status: closed
deps: [t3c-vepd, t3c-e4c8]
links: []
created: 2026-03-26T17:12:04Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-02es
tags: [automation, server]
---

# Implement ScheduledDispatchReactor for delayed-send

Extend ScheduledDispatchReactor to handle delayed-send dispatch.

Key behavior:

- Subscribe to new domain events: thread.delayed-send-scheduled, thread.delayed-send-cancelled
- Maintain delayed-send candidates: Map<ThreadId, DelayedSendCandidate>
- Schedule Effect fiber wake-ups at the dueAt timestamp
- On wake: check thread readiness (idle, no approvals), create thread if needed (createThread metadata), persist settings overrides, dispatch thread.turn.start
- Record delayed-send.dispatched activity on success
- Retry logic same as auto-continue
- On startup: rebuild candidates from persisted delayed-send state

The decider must handle thread.delayed-send.schedule and thread.delayed-send.cancel commands — emit the corresponding domain events. The projector must handle thread.delayed-send-scheduled to persist to a new projection table or inline in the thread projection.

Acceptance: unit tests covering schedule, cancel, dispatch on wake, thread creation, retry, readiness blocking.
