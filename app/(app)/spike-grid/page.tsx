import SpikeGrid from "./spike-grid";

// Route segment config (Next.js) — forces dynamic render; unrelated to next/dynamic.
export const dynamic = "force-dynamic";

/**
 * THROWAWAY spike route (D3-00). Proves AG Grid Community 35.3.1 works inside
 * Next 16 App Router + React 19 before the real Phase-3 build. Lives under the
 * (app) group so it inherits the shared-password gate. Not linked from the nav;
 * reachable only by direct URL /spike-grid. Delete after the GO/NO-GO.
 */
export default function SpikeGridPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <header>
        <h1 className="text-xl font-semibold">AG Grid Spike (throwaway)</h1>
        <p className="mt-1 text-sm text-neutral-600">
          D3-00 de-risk: ~800 rows, inline number edit, a Status select editor, a
          valueGetter-derived column, an external Region filter, and an SFID
          quick-filter. Not production code.
        </p>
      </header>
      <SpikeGrid />
    </div>
  );
}
