"use client";

/**
 * SaveBar — the persistent "N unsaved changes / Save" bar (D3-10/11/12).
 *
 * Protocol:
 *   - Shows live unsaved count from the dirty Map (passed as dirtyRows[]).
 *   - Save button calls saveExecutionsBatch with the batch of UnitPatch objects.
 *   - On success: calls onSaveResult so ActualsGrid clears dirty flags + updates versions.
 *   - Conflict rows: flagged in the result.conflicts array → ActualsGrid marks them "reload".
 *   - Shows a transient "Saved" confirmation after a clean flush.
 *
 * Security: saveExecutionsBatch sends only planRowId (never sfid). Fields are sent
 * as-is; the server recomputes derived totals and validates with Zod.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import { saveExecutionsBatch, type SaveBatchState } from "@/lib/actions/executions";
import { type UnitRow } from "@/lib/actuals/rows";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SaveBarProps = {
  dirtyRows: UnitRow[];
  activityKey: string;
  periodId: number;
  onSaveResult: (result: SaveBatchState) => void;
  items?: Array<{ id: number; name: string; category: string | null }>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const INITIAL_STATE: SaveBatchState = { ok: true, savedIds: [], conflicts: [] };

export default function SaveBar({
  dirtyRows,
  activityKey,
  periodId,
  onSaveResult,
}: SaveBarProps) {
  const [state, formAction, pending] = useActionState<SaveBatchState, FormData>(
    async (_prev: SaveBatchState, _formData: FormData) => {
      // Build UnitPatch[] from the dirty rows.
      const units = dirtyRows.map((row) => ({
        rowKey: row.rowKey,
        planRowId: row.planRowId,
        executionId: row.executionId,
        version: row.version,
        fields: row.fields,
        isPlaceholder: row.isPlaceholder,
        // POP/Dealer-Kit kit lines (undefined for non-POP rows → normal insert/update path;
        // an array → the action routes through savePopKit: one execution + N execution_items).
        popLines: row.popLines,
      }));

      return saveExecutionsBatch(undefined, {
        activity: activityKey,
        periodId,
        units,
      });
    },
    INITIAL_STATE,
  );

  // Track whether we've shown the "saved" flash.
  const [showSaved, setShowSaved] = useState(false);

  // P2-4: form ref so the Ctrl/Cmd+S shortcut can submit the same action the
  // Save button triggers (requestSubmit runs validation + the form action).
  const formRef = useRef<HTMLFormElement>(null);

  const dirtyCount = dirtyRows.length;
  const conflictCount = "conflicts" in state ? state.conflicts.length : 0;

  // When the action completes, notify the parent and flash "saved" if clean.
  useEffect(() => {
    if (state === INITIAL_STATE) return;
    onSaveResult(state);
    if (state.ok && state.conflicts.length === 0 && state.savedIds.length > 0) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 3000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // P2-4: Ctrl/Cmd+S saves without reaching for the mouse — the reviewer's
  // muscle-memory shortcut. Only fires when there's something to save and a
  // save isn't already in flight; otherwise we let the browser keep its default.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        if (dirtyCount > 0 && !pending) {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirtyCount, pending]);

  if (dirtyCount === 0 && !showSaved && conflictCount === 0) {
    return null; // Hide bar when nothing is pending
  }

  return (
    <div
      data-slot="save-bar"
      className="sticky bottom-0 flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-md"
    >
      <div className="flex items-center gap-3 text-sm">
        {dirtyCount > 0 && (
          <span className="text-neutral-700">
            <span
              data-slot="unsaved-count"
              className="font-semibold tabular-nums"
            >
              {dirtyCount}
            </span>{" "}
            unsaved {dirtyCount === 1 ? "change" : "changes"}
          </span>
        )}
        {conflictCount > 0 && (
          <span className="text-amber-700">
            {conflictCount} row{conflictCount === 1 ? "" : "s"} with conflicts — reload
            those rows before re-saving.
          </span>
        )}
        {showSaved && (
          <span
            data-slot="save-confirmation"
            className="text-emerald-700"
          >
            Saved successfully
          </span>
        )}
        {"ok" in state && !state.ok && (
          <span className="text-red-600">
            {"error" in state ? (state as { error: string }).error : "Save failed"}
          </span>
        )}
      </div>

      <form action={formAction} ref={formRef}>
        <button
          type="submit"
          data-slot="save-button"
          disabled={pending || dirtyCount === 0}
          title="Save (Ctrl/⌘+S)"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 hover:bg-neutral-800"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
