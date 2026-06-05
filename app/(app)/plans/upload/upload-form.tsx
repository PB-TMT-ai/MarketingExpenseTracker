"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  commitPlanUploadForm,
  type CommitPlanState,
} from "@/lib/actions/plans";
import { ACTIVITIES } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";
import { coerceCell, readWorkbook } from "@/lib/excel/parse";
import { buildPreview, validateHeaders } from "@/lib/excel/validate";
import type { PreviewRow } from "@/lib/excel/types";
import PreviewTable from "./preview-table";
import TemplateButton from "./template-button";

/**
 * UploadForm — client-side parse → preview → commit (D2-06).
 *
 * Flow:
 *  1. User picks activity + period (period defaults to active period per D-11 +
 *     CONTEXT line 46; querystring overrides via the parent Server Component).
 *  2. User picks a file. We cap at 10 MB BEFORE arrayBuffer() to bound memory
 *     (RESEARCH §6). We parse + validate headers + build the preview entirely
 *     in the browser — the server NEVER sees an .xlsx (D2-06 / CVE-2023-30533).
 *  3. Preview renders with per-classification counts. The user clicks "Commit
 *     upload"; we serialize the valid+update rows into a hidden JSON field and
 *     let useActionState drive the POST through commitPlanUploadForm.
 *  4. On success we surface insert/update/delete counts; on FK-restrict we
 *     render the blocked-dealers list (COMP-02 transient UI per D2-02).
 *
 * Activity change clears the preview because the per-activity schema changed —
 * a stale preview against the wrong schema would be misleading.
 *
 * `xlsx` is imported ONLY through lib/excel/parse + lib/excel/template (which are
 * the only files allowed to couple to SheetJS). The acceptance gate enforces that
 * `lib/db/**` and `lib/actions/**` contain ZERO `from "xlsx"` references.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cap — RESEARCH §6

export type UploadFormProps = {
  periods: readonly { id: number; label: string; isActive: boolean }[];
  defaultActivity: ActivityKey;
  defaultPeriodId: number | null;
};

export default function UploadForm({
  periods,
  defaultActivity,
  defaultPeriodId,
}: UploadFormProps) {
  const [activity, setActivity] = useState<ActivityKey>(defaultActivity);
  const [periodId, setPeriodId] = useState<number>(
    defaultPeriodId ?? (periods[0]?.id ?? 0),
  );
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [state, formAction, pending] = useActionState<CommitPlanState, FormData>(
    commitPlanUploadForm,
    { ok: false, error: "" } as CommitPlanState,
  );

  // Rows we will actually post: every preview row that is valid or update
  // (errors + duplicates are excluded). `parsed` is non-null for both classes.
  const toCommit = useMemo(() => {
    if (!preview) return [];
    return preview
      .filter(
        (p) =>
          (p.classification === "valid" || p.classification === "update") &&
          p.parsed !== null,
      )
      .map((p) => p.parsed!);
  }, [preview]);

  // When the commit succeeds, blow away the in-browser preview so the user sees
  // the success block and can't double-submit the same rows by accident.
  useEffect(() => {
    if (state.ok) {
      setPreview(null);
      setParseError(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [state]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setPreview(null);

    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setParseError(
        `File larger than 10 MB (${(file.size / 1024 / 1024).toFixed(2)} MB) — split into smaller plans`,
      );
      return;
    }

    try {
      const buf = await file.arrayBuffer(); // native Promise API (RESEARCH §6)
      const rows = readWorkbook(buf);
      const headerErr = validateHeaders(
        (rows[0] as unknown[]) ?? [],
        ACTIVITIES[activity].planColumns,
      );
      if (headerErr) {
        setParseError(
          `Header mismatch (${headerErr.kind}): ${headerErr.details ?? "see template"}`,
        );
        return;
      }
      const next = buildPreview(rows, ACTIVITIES[activity].planColumns, coerceCell);
      setPreview(next);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse file");
    }
  }

  function onActivityChange(value: string) {
    // Per-activity schema changed → a preview built against the old schema is stale.
    setActivity(value as ActivityKey);
    setPreview(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const blockedDealers =
    !state.ok && state.blockedDealers ? state.blockedDealers : null;

  return (
    <form
      action={formAction}
      className="grid gap-4"
      data-slot="upload-form"
    >
      {/* Hidden inputs are the SOURCE OF TRUTH for the Server Action (FormData payload).
          The visible selectors below mirror them via controlled React state so the user
          sees what will be posted. */}
      <input type="hidden" name="periodId" value={String(periodId)} />
      <input type="hidden" name="activity" value={activity} />
      <input type="hidden" name="rows" value={JSON.stringify(toCommit)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Activity
          <select
            value={activity}
            onChange={(e) => onActivityChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
            data-slot="activity-select"
          >
            {Object.values(ACTIVITIES).map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Period
          <select
            value={String(periodId)}
            onChange={(e) => setPeriodId(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
            data-slot="period-select"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <TemplateButton activity={activity} />
        <span className="text-xs text-neutral-500">
          marketing-plan-template-{activity}.xlsx
        </span>
      </div>

      <label className="text-sm">
        Filled .xlsx (max 10 MB)
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFile}
          className="mt-1 block w-full text-sm"
          data-slot="file-input"
        />
      </label>

      {parseError ? (
        <p role="alert" data-slot="parse-error" className="text-sm text-red-600">
          {parseError}
        </p>
      ) : null}

      {preview ? <PreviewTable preview={preview} /> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || preview === null || toCommit.length === 0}
          data-slot="commit-button"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
        >
          {pending
            ? "Committing…"
            : preview === null
              ? "Upload a file first"
              : toCommit.length === 0
                ? "No valid rows to commit"
                : `Commit upload (${toCommit.length} rows)`}
        </button>
      </div>

      {state.ok ? (
        <div
          data-slot="commit-success"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          Committed: <span className="font-semibold">{state.inserted}</span>{" "}
          inserted ·{" "}
          <span className="font-semibold">{state.updated}</span> updated ·{" "}
          <span className="font-semibold">{state.deleted}</span> deleted.{" "}
          <a href="/plans" className="ml-2 underline">
            Back to /plans
          </a>
        </div>
      ) : null}

      {!state.ok && blockedDealers && blockedDealers.length > 0 ? (
        <div
          data-slot="blocked-dealers"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Cannot commit — these dealers were removed but already have recorded
            actuals:
          </p>
          <ul className="mt-2 list-disc pl-6">
            {blockedDealers.map((b) => (
              <li key={b.sfid} data-slot="blocked-dealer-row" data-sfid={b.sfid}>
                <span className="font-mono">{b.sfid}</span> · {b.executionCount}{" "}
                execution{b.executionCount === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Fix the source Excel to include this SFID, or retire its actuals,
            then retry.
          </p>
        </div>
      ) : null}

      {!state.ok && state.error && !blockedDealers ? (
        <p role="alert" data-slot="commit-error" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
