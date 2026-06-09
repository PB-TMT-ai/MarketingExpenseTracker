"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * MultiSelectPopover — a single facet's filter as a popover dropdown.
 *
 * Replaces the always-expanded `<select multiple size={5}>` listboxes that previously
 * occupied vertical space on the actuals and dashboard filter bars. Behaviour matches:
 * selection toggles fire `onChange` instantly (no Apply button), parent owns the cascade
 * (this component is dumb).
 *
 * Hand-rolled, no shadcn / @radix-ui / cmdk dependency — keeps the deps lean to match
 * the rest of the codebase.
 */
export default function MultiSelectPopover({
  label,
  options,
  selected,
  onChange,
  testIdSuffix,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** e.g. "region" — used to build a stable data-slot for e2e selectors. */
  testIdSuffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Outside-click closes the popover. Tracked here (not in a portal) because we render
  // inline — the surrounding flex layout positions the trigger; the panel is absolute.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? options : options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const isEmpty = options.length === 0;
  const count = selected.length;

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col gap-1"
      data-slot={testIdSuffix ? `filter-${testIdSuffix}` : undefined}
    >
      <button
        type="button"
        disabled={isEmpty}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-10 min-w-[140px] items-center justify-between gap-2 rounded-md border px-3 text-sm ${
          isEmpty
            ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
            : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{label}</span>
          {isEmpty ? (
            <span className="text-neutral-400">—</span>
          ) : count > 0 ? (
            <span className="rounded-full bg-neutral-900 px-1.5 text-[10px] font-semibold text-white">
              ({count})
            </span>
          ) : null}
        </span>
        <span aria-hidden className="text-neutral-400">▾</span>
      </button>

      {open && !isEmpty && (
        <div
          role="listbox"
          className="absolute top-full z-20 mt-1 w-[260px] rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          <div className="border-b border-neutral-100 p-2">
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-200 px-2 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-neutral-500">No matches.</p>
            ) : (
              visible.map((opt) => {
                const isChecked = selected.includes(opt);
                return (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(opt)}
                      aria-label={opt}
                    />
                    <span>{opt}</span>
                  </label>
                );
              })
            )}
          </div>
          <div className="flex justify-between border-t border-neutral-100 p-2 text-xs">
            <button
              type="button"
              onClick={() => onChange(options.slice())}
              className="text-neutral-700 hover:text-neutral-900"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-neutral-700 hover:text-neutral-900"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
