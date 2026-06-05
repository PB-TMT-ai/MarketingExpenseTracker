---
phase: 01-foundation
reviewed: 2026-06-05T01:28:00Z
depth: deep
files_reviewed: 27
files_reviewed_list:
  - app/(app)/layout.tsx
  - app/(app)/page.tsx
  - app/globals.css
  - app/layout.tsx
  - app/login/page.tsx
  - drizzle.config.ts
  - drizzle/0000_abnormal_magneto.sql
  - drizzle/meta/_journal.json
  - drizzle/meta/0000_snapshot.json
  - instrumentation.ts
  - lib/actions/auth.ts
  - lib/actions/spike.ts
  - lib/auth/password.ts
  - lib/auth/session.test.ts
  - lib/auth/session.ts
  - lib/db/__smoke__/spike.ts
  - lib/db/__smoke__/tables.ts
  - lib/db/index.ts
  - lib/db/migrate-cli.ts
  - lib/db/migrate.ts
  - lib/db/schema.ts
  - next.config.ts
  - package.json
  - postcss.config.mjs
  - proxy.ts
  - tsconfig.json
  - .env.example
findings:
  critical: 0
  high: 2
  medium: 3
  low: 5
  total: 10
status: issues-found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-05T01:28:00Z
**Depth:** deep
**Files Reviewed:** 27
**Status:** issues-found

## Summary

Phase 01 lays down a Next 16 walking skeleton: shared-password auth (jose HS256 cookie + constant-time password check), a Next-16 `proxy.ts` route gate with defense-in-depth re-verification in the `(app)` layout, a dual-driver Drizzle DB seam (PGlite local / postgres-js Supabase), and the off-plan-guard schema.

The security-sensitive core is **fundamentally sound**: no hardcoded secrets, no `NEXT_PUBLIC_` leakage, SheetJS/AG Grid correctly absent, `timingSafeEqual` used instead of `===`, the session cookie is a signed JWT (not the password), `httpOnly`/`sameSite`/`Secure`-gating are correct, and the layout re-verifies on every render rather than trusting the proxy (the CVE-2025-29927 lesson is applied). The off-plan guard is structurally enforced exactly as the spec demands — `executions` has no `sfid`, only a `NOT NULL ... ON DELETE restrict` FK to `plan_rows`.

No Critical issues. However there are **two High-severity correctness gaps** that undermine stated security/robustness guarantees: (1) the password digest comparison is not actually constant-time across all inputs because the early `if (!expected) return false` and SHA-256 length-normalization still leak the "password env var unset" state, but more importantly the comparison short-circuits cheaply only when `APP_PASSWORD` is missing — the real High issue is that **`verifyPassword` and the whole gate silently treat an unset/empty `APP_PASSWORD` as "no one can log in" while `SESSION_SECRET` misconfig throws at request time inside a Server Action, producing an unhandled 500 with a stack trace** rather than a controlled failure; and (2) the **"30-day sliding expiry" documented in `session.ts` is not implemented — the expiry is fixed-at-mint and never refreshed**, so the cookie hard-expires 30 days after login regardless of activity, contradicting the stated behavior and the D-13 decision the comment cites.

The Medium/Low items are robustness and convention nits (postgres-js SSL not pinned, `secret.length` counts UTF-16 code units not bytes, redirect-to-`/login` doesn't preserve the original path, an authenticated user hitting `/login` isn't bounced to `/`).

## High

### HI-01: SESSION_SECRET misconfiguration throws inside the login Server Action → unhandled 500 with stack trace

**File:** `lib/auth/session.ts:15-23`, surfaced via `lib/actions/auth.ts:33` and `proxy.ts:21`
**Issue:** `getSecret()` throws a raw `Error` when `SESSION_SECRET` is missing or `< 32` chars. This is lazy (good — import never throws), but the throw lands in three hot paths with no catch:
- `mintSession()` is awaited inside `login()` (`auth.ts:33`) after the password already validated. A misconfigured prod deploy (secret unset/too short) turns a *correct* password submission into an uncaught exception → Next returns a 500. In dev the stack trace (including the literal guidance string) is rendered to the client.
- `verifySession()` swallows it (try/catch returns `false`), so `proxy.ts` and the layout will *silently redirect every request to `/login`* — an infinite login loop where the password "never works," with no diagnostic. An operator cannot tell a wrong password from a missing secret.

This is the classic "shared-password misconfig" failure mode (PITFALLS #10). The mint path is the worse half: it crashes post-auth.

**Fix:** Fail fast and loud at boot, and degrade gracefully at request time. Validate `SESSION_SECRET` (and `APP_PASSWORD`) in `instrumentation.ts register()` so a misconfigured server refuses to start with a clear log line:
```ts
// instrumentation.ts, inside register(), nodejs branch
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("Boot aborted: SESSION_SECRET missing or < 32 chars.");
}
if (!process.env.APP_PASSWORD) {
  throw new Error("Boot aborted: APP_PASSWORD is not set.");
}
```
Additionally, wrap the `mintSession()` call in `login()` so a runtime config error returns a controlled `{ error: "Server is misconfigured. Contact admin." }` instead of a 500/stack trace.

### HI-02: "30-day sliding expiry" is documented but not implemented — session is fixed-expiry

**File:** `lib/auth/session.ts:8` (doc), `:30` (mint), `lib/actions/auth.ts:33-42` (cookie set)
**Issue:** The module docstring claims *"30-day sliding expiry (D-13)"* and the cookie comment in `auth.ts` reinforces a sliding model, but nothing re-mints or re-sets the cookie after login. `setExpirationTime("2592000s")` bakes a fixed `exp` at mint; the cookie `maxAge` is likewise fixed. `proxy.ts` and the layout only *read*/verify — they never refresh. Result: a user who logs in and uses the app daily is still hard-logged-out exactly 30 days after login, not 30 days after last activity. The behavior contradicts both the comment and the cited decision, which will surface as a "why was I kicked out mid-use" support issue and is a latent correctness defect for anyone who later relies on the documented semantics.

**Fix:** Either (a) correct the docs to say "fixed 30-day expiry," or (b) implement sliding by re-issuing the cookie when the token is valid and past a refresh threshold. Sliding belongs in a Server Action / Route Handler or the `(app)` layout (NOT `proxy.ts`, which must stay pure and cannot reliably set cookies on every response). Minimal honest fix is (a):
```ts
* Fixed 30-day expiry from time of login (D-13); re-login required after expiry.
```
and drop the word "sliding" in `auth.ts:35-37`.

## Medium

### ME-01: postgres-js connection does not pin SSL — Supabase pooled connections may fail or fall back insecurely

**File:** `lib/db/index.ts:28`
**Issue:** `postgres(url, { prepare: false })` passes no `ssl` option. Supabase requires TLS. Behavior then depends entirely on whether `sslmode=require` is present in the `DATABASE_URL` query string — which `.env.example:19` does not document or include. If an operator pastes a bare pooled URL without `sslmode`, postgres-js defaults to `ssl: false` and the connection either fails or (worse, depending on server config) is attempted without TLS. The `prepare:false` pooler caveat is handled; the TLS caveat is not.

**Fix:** Make TLS explicit for the cloud branch so it cannot silently depend on URL query params:
```ts
return postgresDrizzle(postgres(url, { prepare: false, ssl: "require" }), { schema });
```
and add `?sslmode=require` guidance to the `DATABASE_URL` comment in `.env.example`.

### ME-02: SESSION_SECRET length check counts UTF-16 code units, not bytes — under-32-byte secrets can pass

**File:** `lib/auth/session.ts:17`
**Issue:** The guard is `secret.length < 32`, and the error text and `.env.example:11` both say *">= 32 random **bytes**."* `String.length` counts UTF-16 code units. A secret containing multi-byte characters (e.g. emoji or accented chars, each often 1 code unit but representing >1 UTF-8 byte — and astral chars counting as 2 code units for fewer codepoints) makes "length" and "bytes" diverge. A 32-char ASCII secret is fine, but the stated contract (bytes) is not what's enforced (code units), so a secret that *looks* compliant can carry less entropy than intended. Low exploitability for a single-team app, but it's a real contract mismatch in security-critical code.

**Fix:** Measure the encoded byte length (you already encode it on the next line):
```ts
const bytes = new TextEncoder().encode(secret);
if (bytes.length < 32) { throw new Error("SESSION_SECRET must be >= 32 bytes."); }
return bytes;
```

### ME-03: `verifyPassword` early-returns `false` on unset `APP_PASSWORD`, masking misconfiguration as "wrong password"

**File:** `lib/auth/password.ts:12-13`
**Issue:** When `APP_PASSWORD` is unset, every login returns "Incorrect password" (`auth.ts:29`) with no signal that the server is misconfigured rather than the user mistyping. Combined with HI-01, a misconfigured deploy is indistinguishable from a forgotten password from the operator's side, and there is no log. (Functionally this is the safe direction — it fails closed — hence Medium not High, but the silent ambiguity is a real operability defect.)

**Fix:** Covered by the HI-01 boot-time `APP_PASSWORD` assertion (fail fast so this branch is unreachable in a correctly-deployed server). Keep the `return false` as defense-in-depth.

## Low

### LO-01: Redirect to `/login` discards the originally requested path — no post-login return

**File:** `proxy.ts:25-28`, `app/(app)/layout.tsx:20`
**Issue:** Unauthenticated requests are redirected to `/login` with `search` cleared and no `?next=` / `from` param. After login the client unconditionally `router.replace("/")` (`login/page.tsx:15`). A user deep-linking to a future `/period/123` always lands on `/` after auth. Harmless in this skeleton (only `/` exists) but worth a note before deep links exist.
**Fix:** Optionally capture `loginUrl.searchParams.set("next", pathname)` in `proxy.ts` and honor it in the login redirect, with an allowlist/relative-only check to avoid open-redirect.

### LO-02: Authenticated user visiting `/login` is not bounced to `/`

**File:** `proxy.ts:16-18`
**Issue:** `/login` is unconditionally public, so an already-authenticated user can re-open the login form. Minor UX wart; not a security issue.
**Fix:** In `proxy.ts`, if `pathname.startsWith("/login")` and the cookie verifies, `NextResponse.redirect` to `/`.

### LO-03: Proxy matcher does not exclude `favicon.ico` / static assets that the in-handler check then lets through only via cookie

**File:** `proxy.ts:33`
**Issue:** Matcher excludes `_next/static`, `_next/image`, `favicon.ico`. Any other top-level static asset (e.g. a future `/robots.txt`, `/sitemap.xml`, `/apple-touch-icon.png` served from `app/` or `public/`) will hit the proxy and be redirected to `/login` because it carries no session cookie. Not a bug today (no such assets exist) but a foreseeable trip-hazard when `public/` assets are added.
**Fix:** When public static files are introduced, extend the matcher negative-lookahead or add their paths to the public-surface check in the handler.

### LO-04: `db.execute(sql.raw(...))` in smoke harness — safe now, but pattern is a footgun

**File:** `lib/db/__smoke__/tables.ts:27`
**Issue:** `sql.raw(\`select 1 from ${table} limit 1\`)` interpolates a table name into raw SQL. The inline comment correctly notes `TABLES` is a fixed const list, so there is no injection today. Flagging only because `sql.raw` with template interpolation is the exact shape that becomes an injection if someone later sources `table` from input. Dev-only throwaway file, hence Low.
**Fix:** None required now. If this pattern is ever generalized, switch to an allowlist check or `sql.identifier(table)`.

### LO-05: Migration journal `when` timestamp (1780602475592 ≈ 2026-06-05) is fine, but `migrate.ts` hardcodes a relative `./drizzle` path tied to CWD

**File:** `lib/db/migrate.ts:4`, `instrumentation.ts:11-12`
**Issue:** `MIGRATIONS_FOLDER = "./drizzle"` is resolved relative to `process.cwd()`. It works when the server boots from the project root (the normal case, and `next.config.ts` already pins `turbopack.root` to cwd), but a process launched from another directory (some CI/serverless layouts) would fail to find migrations. Low because the standard Next boot satisfies it.
**Fix:** Optionally resolve from a stable anchor, e.g. `path.join(process.cwd(), "drizzle")` made explicit, or document the cwd assumption next to `ensureMigrated`.

---

## Verified non-issues (checked, not findings)

- **SheetJS / AG Grid / Glide absent** — confirmed via `package.json` grep; no `xlsx`/`ag-grid`/`glide` anywhere. Convention satisfied.
- **No `NEXT_PUBLIC_` on secrets** — repo grep shows only docs/warnings, never a prefixed secret. Satisfied.
- **Constant-time password check** — `timingSafeEqual` on equal-length (32-byte) SHA-256 digests; no `===` on the secret. Correct (modulo ME-02/ME-03 contract nits).
- **Cookie flags** — `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure` gated on `NODE_ENV === "production"`. Correct, and the localhost rationale is right (a `Secure` cookie over http is dropped).
- **`proxy.ts` purity** — imports only the jose session helper; no DB import. Correct, and it's the right Next-16 filename (`proxy.ts`, tracked; no `middleware.ts`).
- **Defense-in-depth** — `(app)/layout.tsx` re-verifies the cookie every render and redirects on failure; does not trust the proxy. Correct (CVE-2025-29927 lesson applied).
- **Off-plan guard** — `executions` has no `sfid`; only `plan_row_id` `NOT NULL` FK `ON DELETE restrict`; `plan_rows` composite `UNIQUE(period_id, activity, sfid)`. Migration SQL (`0000_*.sql:54,58`) matches the schema. Guard is structural. Correct.
- **Money columns** — all `numeric(14,2)`, no float, no generated columns. `version integer DEFAULT 0`. Correct per D-05/D-04.
- **DB seam** — `DATABASE_URL` regex branch `/^postgres(ql)?:\/\//`, `globalThis.__db` cache for PGlite single-connection reuse, `prepare:false` for the pooler. Correct (aside from ME-01 SSL).
- **Boot migration** — `instrumentation.ts` guards on `NEXT_RUNTIME === "nodejs"` and dynamically imports the DB layer so PGlite WASM never reaches edge/client; `ensureMigrated()` no-ops on `postgres://`. Correct.
- **`migrate.ts` importing `drizzle-orm/pglite/migrator` unconditionally** — checked: it is only *reached* on the PGlite branch (no-ops before touching `db` when URL is `postgres://`), and the import is Node-only/never bundled to edge. Not a defect.
- **`mintSession` `setExpirationTime("2592000s")`** — numeric+unit string is a relative offset from `iat` in jose; the template literal interpolates a hardcoded constant, no injection. `exp` is correct (see HI-02 for the *semantic* mismatch, which is about "sliding," not a broken `exp`).
- **`next.config.ts`** — `serverExternalPackages: ["@electric-sql/pglite"]` and `turbopack.root = cwd` both correct and necessary.
- **Locked versions** — `package.json` pins next 16.2.7, react 19.2.7, drizzle-orm 0.45.2, drizzle-kit 0.31.10, jose 6.2.3, zod 4.4.3, postgres 3.4.9, pglite 0.5.1 — all match CLAUDE.md.

---

_Reviewed: 2026-06-05T01:28:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
