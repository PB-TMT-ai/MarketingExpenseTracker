import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { logout } from "@/lib/actions/auth";

/**
 * Protected app shell for the `(app)` route group.
 *
 * Defense-in-depth: re-verifies the session cookie on EVERY render and redirects to
 * /login if it's missing/invalid. We do not trust proxy.ts as the boundary — the gate
 * holds here at the render/action layer too (CVE-2025-29927 lesson).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Marketing Expense Tracker</span>
          {/* Period switcher mounts here in a later Phase-1 plan. */}
          <span
            data-slot="period-switcher"
            className="text-sm text-neutral-400"
          />
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Log out
          </button>
        </form>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
