import { redirect } from "next/navigation";

/**
 * Root of the authed app — DASH-01: a logged-in user lands on the dashboard.
 * The redirect is server-side (next/navigation), so the browser URL changes to
 * /dashboard before any UI renders.
 */
export default function RootRedirect() {
  redirect("/dashboard");
}
