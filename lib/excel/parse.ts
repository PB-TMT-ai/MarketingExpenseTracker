// SECURITY: per D2-06, .xlsx parsing runs CLIENT-SIDE only. The server never
// receives an .xlsx file — only Zod-validated JSON rows. See CONTEXT.md D2-06
// and CVE-2023-30533 (prototype pollution on .xlsx read) for the rationale.
//
// If you find yourself adding a Route Handler or Server Action that calls
// readWorkbook() on a request body — STOP. That re-introduces the entire
// attack surface this layer was designed to keep out of the server runtime.

import * as XLSX from "xlsx";
import type { FieldDef } from "../activities/types";

/**
 * Parse an .xlsx ArrayBuffer into array-of-arrays (header row at index 0).
 *
 * Options (RESEARCH §1 verbatim):
 *   - `type:"array"`     → input shape matches `File.arrayBuffer()` from the browser
 *   - `cellDates:true`   → Excel date serials (e.g. 45810) come back as JS Date objects,
 *                          NOT 5-digit numbers we'd have to decode per-cell
 *   - `header:1`         → array-of-arrays mode; we validate the header row separately
 *                          BEFORE mapping cells through coerceCell
 *   - `raw:false`        → numeric cells come back as their formatted string (so a
 *                          10-digit SFID typed numerically arrives as "1234567890",
 *                          NOT 1.23456789e9). Defensive — coerceCell guards anyway.
 *   - `defval:""`        → null/undefined cells become "" so column positions stay
 *                          aligned in array-of-arrays mode
 *   - `blankrows:false`  → skip empty rows (the canonical input has no blanks)
 *
 * Throws when the workbook has no sheets (a malformed file the user must re-export).
 */
export function readWorkbook(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  return _extractFirstSheetRows(wb);
}

/**
 * Internal — exported for unit testing the zero-sheet defensive guard.
 *
 * SheetJS's own `read()` leniently returns a default "Sheet1" for almost any
 * input (even an 8-byte ArrayBuffer), so the "Workbook has no sheets" branch
 * in `readWorkbook` is unreachable via real input. We expose this internal so
 * the guard can be exercised against a hand-built `{ SheetNames: [], Sheets: {} }`
 * — protecting future contributors from regressing the guard during a refactor.
 *
 * Underscore prefix marks it as not part of the public surface; consumers MUST
 * use `readWorkbook`.
 */
export function _extractFirstSheetRows(
  wb: Pick<XLSX.WorkBook, "SheetNames" | "Sheets">,
): unknown[][] {
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Workbook has no sheets");
  }
  const firstSheet = wb.Sheets[firstSheetName];
  if (!firstSheet) {
    throw new Error("Workbook has no sheets");
  }
  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
}

/**
 * Coerce a single cell value into the typed shape declared by its FieldDef.
 *
 * Tagged-union return: `{ ok: true, value }` on success (value is null for
 * blank/empty cells regardless of kind — the CALLER decides if "required" means
 * a blank should escalate to fieldError). `{ ok: false, error }` on coercion
 * failure (bad date, non-numeric currency, enum out of range).
 *
 * The three hostile cell types from PITFALLS.md §6:
 *   1. SFID-as-number  → text/status/enum/lat/long use `String(Math.trunc(n))`
 *                        when raw is numeric — no scientific-notation loss
 *   2. ₹ + comma money → number/currency strip /[₹$,\s]/g before Number()
 *   3. DD/MM date      → date kind accepts a JS Date (formatted UTC) AND a
 *                        DD/MM/YY or DD/MM/YYYY string; ISO (YYYY-MM-DD) is
 *                        REJECTED because the canonical Indian input shape is
 *                        DD/MM, and silently accepting ISO masks vendor format
 *                        drift we want to surface as a row error.
 */
export function coerceCell(
  raw: unknown,
  field: FieldDef,
):
  | { ok: true; value: string | number | null }
  | { ok: false; error: string } {
  // Blank / empty → null. Caller checks FieldDef.required to decide whether
  // null escalates to a fieldError.
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }

  switch (field.kind) {
    case "text":
    case "status":
    case "enum":
    case "lat":
    case "long": {
      // ID-shaped fields MUST stay text. With raw:false on sheet_to_json a
      // numeric SFID already arrives as a formatted string, but guard anyway
      // in case a caller bypasses sheet_to_json. Integer-truncate to avoid
      // String(1234567890) producing "1.23456789e9" in any future engine.
      const s =
        typeof raw === "number" ? String(raw) : String(raw).trim();
      if (
        field.kind === "enum" &&
        field.enumValues &&
        !field.enumValues.includes(s)
      ) {
        return {
          ok: false,
          error: `Expected one of ${field.enumValues.join(", ")}, got "${s}"`,
        };
      }
      return { ok: true, value: s };
    }
    case "number":
    case "currency": {
      // Strip ₹ / $ / commas / whitespace. SheetJS raw:false may include the
      // format glyph for currency cells (e.g. "₹1,250.00") or thousands
      // separators on plain numbers.
      const asString = typeof raw === "number" ? String(raw) : String(raw);
      const cleaned = asString.replace(/[₹$,\s]/g, "");
      if (cleaned === "") return { ok: true, value: null };
      const n = Number(cleaned);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `Not a number: "${raw}"` };
      }
      return { ok: true, value: n };
    }
    case "date": {
      // With cellDates:true a real Excel date arrives as a JS Date object.
      // Text-typed cells (DD/MM/YY or DD/MM/YYYY) arrive as strings — parse
      // explicitly. NEVER accept ISO YYYY-MM-DD here; the canonical input is
      // DD/MM and silent ISO acceptance hides vendor template drift.
      if (raw instanceof Date) {
        // Use getUTC* to avoid the local-TZ off-by-one-day bug on a UTC
        // Vercel runtime. SheetJS returns UTC-correct Date objects.
        const y = raw.getUTCFullYear();
        const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
        const d = String(raw.getUTCDate()).padStart(2, "0");
        return { ok: true, value: `${y}-${m}-${d}` };
      }
      const s = String(raw).trim();
      const matched = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/.exec(s);
      if (!matched) {
        return {
          ok: false,
          error: `Date must be DD/MM/YY or DD/MM/YYYY: "${raw}"`,
        };
      }
      const dd = matched[1].padStart(2, "0");
      const mm = matched[2].padStart(2, "0");
      const yy = matched[3].length === 2 ? `20${matched[3]}` : matched[3];
      return { ok: true, value: `${yy}-${mm}-${dd}` };
    }
  }
}
