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
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
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
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
        />
      </label>

      <label className="text-sm sm:col-span-1">
        Start date
        <input
          type="date"
          name="startDate"
          required
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
        />
      </label>

      <label className="text-sm sm:col-span-1">
        End date
        <input
          type="date"
          name="endDate"
          required
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
        />
      </label>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="makeActive" className="size-4" />
        Set as the active period after creation
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create period"}
        </button>
      </div>
    </form>
  );
}
