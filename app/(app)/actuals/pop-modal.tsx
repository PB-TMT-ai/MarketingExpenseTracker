"use client";

/**
 * PopModal — POP / Dealer-Kit multi-item entry (D3-13 / D3-14, GRID-06).
 *
 * A plain Tailwind overlay (no shadcn) opened for ONE kit row. The user adds N line
 * items — each an ACTIVE item-master pick (name SNAPSHOT at entry, D-08), a Qty, and a
 * Rate; Line Total = Qty × Rate auto-fills via the shared calc engine. The subtotal rolls
 * up to the kit row's total. On confirm the lines are written back to the row and the
 * existing Save bar flushes them through saveExecutionsBatch → savePopKit (one execution
 * + N execution_items, atomic, replace-all). The modal NEVER saves directly.
 */

import { useMemo, useState } from "react";
import { computeDerived } from "@/lib/actuals/calc";
import type { PopLineInput } from "@/lib/actuals/rows";

export type PopModalProps = {
  /** Read-only plan context for the header (dealer, sfid, …) */
  planContext: Record<string, unknown>;
  /** Existing lines (from a loaded kit) or [] for a new kit */
  initialLines: PopLineInput[];
  /** ACTIVE item master for the picker */
  items: Array<{ id: number; name: string; category: string | null }>;
  onConfirm: (lines: PopLineInput[]) => void;
  onClose: () => void;
};

type DraftLine = { itemName: string; qty: string; rate: string };

function toDraft(l: PopLineInput): DraftLine {
  return { itemName: l.itemName, qty: String(l.qty), rate: String(l.rate) };
}

function lineTotalOf(d: DraftLine): number {
  return (
    computeDerived("pop-dealer-kit", "lineTotal", {
      qty: d.qty,
      rate: d.rate,
    }) ?? 0
  );
}

export default function PopModal({
  planContext,
  initialLines,
  items,
  onConfirm,
  onClose,
}: PopModalProps) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialLines.length > 0 ? initialLines.map(toDraft) : [{ itemName: "", qty: "", rate: "" }],
  );

  // Item options: ACTIVE master names, plus any snapshot name already on a line that is
  // no longer active (so re-editing a kit whose item was retired still shows it).
  const itemNames = useMemo(() => {
    const set = new Set(items.map((i) => i.name));
    for (const l of lines) if (l.itemName) set.add(l.itemName);
    return Array.from(set).sort();
  }, [items, lines]);

  const subtotal = useMemo(
    () => Math.round(lines.reduce((s, d) => s + lineTotalOf(d), 0) * 100) / 100,
    [lines],
  );

  // P1-5: count valid lines (item picked, qty > 0). Mirrors handleConfirm's
  // filter so the Done button's disabled state matches what will actually save.
  const validCount = useMemo(
    () =>
      lines.filter(
        (d) => d.itemName.trim() !== "" && Number(d.qty) > 0,
      ).length,
    [lines],
  );

  // A NEW kit (no initialLines) with zero valid lines is meaningless — block
  // Done. An EXISTING kit can be emptied deliberately (replace-all semantics
  // on the server handle the line delete), so we don't block that path.
  const isNewEmptyKit = initialLines.length === 0 && validCount === 0;

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { itemName: "", qty: "", rate: "" }]);
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleConfirm() {
    // Keep only valid lines: a chosen item with a positive qty.
    const valid: PopLineInput[] = lines
      .filter((d) => d.itemName.trim() !== "" && Number(d.qty) > 0)
      .map((d) => ({
        itemName: d.itemName,
        qty: Number(d.qty),
        rate: Number(d.rate) || 0,
        lineTotal: lineTotalOf(d),
      }));
    onConfirm(valid);
  }

  const dealer = (planContext.dealer ?? planContext.dealerOrArea ?? "") as string;
  const sfid = (planContext.sfid ?? "") as string;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-slot="pop-modal"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-neutral-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 p-4">
          <div>
            <h2 className="text-base font-semibold">POP / Dealer-Kit items</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {dealer ? `${dealer} · ` : ""}
              <span className="font-mono">{sfid}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-[1fr_5rem_6rem_6rem_2rem] items-center gap-2 pb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            <span>Item</span>
            <span>Qty</span>
            <span>Rate (₹)</span>
            <span>Total (₹)</span>
            <span />
          </div>

          {lines.map((d, i) => (
            <div
              key={i}
              data-slot="pop-line"
              className="grid grid-cols-[1fr_5rem_6rem_6rem_2rem] items-center gap-2 py-1"
            >
              <select
                data-slot="pop-line-item"
                value={d.itemName}
                onChange={(e) => updateLine(i, { itemName: e.target.value })}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="">— pick item —</option>
                {itemNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <input
                data-slot="pop-line-qty"
                type="number"
                min="0"
                value={d.qty}
                onChange={(e) => updateLine(i, { qty: e.target.value })}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <input
                data-slot="pop-line-rate"
                type="number"
                min="0"
                value={d.rate}
                onChange={(e) => updateLine(i, { rate: e.target.value })}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <span
                data-slot="pop-line-total"
                className="text-right text-sm tabular-nums"
              >
                {lineTotalOf(d).toFixed(2)}
              </span>
              <button
                onClick={() => removeLine(i)}
                className="text-neutral-400 hover:text-red-600"
                aria-label="Remove line"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            data-slot="pop-add-line"
            onClick={addLine}
            className="mt-2 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
          >
            + add line
          </button>

          <div className="mt-4 flex items-center justify-between border-t border-neutral-200 pt-3">
            <span className="text-sm text-neutral-600">Kit subtotal</span>
            <span data-slot="pop-subtotal" className="text-base font-semibold tabular-nums">
              ₹{subtotal.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 p-4">
          <button
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            data-slot="pop-confirm"
            onClick={handleConfirm}
            disabled={isNewEmptyKit}
            title={
              isNewEmptyKit
                ? "Add at least one item with a quantity before saving the kit"
                : undefined
            }
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
