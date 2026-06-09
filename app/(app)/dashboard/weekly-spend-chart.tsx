"use client";

/**
 * WeeklySpendChart (client island) — DASH-06 weekly planned ₹ vs actual ₹.
 *
 * Recharts LineChart: an `actualCost` line per ISO week (from WeekBucket.actualCost)
 * plus a flat `plannedBaseline` reference line.
 *
 * Open Question #4 (RESEARCH) decision: the planned series is a FLAT REFERENCE LINE at
 * period-planned-₹ / number-of-weeks. Plan rows have no per-week planning cadence, so
 * a flat baseline is the honest representation (option (c)/(a) hybrid — no fabricated
 * per-week plan curve). The caller (page.tsx) computes the scalar baseline
 * server-side and passes it as `plannedBaseline`; we synthesize the flat series here.
 *
 * Receives pre-aggregated WeekBucket[] + a scalar baseline — no client-side fetch.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { WeekBucket } from "@/lib/db/dashboard";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type ChartDatum = {
  weekStart: string;
  actual: number;
  planned: number;
};

export default function WeeklySpendChart({
  buckets,
  plannedBaseline,
}: {
  buckets: WeekBucket[];
  plannedBaseline: number;
}) {
  const data: ChartDatum[] = buckets.map((b) => ({
    weekStart: b.weekStart,
    actual: b.actualCost,
    planned: plannedBaseline,
  }));

  return (
    <section
      data-slot="weekly-spend-chart"
      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="mb-3 text-base font-semibold text-neutral-900">
        Weekly spend: planned vs actual ₹
      </h2>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          No recorded spend in scope yet.
        </p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                width={64}
                tickFormatter={(v) => inr.format(Number(v))}
              />
              <Tooltip formatter={(v) => inr.format(Number(v))} />
              <Legend />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual ₹"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="planned"
                name="Planned ₹ (flat reference)"
                stroke="#9ca3af"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Planned ₹ shown as flat reference line — plan rows have no per-week planning
        cadence (see Open Question #4).
      </p>
    </section>
  );
}
