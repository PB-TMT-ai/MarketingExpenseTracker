import Link from "next/link";
import { getActivePeriod } from "@/lib/periods/active";
import { listByPeriodActivity } from "@/lib/db/plan-rows";
import {
  listExecutionsByPeriodActivity,
  listKitLines,
} from "@/lib/db/executions";
import { listItems } from "@/lib/db/items";
import { buildRowModel, type PopLineInput } from "@/lib/actuals/rows";
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
          <h1 className="text-2xl font-semibold tracking-tight">Actuals</h1>
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

  // POP/Dealer-Kit (item-list): load existing kit lines and attach to their rows so
  // re-opening a saved kit shows its items (and a re-save doesn't wipe them, since
  // savePopKit is replace-all). Other activity types carry no popLines.
  if (ACTIVITIES[activityKey].type === "item-list" && executions.length > 0) {
    const lines = await listKitLines(executions.map((e) => e.id));
    const byExec = new Map<number, PopLineInput[]>();
    for (const l of lines) {
      const arr = byExec.get(l.executionId) ?? [];
      arr.push({
        itemName: l.itemName,
        qty: Number(l.qty),
        rate: Number(l.rate),
        lineTotal: Number(l.lineTotal),
      });
      byExec.set(l.executionId, arr);
    }
    for (const row of initialRows) {
      if (row.executionId != null && byExec.has(row.executionId)) {
        row.popLines = byExec.get(row.executionId);
      }
    }
  }

  // Active items for the POP modal picker (ACTIVE only; itemName is snapshotted at entry).
  const activeItems = allItems.filter((i) => i.active);

  return (
    <div data-slot="actuals-page" className="mx-auto max-w-[1600px]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Actuals</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Record on-ground executions against the plan for{" "}
            <span className="font-medium">{activePeriod.label}</span>.
          </p>
        </div>
      </header>

      {/* Activity selector */}
      <div
        data-slot="activity-select"
        role="tablist"
        aria-label="Select activity"
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 whitespace-nowrap sm:mx-0 sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:px-0"
      >
        {ACTIVITY_KEYS.map((key: ActivityKey) => {
          const isActive = key === activityKey;
          return (
            <Link
              key={key}
              href={`/actuals?activity=${key}`}
              data-activity={key}
              role="tab"
              aria-selected={isActive}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-3.5 text-sm font-medium ${
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
          <div className="flex flex-col gap-2 border-b border-neutral-200 p-4 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 className="text-base font-semibold">
              {ACTIVITIES[activityKey].label}
            </h2>
            <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-neutral-500">
              <div>
                <dt className="sr-only">Period</dt>
                <dd>{activePeriod.label}</dd>
              </div>
              <div>
                <dt className="inline">Plan rows: </dt>
                <dd className="inline font-semibold text-neutral-900">
                  {planRows.length}
                </dd>
              </div>
              <div>
                <dt className="inline">Executions: </dt>
                <dd className="inline font-semibold text-neutral-900">
                  {executions.length}
                </dd>
              </div>
            </dl>
          </div>
          <p className="border-b border-neutral-200 px-4 py-2 text-xs text-neutral-500 lg:hidden">
            Scroll horizontally to see all columns.
          </p>
          <div className="overflow-x-auto p-4">
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
