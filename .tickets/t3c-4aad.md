---
id: t3c-4aad
status: closed
deps: [t3c-a1po, t3c-e4c8]
links: []
created: 2026-03-26T17:12:33Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-d0fc
tags: [automation, web]
---

# Delete client-side delayedSendRunner and delayedSendStore

Remove:

- apps/web/src/delayedSendRunner.tsx
- apps/web/src/delayedSendRunner.test.ts
- apps/web/src/delayedSendStore.ts

The server-side ScheduledDispatchReactor now owns delayed-send dispatch. The client schedules via thread.delayed-send.schedule command (same as any other orchestration command dispatch).

Remove the <DelayedSendRunner /> mount from apps/web/src/routes/\_\_root.tsx.

Update ChatView.tsx delayed-send scheduling to dispatch the command to server instead of writing to the local Zustand store.

Acceptance: no references to delayedSendRunner or delayedSendStore remain, bun typecheck passes.
