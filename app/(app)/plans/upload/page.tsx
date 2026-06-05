import { listPeriods } from "@/lib/db/periods";
import { getActivePeriod } from "@/lib/periods/active";
import { ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";
import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

/**
 * /plans/upload — Server Component shell hosting the client UploadForm.
 *
 * Reads `listPeriods()` and `getActivePeriod()` so the form can default the period
 * selector to the active period (D-11 + CONTEXT line 46 discretion item). Also reads
 * the ?activity and ?periodId querystring so the /plans grid cells can deep-link
 * straight to a pre-selected (activity, period) cell.
 *
 * The page itself does NO DB write — mutation lives in the form's Server Action
 * (`commitPlanUploadForm` from Plan 02-02). The 10 MB cap and all .xlsx parsing
 * happen in the Client Component; this shell only hands props down.
 */
export default async function UploadPlanPage({
  searchParams,
}: {
  // Next 16 typed-search-params: it's a Promise of a record of string|string[].
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [periods, activePeriod, params] = await Promise.all([
    listPeriods(),
    getActivePeriod(),
    searchParams,
  ]);

  // Validate ?activity against the registry; ignore anything we don't know.
  const rawActivity = typeof params.activity === "string" ? params.activity : null;
  const defaultActivity: ActivityKey =
    rawActivity && (ACTIVITY_KEYS as readonly string[]).includes(rawActivity)
      ? (rawActivity as ActivityKey)
      : ((ACTIVITY_KEYS[0] ?? "counter-wall") as ActivityKey);

  // Validate ?periodId — must parse to a positive int AND match a real period id.
  const rawPeriodId = typeof params.periodId === "string" ? Number(params.periodId) : NaN;
  const periodIdFromQs = Number.isInteger(rawPeriodId) && rawPeriodId > 0 ? rawPeriodId : null;
  const validQsPeriod =
    periodIdFromQs !== null && periods.some((p) => Number(p.id) === periodIdFromQs)
      ? periodIdFromQs
      : null;
  const defaultPeriodId =
    validQsPeriod ?? (activePeriod ? Number(activePeriod.id) : periods[0]?.id ?? null);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header>
        <h1 className="text-xl font-semibold">Upload a plan</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Pick an activity and a period, download the template if you need it, then
          upload the filled .xlsx. The file is parsed in your browser — only the
          validated rows reach the server. Re-uploads are non-destructive: existing
          actuals stay attached to their dealers.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <h2 className="border-b border-neutral-200 p-4 text-base font-semibold">
          Plan upload
        </h2>
        <div className="p-4">
          {periods.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No periods yet — create one in /periods before uploading a plan.
            </p>
          ) : (
            <UploadForm
              periods={periods.map((p) => ({
                id: Number(p.id),
                label: p.label,
                isActive: p.isActive,
              }))}
              defaultActivity={defaultActivity}
              defaultPeriodId={defaultPeriodId}
            />
          )}
        </div>
      </section>
    </div>
  );
}
