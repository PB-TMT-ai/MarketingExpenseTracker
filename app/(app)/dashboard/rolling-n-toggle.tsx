"use client";

/**
 * RollingNToggle (client island) — DASH-06 weekly window selector (D-14 / D-15).
 *
 * Four segmented buttons: "Period", "4w", "8w", "12w". The active button reflects the
 * current `?mode` / `?weeks` URL params. Clicking writes:
 *   - "Period" → `?mode=period` (weeks param removed)
 *   - "Nw"     → `?mode=rolling&weeks=N`
 * via useRouter().replace(..., { scroll: false }) — the RSC then re-aggregates the
 * weekly buckets server-side (resolveWeeklyMode in page.tsx). All other params
 * (region/state/district/distributor/activity) are preserved.
 *
 * The server re-validates (T-04-04-01): parseDashboardFilters / resolveWeeklyMode clamp
 * weeks to {4, 8, 12} or fall back to period mode, so a crafted `?weeks=99` is inert.
 */

import { useRouter, useSearchParams } from "next/navigation";

const ROLLING_OPTIONS = [4, 8, 12] as const;

export default function RollingNToggle({
  currentMode,
  currentWeeks,
}: {
  currentMode: "period" | "rolling";
  currentWeeks: number | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(mode: "period" | "rolling", weeks?: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "period") {
      params.delete("mode");
      params.delete("weeks");
    } else {
      params.set("mode", "rolling");
      params.set("weeks", String(weeks));
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const periodActive = currentMode === "period";

  const baseBtn =
    "px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-neutral-400";
  const activeCls = "bg-neutral-900 text-white";
  const idleCls = "bg-white text-neutral-700 hover:bg-neutral-100";

  return (
    <div
      data-slot="rolling-n-toggle"
      className="inline-flex overflow-hidden rounded-md border border-neutral-300"
      role="group"
      aria-label="Weekly trend window"
    >
      <button
        type="button"
        data-mode="period"
        aria-pressed={periodActive}
        onClick={() => select("period")}
        className={`${baseBtn} ${periodActive ? activeCls : idleCls}`}
      >
        Period
      </button>
      {ROLLING_OPTIONS.map((n) => {
        const active = currentMode === "rolling" && currentWeeks === n;
        return (
          <button
            key={n}
            type="button"
            data-weeks={n}
            aria-pressed={active}
            onClick={() => select("rolling", n)}
            className={`${baseBtn} border-l border-neutral-300 ${active ? activeCls : idleCls}`}
          >
            {n}w
          </button>
        );
      })}
    </div>
  );
}
