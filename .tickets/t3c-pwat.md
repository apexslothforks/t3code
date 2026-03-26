---
id: t3c-pwat
status: open
deps: [t3c-4t0a, t3c-a1po]
links: []
created: 2026-03-26T17:12:24Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-d0fc
tags: [automation, web]
---

# Delete client-side autoContinueRunner.tsx

Remove apps/web/src/autoContinueRunner.tsx and apps/web/src/autoContinueRunner.test.ts. The server-side ScheduledDispatchReactor now owns auto-continue dispatch.

Remove the <AutoContinueRunner /> mount from apps/web/src/routes/\_\_root.tsx.

Any exports used by ChatView.tsx (deriveAutoContinueStatusSnapshot, AutoContinueStatusSnapshot, resolveEffectiveAutoContinueDelayResetAt) must be moved to a new client-side derivation module before deletion — see the 'automation status derivation' ticket.

Acceptance: no references to autoContinueRunner remain, bun typecheck passes, bun lint passes.
