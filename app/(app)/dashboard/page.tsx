import Link from "next/link";
import { z } from "zod";
import { getActivePeriod } from "@/lib/periods/active";
import { ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";
import {
  aggregateScopeTotals,
  aggregateByGeo,
  aggregateWeeklyBuckets,
  aggregateExceptionTotals,
  type DashboardFilters,
  type GeoRow,
  type WeeklyMode,
} from "@/lib/db/dashboard";
import { computeCompleteness } from "@/lib/compliance";
import { buildGeoTree } from "@/lib/compliance/tree";
import StatStrip from "./stat-strip";
import BreakdownCard from "./breakdown-card";
import ExceptionCard from "./exception-card";
import DashboardFilterBar, {
  type DashboardFilterOptions,
} from "./dashboard-filter-bar";
import RefreshButton from "./refresh-button";
import WeeklyTrendChart from "./weekly-trend-chart";
import WeeklySpendChart from "./weekly-spend-chart";
import RollingNToggle from "./rolling-n-toggle";
import GeoDrillTree from "./geo-drill-tree";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Read a (possibly repeated) param into a string[]. Mirrors actuals/page.tsx readFacetParam:
 * Next gives `string | string[] | undefined`; multi-select facets are repeated params.
 */
function readList(params: SearchParams, key: string): string[] {
  const v = params[key];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((s) => s.trim() !== "");
}

const facetSchema = z.array(z.string());

/**
 * Zod-validate + normalize the untrusted URL searchParams into a DashboardFilters payload
 * (T-04-03-01). `status` is SILENTLY STRIPPED — it is never read here, enforcing D-17 even
 * if a user crafts `?status=Done`. `activity` is resolved against ACTIVITY_KEYS; `?activity=all`
 * (or any unknown value) becomes null = "no activity constraint".
 */
function parseDashboardFilters(
  params: SearchParams,
  activePeriod: { id: number },
): DashboardFilters {
  const rawActivity = Array.isArray(params.activity)
    ? params.activity[0]
    : params.activity;
  const activity: string | null =
    rawActivity && rawActivity !== "all" && ACTIVITY_KEYS.includes(rawActivity as ActivityKey)
      ? (rawActivity as ActivityKey)
      : null;

  return {
    periodId: activePeriod.id,
    activity,
    regions: facetSchema.parse(readList(params, "region")),
    states: facetSchema.parse(readList(params, "state")),
    districts: facetSchema.parse(readList(params, "district")),
    distributors: facetSchema.parse(readList(params, "distributor")),
  };
}

/**
 * Resolve the weekly-trend mode from the URL. Defaults to period mode (D-14). Rolling mode
 * (D-15) only engages when `?mode=rolling` AND `?weeks` is one of {4, 8, 12}; otherwise we
 * fall back to period. Plan 04-04 reads the resulting WeekBucket[] in the chart island.
 */
function resolveWeeklyMode(
  params: SearchParams,
  period: { startDate: string; endDate: string },
): WeeklyMode {
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const rawWeeks = Array.isArray(params.weeks) ? params.weeks[0] : params.weeks;
  const weeks = Number(rawWeeks);
  if (rawMode === "rolling" && (weeks === 4 || weeks === 8 || weeks === 12)) {
    return { kind: "rolling", weeks };
  }
  return { kind: "period", startDate: period.startDate, endDate: period.endDate };
}

/**
 * Derive the FilterBar option lists server-side from the geo aggregate (D-11 single
 * cascade source — the same who/where values that drive the drill tree). Distinct,
 * sorted, "(unassigned)" filtered out of the selectable options.
 */
function deriveFilterOptions(geo: GeoRow[]): DashboardFilterOptions {
  const uniq = (vals: string[]) =>
    [...new Set(vals.filter((v) => v && v !== "(unassigned)"))].sort();
  return {
    regions: uniq(geo.map((g) => g.region)),
    states: uniq(geo.map((g) => g.state)),
    districts: uniq(geo.map((g) => g.district)),
    distributors: [],
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedParams = await searchParams;
  const activePeriod = await getActivePeriod();

  if (!activePeriod) {
    return (
      <div data-slot="dashboard-page" className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </header>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-neutral-500">
            No active period —{" "}
            <Link href="/periods" className="underline">
              create one or mark one active in /periods
            </Link>{" "}
            before viewing the compliance dashboard.
          </p>
        </div>
      </div>
    );
  }

  const filters = parseDashboardFilters(resolvedParams, activePeriod);
  const weeklyMode = resolveWeeklyMode(resolvedParams, activePeriod);

  // Six parallel aggregators (DASH-01..DASH-07 data plane). All numbers flow through
  // lib/db/dashboard — no inline SQL here.
  const [totals, byGeo, weekly, exceptionTotals] =
    await Promise.all([
      aggregateScopeTotals(filters),
      aggregateByGeo(filters),
      aggregateWeeklyBuckets(filters, weeklyMode),
      aggregateExceptionTotals(filters),
    ]);

  const completeness = computeCompleteness(totals);
  const filterOptions = deriveFilterOptions(byGeo);

  return (
    <div data-slot="dashboard-page" className="mx-auto max-w-[1600px]">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Plan execution &amp; spend for{" "}
            <span className="font-medium">{activePeriod.label}</span>.
          </p>
        </div>
        <RefreshButton />
      </header>

      <div className="mb-4">
        <DashboardFilterBar initialFilters={filters} options={filterOptions} />
      </div>

      <div className="flex flex-col gap-4">
        <StatStrip totals={totals} completeness={completeness} />

        {totals.plannedUnits === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
            No plan rows in scope —{" "}
            <Link href="/plans" className="underline">
              upload a plan
            </Link>{" "}
            to populate the dashboard.
          </p>
        ) : null}

        <BreakdownCard filters={filters} />

        <ExceptionCard totals={exceptionTotals} />

        {/* DASH-06 — weekly trend + spend charts with rolling-N window toggle. */}
        <section data-slot="trend-section" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Weekly trend
            </h2>
            <RollingNToggle
              currentMode={weeklyMode.kind}
              currentWeeks={weeklyMode.kind === "rolling" ? weeklyMode.weeks : null}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <WeeklyTrendChart buckets={weekly} />
            <WeeklySpendChart
              buckets={weekly}
              plannedBaseline={totals.plannedCost / Math.max(1, weekly.length)}
            />
          </div>
        </section>

        {/* DASH-07 — Zone → State → District → Taluka drill tree. */}
        <GeoDrillTree tree={buildGeoTree(byGeo)} />
      </div>
    </div>
  );
}
