# Automation Spec

## Scope

This document specifies the automation behavior implemented in T3 Code today.

It covers:

- per-thread auto-continue
- quick automation presets
- delayed send
- restart and failure behavior that affects automation
- the UI state derived from automation state

It does not cover:

- account switching
- external quota tooling
- `codex-swap`

The goal is to make the current behavior explicit enough that it can be ported to another client later.

## Product Goals

- Let a thread continue working without the user manually sending every follow-up.
- Keep automated behavior scoped to a specific thread.
- Keep queued work visible in the UI.
- Avoid silently dropping pending automation on restart or transient failures.
- Prefer predictability over aggressiveness.

## Concepts

### Auto-Continue

Auto-continue is server-owned automation that sends a follow-up user message after an assistant reply settles.

It is configured per thread and stored in thread state.

Settings:

- `enabled`
- `messages`
- `delayMinutes`
- `cooldownMinutes`
- `stopWithHeuristic`

### Quick Automation Preset

The quick automation field is a convenience layer on top of auto-continue settings.

It does not introduce a new automation system. It simply fills in a standard auto-continue preset from a short task input.

### Delayed Send

Delayed send is a client-owned scheduler for a single queued message.

Unlike auto-continue, it is not derived from an assistant completion. It is an explicit future send request created by the user.

## Thread-Level Auto-Continue

### Trigger Model

Auto-continue is eligible only after:

- the latest non-system message is from the assistant
- that assistant message is complete
- the thread has no active turn
- the assistant message has not already triggered auto-continue
- heuristic stop does not suppress the next follow-up

The dispatch time is derived from:

- assistant completion time
- thread delay setting
- cooldown setting
- last auto-continue activity
- delay-reset activity, if one exists

### Dispatch Ownership

Dispatch is server-owned in `AutoContinueReactor`.

The server watches:

- assistant message completions
- thread setting changes
- thread/session readiness changes
- pending approval and user-input state

The server is responsible for deciding when to actually send the next follow-up command.

### Blocking Conditions

Auto-continue must not dispatch while the thread is blocked by:

- pending approval requests
- pending user-input requests
- an active turn still running

Blocked automation is paused, not deleted.

### Failure Behavior

Auto-continue should survive:

- server restart
- transient dispatch errors
- temporary provider/session races

Current behavior:

- pending candidates are rebuilt on reactor startup
- stale wake timers are cancelled when superseded
- transient dispatch failures retry rather than killing the candidate immediately

### Visibility

The client derives an automation timer state from:

- thread messages
- thread activities
- session status
- auto-continue settings

The UI shows:

- delay start
- target dispatch time
- whether automation is waiting for readiness
- whether it is blocked by approval or user input

## Quick Automation Preset

### User Input

The quick automation input is a short task string entered inline in the composer area.

Example shape:

- ticket title
- short work item
- “work on X”

### Preset Translation

Submitting the quick automation field produces:

- `enabled = true`
- `stopWithHeuristic = true`
- `delayMinutes = 1`
- `cooldownMinutes = round(current cooldown)`, with fallback to `5`
- `messages = [preset message]`

Current preset message format:

`work on {task}, use your best jugment to push this forward, check children to work on, and rebase often`

### Thread Rename Behavior

Submitting the quick preset also renames the thread to the entered task when the thread exists server-side.

The input itself is cleared after submit, but the last submitted task remains visible as placeholder text.

### Sidebar Toggle

There is also a per-thread sidebar toggle that flips automation on or off directly.

This toggle uses the existing thread auto-continue state. It is not a separate mode.

## Delayed Send

### Purpose

Delayed send is for explicit “send this later” behavior, not autonomous follow-up after model output.

It is useful for:

- short cooling-off periods
- timed follow-up starts
- scheduling a thread to begin later

### Ownership

Delayed send is client-owned and persisted in a delayed-send store.

The global delayed-send runner scans scheduled entries and dispatches them when due.

### Stored Entry Shape

A delayed-send entry includes:

- target `threadId`
- due time
- message text
- attachments
- model
- model options
- provider
- runtime mode
- interaction mode
- assistant delivery mode
- retry metadata
- optional `createThread` metadata for draft threads

### Draft Thread Support

Delayed send can be created before the server thread exists.

When the due time arrives:

- if the target thread does not exist yet
- and the entry contains `createThread`
- the runner creates the thread first
- then persists thread settings
- then dispatches the turn

### Readiness Rules

Delayed send only dispatches when the target thread is:

- idle
- not blocked by approvals
- not blocked by user-input requests

An idle error session is still allowed to dispatch a delayed send. Error state alone must not permanently block the queued message.

### Failure Behavior

On dispatch failure:

- transient failures are retried after a short retry delay
- permanent failures clear the queued entry
- the thread error state is updated
- the user gets a toast

### Provider Overrides

Delayed send must pass through the current Codex provider overrides, including custom binary/home settings, the same way a normal turn start does.

## Restart Behavior

### Auto-Continue

Auto-continue state survives server restart by rebuilding pending candidates from thread state and activities.

The countdown should continue from persisted state instead of disappearing.

### Delayed Send

Delayed send is persisted client-side and resumes from stored entries when the client is running again.

### Pending Approvals and User Input

When the provider session exits, stale pending approvals and stale pending user-input requests are cleared rather than left hanging forever in the UI.

This is required because the new provider session may no longer know about those pending requests.

## Session Phase Semantics

Automation depends on accurate session-phase modeling.

The UI derives phase from:

- orchestration status
- `activeTurnId`

It should not trust only legacy provider session status, because that can leave the UI stuck on “working” after the thread is already idle.

This affects:

- send availability
- delayed-send readiness
- automation waiting state
- thread status display

## Heuristic Stop

Auto-continue may stop before sending if heuristic stop decides that another follow-up should not be issued.

Heuristic stop is a guardrail, not a separate workflow.

The exact heuristic implementation lives in shared runtime logic and should be preserved as a policy input rather than duplicated in multiple UI surfaces.

## Activities and Observability

The system records activities for automation so later logic and UI can reason about what happened.

Important activity classes include:

- auto-continue sent
- auto-continue failed
- auto-continue delay reset
- stale pending interaction cleanup

These activities are part of the functional state model, not just logging.

## Porting Notes

If this behavior is reimplemented in another app:

- keep auto-continue server-owned
- keep delayed send client-owned unless there is a strong reason to centralize it
- preserve per-thread settings rather than global automation
- preserve blocked-state semantics for approvals and user-input requests
- preserve restart cleanup for stale pending requests
- preserve provider-option passthrough for normal sends and delayed sends

The main product behavior to preserve is:

- a thread can be explicitly scheduled
- a thread can autonomously follow up after a completed assistant reply
- both survive common failure and restart paths without silently disappearing
