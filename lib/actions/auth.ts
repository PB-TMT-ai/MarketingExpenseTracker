"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyPassword } from "../auth/password";
import { mintSession, sessionCookieOptions, SESSION_COOKIE } from "../auth/session";

const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LoginState = { ok?: true; error?: string };

/**
 * Validate the submitted password, and on success mint a signed session cookie.
 * Returns `{ ok: true }` (the client then navigates to `/`) or `{ error }` for an
 * inline message. No account lockout in v1 (single trusted team, D-13).
 */
export async function login(
  _prevState: unknown,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Password is required" };
  }
  if (!verifyPassword(parsed.data.password)) {
    return { error: "Incorrect password" };
  }

  try {
    const jar = await cookies(); // Next 16: cookies() is async (Pitfall 4)
    jar.set(SESSION_COOKIE, await mintSession(), sessionCookieOptions());
  } catch {
    // e.g. SESSION_SECRET missing/too short — return a controlled error instead of a raw
    // 500 on a *correct* password. instrumentation.ts also asserts these at boot (fail fast).
    return {
      error: "Server authentication is misconfigured. Please contact the administrator.",
    };
  }
  return { ok: true };
}

/** Clear the session cookie and return to the login screen. */
export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
