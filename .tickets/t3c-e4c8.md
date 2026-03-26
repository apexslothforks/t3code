---
id: t3c-e4c8
status: closed
deps: []
links: []
created: 2026-03-26T17:10:55Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-eh7q
tags: [automation, contracts]
---

# Add delayed-send command schemas to contracts

Add two new orchestration commands to packages/contracts/src/orchestration.ts:

- thread.delayed-send.schedule: Schedule a message to be sent at a specific time. Fields: threadId, messageId, text, attachments, dueAt, modelSelection, runtimeMode, interactionMode, optional createThread metadata.
- thread.delayed-send.cancel: Cancel a previously scheduled delayed send. Fields: threadId, commandId.

Add corresponding domain events:

- thread.delayed-send-scheduled
- thread.delayed-send-cancelled
- thread.delayed-send-dispatched

Follow existing patterns in the file (Schema.TaggedStruct, OrchestrationCommand union, OrchestrationEvent union). Look at how thread.auto-continue.set is defined as a reference.
