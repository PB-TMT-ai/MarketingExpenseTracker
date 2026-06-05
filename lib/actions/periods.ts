"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import { insertPeriod, setActiveTx } from "../db/periods";

/**
 * Period Server Actions — defense-in-depth re-checks the jose cookie on every call
 * (proxy.ts is the UX gate, not the boundary — CVE-2025-29927 lesson). Zod validates
 * every field at action entry: invalid input never reaches the DB.
 */

async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    throw new Error("Unauthorized");
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const createPeriodSchema = z
  .object({
    type: z.enum(["month", "quarter", "fy"]),
    label: z.string().trim().min(1, "Label is required"),
    startDate: z.string().regex(ISO_DATE, "Start date is required (YYYY-MM-DD)"),
    endDate: z.string().regex(ISO_DATE, "End date is required (YYYY-MM-DD)"),
    makeActive: z.boolean().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export type CreatePeriodState = { ok?: true; id?: number; error?: string };

export async function createPeriod(
  _prev: unknown,
  formData: FormData,
): Promise<CreatePeriodState> {
  await requireSession();
  const parsed = createPeriodSchema.safeParse({
    type: formData.get("type"),
    label: formData.get("label"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    makeActive: formData.get("makeActive") === "on" ? true : undefined,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Invalid input" };
  }
  const id = await insertPeriod({
    type: parsed.data.type,
    label: parsed.data.label,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
  });
  if (parsed.data.makeActive) {
    await setActiveTx(id);
  }
  revalidatePath("/periods");
  revalidatePath("/");
  return { ok: true, id };
}

const setActiveSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type SetActiveState = { ok?: true; error?: string };

export async function setActivePeriod(
  _prev: unknown,
  formData: FormData,
): Promise<SetActiveState> {
  await requireSession();
  const parsed = setActiveSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { error: "Invalid period id" };
  }
  await setActiveTx(parsed.data.id);
  revalidatePath("/periods");
  revalidatePath("/");
  return { ok: true };
}
