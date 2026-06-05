"use client";

import {
  buildPlanTemplate,
  TEMPLATE_FILE_NAME,
} from "@/lib/excel/template";
import type { ActivityKey } from "@/lib/activities/types";

/**
 * Browser-side template download (RESEARCH §2 + §7 — no Route Handler needed).
 *
 * The `xlsx` library is already pulled in by the upload form on this same route, so
 * making the template path also use SheetJS adds zero kilobytes to the bundle. We
 * reuse Plan 02-01's `buildPlanTemplate` so the SheetJS coupling stays inside
 * lib/excel/* (D2-06 invariant: this file imports buildPlanTemplate, NOT xlsx).
 *
 * Click handler runs purely post-hydration: `URL.createObjectURL` + `<a download>` is
 * the canonical SheetJS pattern from the docs.
 */
export default function TemplateButton({
  activity,
}: {
  activity: ActivityKey;
}) {
  function onDownload() {
    const out = buildPlanTemplate(activity);
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = TEMPLATE_FILE_NAME(activity);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={onDownload}
      data-slot="template-button"
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
    >
      Download template
    </button>
  );
}
