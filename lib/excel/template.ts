/**
 * Pure SheetJS write surface — `buildPlanTemplate(activityKey)` emits a
 * headers-only .xlsx ArrayBuffer (D2-05). Callers (the UI in Plan 02-03)
 * wrap the buffer in `new Blob([buf], { type: <xlsx mime> })` and trigger
 * a download via `URL.createObjectURL` + `<a download>`.
 *
 * Framework-free: only imports `xlsx` and the typed activity registry.
 * Runs unchanged in browser and vitest.
 */

import * as XLSX from "xlsx";
import { getActivity } from "../activities/registry";
import type { ActivityKey } from "../activities/types";

/**
 * Build a headers-only .xlsx whose row 0 equals `getActivity(key).planColumns`
 * mapped to `.label`, in order. The sheet is named "Plan" (D2-05 convention,
 * fixed; the UI never relies on the sheet name).
 *
 * Throws when the registry has no entry for `activityKey`. The registry's
 * `getActivity` returns `undefined` for unknown keys (it does not throw),
 * so we own the throw here.
 */
export function buildPlanTemplate(activityKey: ActivityKey): ArrayBuffer {
  const activity = getActivity(activityKey);
  if (!activity) {
    throw new Error(`Unknown activity: ${activityKey}`);
  }
  const headers = activity.planColumns.map((c) => c.label);
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Plan");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/**
 * D2-05 file-name convention: `marketing-plan-template-{activity-key}.xlsx`.
 * Period-agnostic by design (the template is the canonical empty-shape).
 */
export function TEMPLATE_FILE_NAME(activityKey: ActivityKey): string {
  return `marketing-plan-template-${activityKey}.xlsx`;
}
