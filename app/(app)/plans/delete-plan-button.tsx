"use client";

import { useState, useTransition } from "react";
import { deletePlanByScope, type DeletePlanState } from "@/lib/actions/plans";
import type { BlockedDealer } from "@/lib/db/plan-rows";

type Props = {
  periodId: number;
  activity: string;
  activityLabel: string;
  count: number;
};

export default function DeletePlanButton({ periodId, activity, activityLabel, count }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedDealers, setBlockedDealers] = useState<BlockedDealer[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    setBlockedDealers(null);
    startTransition(async () => {
      const result: DeletePlanState = await deletePlanByScope(periodId, activity);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
        setBlockedDealers(result.blockedDealers ?? null);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setBlockedDealers(null); setOpen(true); }}
        data-slot="delete-plan-button"
        data-activity={activity}
        aria-label={`Delete ${activityLabel} plan`}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-plan-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="delete-plan-title" className="text-base font-semibold">
              Delete {activityLabel} plan?
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              This will remove all{" "}
              <span className="font-semibold">{count}</span> plan row
              {count === 1 ? "" : "s"} for this activity. This cannot be undone.
            </p>

            {error ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">{error}</p>
                {blockedDealers && blockedDealers.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5">
                    {blockedDealers.map((b) => (
                      <li key={b.sfid}>
                        <span className="font-mono">{b.sfid}</span> · {b.executionCount}{" "}
                        execution{b.executionCount === 1 ? "" : "s"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                data-slot="confirm-delete"
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isPending ? "Deleting…" : "Delete plan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
