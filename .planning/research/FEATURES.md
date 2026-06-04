# Feature Research

**Domain:** Internal trade-marketing / marketing-spend execution compliance tracker (centralized data-entry + plan-vs-actual reconciliation web app; Indian retail/dealer context)
**Researched:** 2026-06-04
**Confidence:** MEDIUM-HIGH

> **Framing note.** The off-the-shelf "retail execution" / "merchandising compliance" market (SimplyDepo, Axonify, PepUpSales, planogram tools) is built around *field-mobile reps*: photo capture, GPS check-in, offline mobile apps, per-rep task assignment, AI shelf-image recognition, roles/approval chains. This project is deliberately a **different shape**: a small central team that ingests Excel plans and transcribes vendor-reported actuals into a grid, then reports compliance. So most "industry table stakes" from that market (mobile, photos, GPS, roles) are **explicitly out of scope here** and are not re-proposed. The real table stakes for *this* product are the table stakes of **spreadsheet-replacement internal tools**: trustworthy Excel import, a fast editable grid, reliable filtering, and clear plan-vs-actual rollups. Features below are scoped to that reality.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = the tool feels broken or "worse than the Excel they already have."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Template download per activity** | Users won't guess column headers for 6 different layouts; a "Download template" button is the standard first step of every import flow ("file → map → validate → submit") | LOW | Generate from the same activity config registry that drives the grid. One template per activity type. Pre-fill header row + maybe 1 example row. Eliminates most import failures at the source. |
| **Header validation on upload** | Wrong/missing/extra columns are the #1 cause of bad imports; users expect "this column is missing" not a silent partial load | MEDIUM | Validate against the activity's expected header set. Tolerate column reordering and trailing blank columns; fail loudly on missing required columns. Trim/normalize whitespace and case in headers. |
| **Preview-before-commit** | Users must see "here's what will be imported, here's what's wrong" before mutating data — committing blind is the cardinal sin of import UX | MEDIUM | Show parsed rows, row count, and a per-row validation status (OK / warning / error). Nothing is written until the user confirms. Depends on header validation. |
| **Per-row import error reporting** | "Import failed" with no detail is unusable; users expect row N, column X, reason | MEDIUM | Categorize: hard errors (block that row), warnings (allow but flag). Let the user proceed with valid rows or cancel. Surface off-plan rows here for actuals imports (see off-plan guard). |
| **Off-plan guard on actuals** | This is the product's **Core Value**. An actual recorded against an SFID not in the plan must be rejected/flagged | MEDIUM | Enforced structurally (execution FK → plan_row). On Excel actuals import, match on (activity, period, SFID); no match = rejected as off-plan and reported in the preview. On in-grid entry, off-plan rows simply can't be created. |
| **Inline cell editing in the grid** | The whole point is "spreadsheet feel"; click a cell, type, move on | MEDIUM | Provided largely out-of-box by the chosen grid (Glide Data Grid / react-data-grid). Keyboard navigation (arrows, tab, enter) is part of the expectation, not a bonus. |
| **Paste from Excel into the grid** | The team lives in Excel; vendors send Excel; pasting a block of cells is how data actually arrives | MEDIUM | Tab-separated paste into a cell range is supported by react-data-grid (MIT) and Glide. Must respect locked plan columns (paste into editable actual columns only) and the activity's column types. High real-world value. |
| **Locked / read-only plan columns** | Plan data is the approved source of truth; users must not accidentally overwrite Region/SFID/Dealer/Plan-SqFt while filling actuals | LOW | Mark plan-origin columns non-editable in the grid config. Cheap, and prevents a whole class of data-integrity bugs. |
| **Status dropdown (enum cell)** | Status is categorical (e.g. Done / Pending / In-progress); free text creates dirty data and breaks rollups | LOW | Dropdown/select cell driven by activity config. Constrains values so completeness % and filters stay clean. |
| **Auto-calculated totals (sq ft, total cost)** | Listed as an explicit requirement; hand-calculating L×B or qty×rate defeats the purpose and invites arithmetic errors | MEDIUM | Compute derived cells (Total Sq Ft = L×B, Total Cost = sqft×rate, line total = qty×rate) reactively as inputs change. Derived cells should be read-only. Currency in ₹, Indian formatting. |
| **Filter by Region / State / District / Distributor / Status** | Explicit requirement; a national dealer dataset is unusable without slicing it | MEDIUM | These are real indexed columns (per schema decision) → fast dropdown facets. Multi-select within a facet, AND across facets is the conventional behavior. |
| **Search by SFID (and dealer name)** | SFID is the key; users will paste a specific SFID to find one dealer's row instantly | LOW | Simple text/contains search box scoped to the current activity+period. SFID exact-match plus dealer-name contains covers the common cases. |
| **Period scoping (month / qtr / FY)** | Explicit requirement; plans and actuals are per-period and must never bleed across periods | MEDIUM | A period selector is effectively a mandatory top-level filter; the grid and dashboard always operate within one selected period+activity. |
| **Compliance dashboard: % plan executed + counts** | This is the headline metric and an explicit requirement; without it the tool is just data entry | MEDIUM | % executed = executed rows / planned rows. Show planned / executed / pending counts. Break down by activity and by region. Keep the math definition unambiguous and documented. |
| **Spend rollups (by activity, by region)** | Explicit requirement; "how much have we spent" is half the value | MEDIUM | Sum total-cost across rows, grouped by activity and region, within the selected period. ₹ formatting, thousands separators (Indian or standard). |
| **Multi-item entry for POP / Dealer Kit** | Explicit requirement; POP/kit is inherently 1 dealer → N line items (item, qty, rate, total) | MEDIUM | Modal/popup per parent row containing a small line-item subgrid with add/remove rows and qty×rate=line total, summed to a parent total. Standard "invoice line items" pattern. Child table in schema. |
| **Filtered Excel export** | Explicit requirement; the team must hand reports/data back out in Excel — the round-trip is the workflow | MEDIUM | Export *exactly what's currently filtered/visible*, not the whole dataset (this is the expected behavior and a frequent source of complaints when violated). SheetJS `xlsx`. Apply ₹/number formats via the `z` property (supported in Community Edition — verified). |
| **Shared-password gate** | Explicit requirement; the app holds commercial spend data and must not be open on the public internet | LOW | Middleware checks env-var password, sets a signed cookie. Already a Key Decision. |
| **Visible "dirty / unsaved changes" state + explicit save** | Editable grids that silently lose edits on navigation are a notorious footgun; users expect to see what's unsaved and to save deliberately | MEDIUM | Batch-save model: edits accumulate as dirty rows with a visible indicator; a Save button commits them; warn on navigate-away with unsaved changes. See Anti-Features for why pure autosave is risky here. |
| **Empty / loading / error states** | A blank screen on "no plan uploaded yet" or a silent failure reads as "broken" | LOW | First-run guidance ("Upload a plan to begin"), loading skeletons on the grid, and human-readable error toasts. Cheap polish that determines whether the tool feels finished. |

### Differentiators (Competitive Advantage)

Features that make this meaningfully better than the spreadsheet it replaces. Aligned with Core Value: *spend stays inside the plan, execution progress always visible.* Most are **v1.x**, not v1 — listed so requirements knows the upgrade path.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Off-plan rejections shown as a reviewable list** | Turns the guard from a silent block into an insight: "these 12 actuals from the field reference dealers not in the plan — investigate" | LOW | A small report/section listing rejected off-plan rows from the last import with their SFIDs. High value, low cost, directly reinforces Core Value. Strong v1 candidate. |
| **Period-over-period comparison** | "Are we executing faster than last quarter?" — context that a single-period view can't give; explicitly flagged as enabled by per-period design | MEDIUM | Compare completeness % / spend across two selected periods. Defer to v1.x: needs ≥2 periods of real data to be meaningful, so it can't be validated at launch anyway. |
| **Saved filter views** | Power users re-run the same Region+Status slice constantly; saving it removes repetitive clicking | MEDIUM | Even encoding filter state in the URL (shareable/bookmarkable, survives back-button) is a cheap 80% version; named saved views are the fuller form. URL-state is a strong v1 inclusion; named views are v1.x. |
| **Completeness drill-down** | Click "62% executed" → see exactly which planned rows are still pending | MEDIUM | Dashboard tile links into a pre-filtered grid (Status = pending). Makes the headline number actionable instead of just informative. |
| **Config-driven activities (7th activity = data change)** | Already a Key Decision and a genuine differentiator vs hardcoded competitors: adding an activity type is config, not a release | MEDIUM | One grid engine + template generator + validator all read the activity registry. This is architecture, but its *user-visible payoff* (fast new activity types) is a differentiator worth stating. |
| **Bulk status update on filtered selection** | "Mark these 40 filtered rows as Done" in one action beats editing 40 cells | MEDIUM | Select-all-in-filter → set status. Pairs with filtering. Useful but defer to v1.x — adds selection-model complexity and is only valuable once data volume is real. |
| **Import-time fuzzy column matching** | Vendors rename headers ("Sq.Ft" vs "Plan Sq Ft"); auto-suggesting a mapping reduces failed imports | MEDIUM | A column-mapping step (auto-match + manual override) is the "nice" version of header validation. v1 can ship strict validation; mapping is the v1.x upgrade when header drift becomes a real pain. |
| **Per-activity / per-region budget vs actual** | If a planned budget figure exists, "spent ₹X of ₹Y planned (Z%)" is richer than spend alone | MEDIUM | Only viable if plans carry a planned-cost/budget column. Note: compliance is *completeness*, not cost-tolerance (locked decision) — so this is a reporting enrichment, **not** a pass/fail mechanism. Defer; confirm data availability first. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem obviously good but add disproportionate complexity or contradict the locked scope. Documenting them prevents scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Per-user accounts, roles, approval chains** | "Standard" for business apps; audit trails feel responsible | Explicitly out of scope: small trusted team shares one password. Auth/roles/approvals is a large, cross-cutting subsystem that would dominate v1 for near-zero value here | Shared-password gate (already decided). Revisit only if the team grows or external auditors require attribution. |
| **Photo / proof-image upload & gallery** | Every retail-execution competitor has it; "proof of execution" sounds essential | Explicitly out of scope: storage, image handling, mobile capture, and review UI are a milestone of their own. The team currently transcribes vendor data centrally | Defer (already decided). Team can paste a link in Remarks if absolutely needed before native upload lands. |
| **Field-mobile capture with auto-GPS** | The whole external market assumes reps in stores with phones | Explicitly out of scope: this team enters data centrally; lat/long are *pasted in* from what vendors send. Building offline mobile + GPS is a wrong-shaped, huge effort | Keep lat/long as plain pasteable text columns (already the model). No map, no geofencing, no mobile app. |
| **Live Salesforce / CRM / ERP sync** | "SFID" implies Salesforce; integrations look professional | Explicitly out of scope: SFID is a *key only*. Live sync means API auth, rate limits, field mapping, conflict resolution, and ongoing breakage — enormous surface for v1 | SFID stays a plain matching key. If sync is ever wanted, it's a dedicated future milestone. |
| **Compliance based on sq-ft / cost tolerance vs plan** | "Did they paint the full planned area / stay in budget?" feels like real compliance | Explicitly out of scope: compliance = off-plan guard + completeness only. Tolerance rules add a config/threshold engine and a pass/fail UI the team didn't ask for. Sq ft & cost are captured for *spend totals*, not pass/fail | Keep sq ft/cost as spend metrics. Show the numbers; don't grade them. (Budget-vs-actual *reporting* is fine as a differentiator — just not as compliance.) |
| **Real-time collaborative grid editing (multi-cursor)** | "Google Sheets does it"; multiple people editing at once sounds modern | Massive complexity (CRDT/OT, presence, conflict UI) for a small team that mostly edits sequentially. Concurrent-edit conflict handling alone is a research project | Batch-save with a dirty-state indicator and last-write-wins on a per-row save. If two people genuinely collide, that's rare; a simple "row changed since you loaded it" check is the most that's warranted, and even that is v1.x. |
| **Pure autosave (save every keystroke/blur)** | "Users never lose work"; feels seamless | For grid editing specifically this is a known footgun: partial/invalid intermediate states get persisted, derived totals churn, and there's no clean "commit" boundary for validation or for the off-plan guard. Documented industry pain | Explicit batch save + visible dirty state + navigate-away warning (listed in table stakes). Validate and compute totals at save time. |
| **General-purpose report builder / pivot UI** | "Let users build any report they want" | Huge UI surface; almost always under-used. The team has a fixed, known set of questions (% executed, spend by activity/region) | Ship the 3–4 fixed dashboard views that answer the actual questions. Filtered Excel export covers ad-hoc analysis in the tool they already know (Excel). |
| **Richly *styled* Excel export (fonts/borders/fills/colors)** | "Make the export look like our branded report" | SheetJS Community Edition supports number/currency formats (`z`) but **not** cell styling — that needs the `xlsx-js-style` fork or paid SheetJS Pro (verified against SheetJS docs). Chasing pixel-perfect styling means a dependency change or licensing cost for cosmetic gain | Export clean, correctly-typed data with ₹/number formats (Community Edition handles this). If branded styling is later required, evaluate `xlsx-js-style` as a deliberate v1.x decision, not an assumed v1 capability. |
| **In-app activity-config editor (admin UI to define activities)** | "Let admins add a 7th activity from the UI" | The Key Decision is that activities are a *typed config registry* — adding one is a code/data change by a developer, which is fine for this team. A full config-editing UI (column types, validation rules, template gen) is a product unto itself | Edit the typed config in code and redeploy (Vercel makes this trivial). The open/closed payoff is real without building an editor. |
| **Hard delete with no recovery / no soft-delete thought** | "Just delete the row" | Spend data is commercially sensitive; an accidental delete of plan rows (which actuals FK to) can cascade or orphan data | At minimum guard destructive actions with confirmation; prefer soft-delete or "clear actuals vs delete plan row" semantics. Keep simple, but don't make deletes silent/irreversible. (Low-effort safeguard, not a feature build.) |
| **Notifications / email alerts on thresholds** | "Alert me when a region falls behind" | Adds scheduling, email infra, and threshold config for a team that opens the dashboard themselves daily | The dashboard *is* the alert. Defer push notifications until there's a demonstrated "I missed it because I didn't log in" problem. |

## Feature Dependencies

```
Activity config registry (architecture)
    ├──drives──> Template download (per-activity headers)
    ├──drives──> Header validation (expected columns)
    ├──drives──> Grid columns + cell types (editable/locked/dropdown/derived)
    └──drives──> Filtered Excel export (column order/formats)

Plan upload (Excel)
    └──requires──> Header validation
                       └──requires──> Preview-before-commit
                                          └──requires──> Per-row error reporting
    └──establishes──> Allowed-SFID master list (per activity+period)
                          └──enables──> Off-plan guard
                                            └──enhances──> Off-plan rejections list (differentiator)

Editable grid
    ├──requires──> Locked plan columns (data integrity)
    ├──requires──> Status dropdown (clean enums)
    ├──requires──> Auto-calc totals (derived cells)
    ├──requires──> Dirty-state + explicit save (don't lose edits)
    └──enhanced by──> Paste-from-Excel

Filtering (Region/State/District/Distributor/Status) + SFID search
    ├──requires──> Indexed shared columns (schema)
    ├──enhances──> Filtered Excel export (export = current filter)
    ├──enhances──> Completeness drill-down (click metric → filtered grid)
    └──enhanced by──> Saved filter views / URL state (differentiator)

Period scoping (month/qtr/FY)
    ├──scopes──> Grid, Filters, Dashboard, Off-plan matching
    └──enables──> Period-over-period comparison (differentiator)

Compliance + spend dashboard
    ├──requires──> Status data (from grid) for % executed
    ├──requires──> Total-cost data (from auto-calc) for spend rollups
    └──requires──> Period scoping

POP / Dealer-Kit multi-item entry
    ├──requires──> Child line-item table (schema)
    ├──requires──> Managed item-name list
    └──contributes──> line totals → parent total → spend rollups

Real-time collaboration  ──conflicts with──> Batch-save dirty-state model
Pure autosave            ──conflicts with──> Validation/off-plan commit boundary
```

### Dependency Notes

- **Everything import-side requires the activity config registry.** Templates, header validation, grid column definitions, and export formatting all read from one source of truth. Build the registry first; it's the spine. (This is also why it's both architecture *and* a differentiator.)
- **Off-plan guard requires a committed plan first.** The plan upload must establish the allowed-SFID set (per activity+period) before any actuals can be matched or rejected. Plan ingestion strictly precedes actuals ingestion in build order.
- **Preview-before-commit sits on top of header + per-row validation.** You cannot show a meaningful preview without first parsing and validating, so these three ship together as one import pipeline, not separately.
- **Dashboard depends on clean grid data.** % executed needs a constrained Status enum; spend rollups need reliable auto-calculated totals. Garbage-in (free-text status, hand-typed totals) breaks the headline metrics — which is why the status dropdown and auto-calc are table stakes, not nice-to-haves.
- **Filtered export depends on filtering semantics being settled.** "Export = exactly the current filtered view" must be the agreed contract before export is built, or it'll be reworked.
- **Real-time collaboration conflicts with the batch-save model**, and **pure autosave conflicts with the validation/off-plan commit boundary** — these aren't just deferred, they're architecturally incompatible with the chosen save model. Don't combine them in any phase.
- **Period-over-period comparison can't be validated at launch** — it needs ≥2 periods of real data, so it's structurally a post-launch feature regardless of priority.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate *"spend stays inside the plan, execution progress always visible."* This maps 1:1 to the locked Active requirements in PROJECT.md.

- [ ] **Activity config registry** (6 activities; type: measurement / item-list / status) — the spine everything else reads from
- [ ] **Per-activity plan upload** with template download, header validation, preview-before-commit, per-row error reporting — establishes the allowed-SFID master list
- [ ] **Off-plan guard** on both Excel-actuals import and in-grid entry — the Core Value, enforced structurally
- [ ] **Editable grid** with inline edit, paste-from-Excel, locked plan columns, status dropdown, auto-calc totals, and dirty-state + explicit save — the daily workspace
- [ ] **Filtering** (Region/State/District/Distributor/Status) + **SFID/dealer search** — usable on a national dataset
- [ ] **Period scoping** (month/qtr/FY) keeping each period's plan+actuals separate
- [ ] **Compliance + spend dashboard** — % plan executed, planned/executed/pending counts, spend by activity and region
- [ ] **POP / Dealer-Kit multi-item entry** popup (line items: item × qty × rate → total) with managed item-name list
- [ ] **Filtered Excel export** (current view, ₹/number formats via SheetJS Community)
- [ ] **Shared-password gate**
- [ ] *(Recommended low-cost adds, strongly aligned to Core Value:)* **Off-plan rejections list** after import, and **URL-encoded filter state** (shareable, back-button-safe)

### Add After Validation (v1.x)

Add once the core loop (upload → fill → report → export) is confirmed valuable.

- [ ] **Named saved filter views** — trigger: users repeatedly rebuild the same slices (URL-state ships in v1; named views are the upgrade)
- [ ] **Period-over-period comparison** — trigger: ≥2 periods of real data exist (cannot be validated before then)
- [ ] **Completeness drill-down** from dashboard tiles into a pre-filtered grid — trigger: users ask "which rows are pending?"
- [ ] **Bulk status update** on a filtered selection — trigger: data volume makes per-cell editing tedious
- [ ] **Import column-mapping / fuzzy header matching** — trigger: vendor header drift causes repeated import failures
- [ ] **Budget-vs-actual reporting** (spend vs planned cost) — trigger: confirmed that plans carry a planned-cost column (reporting only; never compliance pass/fail)

### Future Consideration (v2+)

Defer until product-market fit / a real demonstrated need; several are explicitly out of scope today.

- [ ] **Photo / proof-image upload** — defer (already out of scope); its own milestone
- [ ] **Per-user accounts / roles / approval chains** — defer (already out of scope); only if team grows or audit attribution is required
- [ ] **Live Salesforce / ERP sync** — defer (already out of scope); dedicated integration milestone
- [ ] **Threshold notifications / email alerts** — defer until "I missed it" is a real reported problem
- [ ] **Richly styled Excel export** — defer; requires `xlsx-js-style`/Pro, deliberate dependency decision
- [ ] **In-app activity-config editor** — defer; config-in-code + redeploy is sufficient for this team
- [ ] **Field-mobile / GPS capture** — defer (already out of scope); wrong shape for a central-entry team

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Activity config registry | HIGH | MEDIUM | P1 |
| Plan upload + validation + preview | HIGH | MEDIUM | P1 |
| Off-plan guard | HIGH | MEDIUM | P1 |
| Editable grid (inline + locked + dropdown + auto-calc) | HIGH | HIGH | P1 |
| Paste-from-Excel into grid | HIGH | MEDIUM | P1 |
| Dirty-state + explicit save | HIGH | MEDIUM | P1 |
| Filtering + SFID search | HIGH | MEDIUM | P1 |
| Period scoping | HIGH | MEDIUM | P1 |
| Compliance + spend dashboard | HIGH | MEDIUM | P1 |
| POP / Dealer-Kit multi-item entry | HIGH | MEDIUM | P1 |
| Filtered Excel export | HIGH | MEDIUM | P1 |
| Shared-password gate | HIGH | LOW | P1 |
| Off-plan rejections list | HIGH | LOW | P1/P2 |
| URL-encoded filter state | MEDIUM | LOW | P1/P2 |
| Completeness drill-down | MEDIUM | MEDIUM | P2 |
| Named saved filter views | MEDIUM | MEDIUM | P2 |
| Period-over-period comparison | MEDIUM | MEDIUM | P2 |
| Bulk status update (filtered) | MEDIUM | MEDIUM | P2 |
| Import column-mapping / fuzzy headers | MEDIUM | MEDIUM | P2 |
| Budget-vs-actual reporting | MEDIUM | MEDIUM | P2/P3 |
| Photo upload | (out of scope v1) | HIGH | P3 |
| Roles / accounts | (out of scope v1) | HIGH | P3 |
| Live SF/ERP sync | (out of scope v1) | HIGH | P3 |
| Styled Excel export | LOW | MEDIUM | P3 |
| Threshold notifications | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have / future consideration

## Competitor Feature Analysis

> These are *external retail-execution suites*, included for contrast — not direct competitors. They validate that this project is intentionally a different (narrower, central-entry) shape, and that copying their feature set would violate the locked scope.

| Feature | Field-rep suites (SimplyDepo / Axonify / PepUpSales) | Spreadsheet / budget templates (Asana, Excel BvA) | Our Approach |
|---------|------------------------------------------------------|---------------------------------------------------|--------------|
| Data capture | Mobile app, offline, in-store | Manual cells in a shared sheet | **Central web grid + Excel import** (no mobile) |
| Proof of execution | Photos + AI shelf recognition | None | **Deferred** (paste link in Remarks if needed) |
| Location | GPS check-in / geofencing | None | **Pasted lat/long text** (no map) |
| Access control | Per-rep roles + approval chains | File sharing perms | **Single shared password** |
| Compliance definition | Planogram match %, photo deviation by SKU | Budget vs actual variance | **Off-plan guard + completeness %** (not cost/size tolerance) |
| Plan vs actual | Reset-from-actuals, real-time | Manual variance columns | **Plan = locked master; actuals reconciled against it** |
| Reporting | Real-time dashboards, predictive/AI | Static charts | **Fixed dashboard: % executed + spend by activity/region**, filtered Excel export |
| Extensibility | Configurable forms (vendor-controlled) | Add columns manually | **Typed config registry: 7th activity = data change, not a release** |
| Integration | ERP/CRM/HRMS sync | Manual export/import | **SFID as a key only; no live sync in v1** |

## Sources

Retail-execution / merchandising compliance market (contrast — shows the field-mobile shape this project deliberately avoids):
- [Top 10 retail execution software compared for 2026 — Axonify](https://axonify.com/blog/retail-execution-platforms/)
- [10 Best Retail Execution Monitoring Software — SimplyDepo](https://simplydepo.com/industry/retail-execution-monitoring-software/)
- [Visual Merchandising Software for In-Store Audits — PepUpSales](https://www.pepupsales.com/retail-execution-n-merchandising.php)
- [What Is Planogram Compliance? — Vision Group Retail](https://visiongroupretail.com/blog/planogram-compliance-how-to-measure-it-and-improve-shelf-execution)
- [Best Compliance Tracking & Monitoring Software — Atlas Systems](https://www.atlassystems.com/blog/best-compliance-tracking-software)

Excel/CSV import UX (table-stakes import pipeline: file → map → validate → submit):
- [Data import UX: designing spreadsheet imports users don't hate — ImportCSV](https://www.importcsv.com/blog/data-import-ux)
- [Best UI patterns for file uploads — CSVBox](https://blog.csvbox.io/file-upload-patterns/)
- [Build A Seamless Spreadsheet Import Experience With Flatfile — Smashing Magazine](https://www.smashingmagazine.com/2019/11/flatfile-seamless-spreadsheet-import-experience/)

Editable data grid capabilities & save model (inline edit, paste, dirty rows, batch vs autosave):
- [React Data Grid — High Performance Excel-like Grid](https://awesome-react.dev/library/react-data-grid)
- [Data Grid — Editing recipes — MUI X](https://mui.com/x/react-data-grid/recipes-editing/)
- [Dynamics 365: Editable grids and autosave (autosave footgun) — It Ain't Boring](https://www.itaintboring.com/dynamics-crm/dynamics-365-is-it-a-bug-or-a-feature/)
- [Data Table Design UX Patterns & Best Practices — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)

Filtering / saved views / URL state:
- [Filter UX Design Patterns & Best Practices (enterprise) — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering)
- [Ecommerce Filter UI Best Practices — Baymard](https://baymard.com/learn/ecommerce-filter-ui)

Multi-item / line-item entry pattern (POP / dealer-kit modal):
- [Invoice Line Items Explained — Lido](https://www.lido.app/blog/invoice-line-item)
- [Building an Invoice Table with Subgrid — Steve Kinney](https://stevekinney.com/courses/tailwind/building-an-invoice-table)
- [Modal UX design: Patterns, examples, best practices — LogRocket](https://blog.logrocket.com/ux-design/modal-ux-design-patterns-examples-best-practices/)

Plan-vs-actual / spend dashboards:
- [Budget vs Actual: Best Practices for Tracking Spend — b2bplanr](https://blog.b2bplanr.com/post/budget-vs-actual-tracking)
- [Marketing Budget Template — Asana](https://asana.com/templates/marketing-budget)
- [Trade Spend Analysis & Reporting — Vividly](https://www.govividly.com/trade-spend-analysis)

SheetJS export capabilities (number/currency formats vs styling — HIGH confidence, official docs):
- [Number Formats — SheetJS Community Edition docs](https://docs.sheetjs.com/docs/csf/features/nf/) (currency/number formats via `z` are supported in CE)
- [xlsx-js-style — GitHub](https://github.com/gitbrent/xlsx-js-style) (fork required for fonts/borders/fills/colors)

Lean MVP / scope-creep discipline (anti-features rationale):
- [Managing Scope Creep with Lean Software Requirements — GatherSpace](https://www.gatherspace.com/managing-scope-creep-with-lean-software-requirements/)
- [Landing Page to MVP: The Lean Path — Valtorian](https://www.valtorian.com/blog/landing-to-mvp)

---
*Feature research for: internal trade-marketing execution compliance tracker (central-entry, Excel round-trip)*
*Researched: 2026-06-04*
