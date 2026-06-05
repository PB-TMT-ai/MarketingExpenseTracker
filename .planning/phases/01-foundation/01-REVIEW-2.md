---
phase: 01-foundation
reviewed: 2026-06-05T12:28:00+05:30
depth: deep
scope: gap-closure since 8ad9e11..HEAD (Tasks 01-03 / 01-04 / 01-05 + proxy sliding refresh + test runners)
files_reviewed: 24
files_reviewed_list:
  - lib/activities/types.ts
  - lib/activities/registry.ts
  - lib/activities/index.ts
  - lib/activities/counter-wall.ts
  - lib/activities/gsb.ts
  - lib/activities/nlb.ts
  - lib/activities/in-shop.ts
  - lib/activities/pop-dealer-kit.ts
  - lib/activities/dealer-certificate.ts
  - lib/activities/registry.test.ts
  - lib/activities/__smoke__/registry.ts
  - lib/db/periods.ts
  - lib/db/items.ts
  - lib/db/__smoke__/active-period.ts
  - lib/db/__smoke__/item-master.ts
  - lib/actions/periods.ts
  - lib/actions/periods.test.ts
  - lib/actions/items.ts
  - lib/actions/items.test.ts
  - lib/periods/active.ts
  - app/(app)/layout.tsx
  - app/(app)/period-switcher.tsx
  - app/(app)/period-switcher-select.tsx
  - app/(app)/periods/page.tsx
  - app/(app)/periods/period-form.tsx
  - app/(app)/items/page.tsx
  - app/(app)/items/item-form.tsx
  - proxy.ts
  - e2e/login.spec.ts
  - e2e/periods.spec.ts
  - e2e/items.spec.ts
  - playwright.config.ts
  - vitest.config.ts
  - package.json
findings:
  critical: 0
  blocker: 0
  high: 2
  medium: 4
  low: 5
  total: 11
status: issues-found
---

# Phase 01 Gap-Closure Code Review (Second Pass)

**Reviewed:** 2026-06-05T12:28:00+05:30
**Depth:** deep
**Scope:** everything added since `8ad9e11` — the activity registry (6 configs + types + tests + smoke), `lib/db/periods.ts` + `lib/db/items.ts` + their Server Actions + Vitest specs, the `lib/periods/active.ts` seam, the `(app)` shell mods (PeriodSwitcher Server/Client split, items + periods pages), `proxy.ts`'s new sliding refresh, and the test-runner separation (Vitest + Playwright).
**Status:** issues-found (no Critical / Blocker; 2 High; 4 Medium; 5 Low)

## Summary

The gap-closure work is substantively solid. The activity registry meets the framework-free invariant cleanly — every config file imports only `import type` from `./types`, no `react`, no `next`, no `drizzle-orm`, no `node:` builtins, and the `ActivityKey` union is correctly closed with `as const satisfies ActivityConfig` on each entry. The D-11 (single-active-period) and D-09 (soft-toggle on item_master) invariants are now backed by both Vitest specs and live PGlite smoke harnesses, and the previous review's HI-01 (boot-time auth env assertion in `instrumentation.ts`) and HI-02 (sliding session refresh in `proxy.ts`) have been addressed. The Server/Client component split for `PeriodSwitcher` is correct — only the `<select>` onChange handler crosses into Client; the data fetch and the Server Action import stay on the server. Slot `data-attributes` (`data-slot="period-switcher"`, `"period-list"`, `"active-marker"`, `"item-list"`, `"retired-badge"`) are preserved. Stack discipline holds: no `xlsx` / `ag-grid` / `glide-data-grid` anywhere, no `NEXT_PUBLIC_` on a secret, no runtime deps added (only scripts).

That said there are **two High-severity correctness gaps** the new code now owns:

1. **D-11 (single-active-period) is not safe under concurrent writers.** `setActiveTx` runs `UPDATE WHERE is_active=true` then `UPDATE WHERE id=$id` inside a transaction without any row-level lock or constraint. Postgres default `READ COMMITTED` lets two concurrent `setActiveTx(idA)` / `setActiveTx(idB)` transactions both observe an empty `is_active=true` set, then both flip their target on — yielding two active rows. The vitest/smoke "two sequential toggles" tests cannot exercise this. For a single-team app this is unlikely in practice but it is the exact invariant the D-11 comment promises is "transactional," and `getActivePeriodRow` uses `.limit(1)` without `ORDER BY` so a transient violation is then masked by an arbitrary row.

2. **`proxy.ts`'s sliding refresh now calls `mintSession()` on every authenticated request without a `try/catch`.** If `SESSION_SECRET` is ever unset, removed, or shortened at runtime (e.g. an env rotation gone wrong, a Vercel env update), `getSecret()` throws and the proxy returns an uncaught 500 on **every** authenticated navigation — far broader than the login-only failure mode the previous review flagged. The boot-time `assertAuthEnv()` covers cold-starts but not runtime env changes.

The Medium items are: production code re-exports `_resetPeriodsForTest` / `_resetItemsForTest` from `lib/db/*.ts` (the underscore prefix is documentation, not access control — any app caller can wipe live tables); `createPeriod`'s insert + setActiveTx are non-atomic; the dev password is hardcoded in three checked-in e2e specs; and `getActivePeriodRow` lacks `ORDER BY` (deterministic-result safety net).

The Low items are E2E fragility (`networkidle` is deprecated guidance; `clearCookies` is racy under reuse), `revalidatePath("/")` on every period mutation (an unbounded blast radius once `/` shows real content), POP/Dealer-Kit's plan sheet lacks `taluka` while every other measurement activity carries it (likely PROJECT.md-faithful but worth confirming), and the playwright webServer wipes `.pglite` unconditionally (silent local-data loss).

---

## High

### HI-01: `setActiveTx` is not race-safe — two concurrent writers can both leave their row active (D-11 violation window)

**File:** `lib/db/periods.ts:62-70`
**Issue:** Under Postgres `READ COMMITTED` (the default), the clear-all step

```ts
await tx.update(periods).set({ isActive: false }).where(eq(periods.isActive, true));
```

acquires row-level write locks **only on the rows it actually finds active right now**. If two transactions T1 and T2 fire concurrently when the table currently has zero active rows (e.g. just after the first-ever period is created without `makeActive: true`), both clear-all updates affect zero rows and acquire no locks; both then proceed to their `UPDATE ... WHERE id = ?` step and commit — leaving **two** rows with `is_active = true`. The D-11 comment in this file explicitly claims "even a concurrent reader can never observe two active rows" — that is not what the code enforces.

The matching `getActivePeriodRow` query (`lib/db/periods.ts:48-55`) does `select … where is_active = true limit 1` with no `ORDER BY`, so once two rows are active the "which one wins" answer is implementation-defined (typically the first heap tuple), and a refresh of `/periods` can show the active marker on different rows on successive renders.

Sequential / non-concurrent calls *are* correct, which is why every vitest and smoke harness passes. Playwright's `workers: 1` also can't surface this.

**Fix:** Either add a partial unique index that makes the invariant a hard database constraint (preferred — the structural enforcement matches the comment's promise), or take an explicit table-level lock inside the transaction.

```sql
-- Migration: make D-11 a real DB-enforced invariant.
CREATE UNIQUE INDEX one_active_period ON periods ((1)) WHERE is_active = true;
```

With that index in place, the existing `setActiveTx` body becomes correct because the second transaction's `UPDATE … SET is_active=true` will fail with a unique-violation if the first hasn't yet flipped its row off (and the second will retry the clear-all once it sees the first's commit). Alternatively, prepend `await tx.execute(sql\`lock table periods in share row exclusive mode\`);` for a less-invasive but coarser fix.

Also add `ORDER BY id` (or `created_at desc`) to `getActivePeriodRow`'s query so the read is deterministic even if the invariant is somehow violated.

### HI-02: `proxy.ts`'s sliding refresh calls `mintSession()` unguarded — any runtime `SESSION_SECRET` problem becomes a site-wide 500

**File:** `proxy.ts:26-30`, depending on `lib/auth/session.ts:30-38` (`getSecret()` throws)
**Issue:** The sliding-refresh implementation reads:

```ts
if (token && (await verifySession(token))) {
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, await mintSession(), sessionCookieOptions());
  return res;
}
```

`mintSession()` calls `getSecret()`, which throws when `SESSION_SECRET` is missing or `< 32` chars. `verifySession()` swallows that throw (catches → `false`), so a misconfigured boot lands in the "redirect to /login" branch — graceful. But the *mint* branch is reached only when `verifySession` returned `true` on a still-valid old token. The valid-token case is the **common case after the env got broken at runtime** (e.g. an admin removed `SESSION_SECRET` from Vercel mid-day, or rotated to a < 32-byte value). Result: every authenticated request 500s with an unhandled rejection. The previous review's HI-01 was login-only; this version of the symptom is on every navigation.

`instrumentation.ts → assertAuthEnv()` only runs at cold-start and does not protect against runtime env mutation. `lib/actions/auth.ts:32-41` wraps `mintSession()` in a try/catch and returns a controlled error — `proxy.ts` does not.

This is also expensive on the steady path: every authenticated page request now does an HMAC mint. Fine for HS256, but worth noting that the previous review explicitly recommended that sliding refresh "belongs in a Server Action / Route Handler or the (app) layout (NOT proxy.ts)"; the implementation chose proxy.ts anyway, which is defensible — but then it must be failure-tolerant.

**Fix:** Catch and fall through to plain `NextResponse.next()` so a transient mint failure degrades gracefully (the user still has a valid old cookie; the worst case is they don't get the refresh until the env is fixed):

```ts
if (token && (await verifySession(token))) {
  const res = NextResponse.next();
  try {
    const refreshed = await mintSession();
    res.cookies.set(SESSION_COOKIE, refreshed, sessionCookieOptions());
  } catch {
    // SESSION_SECRET went missing at runtime — keep serving the request with the
    // existing valid cookie; let assertAuthEnv catch it at the next cold start.
  }
  return res;
}
```

Optionally throttle the refresh (only re-mint when the token is past, say, half its lifetime) to avoid signing on every static-looking GET.

---

## Medium

### ME-01: `_resetPeriodsForTest` / `_resetItemsForTest` are exported from production modules — any app caller can wipe live tables

**File:** `lib/db/periods.ts:76-78`, `lib/db/items.ts:51-53`
**Issue:** Both functions are `export async`, sitting next to the real query helpers in the same module. There is no compile-time barrier preventing an unrelated Server Action, Route Handler, or layout from `import { _resetPeriodsForTest }` and calling it. The `_` prefix is convention, not access control. Combined with the gap-closure introducing two Server Actions per module, the surface area to mis-call is now meaningful — a future contributor refactoring imports may grab the wrong symbol. In Supabase prod this is a `DELETE FROM periods` (and Supabase's pooler has no DDL transaction barrier protecting it). The risk is small today (only test and smoke files use them) but the foot-gun is real.

**Fix:** Move the reset helpers to a sibling file that is only ever imported from test/smoke contexts, and guard at runtime so a prod environment refuses to execute them:

```ts
// lib/db/_test-helpers.ts (NOT exported from any barrel)
import { sql } from "drizzle-orm";
import { db } from "./index";

function assertNotProd() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("_resetForTest invoked in production — refusing.");
  }
}

export async function _resetPeriodsForTest() {
  assertNotProd();
  await db.execute(sql`delete from periods`);
}
export async function _resetItemsForTest() {
  assertNotProd();
  await db.execute(sql`delete from item_master`);
}
```

Update the four call sites (two tests + two smokes) to import from `lib/db/_test-helpers`.

### ME-02: `createPeriod` insert + `setActiveTx` are not atomic — `makeActive: true` can land an inserted period non-active on failure

**File:** `lib/actions/periods.ts:55-63`
**Issue:** Two separate awaits:

```ts
const id = await insertPeriod({ ... });
if (parsed.data.makeActive) {
  await setActiveTx(id);
}
```

If the request is cancelled (client navigates away), the Postgres connection drops, or `setActiveTx` throws between insert and set-active, the new period exists with `is_active = false` and the user's "make this active" intent is silently dropped. The form returns success state to the client only on the happy path, so the user has no signal. Not data loss, but a UX/correctness gap that contradicts the form contract.

**Fix:** Either fold both writes into one transaction, or inline `makeActive` into `insertPeriod`'s call site as a single tx:

```ts
// lib/db/periods.ts
export async function insertPeriodAndMaybeActivate(
  values: NewPeriod & { makeActive?: boolean },
): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(periods).values({ ... }).returning();
    const id = Number((row as { id: number | string }).id);
    if (values.makeActive) {
      await tx.update(periods).set({ isActive: false }).where(eq(periods.isActive, true));
      await tx.update(periods).set({ isActive: true }).where(eq(periods.id, id));
    }
    return id;
  });
}
```

Then `createPeriod` calls the single helper, removing the inter-await window.

### ME-03: Dev password hardcoded in three checked-in e2e specs — soft credential leak

**File:** `e2e/login.spec.ts:11`, `e2e/periods.spec.ts:8`, `e2e/items.spec.ts:8`
**Issue:** All three e2e files declare `const DEV_PASSWORD = "jsw-marketing-2026"`, and `login.spec.ts:11` explicitly comments "matches .env.local; harmless in the public spec." That is exactly the value of `APP_PASSWORD` for the dev environment. Once the repo is pushed (even to a private GitHub), the dev password is searchable in commit history. If the same value is ever copy-pasted into a non-dev environment (a staging deploy, a "quick test on prod"), the leak becomes real. PROJECT.md explicitly identifies `APP_PASSWORD` as a Vercel env secret.

**Fix:** Source the password from the environment in the spec, with a clear failure when missing:

```ts
const DEV_PASSWORD =
  process.env.E2E_APP_PASSWORD ??
  (() => {
    throw new Error("E2E_APP_PASSWORD env var required to run e2e specs.");
  })();
```

Pass it via `playwright.config.ts` (`webServer.env = { APP_PASSWORD: process.env.APP_PASSWORD }`) or a `.env.test.local` (also gitignored). Add a single `e2e/helpers/login.ts` so the duplication collapses to one place.

### ME-04: `getActivePeriodRow` lacks `ORDER BY` — non-deterministic when D-11 is briefly violated (defense-in-depth)

**File:** `lib/db/periods.ts:48-55`
**Issue:** Direct consequence of HI-01 but useful as a standalone defense-in-depth: even if the row-level invariant is fixed, the read

```ts
await db.select().from(periods).where(eq(periods.isActive, true)).limit(1);
```

has no `ORDER BY`. Postgres heap order is implementation-defined; under PGlite it's typically insertion order, under postgres-js it's usually the same but vacuums can rewrite it. If a future change ever momentarily allows two rows (admin tool, manual SQL update during ops), the layout's "active period" indicator can flicker between rows on successive renders without any cache miss to explain it.

**Fix:** Add a stable tiebreaker:

```ts
await db
  .select()
  .from(periods)
  .where(eq(periods.isActive, true))
  .orderBy(desc(periods.id))   // newest active wins if multiple sneak through
  .limit(1);
```

---

## Low

### LO-01: E2E specs rely on `waitForLoadState("networkidle")` — flaky and deprecated guidance

**File:** `e2e/periods.spec.ts:87`, `e2e/items.spec.ts:71,89`
**Issue:** Playwright's own docs flag `networkidle` as flaky/discouraged ("DON'T use ... It is unlikely to fit your needs ... use [explicit] web assertions instead"). For Server Action form submissions the cycle is server-action POST → 303 → GET, which `networkidle` sometimes misses because the action response is plain JSON. Tests pass today but the chosen wait is the documented anti-pattern for Next 16 RSC navigations.

**Fix:** Wait for the visible post-condition explicitly — e.g. `await expect(activeMarkers).toHaveCount(1)` (already there as the assertion; just delete the `networkidle` line above it and let Playwright's auto-wait drive the polling).

### LO-02: `revalidatePath("/")` on every period + item mutation will broadcast far beyond intent once `/` has real content

**File:** `lib/actions/periods.ts:64-65,85-86`, `lib/actions/items.ts:49,73`
**Issue:** `revalidatePath("/")` invalidates the **root page**, not the entire site. That's correct intent today because `/` shows the period-switcher in the layout — but `revalidatePath` in App Router invalidates **the page itself**, not the layout above it. The actions revalidate `/periods` (correct) and then `/` (intended to refresh the switcher in the layout), but for the switcher to actually refresh you need `revalidatePath("/", "layout")` to bust the layout's data. The current code therefore appears to work in dev (no static caching) but will silently break the switcher refresh once Vercel's ISR kicks in.

**Fix:** Use the layout variant for the slot that lives in the layout:

```ts
revalidatePath("/periods");
revalidatePath("/", "layout"); // the switcher lives in (app)/layout.tsx
```

Same change in `setActivePeriod`. `items.ts` only needs `revalidatePath("/items")` because no layout-level slot depends on items.

### LO-03: POP / Dealer Kit plan sheet omits `taluka` while every other measurement activity carries it — likely PROJECT.md-faithful but worth confirming

**File:** `lib/activities/pop-dealer-kit.ts:11-18`, vs `counter-wall.ts:10-19`, `gsb.ts:8-16`, `nlb.ts:8-16`
**Issue:** Counter Wall / GSB / NLB plan columns all include `taluka` as shared. POP / Dealer Kit and Dealer Certificate do not. Reading PROJECT.md "Activity column specs" verbatim that may be correct (POP and DC are dealer-keyed, not site-keyed) — flagging only because shared-column shape divergence is the kind of thing that quietly breaks the Phase-2 filter index. The `plan_rows_filter_idx` in `lib/db/schema.ts:65-71` indexes `(period_id, activity, region, state, district)` — not `taluka` — so the missing column is index-safe; the divergence is purely contract-shape.

**Fix:** Confirm against PROJECT.md "Activity column specs" that POP/DC are intentionally taluka-less. If so, leave a one-line comment in the config: `// PROJECT.md: POP / Dealer Kit is dealer-keyed; no taluka by design.` If not, add the column.

### LO-04: `playwright.config.ts` wipes `.pglite/` unconditionally on every `npm run e2e` — silent local-data loss

**File:** `playwright.config.ts:28-40`
**Issue:** `webServer.command` runs `fs.rmSync('.pglite',{recursive:true,force:true})` before `next dev` regardless of which DB the developer is currently using. A dev who has `DATABASE_URL=./.pglite` (the default) and has manually seeded test data — period rows, plan rows being worked on — loses all of it the moment they run `npm run e2e`. The script has no opt-out and no warning. The comment explains *why* (deterministic E2E start) but the trap is real for anyone reading "I'll just run the tests."

**Fix:** Either (a) point E2E at a separate path (`DATABASE_URL=./.pglite-e2e` in `webServer.env`, wipe only that dir), or (b) print a clear `console.warn` and require a `--force` env, e.g.:

```ts
command: process.env.E2E_WIPE_DB === "1"
  ? "node -e \"...rmSync('.pglite-e2e'...)\" && DATABASE_URL=./.pglite-e2e npm run dev"
  : "DATABASE_URL=./.pglite-e2e npm run dev"
```

`(a)` is the right answer. It also fixes the parallelism story when you eventually relax `workers: 1`.

### LO-05: `activities/__smoke__/registry.ts` doubles as a code-shape doc but the `as unknown as ActivityConfig` cast is a silent contract escape hatch

**File:** `lib/activities/__smoke__/registry.ts:51-66`
**Issue:** The smoke constructs a synthetic seventh activity with `key: "test-banner"` cast via `as unknown as ActivityConfig`. The comment correctly identifies why (the union is closed by design). But `as unknown as T` defeats every typecheck on the literal — a malformed `planColumns` entry (wrong `kind`, missing `key`) would compile and "prove" extensibility on a structurally broken record. Today the literal happens to be well-formed; the script is doc-by-example, so the type evasion partially defeats the purpose.

**Fix:** Split the cast. Type the seventh entry against a *widened* config type that drops only the union closure, not the field validation:

```ts
type SeventhConfig = Omit<ActivityConfig, "key"> & { readonly key: string };
const testBanner: SeventhConfig = {
  key: "test-banner",
  label: "Test Banner",
  type: "measurement",
  planColumns: [...] as const,    // now validates every FieldDef shape
  actualColumns: [...] as const,
};
```

Then cast only at the dictionary spread (`{ ...ACTIVITIES, "test-banner": testBanner as ActivityConfig }`). The compile-time evidence is preserved on every column.

---

## Verified non-issues (checked, not findings)

- **Framework-free activity registry** — grep on `lib/activities/**` for `from "(react|next/|drizzle-orm|node:|@neondatabase|postgres|@electric-sql)"` returns zero hits. Every config imports only `import type { ActivityConfig, FieldDef } from "./types"`. ACTV-01 contract honored.
- **`ActivityKey` union closure** — `ACTIVITIES` is typed `Readonly<Record<ActivityKey, ActivityConfig>>`, and each config file ends with `as const satisfies ActivityConfig`. Adding a key to one file without updating `ActivityKey` triggers a compile error at the registry record. Closed correctly.
- **Server vs Client split** — `period-switcher.tsx` is a Server Component (no `"use client"`, imports `next/headers` indirectly via `getActivePeriod` and `setActivePeriodForm`). `period-switcher-select.tsx`, `period-form.tsx`, `item-form.tsx` correctly carry `"use client"`. The Client child receives only POJOs (`PeriodRow[]`, `activeId`) — no Server Actions or DB handles. Slot data-attributes (`data-slot="period-switcher"`, `"period-list"`, `"active-marker"`, `"item-list"`, `"retired-badge"`) all preserved.
- **No DB code in Client components** — grep for `drizzle` / `next/headers` / `cookies()` in `app/(app)/**` shows only `layout.tsx` (Server) using `cookies()`. The two Client files (`period-switcher-select.tsx`, `*-form.tsx`) reach the server only through Server Action references, never imports of `lib/db`.
- **Defense-in-depth in layout still holds** — `app/(app)/layout.tsx:20-23` reads the cookie and `await verifySession(token)` on every render, redirects on failure. CVE-2025-29927 lesson still applied.
- **Defense-in-depth in Server Actions** — both `lib/actions/periods.ts:15-20` and `lib/actions/items.ts:14-19` re-verify the session inside every action, not trusting `proxy.ts`. Throw `"Unauthorized"` on failure (Server Action error surfaces as a generic error page — acceptable for v1).
- **Zod validation surface** — `createPeriodSchema` uses `z.enum(["month","quarter","fy"])` (matches `periodType` pgEnum exactly), `regex(ISO_DATE)` on both dates, and a `.refine` ensuring `endDate >= startDate` (ISO date strings sort lexically — correct). `addItemSchema` trims and coerces blank category → undefined so the column stays NULL. `toggleSchema` uses `z.literal("true") | z.literal("false")` — exact match, no whitespace bypass.
- **D-09 (no item DELETE path)** — `lib/db/items.ts` exposes `listItems` / `insertItem` / `setItemActive` / `_resetItemsForTest` only. No `delete*`. Smoke harness `__smoke__/item-master.ts` asserts row count is unchanged across retire+restore — runtime proof of the invariant.
- **`getActivePeriod` scoping seam** — `lib/periods/active.ts` is a one-liner that delegates to `getActivePeriodRow`. No leakage of DB types, no caching layer to invalidate. Phase-2 can swap it without touching db.
- **proxy.ts purity** — imports only `next/server` + `./lib/auth/session`. No DB import. Matcher still excludes `_next/static`, `_next/image`, `favicon.ico`.
- **Stack discipline** — no `xlsx`, `ag-grid`, `glide-data-grid`, or `NEXT_PUBLIC_*` secret hits outside docs/comments. `package.json` adds three smoke scripts and `e2e` script; runtime deps unchanged from the prior review. Versions still pinned: next 16.2.7, react 19.2.7, drizzle-orm 0.45.2, drizzle-kit 0.31.10, jose 6.2.3, zod 4.4.3, postgres 3.4.9, pglite 0.5.1, vitest 4.1.8, @playwright/test 1.60.0.
- **Test runner separation** — `vitest.config.ts` excludes `e2e/**`; `playwright.config.ts` `testDir: "./e2e"`. No collection collision. The `webServer.command` does the .pglite wipe in the same shell as `next dev` so the ordering is deterministic.
- **`as const satisfies ActivityConfig`** — verified on every config: `counter-wall:46`, `dealer-certificate:29`, `gsb:46`, `in-shop:46`, `nlb:46`, `pop-dealer-kit:40`. Each gives both inference (the literal types are preserved into `ACTIVITIES`) and type checking (mis-typed `kind` would fail to compile).
- **No new runtime deps** — `package.json` diff is scripts + the prior playwright/vitest deps were already present; no `xlsx`/`ag-grid` snuck in.
- **HI-01 / HI-02 from prior review** — both addressed: `instrumentation.ts` calls `assertAuthEnv()` and `login()` wraps `mintSession()` in try/catch (HI-01 closed); `proxy.ts` re-mints on each authenticated request (HI-02 closed *semantically*, but see HI-02 in this review for the runtime-failure gap that the closure introduced).

---

_Reviewed: 2026-06-05T12:28:00+05:30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (advisory only — no code changed)_
