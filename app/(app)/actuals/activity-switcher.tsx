"use client";

/**
 * ActivitySwitcher — the activity tablist for /actuals (P2-5).
 *
 * Reads the LIVE query string at click time (window.location, which FilterBar keeps in
 * sync via history.replaceState) and carries every filter param across the switch.
 *
 * Renders the 6 registry activities AND a 7th "Adhoc Expenses" tab. Adhoc is NOT in the
 * activity registry (it has no SFID flow); it's appended at the component level. The page
 * branches on `?activity=adhoc` to render a different grid.
 */

import { useRouter } from "next/navigation";
import { ACTIVITIES } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

export type ActualsTabKey = ActivityKey | "adhoc";

export default function ActivitySwitcher({
  activityKeys,
  activeKey,
}: {
  activityKeys: readonly ActivityKey[];
  activeKey: ActualsTabKey;
}) {
  const router = useRouter();

  function go(key: ActualsTabKey) {
    const search =
      typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    params.set("activity", key);
    router.push(`/actuals?${params.toString()}`);
  }

  const tabs: { key: ActualsTabKey; label: string }[] = [
    ...activityKeys.map((k) => ({ key: k as ActualsTabKey, label: ACTIVITIES[k].label })),
    { key: "adhoc", label: "Adhoc Expenses" },
  ];

  return (
    <div
      data-slot="activity-select"
      role="tablist"
      aria-label="Select activity"
      className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 whitespace-nowrap sm:mx-0 sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:px-0"
    >
      {tabs.map(({ key, label }) => {
        const isActive = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            data-activity={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => go(key)}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-3.5 text-sm font-medium ${
              isActive
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
