"use client";

/**
 * ActivitySwitcher — the activity tablist (P2-5).
 *
 * Was a set of plain server <Link href="/actuals?activity=KEY">. The problem:
 * switching activity is a full navigation that dropped the reviewer's filter
 * selections. Now it reads the LIVE query string at click time (window.location,
 * which FilterBar keeps in sync via history.replaceState) and carries every
 * filter param across the switch — so "Punjab, Pending" persists when you hop
 * from Counter-Wall to GSB to compare progress.
 *
 * Reads window.location at click (not useSearchParams) on purpose: FilterBar
 * updates the URL with history.replaceState, which does NOT update the Next
 * router's cached search params — so useSearchParams would be stale.
 *
 * Preserves the original data-slot/role/data-activity/aria-selected contract
 * the e2e selectors and accessibility rely on.
 */

import { useRouter } from "next/navigation";
import { ACTIVITIES } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

export default function ActivitySwitcher({
  activityKeys,
  activeKey,
}: {
  activityKeys: readonly ActivityKey[];
  activeKey: ActivityKey;
}) {
  const router = useRouter();

  function go(key: ActivityKey) {
    const search =
      typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    params.set("activity", key);
    router.push(`/actuals?${params.toString()}`);
  }

  return (
    <div
      data-slot="activity-select"
      role="tablist"
      aria-label="Select activity"
      className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 whitespace-nowrap sm:mx-0 sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:px-0"
    >
      {activityKeys.map((key) => {
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
            {ACTIVITIES[key].label}
          </button>
        );
      })}
    </div>
  );
}
