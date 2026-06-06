import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { logout } from "@/lib/actions/auth";
import NavLinks from "./nav-links";
import PeriodSwitcher from "./period-switcher";

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
      <header className="flex flex-col gap-2 border-b border-neutral-200 bg-white px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex items-center justify-between gap-3 md:justify-start md:gap-4">
          <Link
            href="/"
            className="inline-flex min-h-11 shrink-0 items-center font-semibold"
          >
            <span className="md:hidden">MET</span>
            <span className="hidden md:inline">Marketing Expense Tracker</span>
          </Link>
          <PeriodSwitcher />
        </div>
        <nav
          aria-label="Primary"
          className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 text-sm whitespace-nowrap sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:whitespace-normal"
        >
          <NavLinks />
          <form action={logout} className="shrink-0">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3.5 hover:bg-neutral-50"
            >
              Log out
            </button>
          </form>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
