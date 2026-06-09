"use client";

import { useTransition } from "react";
import { revalidateDashboard } from "@/lib/actions/dashboard";

/**
 * RefreshButton (client island) — manual eventual-consistency affordance (Pitfall 5 / R3).
 *
 * A single button that calls the `revalidateDashboard` Server Action inside a transition,
 * showing "Refreshing…" while pending. The action invalidates the /dashboard route cache,
 * forcing a fresh aggregate pass on the next render.
 */
export default function RefreshButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      data-slot="refresh-button"
      disabled={isPending}
      onClick={() => startTransition(() => revalidateDashboard())}
      className="inline-flex h-10 shrink-0 items-center rounded-md border border-neutral-300 bg-white px-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
