import { listItems } from "@/lib/db/items";
import { toggleItemActiveForm } from "@/lib/actions/items";
import ItemForm from "./item-form";

export const dynamic = "force-dynamic";

/**
 * Item-master management — protected by the (app) group gate + the layout's per-render
 * re-verification. Server Component: lists items (active first via the form button label),
 * lets the user add one (Client form) and retire/restore via per-row Server-Action forms.
 * Retired items are visually muted so the picklist is obvious.
 */
export default async function ItemsPage() {
  const rows = await listItems();

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Item master</h1>
        <p className="mt-2 text-sm text-neutral-600">
          The selectable list used for POP / dealer-kit line items. Retiring an item
          hides it from the picker without removing past entries — the row stays in
          the database so existing executions are unaffected.
        </p>
      </header>

      <ItemForm />

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <h2 className="border-b border-neutral-200 p-4 text-base font-semibold">
          Items
        </h2>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No items yet — add one above.</p>
        ) : (
          <ul data-slot="item-list" className="divide-y divide-neutral-200">
            {rows.map((it) => (
              <li
                key={it.id}
                data-active={it.active ? "true" : "false"}
                className={`flex items-center justify-between gap-4 p-4 text-sm ${
                  it.active ? "" : "bg-neutral-50 text-neutral-400"
                }`}
              >
                <div>
                  <div className="font-medium">
                    {it.name}{" "}
                    {it.active ? null : (
                      <span
                        data-slot="retired-badge"
                        className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600"
                      >
                        retired
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {it.category ?? "uncategorized"}
                  </div>
                </div>
                <form action={toggleItemActiveForm}>
                  <input type="hidden" name="id" value={it.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={it.active ? "false" : "true"}
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                  >
                    {it.active ? "Retire" : "Restore"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
