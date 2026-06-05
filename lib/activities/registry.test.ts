import { describe, it, expect } from "vitest";
import { ACTIVITIES, ACTIVITY_KEYS, getActivity } from "./index";
import type { ActivityConfig, ActivityKey } from "./index";

const SIX_KEYS: readonly ActivityKey[] = [
  "counter-wall",
  "gsb",
  "nlb",
  "in-shop",
  "pop-dealer-kit",
  "dealer-certificate",
];

describe("activity registry", () => {
  it("registers exactly six activities", () => {
    expect(ACTIVITY_KEYS).toHaveLength(6);
    expect(new Set(ACTIVITY_KEYS)).toEqual(new Set(SIX_KEYS));
  });

  it("resolves every known key via getActivity", () => {
    for (const k of SIX_KEYS) {
      const cfg = getActivity(k);
      expect(cfg, `getActivity("${k}")`).toBeDefined();
      expect(cfg?.key).toBe(k);
      expect(typeof cfg?.label).toBe("string");
      expect(cfg?.label.length).toBeGreaterThan(0);
    }
  });

  it("typings: each config exposes the contract", () => {
    for (const k of SIX_KEYS) {
      const cfg = ACTIVITIES[k] as ActivityConfig;
      expect(["measurement", "item-list", "status"]).toContain(cfg.type);
      expect(Array.isArray(cfg.planColumns)).toBe(true);
      expect(Array.isArray(cfg.actualColumns)).toBe(true);
    }
  });

  it("counter-wall is a measurement activity (sanity)", () => {
    expect(getActivity("counter-wall")?.type).toBe("measurement");
  });

  it("pop-dealer-kit is an item-list activity", () => {
    expect(getActivity("pop-dealer-kit")?.type).toBe("item-list");
  });

  it("dealer-certificate is a status activity", () => {
    expect(getActivity("dealer-certificate")?.type).toBe("status");
  });

  it("getActivity returns undefined on unknown keys (does not throw)", () => {
    expect(getActivity("not-a-real-activity")).toBeUndefined();
    expect(getActivity("")).toBeUndefined();
  });

  it("shared who/where columns are flagged shared:true on every activity", () => {
    const sharedKeys = new Set(["sfid"]); // sfid is shared in every plan sheet
    for (const k of SIX_KEYS) {
      const cfg = ACTIVITIES[k];
      const sfid = cfg.planColumns.find((c) => c.key === "sfid");
      expect(sfid, `${k} plan must include sfid`).toBeDefined();
      expect(sfid?.shared, `${k}.sfid must be shared:true`).toBe(true);
      // Other who/where columns when present must also be shared
      for (const col of cfg.planColumns) {
        if (sharedKeys.has(col.key)) {
          expect(col.shared, `${k}.${col.key} must be shared:true`).toBe(true);
        }
      }
    }
  });
});
