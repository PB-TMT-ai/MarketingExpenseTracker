"use client";

/**
 * WeeklyTrendChart (client island) — DASH-06 weekly counter trend.
 *
 * Recharts stacked AreaChart: one stack per ISO Monday-start week showing executed /
 * (pending + in-progress) / cancelled counts. XAxis is the `weekStart` ISO date.
 *
 * Open Question #4 (RESEARCH): the trend shows RECORDED EXECUTIONS ONLY — there is no
 * fabricated planned baseline here, because plan rows carry no per-week planning
 * cadence. The honest period totals live in the StatStrip cards above. The caption
 * states this explicitly.
 *
 * Receives pre-aggregated WeekBucket[] as a prop — no client-side fetch (RSC → island
 * trust boundary; all numbers computed server-side in lib/db/dashboard).
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { WeekBucket } from "@/lib/db/dashboard";

type ChartDatum = {
  weekStart: string;
  executed: number;
  pendingWip: number;
  cancelled: number;
};

export default function WeeklyTrendChart({ buckets }: { buckets: WeekBucket[] }) {
  const data: ChartDatum[] = buckets.map((b) => ({
    weekStart: b.weekStart,
    executed: b.executed,
    pendingWip: b.pending + b.inProgress,
    cancelled: b.cancelled,
  }));

  return (
    <section
      data-slot="weekly-trend-chart"
      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="mb-3 text-base font-semibold text-neutral-900">
        Weekly execution trend
      </h2>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          No recorded executions in scope yet.
        </p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="weekStart"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                stackId="1"
                dataKey="executed"
                name="Executed"
                stroke="#16a34a"
                fill="#16a34a"
                fillOpacity={0.55}
              />
              <Area
                type="monotone"
                stackId="1"
                dataKey="pendingWip"
                name="Pending + WIP"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.45}
              />
              <Area
                type="monotone"
                stackId="1"
                dataKey="cancelled"
                name="Cancelled"
                stroke="#dc2626"
                fill="#dc2626"
                fillOpacity={0.4}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Trend shows recorded executions only (ISO Monday-start weeks). Period totals
        in cards above.
      </p>
    </section>
  );
}
