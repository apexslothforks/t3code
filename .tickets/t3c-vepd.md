---
id: t3c-vepd
status: closed
deps: [t3c-husd, t3c-e4c8]
links: []
created: 2026-03-26T17:11:41Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-02es
tags: [automation, server]
---

# Add ScheduledDispatchReactor service interface

Create the Effect service interface for the unified dispatch reactor.

Files to create:

- apps/server/src/orchestration/Services/ScheduledDispatchReactor.ts

The interface should have:

- start: Effect<void, never, Scope> — starts the reactor fibers
- Same pattern as .worktrees/tb-rwpj/apps/server/src/orchestration/Services/AutoContinueReactor.ts

This is a thin service definition, no implementation logic.
