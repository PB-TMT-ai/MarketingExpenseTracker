# Deploying — Vercel + Supabase

This app is **local-first**: it runs on embedded PGlite with zero cloud setup. Deploying is
mostly a **config swap** — point one `DATABASE_URL` at Supabase and host on Vercel. No code change.

**Three production secrets** (set in Vercel, never committed):
| Var | What | How to get it |
|-----|------|----------------|
| `DATABASE_URL` | Supabase **pooled** connection (runtime) | Supabase → Connect → Transaction pooler (`:6543`), add `?sslmode=require` |
| `APP_PASSWORD` | the shared login password | you choose it (share with the team) |
| `SESSION_SECRET` | signs the session cookie (jose HS256, ≥32 bytes) | `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |

---

## 1. Push the repo to GitHub
Create an **empty private repo** on GitHub (no README), then from this folder:
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin master
```
`.env.local` and `.pglite/` are gitignored — secrets and local data are NOT pushed.

## 2. Create the Supabase database
1. Supabase → **New project** (pick a region near your team, e.g. Mumbai `ap-south-1`). Save the DB password.
2. Project → **Connect**. Copy two strings:
   - **Transaction pooler** (host has `-pooler`, port **`:6543`**) → this becomes `DATABASE_URL` in Vercel. Append `?sslmode=require`.
   - **Direct connection** (port **`:5432`**) → used once now, for migrations only.

## 3. Apply the migrations to Supabase
Run the bundled migrations (`drizzle/0000`, `0001`) against the **direct** (`:5432`) URL:
```bash
# PowerShell (Windows)
$env:DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres?sslmode=require"; npm run db:migrate:prod

# bash / macOS / Linux
DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres?sslmode=require" npm run db:migrate:prod
```
This creates all tables (`periods`, `plan_rows`, `executions`, `execution_items`, `item_master`)
with the off-plan FK guard. *(Alternative for a one-off: paste the contents of `drizzle/0000_*.sql`
then `drizzle/0001_*.sql` into the Supabase SQL Editor and run them in order.)*

## 4. Create the Vercel project
1. Vercel → **Add New → Project** → import the GitHub repo from step 1. Framework auto-detects as Next.js.
2. **Settings → Environment Variables** → add all three (Production scope):
   - `DATABASE_URL` = the **pooled** `:6543` string **with `?sslmode=require`**
   - `APP_PASSWORD` = your chosen password
   - `SESSION_SECRET` = the generated 48-byte value
3. **Deploy** (Vercel builds `next build` automatically).

## 5. Verify
- Open the Vercel URL → you should hit the **/login** gate.
- Enter `APP_PASSWORD` → land in the app.
- `/periods` create a period → `/plans` upload a plan → `/actuals` record an execution → Save.
  If data persists across reload, Supabase is wired correctly.

---

## Future changes (after launch)
Because deploy is **git-based**, shipping a change is just:
```bash
git push          # Vercel auto-deploys
```
If a change includes a **schema migration** (e.g. Phase 4/5):
```bash
npm run db:generate        # writes a new drizzle/NNNN_*.sql from schema.ts
# commit it, then apply to Supabase BEFORE/with the deploy:
$env:DATABASE_URL="<direct :5432 url>"; npm run db:migrate:prod
git push
```

## Notes
- **Pooler vs direct**: the app runtime uses the `:6543` transaction pooler (`prepare:false`,
  handled in `lib/db/index.ts`); migrations use the `:5432` direct connection. Don't mix them up.
- **`npm audit`**: the AG Grid install added 6 moderate (transitive) advisories — review with
  `npm audit` before/after launch; none are runtime-blocking.
- **Rotating secrets**: changing `SESSION_SECRET` invalidates all active sessions (everyone
  re-logs-in). Changing `APP_PASSWORD` changes the shared login.
