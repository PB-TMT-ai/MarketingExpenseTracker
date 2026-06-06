import Link from "next/link";
import { listPeriods, type PeriodRow } from "@/lib/db/periods";
import { setActivePeriodForm } from "@/lib/actions/periods";
import { getActivePeriod } from "@/lib/periods/active";
import PeriodSwitcherSelect from "./period-switcher-select";

/**
 * Mounted in the (app) layout's reserved `data-slot="period-switcher"` slot.
 * Server Component — fetches periods + the active one. The interactive `<select>` lives
 * in a tiny Client child so its onChange auto-submits the form (a Server Component
 * cannot carry event handlers). The slot's data-slot attribute is preserved.
 */
export default async function PeriodSwitcher() {
  const [active, all]: [PeriodRow | null, PeriodRow[]] = await Promise.all([
    getActivePeriod(),
    listPeriods(),
  ]);

  if (all.length === 0) {
    return (
      <span data-slot="period-switcher" className="text-xs text-neutral-400">
        No periods —{" "}
        <Link href="/periods" className="underline">
          create one
        </Link>
      </span>
    );
  }

  return (
    <form data-slot="period-switcher" action={setActivePeriodForm}>
      <PeriodSwitcherSelect periods={all} activeId={active?.id ?? null} />
    </form>
  );
}
