/**
 * Next.js instrumentation hook — runs once when the server process boots.
 *
 * Applies pending PGlite migrations locally so the embedded DB is ready before the first
 * request. Guarded to the Node.js runtime and dynamically imported so the DB layer (and its
 * PGlite WASM) never loads on the edge runtime or in the client bundle. Do NOT import this
 * from proxy.ts or a client component.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast & loud if APP_PASSWORD / SESSION_SECRET are missing or weak, before serving.
    const { assertAuthEnv } = await import("./lib/auth/env");
    assertAuthEnv();
    const { ensureMigrated } = await import("./lib/db/migrate");
    await ensureMigrated();
  }
}
