"use client";

import { useActionState, useEffect, useRef } from "react";
import { addItem, type AddItemState } from "@/lib/actions/items";

export default function ItemForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<AddItemState, FormData>(
    addItem,
    {},
  );

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:grid-cols-2"
    >
      <h2 className="text-base font-semibold sm:col-span-2">Add an item</h2>

      <label className="text-sm sm:col-span-1">
        Name
        <input
          name="name"
          required
          placeholder="e.g. Wall stickers"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
        />
      </label>

      <label className="text-sm sm:col-span-1">
        Category <span className="text-neutral-400">(optional)</span>
        <input
          name="category"
          placeholder="e.g. POP / Dealer Kit"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center rounded-md bg-neutral-900 px-5 text-sm font-medium text-white transition-opacity hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add item"}
        </button>
      </div>
    </form>
  );
}
