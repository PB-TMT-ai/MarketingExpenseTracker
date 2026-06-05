import type { ActivityConfig, ActivityKey } from "./types";
import counterWall from "./counter-wall";
import gsb from "./gsb";
import nlb from "./nlb";
import inShop from "./in-shop";
import popDealerKit from "./pop-dealer-kit";
import dealerCertificate from "./dealer-certificate";

/**
 * The single source of truth for activities. ADDING A SEVENTH ACTIVITY (ACTV-03) IS A
 * ONE-ENTRY CHANGE: create a new `lib/activities/<key>.ts` config module, add its literal
 * key to the `ActivityKey` union in `types.ts`, and add ONE line below registering its
 * import. No resolver/loop/switch edit is required — `getActivity` is a by-key lookup.
 */
export const ACTIVITIES: Readonly<Record<ActivityKey, ActivityConfig>> = {
  "counter-wall": counterWall,
  gsb,
  nlb,
  "in-shop": inShop,
  "pop-dealer-kit": popDealerKit,
  "dealer-certificate": dealerCertificate,
};

/** All registered keys, frozen — useful for iterating activities (e.g. building selects). */
export const ACTIVITY_KEYS: readonly ActivityKey[] = Object.keys(
  ACTIVITIES,
) as ActivityKey[];

/**
 * Typed resolver. Returns `undefined` (NOT throw) for unknown keys so callers can treat
 * resolution as an Option type — Phase-2 import surfaces "unknown activity" as a row error.
 */
export function getActivity(key: string): ActivityConfig | undefined {
  return (ACTIVITIES as Record<string, ActivityConfig>)[key];
}
