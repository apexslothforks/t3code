---
id: t3c-a1po
status: closed
deps: [t3c-fptw, t3c-3l9v]
links: []
created: 2026-03-26T17:12:12Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-02es
tags: [automation, server]
---

# Wire ScheduledDispatchReactor into OrchestrationReactor startup

Add the ScheduledDispatchReactor to the server orchestration startup.

Changes:

1. apps/server/src/orchestration/Layers/OrchestrationReactor.ts — yield\* scheduledDispatchReactor.start alongside existing reactors
2. apps/server/src/serverLayers.ts — compose ScheduledDispatchReactorLive layer with its dependencies (OrchestrationEngineService)

Reference: .worktrees/tb-rwpj/apps/server/src/orchestration/Layers/OrchestrationReactor.ts shows how AutoContinueReactor was wired in. Same pattern.

Acceptance: server starts with reactor active, bun typecheck passes, integration smoke test shows reactor subscribing to domain events.
