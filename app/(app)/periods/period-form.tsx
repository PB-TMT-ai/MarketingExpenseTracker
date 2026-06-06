"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPeriod, type CreatePeriodState } from "@/lib/actions/periods";

export default function PeriodForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<CreatePeriodState, FormData>(
    createPeriod,
    {},
  );

  // Reset the form after a successful create so the user can add another period.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:grid-cols-2"
    >
      <h2 className="text-base font-semibold sm:col-span-2">Add a period</h2>

      <label className="text-sm sm:col-span-1">
        Type
        <select
          name="type"
          required
          defaultValue="month"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
        >
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
          <option value="fy">Financial Year</option>
        </select>
      </label>

      <label className="text-sm sm:col-span-1">
        Label
        <input
          name="label"
          required
          placeholder="e.g. Aug 2026 / Q3 FY27"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
        />
      </label>

      <label className="text-sm sm:col-span-1">
        Start date
        <input
          type="date"
          name="startDate"
          required
          lang="en-GB"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
        />
      </label>

      <label className="text-sm sm:col-span-1">
        End date
        <input
          type="date"
          name="endDate"
          required
          lang="en-GB"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
        />
      </label>

      <div className="border-t border-neutral-200 pt-4 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="makeActive" className="size-4" />
          <span>
            Set as the active period after creation
            <span className="ml-1 text-xs text-neutral-500">
              (replaces the current active period)
            </span>
          </span>
        </label>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center rounded-md bg-neutral-900 px-5 text-sm font-medium text-white transition-opacity hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create period"}
        </button>
      </div>
    </form>
  );
}
