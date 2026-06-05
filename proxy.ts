import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  mintSession,
  sessionCookieOptions,
  verifySession,
} from "./lib/auth/session";

/**
 * Route gate — Next 16 `proxy.ts` (the Node-runtime successor to `middleware.ts`).
 *
 * This is a UX gate, NOT the security boundary: every protected Server Component and
 * Server Action ALSO re-verifies the cookie itself (defense-in-depth — a spoofed
 * `x-middleware-subrequest` header once bypassed middleware, CVE-2025-29927). Keep this
 * file pure cookie crypto: it imports only the jose session helper, never any DB code.
 */
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public surface: the login page and Next internals/assets.
  if (pathname.startsWith("/login") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySession(token))) {
    // Sliding 30-day window (D-13): refresh the cookie's expiry on each authenticated
    // request. mintSession() throws if SESSION_SECRET is missing or too short at runtime
    // (env rotation gone wrong) — let the request through without refreshing rather than
    // 500-ing every authenticated page navigation. instrumentation.ts asserts the env
    // var at boot, so this catch is the second line of defense.
    const res = NextResponse.next();
    try {
      res.cookies.set(SESSION_COOKIE, await mintSession(), sessionCookieOptions());
    } catch {
      // Stale cookie keeps the user logged in until expiry; admin sees the boot-time error.
    }
    return res;
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except static assets; the in-handler check above re-excludes /login.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
