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
import type { FacetSelections } from "@/lib/actuals/filter";
import ActualsGrid from "./actuals-grid";
import ActivitySwitcher from "./activity-switcher";
import AdhocGrid from "./adhoc-grid";
import { listAdhocByPeriod } from "@/lib/db/adhoc";
import type { ActualsTabKey } from "./activity-switcher";

/**
 * Read a (possibly repeated) filter param into a string[] (P2-5).
 * Next gives `string | string[] | undefined`; multi-select facets are encoded
 * as repeated params (?region=North&region=South).
 */
function readFacetParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string[] {
  const v = params[key];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((s) => s.trim() !== "");
}

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

  // Adhoc Expenses branch — period-scoped off-plan grid. No SFID gate.
  if (activityParam === "adhoc") {
    const adhocRows = await listAdhocByPeriod(activePeriod.id);
    return (
      <div data-slot="actuals-page" className="mx-auto max-w-[1600px]">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Actuals</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Adhoc expenses recorded for{" "}
              <span className="font-medium">{activePeriod.label}</span>.
            </p>
          </div>
        </header>
        <ActivitySwitcher
          activityKeys={ACTIVITY_KEYS}
          activeKey={"adhoc" as ActualsTabKey}
        />
        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-4">
            <h2 className="text-base font-semibold">Adhoc Expenses</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Off-plan, period-scoped spend. Not gated by SFID.
            </p>
          </div>
          <div className="p-4">
            <AdhocGrid initialRows={adhocRows} periodId={activePeriod.id} />
          </div>
        </section>
      </div>
    );
  }

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

  // P2-5: initial filter selections from the URL so a shared/reloaded link lands
  // pre-filtered, and so filters carried across an activity switch re-apply.
  const initialFacets: FacetSelections = {
    region: readFacetParam(resolvedParams, "region"),
    state: readFacetParam(resolvedParams, "state"),
    district: readFacetParam(resolvedParams, "district"),
    distributor: readFacetParam(resolvedParams, "distributor"),
    status: readFacetParam(resolvedParams, "status"),
  };
  const rawSfid = resolvedParams.sfid;
  const initialSfid = typeof rawSfid === "string" ? rawSfid : "";

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

      {/* Activity selector (P2-5: client switcher preserves filters across switch) */}
      <ActivitySwitcher activityKeys={ACTIVITY_KEYS} activeKey={activityKey} />

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
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">
                {ACTIVITIES[activityKey].label}
              </h2>
              {planRows.length - executions.length > 0 ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {planRows.length - executions.length} to record
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  All recorded
                </span>
              )}
            </div>
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
          <details className="border-b border-neutral-200 px-4 py-2 text-xs text-neutral-600">
            <summary className="cursor-pointer font-medium text-neutral-700 hover:text-neutral-900">
              How to record an execution
            </summary>
            <p className="mt-2 leading-relaxed">
              Click any editable cell on a plan row to enter execution details
              (sq ft, status, dates, coordinates). The row turns from a
              placeholder into a saved execution as soon as you tab out — no
              separate save button per row.
              {ACTIVITIES[activityKey].type === "item-list" ? (
                <>
                  {" "}
                  For POP / Dealer Kit, click the row to open the kit modal
                  and pick line items.
                </>
              ) : null}
            </p>
          </details>
          <p className="border-b border-neutral-200 px-4 py-2 text-xs text-neutral-500 lg:hidden">
            Scroll horizontally to see all columns.
          </p>
          <div className="overflow-x-auto p-4">
            <ActualsGrid
              initialRows={initialRows}
              activityKey={activityKey}
              periodId={activePeriod.id}
              items={activeItems}
              initialFacets={initialFacets}
              initialSfid={initialSfid}
            />
          </div>
        </section>
      )}
    </div>
  );
}
