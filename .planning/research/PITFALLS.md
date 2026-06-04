# Pitfalls Research

**Domain:** Excel-driven plan-vs-actual marketing compliance tracker — Next.js (App Router) on Vercel + Postgres (Supabase/Neon) + SheetJS + editable data-grid
**Researched:** 2026-06-04
**Confidence:** HIGH (core stack pitfalls verified against official docs, SheetJS issue tracker, Postgres docs, Vercel KB; a few domain-specific items are MEDIUM, flagged inline)

> Scope note: this is a small internal tool (a handful of users, one shared login, a few thousand rows per period). Most "scale" pitfalls below break well below SaaS scale, but two of them — **connection exhaustion** and **lost edits on a shared login** — bite even tiny teams. Those plus the **off-plan guard** and **re-upload data loss** are the four that can actually hurt this project. Everything else is hygiene.

## Critical Pitfalls

### Pitfall 1: Off-plan guard enforced only in app code, not in the schema

**What goes wrong:**
The headline value of this product is "spend cannot be recorded against an SFID that isn't in the plan." If that rule lives only in a server-action `if (planRow exists)` check, it gets bypassed the moment someone adds a second write path — the Excel-actuals importer, a bulk paste in the grid, a future API, or a quick manual `INSERT` to fix data. The guard silently stops applying and off-plan spend leaks in. Worse, it can pass review because the happy-path UI still rejects off-plan rows.

**Why it happens:**
App-layer validation is easy to write and easy to demo. The structural alternative (a NOT NULL foreign key from `execution → plan_row`) requires getting the schema and the import-matching logic right up front, which feels like more work during MVP.

**How to avoid:**
Make it structural exactly as the charter intends: `execution.plan_row_id` is `NOT NULL REFERENCES plan_row(id)`. There is no column on `execution` to hold a free-floating SFID — an execution can only exist by pointing at a real plan row. The Excel importer's job becomes "resolve `(activity, period, SFID)` to a `plan_row_id` or reject the row," and the DB makes it impossible to forget. Add a UNIQUE constraint on `plan_row(activity, period, sfid)` so the match is unambiguous (see Pitfall 5).

**Warning signs:**
- `execution` table has its own `sfid` column that isn't derived from the plan row.
- The off-plan check appears in TypeScript but there's no FK in the migration.
- You can think of a code path (import, bulk paste, seed script) that writes executions without going through the validation function.

**Phase to address:**
Schema/data-model phase (earliest). This decision is load-bearing for the entire product and is the most expensive to retrofit.

---

### Pitfall 2: Re-uploading a plan for a period that already has actuals (destructive overwrite)

**What goes wrong:**
The team re-uploads a corrected plan Excel for "Counter Wall Painting / Q2." The naive implementation deletes the old plan rows and inserts the new ones. Because executions FK to plan rows, this either (a) cascades and deletes all the actuals already entered for that period, or (b) blocks with a foreign-key error and leaves the user stuck. Either outcome is a system-of-record disaster: weeks of hand-entered actuals vanish or the team can't fix a typo in the plan.

**Why it happens:**
"Upload plan" is modeled as a single idempotent "replace the period" operation early on, before anyone thinks about the second upload. The first upload works perfectly in the demo, so the destructive path is never exercised.

**How to avoid:**
- Treat re-upload as a **reconcile/merge**, not a replace. Compute the diff: SFIDs added (insert), SFIDs removed (only deletable if they have zero actuals — otherwise warn and keep), SFIDs changed (update plan fields, keep the row id so actuals stay attached).
- Decide and document the policy for "plan row removed in re-upload but has actuals": block, soft-archive, or flag — do not silently delete.
- Never `ON DELETE CASCADE` from plan_row to execution. Use `ON DELETE RESTRICT` so an accidental destructive delete fails loudly instead of erasing actuals.
- Show a confirmation summary before committing: "12 new dealers, 3 removed (2 have actuals — kept), 40 unchanged."

**Warning signs:**
- Upload handler starts with `DELETE FROM plan_row WHERE period = ...`.
- No test for "upload the same period twice."
- Plan→execution FK uses `ON DELETE CASCADE`.

**Phase to address:**
Excel import phase, but the schema phase must set `ON DELETE RESTRICT` so the mistake is structurally hard.

---

### Pitfall 3: Serverless connection exhaustion against Postgres

**What goes wrong:**
The app works perfectly in dev and in early use, then under any concurrency (two people in the grid, or autosave firing on every keystroke) it starts throwing `remaining connection slots are reserved` / `too many connections` and pages fail intermittently. Each Vercel function invocation opens its own DB connection; serverless fans out faster than Postgres's connection limit (Supabase free tier and Neon both cap low). This is the single most common production failure for Next.js + Postgres on Vercel — and it's a config mistake, not a load problem, so it bites tiny teams too.

**Why it happens:**
Developers wire up the **direct** connection string (port 5432) because it's what the dashboard shows first and it works locally. The direct connection is for migrations/admin, not for serverless app traffic.

**How to avoid:**
- **Supabase:** use the **pooler** connection string in **transaction mode** (port 6543, the PgBouncer endpoint) for all app queries; reserve the direct 5432 URL for migrations only. Note: transaction-mode pooling disables prepared statements and some session features — set the driver flag accordingly (e.g. `prepare: false` for `postgres.js`).
- **Neon:** use the `@neondatabase/serverless` driver (HTTP/WebSocket), which is built for this fan-out pattern, or the pooled connection string.
- Use one shared module-scope client/pool, not a new client per request.
- If on Vercel Fluid Compute, it now closes idle pool clients before suspending — still use the pooler endpoint; Fluid reduces but does not eliminate the need.

**Warning signs:**
- Connection string contains `:5432` and `db.<project>.supabase.co` (direct) rather than the pooler host / `:6543`.
- Intermittent 500s that correlate with concurrent use, not specific data.
- A `new Pool()`/`createClient()` inside a request handler or server action.

**Phase to address:**
Foundation/DB-connection phase (before any feature uses the DB). Pick provider + pooler endpoint on day one.

---

### Pitfall 4: Lost edits on the shared login (no concurrency control)

**What goes wrong:**
Two team members are filling actuals in the same grid (entirely plausible — they share one password and split the dealer list). Person A edits dealer X's sq ft; Person B, who loaded the grid earlier, edits dealer X's status; B's autosave writes the whole row and silently wipes A's sq ft. Because they're on one shared account there's no per-user trail, so the loss is invisible and unattributable — the data just quietly drifts wrong. This is the classic lost-update problem, made worse here because the shared login removes the social signal of "who touched what."

**Why it happens:**
Inline-edit grids with autosave usually PUT the entire row. Without a version check, last-writer-wins overwrites concurrent edits. It never surfaces in single-user testing.

**How to avoid:**
- Save **per-cell / per-field** patches, not whole rows, so two people editing different fields of the same row don't clobber each other.
- Add optimistic concurrency: stamp each row with `updated_at` (or a `version` int). On save, `UPDATE ... WHERE id = ? AND version = ?`; if 0 rows affected, the row changed underneath — reject and reload, don't overwrite.
- Show a non-blocking "this row changed, reload" prompt rather than silently winning.
- Consider scoping who fills which region/activity by convention to reduce overlap (cheap, no code).

**Warning signs:**
- Save payload is the entire row object.
- No `version`/`updated_at` predicate in the `UPDATE`.
- "Works fine" but only ever tested by one person at a time.

**Phase to address:**
Grid / actuals-entry phase. Bake the version column into the schema phase so it's there when needed.

---

### Pitfall 5: Match-key ambiguity and collisions across periods/activities

**What goes wrong:**
Actuals match to plan rows on `(activity, period, SFID)`. If the same SFID legitimately appears twice in one period's plan (e.g. a dealer planned for two walls), or the plan Excel has duplicate SFID rows, the importer either picks the wrong row, picks arbitrarily, or creates duplicates. Conversely, if period is encoded inconsistently ("Q2" vs "FY25-Q2" vs a date), the same real-world plan splits across keys and actuals fail to match a plan that visibly exists. Either way the off-plan guard and the completeness % go wrong.

**Why it happens:**
SFID is assumed unique-per-period without enforcing it. Period is free-text from a filename or a cell rather than a normalized value. Activities like Counter Wall Painting can have multiple physical units per dealer, breaking the "one SFID = one plan row" assumption.

**How to avoid:**
- Decide the grain explicitly: is a plan row "one dealer per activity per period" or "one execution unit (wall/board)"? For multi-unit activities, you likely need a per-unit key (e.g. Wall/Shop No) in the key, or a quantity-planned model.
- Add a UNIQUE constraint matching your chosen match key (e.g. `UNIQUE(activity, period, sfid)` — or include unit no if needed). Let the DB reject duplicate plan rows at upload instead of silently accepting them.
- Normalize period to a single canonical representation (e.g. `period_type` + `period_key` like `FY2026-Q2`) and derive it deterministically, never from a filename.
- On import, reject (don't guess) when an actual matches zero or >1 plan rows; report both cases to the user.

**Warning signs:**
- No UNIQUE constraint on the plan match key.
- Importer uses `findFirst`/`LIMIT 1` to resolve a plan row.
- Period stored as a raw string typed by the uploader.

**Phase to address:**
Schema phase (define grain + UNIQUE constraint) and Excel import phase (matching logic, zero/multi-match handling).

---

### Pitfall 6: Excel type coercion — dates as DD/MM/YY text vs serial, and numbers stored as text

**What goes wrong:**
Vendor Excels are messy. Dates arrive three ways: as real Excel date serials, as text strings like `03/06/26`, and embedded in coded fields (`VendorInitials_wallNo_DD/MM/YY`). SheetJS by default emits date cells as **numbers** unless told otherwise, and it does **not** parse text strings into dates. Numbers can arrive as text (`"1,250"`, `"₹1250"`, leading-zero pin codes/mobile numbers, GST nos). The result: execution dates land as `45810`-style serials or wrong-month dates (US MM/DD vs Indian DD/MM), sq ft/cost totals compute on `NaN` or string-concatenate, and pin/mobile/GST lose leading zeros or get rounded into scientific notation.

**Why it happens:**
SheetJS faithfully reflects what Excel stored, which depends on the vendor's locale and whether they typed the value or formatted the cell. Defaults (`cellDates` off, no `raw`/`UTC` control) surprise developers who assume "it's a date in Excel so I get a Date." The 1900 leap-year quirk (Excel treats 1900 as a leap year) adds off-by-one risk for serials.

**How to avoid:**
- Read with explicit options: `cellDates: true` and `UTC: true` for date columns (user-entered dates → interpret consistently; UTC avoids local-timezone shifts on the server), and handle the case where a "date" column still comes back as a number or a string.
- Treat **identifiers** (SFID, GST, mobile, pin code) as **strings always** — never let them be parsed as numbers (leading zeros, 16+ digit precision loss). Read those columns raw/as text.
- For numeric measures (sq ft, rate, cost), strip currency symbols/commas/spaces and validate `Number.isFinite` before storing; reject non-numeric with a clear per-cell error.
- For DD/MM/YY text and coded date fragments, parse with an explicit, locale-fixed parser (assume DD/MM, reject ambiguous); never rely on `new Date(string)`.
- Validate every imported row against the activity's expected types **before** insert; collect errors and show a per-row report rather than failing the whole file or coercing silently.

**Warning signs:**
- Imported dates show as 5-digit numbers, or April rows appear in different months.
- Pin codes/mobiles show as `9.19e9` or lose a leading 0; SFIDs don't match the plan due to numeric formatting.
- Cost totals are `NaN` or absurd (string concatenation).

**Phase to address:**
Excel import phase. This is the highest-effort correctness area in the project — give it its own milestone and a corpus of real vendor files to test against.

---

### Pitfall 7: Header/format drift across the six activities (brittle column mapping)

**What goes wrong:**
Each activity has a different column set, and vendors rename, reorder, add, or translate headers ("Sq Ft" vs "Sqft" vs "Area (sq ft)"; "Dealer" vs "Dealer Name"). If the importer maps by column position or exact header string, a slightly different file imports data into the wrong fields silently — sq ft into cost, district into taluka — and nobody notices until a report looks wrong.

**Why it happens:**
The first sample file per activity becomes the hardcoded mapping. Real-world files drift, and positional/exact-string mapping has no tolerance.

**How to avoid:**
- Drive mapping from the typed activity config registry (already a charter decision). Define per-activity expected fields with a set of accepted header aliases (normalized: lowercased, trimmed, punctuation-stripped).
- Match by header name, not position; if a required header is missing or unmatched, **reject the file with a clear message** ("expected a 'Plan Sq Ft' column for Counter Wall Painting") rather than importing partial/misaligned data.
- Surface a mapping preview ("we read these columns as → these fields") before committing the import.

**Warning signs:**
- Column access by index (`row[3]`) anywhere.
- Adding a new vendor file requires a code change to import it.
- No "unrecognized/missing column" error path.

**Phase to address:**
Excel import phase, designed alongside the activity config registry.

---

### Pitfall 8: Partial / failed bulk import leaves the database half-written

**What goes wrong:**
A plan upload of 500 rows fails on row 300 (bad data, timeout, or Vercel function hitting its execution limit). Without a transaction, rows 1–299 are committed and 300–500 aren't. The user re-uploads to fix it and now has duplicates, or a period is half-populated and the completeness % is silently wrong.

**Why it happens:**
Bulk inserts are written as a loop of individual inserts with no surrounding transaction. Serverless function timeouts (Vercel default ~10–60s depending on plan) make large files especially prone to mid-flight termination.

**How to avoid:**
- Wrap the whole import in a single DB transaction: validate-all-then-insert-all; any error → ROLLBACK, nothing persists. Show the full error report and let the user fix and retry cleanly.
- Validate the entire file in memory first; only open the transaction once the data is known-good.
- For large files, keep payloads server-side and use batched multi-row inserts within the one transaction; if files can be very large, move import off the request path (background job) to dodge function timeouts.
- Make re-upload idempotent via the UNIQUE match key + upsert/merge (Pitfall 2/5), so a retry can't duplicate.

**Warning signs:**
- Insert loop with no `BEGIN/COMMIT`.
- "It imported some of the rows" appears in testing.
- Large uploads occasionally 504 / time out.

**Phase to address:**
Excel import phase; transaction discipline is a general data-integrity requirement across all write actions.

---

### Pitfall 9: Money/units stored or computed as floats (totals drift)

**What goes wrong:**
Per-unit cost × sq ft, line-item qty × rate, and grand totals are computed in JavaScript `number` (IEEE-754 float) and/or stored in a Postgres `float`/`double` column. Totals drift by paise/rupees, dashboard spend doesn't reconcile with the sum of rows, and the same total renders differently in two places. For a spend system of record this erodes trust immediately.

**Why it happens:**
`float8` is the path of least resistance and "looks fine" for small numbers. JS has no native decimal type, so multiplication/rounding accumulates error. Compounded by `pg` returning `numeric` as a **string**, which developers wrap in `Number()` and reintroduce float error.

**How to avoid:**
- Store money and measured quantities as Postgres `numeric` (e.g. `numeric(14,2)` for ₹, appropriate scale for sq ft) — never `float`/`double`/`money` type.
- Do arithmetic either in SQL (`numeric` math is exact) or in JS with a decimal library / integer-paise approach; round once, at a defined point, with a defined rounding mode (round half-up is the usual expectation for ₹).
- Keep `numeric` values as **strings** end-to-end in Node (the `pg` driver returns them as strings deliberately) — don't `Number()` them for storage or summation.
- Define rounding rules explicitly: are line items rounded then summed, or summed then rounded? Pick one and apply consistently so child-table totals (POP/dealer kit) match the parent.
- Auto-calc (sq ft = L×B×H, total = qty×rate) should be computed once authoritatively (ideally DB-side or a single shared util) so the grid, the export, and the dashboard never disagree.

**Warning signs:**
- Column types are `real`/`double precision`.
- `Number(row.cost)` or `parseFloat` on a numeric column.
- Dashboard spend ≠ sum of grid rows; totals change on re-save.

**Phase to address:**
Schema phase (column types) and the auto-calc/totals feature. Cheap now, expensive and trust-damaging to fix after data exists.

---

### Pitfall 10: Shared-password auth misconfigured — accidental public exposure

**What goes wrong:**
The whole product sits behind one shared password in a Vercel env var checked by middleware. Three things go wrong in practice: (1) the gate is only in middleware, and middleware can be bypassed — **CVE-2025-29927** let attackers skip Next.js middleware entirely via an `x-middleware-subrequest` header, exposing every "protected" route with no credentials; (2) the password or cookie secret gets prefixed `NEXT_PUBLIC_` and ships to the browser; (3) the auth cookie is set without `httpOnly`/`Secure`/`SameSite`, or is a static unsigned value that's trivially forged. Result: an internal spend tracker is readable/writable by anyone who finds the URL — and there's no per-user trail to even detect it.

**Why it happens:**
"It's just a shared password" invites the simplest possible implementation. Middleware-only gating is the documented quick pattern, and the CVE/cookie nuances aren't obvious.

**How to avoid:**
- Keep Next.js patched (the CVE-2025-29927 fix shipped in patched 13/14/15 releases) — pin a fixed version and don't lag.
- **Defense in depth:** re-check auth inside server actions / route handlers that read or write data, not in middleware alone. Treat middleware as UX, not the security boundary.
- Never prefix the password or cookie secret with `NEXT_PUBLIC_`. Keep them server-only env vars.
- Set the session cookie `httpOnly`, `Secure`, `SameSite=Lax`, with a sane `maxAge`; make it a **signed/HMAC** value (not the password itself), so it can't be forged or replayed indefinitely.
- Set Vercel **Deployment Protection** and ensure preview deployments aren't publicly indexable; add `noindex` so the app can't be found via search.
- Accept the known limitation explicitly: a shared login means **no audit trail** — fine per the charter, but it means data corruption (Pitfall 4) and unauthorized access are both undetectable, which raises the bar on backups (Pitfall 11).

**Warning signs:**
- Auth check exists only in `middleware.ts`.
- Any `NEXT_PUBLIC_` var holds the password or secret.
- Cookie is the literal password or lacks `httpOnly`/`Secure`.
- Next.js version predates the March 2025 CVE patch.

**Phase to address:**
Foundation/auth phase. Revisit during a pre-launch security pass.

---

### Pitfall 11: No backup / point-in-time recovery for a system of record

**What goes wrong:**
This is the authoritative record of marketing spend, hand-entered over weeks, with no per-user audit trail to reconstruct lost data. A bad re-upload (Pitfall 2), a wrong bulk edit, a `DELETE` run against the wrong period, or a dropped free-tier database, and the data is simply gone with no way back. Free tiers are the trap: Supabase pauses/limits inactive free projects and Neon's free-tier history retention is short — teams assume "the cloud backs it up" and discover otherwise during the incident.

**Why it happens:**
Backups feel like ops overhead for a small internal tool, and managed Postgres "feels" durable. The system-of-record nature (and absence of any audit trail) isn't weighted during MVP.

**How to avoid:**
- Confirm the provider's actual backup/PITR guarantees for your tier in writing, and upgrade the tier if recovery window is inadequate for a system of record.
- Add a scheduled `pg_dump` export (e.g. nightly to object storage) independent of the provider, so a paused/lost project isn't catastrophic.
- Implement **soft deletes / archival** for plan rows and executions instead of hard `DELETE`, and keep a simple change log (even without per-user identity, a timestamped before/after row history makes "undo the bad upload" possible).
- Add an "export everything to Excel" path (you already need filtered export — extend it to full backup) as a user-driven safety net.

**Warning signs:**
- No documented recovery plan; "Supabase/Neon handles it" with no verification.
- Hard `DELETE` statements in the codebase.
- Free tier with no external dump configured.

**Phase to address:**
Foundation phase (pick tier knowingly), reinforced in the data-integrity/import phase (soft delete + change log) and pre-launch (verify a restore actually works).

---

### Pitfall 12: jsonb misused — wrong index, unvalidated fields, schema drift

**What goes wrong:**
Activity-specific measurement fields live in a `jsonb` column. Three failures follow: (1) someone slaps a default GIN index on the column expecting it to speed up `data->>'actual_sq_ft' = x` filters — it **doesn't**; the default `jsonb_ops` GIN supports `@>`, `?`, `?|`, `?&`, not `->>` equality, so filters stay slow; (2) nothing validates the JSON shape, so a typo'd key (`sqft` vs `actual_sq_ft`) or wrong type writes happily and the value silently disappears from filters, totals, and the dashboard; (3) the field set drifts per upload, so old and new rows have different keys and aggregates undercount.

**Why it happens:**
jsonb is "schemaless and flexible," which invites dumping arbitrary shapes in with no contract and assuming a GIN index covers everything.

**How to avoid:**
- Validate every jsonb payload against the activity's typed config (the registry) before insert/update — reject unknown keys and wrong types. The flexibility is in the *schema design*, not in *what gets written*.
- Index intentionally: for the 1–3 fields you actually filter/sort on, use **expression B-tree indexes** (`CREATE INDEX ... ((data->>'field'))`) — not a blanket GIN. Only use GIN (`jsonb_path_ops`) if you genuinely need containment queries.
- **Keep the shared who/where columns (Region/State/District/Distributor/SFID/Dealer) as real indexed columns** — the charter already says this; the pitfall is letting any filterable field slide into jsonb later.
- Anything you sum for spend (cost, sq ft) is arguably better as a real `numeric` column than jsonb, both for `numeric` exactness (Pitfall 9) and for index/aggregate performance.
- Version the jsonb shape per activity so you can migrate/normalize old rows when fields change.

**Warning signs:**
- A GIN index exists but `->>'...'` filter queries still do sequential scans (`EXPLAIN` shows Seq Scan).
- A filter/total quietly excludes some rows (mismatched keys).
- No schema/zod-style validation between Excel parse and jsonb write.

**Phase to address:**
Schema phase (decide real-column vs jsonb boundary, plan indexes) and import phase (validation against config).

---

### Pitfall 13: Grid renders all rows / autosaves on every keystroke

**What goes wrong:**
The editable grid mounts every row's DOM and re-renders the whole table on each edit. At a few thousand rows with inline inputs this gets janky — slow scroll, laggy typing, dropped keystrokes. Compounded by autosave-per-keystroke, which fires a server action (and a DB connection — Pitfall 3) on every character, hammering both the function budget and Postgres.

**Why it happens:**
A plain table without virtualization works fine with the 50-row demo dataset, and "save as you type" is the simplest autosave. Both fall over with real data and real connections.

**How to avoid:**
- Virtualize rows (render only what's visible). TanStack Table has no built-in virtualization — pair it with TanStack Virtual; Glide Data Grid is canvas-based and virtualizes natively. Either is fine; just don't ship a non-virtualized `<table>` of thousands of rows.
- **Debounce** saves (on blur / after a pause), and send **per-field patches**, not whole rows — this also fixes the lost-edit problem (Pitfall 4).
- Use optimistic UI for responsiveness, but ensure the optimistic update **rolls back on error** (Next.js `useOptimistic` only rolls back when the async fn *throws* — returning an error object leaves the UI lying to the user).
- Keep heavy compute (totals, validation) memoized; don't recompute the whole grid per keystroke.

**Warning signs:**
- Typing lag or slow scroll appears once a real period's data is loaded.
- Network tab shows a save request per keystroke.
- Optimistic edits stick on screen even when the save failed.

**Phase to address:**
Grid / actuals-entry phase. Choose the grid lib and the save strategy together.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Off-plan guard in app code only (no FK) | Faster MVP, simpler schema | Guard silently bypassed by any new write path; the product's core promise breaks | **Never** — it's the product's headline feature; make it a FK |
| Direct DB connection (port 5432) in app | Works in dev immediately | Connection exhaustion under any concurrency | Never for app traffic; direct URL is migrations-only |
| Whole-row saves, no version column | Simplest grid wiring | Silent lost edits on the shared login | Only if truly single-user-at-a-time, which can't be guaranteed here |
| Money in `float` columns | One less type decision | Totals drift; reconciliation failures; rebuild after data exists | Never for a spend system of record |
| Re-upload = delete + insert period | Trivial first-upload logic | Wipes/blocks existing actuals on second upload | Never once a period can have actuals |
| Hardcoded per-activity column mapping by position | Fast first import | Silent misaligned imports on drifted files | Acceptable only for a throwaway one-time import, not the product |
| Everything filterable in jsonb | No schema decisions | Slow filters, no validation, schema drift | Never for the who/where columns; OK for non-filtered measurement detail |
| No external backup (trust the free tier) | Zero ops setup | Total data loss on a bad op or paused project | Never for a system of record — at least nightly `pg_dump` |
| Hard deletes | Less code | No undo for bad upload/edit; no recovery without backup | Acceptable only with reliable PITR + change log in place |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase Postgres on Vercel | Using direct `:5432` URL for app queries | Use pooler `:6543` transaction-mode URL for app; `:5432` for migrations only; set `prepare: false` on the driver |
| Neon on Vercel | Plain `pg` driver over many serverless invocations | Use `@neondatabase/serverless` (HTTP/WS) or the pooled endpoint |
| SheetJS read | Assuming Excel dates arrive as JS `Date`; numbers always numeric | `cellDates: true`, `UTC: true`; read IDs (SFID/GST/mobile/pin) as text; coerce/validate numeric measures explicitly |
| SheetJS read | Trusting header order/exact strings | Map via activity config with normalized header aliases; reject unmatched/missing required columns |
| `pg` / postgres.js + `numeric` | `Number(row.cost)` reintroduces float error | Keep `numeric` as string end-to-end; do math in SQL or a decimal lib |
| Next.js middleware auth | Treating middleware as the security boundary | Re-verify auth in server actions/route handlers; patch past CVE-2025-29927 |
| Vercel env vars | `NEXT_PUBLIC_` on the shared password/secret | Server-only env vars; never `NEXT_PUBLIC_` for secrets |
| `useOptimistic` + server action | Returning an error object expecting rollback | Throw on failure so the optimistic update actually rolls back |
| Vercel functions + bulk import | Large synchronous import hitting function timeout | Validate-then-transaction; batch inserts; move very large imports off-request |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Non-virtualized editable grid | Laggy scroll/typing once real data loads | Virtualize (TanStack Virtual / Glide canvas) | ~1–2k+ rows with inline inputs |
| Autosave per keystroke | Save request per character; DB pressure | Debounce + per-field patch on blur | Immediately under normal typing |
| Connection exhaustion | Intermittent `too many connections` 500s | Pooler endpoint; shared module-scope client | Two concurrent users / autosave bursts |
| GIN index for `->>` equality filters | Filters still do Seq Scan despite "having an index" | Expression B-tree on the filtered jsonb keys | As soon as a period has more than a trivial row count |
| Heavy `@>` filtering on big jsonb docs | Each containment filter = separate bitmap scan; slow multi-filter | Filter on real indexed columns, not jsonb | Multi-filter dashboards over many rows |
| Dashboard recomputed row-by-row in app | Slow dashboard, many round-trips | Aggregate in SQL (`SUM`, `GROUP BY`) over indexed columns | Multi-hundred-row periods |
| GIN index write amplification | Slow plan uploads | Don't over-index jsonb; index only what's filtered | Large plan uploads with broad GIN |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Middleware-only auth gate | CVE-2025-29927-style full bypass exposes all data | Re-verify in server actions/handlers; patch Next.js |
| Password/secret in `NEXT_PUBLIC_` var | Credential shipped to every browser | Server-only env vars; audit for `NEXT_PUBLIC_` leaks |
| Static/unsigned auth cookie or cookie = password | Trivial forgery / indefinite replay | Signed (HMAC) session cookie, `httpOnly`+`Secure`+`SameSite`, maxAge |
| Publicly indexable / unprotected preview deploys | Internal spend data found via URL/search | Vercel Deployment Protection; `noindex`; protect previews |
| No audit trail (shared login) | Unauthorized access & data corruption undetectable | Accepted per charter — compensate with backups + change log |
| SFID/IDs round-tripped through `Number` | Identifier corruption (precision/leading zeros) → wrong matches | Treat all identifiers as strings everywhere |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Whole-file import rejected on one bad cell | Frustrating trial-and-error on big files | Validate all, show a per-row/per-cell error report, let them fix and retry |
| Silent off-plan rejection during import | User doesn't know why rows are "missing" | Explicit "N rows rejected as off-plan (not in plan): SFID list" summary |
| Re-upload silently changes/deletes data | Lost actuals, broken trust | Pre-commit diff summary + confirmation before applying |
| Lost edits with no feedback | Data quietly wrong; team blames each other | "This row changed, reload" prompt on version conflict |
| Totals differ between grid, export, dashboard | Users stop trusting the numbers | One authoritative calc path; numeric types; consistent rounding |
| Ambiguous date display (DD/MM vs MM/DD) | Wrong execution months in reports | Display and parse explicit DD/MM/YYYY; never rely on locale defaults |
| No indication of which period/activity is active | Edits land in the wrong period | Prominent period+activity context; confirm on switch |

## "Looks Done But Isn't" Checklist

- [ ] **Off-plan guard:** demo rejects off-plan rows — verify there is a `NOT NULL` FK and *no* code path (import, bulk paste, script) can insert an execution without a plan row.
- [ ] **Plan re-upload:** first upload works — verify uploading the *same period twice* merges/diffs and does **not** delete or orphan existing actuals.
- [ ] **DB connection:** works locally — verify the app uses the **pooler** endpoint and survives two concurrent users + autosave bursts without `too many connections`.
- [ ] **Excel dates:** sample file imports — verify DD/MM/YY text, real serials, and coded date fragments all land as the correct date, and 1900/timezone edge cases don't shift months.
- [ ] **Identifiers:** SFID/GST/mobile/pin import — verify no leading-zero loss, no scientific notation, and SFIDs still match the plan.
- [ ] **Header drift:** the provided sample imports — verify a file with renamed/reordered columns is mapped correctly or rejected with a clear message (never silently misaligned).
- [ ] **Partial import:** happy path imports — verify a file that errors mid-way leaves the DB **unchanged** (transaction rollback), with a full error report.
- [ ] **Money totals:** dashboard shows a number — verify it equals the sum of grid rows to the paisa, and survives re-save without drift.
- [ ] **Concurrency:** single-user edit works — verify two simultaneous editors of different fields on the same row both persist.
- [ ] **Auth:** password gate works — verify middleware bypass is patched, no secret is `NEXT_PUBLIC_`, the cookie is signed+`httpOnly`+`Secure`, and preview/prod aren't publicly indexable.
- [ ] **Backup:** data is in Postgres — verify a documented restore path exists and a test restore actually recovers the data.
- [ ] **jsonb filters:** filters return rows — run `EXPLAIN` to confirm they use an index, and confirm no rows are silently excluded by a key/type mismatch.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Off-plan guard was app-only, off-plan data leaked in | HIGH | Add FK + UNIQUE; audit existing executions for orphan/off-plan SFIDs; quarantine and reconcile; backfill plan rows or delete bad actuals |
| Destructive re-upload wiped actuals | HIGH (LOW if backups exist) | Restore from PITR/`pg_dump`; if none, manually re-enter — switch to merge-based upload + soft delete to prevent recurrence |
| Connection exhaustion in prod | LOW | Switch connection string to pooler endpoint; set `prepare: false`; consolidate to one shared client — usually a config change, fast |
| Lost edits discovered | MEDIUM | Add version column + per-field saves; reconstruct from change log/backup if present; otherwise re-verify affected rows with the team |
| Money stored as float | MEDIUM | Migrate columns to `numeric`; recompute/round totals from source measurements; fix `Number()` usages — feasible while data volume is small |
| jsonb fields unvalidated / drifted | MEDIUM | Add validation; write a migration to normalize keys/types across existing rows; add expression indexes |
| Auth misconfig / exposure | LOW–MEDIUM | Patch Next.js, rotate the shared password + cookie secret, add server-side checks and deployment protection; assume prior exposure if it was public |
| Data lost, no backup | HIGH (often unrecoverable) | Best effort from provider snapshots if any; re-enter; institute external dumps + soft deletes immediately |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| App-only off-plan guard | Schema / data model (P1) | FK + UNIQUE present; no insert path bypasses plan_row |
| Destructive re-upload | Schema (RESTRICT) + Excel import | Uploading same period twice preserves actuals (test) |
| Connection exhaustion | Foundation / DB connection (P0) | Pooler endpoint in use; concurrent-use load check passes |
| Lost edits on shared login | Schema (version col) + Grid phase | Two-editor concurrent test; conflicting save rejected not clobbered |
| Match-key collisions | Schema + Excel import | UNIQUE on match key; zero/multi-match rejected with report |
| Excel type coercion (dates/numbers) | Excel import | Corpus of real vendor files imports with correct types |
| Header/format drift | Excel import (with config registry) | Renamed/reordered/missing columns handled correctly |
| Partial/failed import | Excel import | Mid-file error → full rollback (test) |
| Money/units as float | Schema + auto-calc/totals | `numeric` types; dashboard == sum of rows to the paisa |
| Shared-password auth exposure | Foundation / auth + pre-launch security pass | Patched Next.js; no `NEXT_PUBLIC_` secret; signed cookie; protected deploys |
| No backup / PITR | Foundation (tier choice) + data-integrity phase | Documented + tested restore; soft deletes; change log |
| jsonb misuse | Schema + Excel import | `EXPLAIN` shows index use; jsonb validated against config |
| Non-virtualized grid / per-keystroke save | Grid / actuals-entry | Smooth at a full period's rows; debounced per-field saves |

## Sources

- [Connection Pooling with Vercel Functions — Vercel Knowledge Base](https://vercel.com/kb/guide/connection-pooling-with-functions)
- [The real serverless compute to database connection problem, solved — Vercel](https://vercel.com/blog/the-real-serverless-compute-to-database-connection-problem-solved)
- [Supabase Connection Pooling with PgBouncer on Vercel Serverless](https://www.iloveblogs.blog/guides/supabase-connection-pooling-vercel)
- [Connecting to Neon from Vercel — Neon Docs](https://neon.com/docs/guides/vercel-connection-methods)
- [Postgres Connection Exhaustion with Vercel Fluid — Jökull Sólberg](https://www.solberg.is/vercel-fluid-backpressure)
- [Dates and Times — SheetJS Community Edition docs](https://docs.sheetjs.com/docs/csf/features/dates/)
- [SheetJS issue #1565 — best practice to read date type value](https://github.com/SheetJS/sheetjs/issues/1565)
- [SheetJS issue #1300 — parsing string values as dates is incorrect](https://github.com/SheetJS/sheetjs/issues/1300)
- [PostgreSQL JSONB Performance Guide: Indexing & Query Optimization — SitePoint](https://www.sitepoint.com/postgresql-jsonb-query-performance-indexing/)
- [Pitfalls of JSONB indexes in PostgreSQL — Vsevolod Solovyov](https://vsevolod.net/postgresql-jsonb-index/)
- [Indexing JSONB in Postgres — Crunchy Data](https://www.crunchydata.com/blog/indexing-jsonb-in-postgres)
- [Understanding Postgres GIN Indexes: The Good and the Bad — pganalyze](https://pganalyze.com/blog/gin-index)
- [Working with Money in Postgres — Crunchy Data](https://www.crunchydata.com/blog/working-with-money-in-postgres)
- [Floats Don't Work For Storing Cents — Modern Treasury](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)
- [PostgreSQL, Node.js and those damn floating point values — Medium](https://medium.com/developer-rants/postgresql-node-js-and-those-damn-floating-point-values-d3a39b432b03)
- [Guides: Data Security — Next.js docs](https://nextjs.org/docs/app/guides/data-security)
- [Understanding Next.js's middleware vulnerability (CVE-2025-29927) — LogRocket](https://blog.logrocket.com/understanding-next-js-middleware-vulnerability/)
- [Next.js Environment Variables: Complete Security Guide — HashBuilds](https://www.hashbuilds.com/articles/next-js-environment-variables-complete-security-guide-2025)
- [Implementing Optimistic Concurrency — Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/web-forms/overview/data-access/editing-inserting-and-deleting-data/implementing-optimistic-concurrency-cs)
- [Concurrent usage with multiple users — AppSheet Help (last-writer-wins)](https://support.google.com/appsheet/answer/10104702)
- [Virtualization Guide — TanStack Table docs](https://tanstack.com/table/v8/docs/guide/virtualization)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [Data Fetching: Server Actions and Mutations — Next.js docs](https://nextjs.org/docs/13/app/building-your-application/data-fetching/server-actions-and-mutations)
- [Next.js 16 Optimistic UI / useOptimistic rollback behavior — Nerd Level Tech](https://nerdleveltech.com/nextjs-16-server-actions-react-19-optimistic-ui-tutorial)

---
*Pitfalls research for: Excel-driven plan-vs-actual marketing compliance tracker (Next.js + Postgres on Vercel)*
*Researched: 2026-06-04*
