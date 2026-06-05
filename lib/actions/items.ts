"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import { insertItem, setItemActive } from "../db/items";

/**
 * Item-master Server Actions — defense-in-depth re-checks the jose cookie on every call.
 * D-09 contract: retire = `active = false` toggle ONLY. No hard delete API exists here.
 */

async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    throw new Error("Unauthorized");
  }
}

const addItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // Coerce blank strings to undefined so the column stays NULL instead of "".
  category: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type AddItemState = { ok?: true; id?: number; error?: string };

export async function addItem(
  _prev: unknown,
  formData: FormData,
): Promise<AddItemState> {
  await requireSession();
  const parsed = addItemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const id = await insertItem({
    name: parsed.data.name,
    category: parsed.data.category ?? null,
  });
  revalidatePath("/items");
  return { ok: true, id };
}

const toggleSchema = z.object({
  id: z.coerce.number().int().positive(),
  active: z.union([z.literal("true"), z.literal("false")]).transform((v) => v === "true"),
});

export type ToggleItemState = { ok?: true; error?: string };

export async function toggleItemActive(
  _prev: unknown,
  formData: FormData,
): Promise<ToggleItemState> {
  await requireSession();
  const parsed = toggleSchema.safeParse({
    id: formData.get("id"),
    active: formData.get("active"),
  });
  if (!parsed.success) {
    return { error: "Invalid input" };
  }
  await setItemActive(parsed.data.id, parsed.data.active);
  revalidatePath("/items");
  return { ok: true };
}

/** `<form action={fn}>` adapter — see periods.ts for the same pattern. */
export async function toggleItemActiveForm(formData: FormData): Promise<void> {
  await toggleItemActive({}, formData);
}
