/**
 * ScheduledDispatchReactor - Unified scheduled dispatch reactor service interface.
 *
 * Coordinates the unified reactor responsible for both auto-continue and
 * delayed-send scheduled dispatch flows.
 *
 * @module ScheduledDispatchReactor
 */
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

/**
 * ScheduledDispatchReactorShape - Service API for scheduled dispatch reactor
 * lifecycle.
 */
export interface ScheduledDispatchReactorShape {
  /**
   * Start the scheduled dispatch reactor.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

/**
 * ScheduledDispatchReactor - Service tag for unified scheduled dispatch
 * reactor workers.
 */
export class ScheduledDispatchReactor extends ServiceMap.Service<
  ScheduledDispatchReactor,
  ScheduledDispatchReactorShape
>()("t3/orchestration/Services/ScheduledDispatchReactor") {}
