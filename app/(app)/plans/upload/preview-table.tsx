"use client";

import type {
  Classification,
  PreviewRow,
} from "@/lib/excel/types";

/**
 * Presentation-only preview table — receives PreviewRow[] from the upload form's
 * client-side parse pipeline (D2-06). Renders rows grouped by classification in
 * priority order (errors first so the user's eye lands on what to fix), with per-class
 * count pills at the top. No virtualisation in v1 (CONTEXT line 45 — raw HTML).
 *
 * Classification order (CONTEXT line 118): fieldError → duplicate → update → valid.
 * The "blocking" state lives in the Server Action (depends on DB state), so it
 * never appears in this client-only component.
 */

const ORDER: readonly Classification[] = [
  "fieldError",
  "duplicate",
  "update",
  "valid",
];

const LABELS: Readonly<Record<Classification, string>> = {
  fieldError: "Field errors",
  duplicate: "Duplicates (in this file)",
  update: "Updates (existing SFID)",
  valid: "Valid (new rows)",
};

const COLORS: Readonly<Record<Classification, string>> = {
  fieldError: "bg-red-100 text-red-800",
  duplicate: "bg-amber-100 text-amber-800",
  update: "bg-blue-100 text-blue-800",
  valid: "bg-emerald-100 text-emerald-800",
};

export default function PreviewTable({
  preview,
}: {
  preview: readonly PreviewRow[];
}) {
  // Compute per-classification counts once for the pills at the top.
  const counts: Record<Classification, number> = {
    fieldError: 0,
    duplicate: 0,
    update: 0,
    valid: 0,
  };
  for (const p of preview) {
    counts[p.classification] += 1;
  }

  // Build groups in priority order; skip empty classes.
  const groups: { cls: Classification; rows: PreviewRow[] }[] = [];
  for (const cls of ORDER) {
    const rows = preview.filter((p) => p.classification === cls);
    if (rows.length > 0) groups.push({ cls, rows });
  }

  return (
    <section
      data-slot="preview-table"
      className="rounded-lg border border-neutral-200 bg-white"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 text-xs">
        <span className="font-semibold text-neutral-700">Preview</span>
        {ORDER.map((cls) => (
          <span
            key={cls}
            data-slot="preview-count"
            data-classification={cls}
            className={`rounded-full px-2 py-0.5 font-medium ${COLORS[cls]}`}
          >
            {LABELS[cls]}: {counts[cls]}
          </span>
        ))}
      </header>

      {groups.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">No data rows in the file.</p>
      ) : (
        groups.map(({ cls, rows }) => (
          <div key={cls} className="border-b border-neutral-100 last:border-b-0">
            <h4 className="bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              {LABELS[cls]} ({rows.length})
            </h4>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="w-16 px-3 py-1.5 font-medium">Row</th>
                  <th className="w-40 px-3 py-1.5 font-medium">SFID</th>
                  <th className="w-32 px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    data-slot="preview-row"
                    data-classification={row.classification}
                    data-sfid={row.sfid ?? ""}
                    className="border-t border-neutral-100"
                  >
                    <td className="px-3 py-1.5 font-mono">{row.rowNumber}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {row.sfid ?? <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${COLORS[row.classification]}`}
                      >
                        {row.classification}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-neutral-700">
                      {row.classification === "fieldError" &&
                      row.errors.length > 0 ? (
                        <ul className="space-y-0.5">
                          {row.errors.map((e, i) => (
                            <li key={i}>
                              <span className="font-semibold">{e.col}:</span>{" "}
                              {e.reason}
                            </li>
                          ))}
                        </ul>
                      ) : row.classification === "duplicate" ? (
                        <span className="text-neutral-500">
                          SFID appears more than once in this file
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}
