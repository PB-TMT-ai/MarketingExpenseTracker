"use client";

/**
 * SaveBar — the persistent "N unsaved changes / Save" bar (D3-10/11/12).
 *
 * PRESENTATIONAL (GRID-12): this component owns NO save state. The save flow lives in the
 * `useSaveExecutions` hook in ActualsGrid (ONE useActionState, ONE submit, ONE onResult).
 * Two instances of this bar (top + bottom) are rendered sharing the SAME
 * { dirtyCount, pending, lastResult, onSave } — so there is never a double-submit or a
 * divergent count. Each instance carries a distinct `slot` ("save-bar-top" / "save-bar-bottom")
 * so e2e selectors can target a specific bar.
 *
 * Protocol:
 *   - Shows the live unsaved count (dirtyCount) supplied by the owner.
 *   - Save button calls onSave (the shared submit).
 *   - Flashes a transient "Saved" confirmation when lastResult flips to a clean success.
 *   - Conflict rows are surfaced via the shared lastResult.conflicts count.
 *
 * Security: the save path (saveExecutionsBatch, in the hook) sends only planRowId
 * (never sfid). Fields are sent as-is; the server recomputes derived totals and validates.
 */

import { useEffect, useRef, useState } from "react";
import { type SaveBatchState } from "@/lib/actions/executions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SaveBarSlot = "save-bar-top" | "save-bar-bottom";

export type SaveBarProps = {
  /** Live unsaved-change count (shared across both bars). */
  dirtyCount: number;
  /** True while the shared save action is in flight. */
  pending: boolean;
  /** The latest save result from the shared useActionState (drives flash + conflicts). */
  lastResult: SaveBatchState;
  /** The shared submit — same function for both bars and the Ctrl/Cmd+S shortcut. */
  onSave: () => void;
  /** Which bar this is — sets the root data-slot for unambiguous e2e targeting. */
  slot: SaveBarSlot;
  /** Extra positioning classes (e.g. "sticky top-0 z-30" vs "sticky bottom-0"). */
  className?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SaveBar({
  dirtyCount,
  pending,
  lastResult,
  onSave,
  slot,
  className = "",
}: SaveBarProps) {
  // Transient "saved" flash — driven by lastResult flipping to a clean success.
  const [showSaved, setShowSaved] = useState(false);
  const prevResultRef = useRef<SaveBatchState | null>(null);

  useEffect(() => {
    // Only react when lastResult actually changes identity (a save completed).
    if (lastResult === prevResultRef.current) return;
    prevResultRef.current = lastResult;
    if (
      lastResult.ok &&
      lastResult.conflicts.length === 0 &&
      lastResult.savedIds.length > 0
    ) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 3000);
      return () => clearTimeout(t);
    }
  }, [lastResult]);

  const conflictCount = lastResult.ok ? lastResult.conflicts.length : 0;

  if (dirtyCount === 0 && !showSaved && conflictCount === 0) {
    return null; // Hide bar when nothing is pending
  }

  return (
    <div
      data-slot={slot}
      className={`flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-md ${className}`.trim()}
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
          <span data-slot="save-confirmation" className="text-emerald-700">
            Saved successfully
          </span>
        )}
        {!lastResult.ok && (
          <span className="text-red-600">{lastResult.error || "Save failed"}</span>
        )}
      </div>

      <button
        type="button"
        data-slot="save-button"
        onClick={onSave}
        disabled={pending || dirtyCount === 0}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 hover:bg-neutral-800"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
