---
id: t3c-sxfv
status: closed
deps: []
links: []
created: 2026-03-26T17:10:55Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-eh7q
tags: [automation, shared]
---

# Move thread readiness guards to packages/shared

The functions isThreadReadyForDispatch and shouldRetryThreadDispatchError currently live in apps/web/src/threadDispatch.ts. The server reactor needs the same readiness logic.

Move them to a new subpath export packages/shared/src/threadDispatch.ts. Keep the web import working by re-exporting or updating imports. The shared version should work with the OrchestrationThread type from contracts (not the web-only Thread type). Add the subpath export to packages/shared/package.json following the existing pattern (see how @t3tools/shared/autoContinue is exported).
