"use client";

/**
 * useSaveExecutions — the SINGLE source of truth for the actuals Save flow (GRID-12).
 *
 * Lifts the save action OUT of SaveBar so the component can become purely presentational.
 * There is exactly ONE useActionState, ONE submit function, ONE onResult dispatch here —
 * so the top bar, the bottom bar, and the Ctrl/Cmd+S shortcut all drive the same flow.
 * No double-submit (React serialises the action; callers disable on `pending`) and no
 * divergent dirty counts (both bars read the same `dirtyCount` prop from the owner).
 *
 * The hook captures the CURRENT dirty units at click time via `getDirtyUnits()` (a closure
 * the owner provides) rather than a stale snapshot — mirroring the old SaveBar's inline
 * async wrapper (decision 03-04: capture dirtyRows closure at click time).
 */

import { useActionState, useEffect } from "react";
import { saveExecutionsBatch, type SaveBatchState } from "@/lib/actions/executions";

/**
 * One unit in the save batch — the patch shape saveExecutionsBatch's Zod schema accepts.
 * Built by the owner (ActualsGrid) from its dirty rows, exactly as the old SaveBar did.
 */
export type UnitPatch = {
  rowKey: string;
  planRowId: number;
  executionId: number | null;
  version: number;
  fields: Record<string, unknown>;
  isPlaceholder: boolean;
  popLines?: Array<{
    itemName: string;
    qty: number;
    rate: number;
    lineTotal: number;
  }>;
};

/** The initial action state — referentially stable so the effect can detect "no result yet". */
export const INITIAL_STATE: SaveBatchState = {
  ok: true,
  savedIds: [],
  conflicts: [],
};

export type UseSaveExecutions = {
  /** Trigger the save. Builds the batch from getDirtyUnits() at call time. */
  submit: () => void;
  /** True while the action is in flight (disable buttons + the keyboard shortcut). */
  pending: boolean;
  /** The latest action result (INITIAL_STATE until the first save returns). */
  state: SaveBatchState;
};

/**
 * @param getDirtyUnits - returns the CURRENT dirty units at submit time (closure, not snapshot)
 * @param activityKey   - registry key for the save batch
 * @param periodId      - active period
 * @param onResult      - called once per completed save with the result (clears dirty, marks conflicts)
 */
export function useSaveExecutions(
  getDirtyUnits: () => UnitPatch[],
  activityKey: string,
  periodId: number,
  onResult: (result: SaveBatchState) => void,
): UseSaveExecutions {
  const [state, formAction, pending] = useActionState<SaveBatchState, void>(
    async () =>
      saveExecutionsBatch(undefined, {
        activity: activityKey,
        periodId,
        units: getDirtyUnits(),
      }),
    INITIAL_STATE,
  );

  // Notify the owner exactly once per completed save (state moves off INITIAL_STATE).
  useEffect(() => {
    if (state === INITIAL_STATE) return;
    onResult(state);
    // onResult is referentially stable (useCallback in the owner); intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return { submit: () => formAction(), pending, state };
}
