import Link from "next/link";
import { getActivePeriod } from "@/lib/periods/active";
import { listByPeriodActivity } from "@/lib/db/plan-rows";
import { listExecutionsByPeriodActivity } from "@/lib/db/executions";
import { listItems } from "@/lib/db/items";
import { buildRowModel } from "@/lib/actuals/rows";
import { ACTIVITIES, ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";
import ActualsGrid from "./actuals-grid";

export const dynamic = "force-dynamic";

/**
 * /actuals — the editable actuals grid for one (activity, active period) slice.
 *
 * Server Component. Mirrors the shape of /plans/page.tsx:
 *   - export const dynamic = "force-dynamic"
 *   - getActivePeriod() first; if null, render the "create a period" empty state.
 *   - Activity selected via ?activity=<key> searchParam; defaults to first ACTIVITY_KEY.
 *   - Loads plan rows + executions, assembles the flat row model server-side.
 *   - Passes rows + activityKey + periodId to the client ActualsGrid component.
 *
 * Data-slot contract (e2e selectors):
 *   "actuals-page" on the page root
 *   "activity-select" on the activity links/selector
 *   "actuals-grid" on the grid container (set inside ActualsGrid)
 */
export default async function ActualsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const activePeriod = await getActivePeriod();

  if (!activePeriod) {
    return (
      <div data-slot="actuals-page" className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Actuals</h1>
        </header>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-neutral-500">
            No active period —{" "}
            <Link href="/periods" className="underline">
              create one or mark one active in /periods
            </Link>{" "}
            before recording actuals.
          </p>
        </div>
      </div>
    );
  }

  // Activity selection: ?activity=<key>, default to first key.
  const rawActivity = resolvedParams.activity;
  const activityParam = Array.isArray(rawActivity) ? rawActivity[0] : rawActivity;
  const activityKey: ActivityKey =
    activityParam && ACTIVITY_KEYS.includes(activityParam as ActivityKey)
      ? (activityParam as ActivityKey)
      : ACTIVITY_KEYS[0];

  // Load plan rows + executions for the selected (activity, period).
  const [planRows, executions, allItems] = await Promise.all([
    listByPeriodActivity(activePeriod.id, activityKey),
    listExecutionsByPeriodActivity(activePeriod.id, activityKey),
    listItems(),
  ]);

  // Assemble the flat row model server-side (zero-execution dealers → placeholder rows).
  const initialRows = buildRowModel(planRows, executions);

  // Active items for POP modal (03-05 will wire the modal; pass now for stable contract).
  const activeItems = allItems.filter((i) => i.active);

  return (
    <div data-slot="actuals-page" className="mx-auto max-w-[1600px]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Actuals</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Record on-ground executions against the plan for{" "}
            <span className="font-medium">{activePeriod.label}</span>.
          </p>
        </div>
      </header>

      {/* Activity selector */}
      <div
        data-slot="activity-select"
        className="mb-4 flex flex-wrap gap-2"
        aria-label="Select activity"
      >
        {ACTIVITY_KEYS.map((key: ActivityKey) => {
          const isActive = key === activityKey;
          return (
            <Link
              key={key}
              href={`/actuals?activity=${key}`}
              data-activity={key}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                isActive
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 hover:bg-neutral-50"
              }`}
            >
              {ACTIVITIES[key].label}
            </Link>
          );
        })}
      </div>

      {/* Plan row count / empty state for this activity */}
      {planRows.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-neutral-500">
            No plan rows for{" "}
            <span className="font-medium">{ACTIVITIES[activityKey].label}</span> in{" "}
            <span className="font-medium">{activePeriod.label}</span>.{" "}
            <Link href="/plans/upload" className="underline">
              Upload a plan
            </Link>{" "}
            first.
          </p>
        </div>
      ) : (
        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-200 p-4">
            <h2 className="text-base font-semibold">
              {ACTIVITIES[activityKey].label}{" "}
              <span className="ml-1 text-sm font-normal text-neutral-500">
                {activePeriod.label} · {planRows.length} plan{" "}
                {planRows.length === 1 ? "row" : "rows"} · {executions.length}{" "}
                execution{executions.length === 1 ? "" : "s"}
              </span>
            </h2>
          </div>
          <div className="p-4">
            <ActualsGrid
              initialRows={initialRows}
              activityKey={activityKey}
              periodId={activePeriod.id}
              items={activeItems}
            />
          </div>
        </section>
      )}
    </div>
  );
}
