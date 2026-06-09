"use server";

import { revalidatePath } from "next/cache";

/**
 * revalidateDashboard — manual "Refresh" affordance for the compliance dashboard.
 *
 * Pitfall 5 / R3 mitigation: the dashboard page is `dynamic = "force-dynamic"`, but a
 * dashboard read can still race a grid write in another tab (eventual consistency is
 * accepted for v1 — CONTEXT D-17 / "Optimistic-concurrency" note). This action lets the
 * user force a fresh aggregate pass by invalidating the route cache and re-rendering.
 *
 * Takes NO input — the only trust boundary is the shared-password session cookie enforced
 * by the `(app)` group middleware (T-04-03-03). No additional Zod validation is needed
 * because there is no payload to validate.
 */
export async function revalidateDashboard(): Promise<void> {
  revalidatePath("/dashboard");
}
