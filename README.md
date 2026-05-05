# InsightBoard — A Mini Data Query & Visualization Platform

InsightBoard is a self-contained, full-stack analytics tool. A user uploads a CSV file, the platform automatically profiles its columns, and the user can then build aggregations and visualizations through a guided, drag-and-drop Query Builder — without writing a single line of SQL. Multiple charts assemble into dashboards, and a simulated multi-user system enforces three permission roles (admin, editor, viewer) so that the surface a user sees changes with the role they hold. The product is intentionally narrow in scope: it focuses on doing the *core* analyst loop — connect, query, visualize, share — really well, rather than spreading thin across half-built features.

---

## Stack

- **Backend:** Python 3.11+, FastAPI, Pandas, Pydantic v2, aiosqlite, uvicorn
- **Frontend:** Vanilla HTML5, CSS3, ES6 JavaScript modules — **no React, no build step**, Chart.js loaded from CDN
- **Database:** SQLite (via aiosqlite) for metadata; raw CSV data lives as in-memory Pandas DataFrames

The original brief suggested React + Node.js + TypeScript. I made an explicit, conscious deviation: Pandas + FastAPI lets the *interesting* part of the problem — query execution and aggregation over 1000+ row CSVs — be solved in three or four lines of Pandas instead of hand-rolling a SQL-like execution engine in Node.js. The frontend deliberately uses no framework so that everything you read in `frontend/js/` is the actual code that runs — there is no compiled bundle hiding behind it. This makes the architecture extremely easy to audit and reason about.

## Requirements & how to run

The full Python dependency list lives in `requirements.txt`. From a clean clone:

```bash
cd insightboard
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Then open <http://localhost:8000>.

The seed runs automatically on first boot. Five simulated users and one default dashboard are inserted into SQLite. Switch between users with the dropdown in the top-right of the page — the entire UI re-applies permissions instantly. To re-seed from scratch, delete `backend/data/insightboard.db`.

### Project layout

```
insightboard/
├── backend/
│   ├── main.py              # FastAPI app + static frontend serving
│   ├── database.py          # SQLite schema + seed data + audit log helper
│   ├── models/schemas.py    # Pydantic request/response models
│   ├── services/
│   │   ├── csv_engine.py    # Pandas-based profiling + query execution
│   │   ├── cache.py         # MD5-keyed query cache (300s TTL)
│   │   ├── permissions.py   # Role -> permission set lookup
│   │   ├── auth.py          # X-User-Id header dependency
│   │   └── profiler.py      # Re-exports for clarity
│   ├── routers/             # users, datasources, queries, dashboards, charts
│   └── data/                # SQLite db + uploaded CSVs (auto-created)
└── frontend/
    ├── index.html
    ├── css/                 # base, layout, components, dashboard, query-builder
    └── js/
        ├── app.js           # Hash router + theme + keyboard shortcuts
        ├── utils/           # api wrapper, reactive store, toast, title generator
        └── modules/         # userSwitcher, datasource, queryBuilder,
                             # chartRenderer, dashboard, users, permissions
```

### Verifying it works

```bash
# upload sample CSV as the admin user
curl -H "X-User-Id: user_1" -F "file=@sample.csv" http://localhost:8000/api/datasources/upload

# run a query
curl -X POST -H "Content-Type: application/json" -H "X-User-Id: user_1" \
  -d '{"datasource_id":"<id>","dimensions":[{"column":"product","alias":"product"}],
       "metrics":[{"column":"revenue","aggregation":"SUM","alias":"sum_revenue"}],
       "filters":[],"limit":100}' \
  http://localhost:8000/api/queries/execute

# attempting to aggregate a text column returns 400 with a helpful message
# attempting to upload as a viewer (user_4 / user_5) returns 403
```

---

## Feature summary

- **CSV upload with automatic column profiling.** Type detection (numeric / date / string), role inference (dimension vs metric), null %, unique count, top values, histograms, suggested explorations, and dataset health checks.
- **Visual Query Builder.** A slide-in panel with a 3-step indicator, a typed column picker that strictly separates dimensions from metrics, drag-and-drop shelves with live shake-and-reject feedback when columns are dropped on the wrong shelf, six aggregations, filters, sorting, a 500ms-debounced live preview, and a plain-English summary that updates as you build.
- **Five chart types.** Bar, line, pie/donut, scatter, table, and KPI — each with sensible defaults (rounded bars, gradient fills under lines, donut center totals, K/M-formatted axes, dark tooltips, and a recommendation engine that picks the best fit for the result shape).
- **Dashboards.** Multiple dashboards per workspace, drag-to-reorder, resizable cards, inline title editing, fullscreen view, PNG/CSV export, and a friendly empty state.
- **Permissions.** Mirror-implemented on backend (enforced) and frontend (gated UI). Admins manage users and see the audit log; editors create/edit only their own; viewers read only and see a persistent banner reminding them their filters are temporary.
- **Caching.** A 300-second query cache keyed by an MD5 hash of the canonicalized query spec, automatically invalidated when its source dataset is deleted.
- **Audit log.** Every meaningful action (upload, query, chart create/edit/delete, role change) is recorded with user attribution and timestamp.
- **Undo-on-delete.** Deleting a chart pops a toast with an "Undo" action button for six seconds; clicking it restores the chart from a captured snapshot.
- **Smooth, responsive UI.** 300ms slide animations on the Query Builder, slide-in chart cards, hover lifts, KPI summary cards, and a layout that collapses to single column under 1200px and to an icon-only sidebar under 900px.

---

## Product Thinking — the five questions

### 1. How do you balance flexibility versus simplicity?

The Query Builder is the place where this question is most visible, because power users want SQL-level expressiveness while beginners just want to drag two columns onto a screen and see a chart. My approach was to use **strict typing as the safety rail and rich guidance as the on-ramp**, both at once. The column picker is split into clearly labelled DIMENSIONS and METRICS sections, color-coded, before the user ever sees the shelves below. The shelves themselves *physically refuse* a wrong-typed drop — a metric chip dragged onto the dimensions shelf shakes red and pops a tooltip — and the backend independently enforces the same rule with a 400 response, so the rules are not just visual. On top of that, a live "plain English" sentence builds itself over the user's choices ("Show the total revenue for each product where region = North"), turning the query into something a non-technical user can verify by reading aloud. Power, meanwhile, is preserved through six aggregations, all comparison operators, sorts, and a 5000-row limit slider. The UI layers these so beginners never see the complexity unless they go looking for it: filters and sort are collapsed sections under the shelves, not part of the primary flow. The principle I'm following: *progressive disclosure with hard guardrails*. The defaults must be safe; advanced controls must exist; and the system must protect the user from themselves at the lowest possible layer (the database, then the API, then the UI).

### 2. What happens when the underlying data changes?

Data change is treated as a first-class lifecycle event rather than something to retrofit. When an admin deletes a datasource, three things happen atomically: the file is removed from disk, the in-memory DataFrame is unloaded, and every chart that referenced that datasource is updated in SQLite to `status='broken'` with a human-readable `broken_reason`. Every query cache entry tagged with that datasource is also invalidated. The next time a dashboard is loaded, those broken charts render with an amber-bordered, friendly explanation card offering "Edit Chart" and "Remove Chart" instead of a blank red error — the user never sees a stack trace. When a user re-uploads or fixes the underlying issue and edits a broken chart's query spec, the backend automatically flips its status back to `active` and clears `broken_reason`. For column-level changes (a column gets renamed, or its type is overridden from metric to dimension), I made the explicit choice to *not* silently rewrite the affected charts, because I think guessing the user's intent across schema drift is dangerous. Instead, the chart breaks loudly, and a future enhancement could add a "Re-link Column" wizard. This trades automation for safety, which I think is the correct tradeoff for a tool that surfaces dollar-denominated numbers to humans.

### 3. Performance — should aggregations run client-side or server-side?

Server-side, without much ambiguity for this product. The largest CSV one user can upload is bounded (currently 100 MB), but the data is shared across all users in a workspace, so caching one server-side query result serves N concurrent dashboard viewers, while client-side aggregation would re-do that work in every browser. Pandas in Python is also significantly faster at groupby/agg over a million rows than naive JavaScript loops, and offloading it preserves UI responsiveness — the browser never has to ship a 50 MB DataFrame across the wire. The result of a typical aggregated query is small — usually a few dozen rows — which is what gets sent to the client. To keep this fast under load I added (a) a 300-second TTL query cache keyed by the MD5 of the canonical query spec, (b) lazy reload of CSVs from disk so server restarts don't lose state, (c) `dropna=False` in groupby to avoid silent row loss, and (d) a debounced 500ms live-preview in the Query Builder so the API is not pummeled while a user is still dragging chips around. The one place I deliberately do client-side work is sorting in rendered tables (clicking a column header re-sorts within the already-fetched 1000 rows) and chart-type recommendation post-processing — both cheap operations on already-summarized data.

### 4. Error recovery when a user deletes the data their charts depend on

This is partially answered above, but it is worth stating the philosophy: **a broken state is a state, not an error.** A chart that has lost its datasource is not deleted, it is not blank, and it certainly does not render an exception to the user — it transitions into a recognized `broken` state with a `broken_reason`, and its card UI shifts to a calm amber-toned panel that names the problem ("Chart Unavailable — column 'revenue' no longer exists in the connected dataset.") and offers two clear next actions. The audit log records the deletion that caused this, so an admin investigating *why* a previously working dashboard broke at 3am has the trail. Beyond that, ordinary destructive actions in the UI use undo-with-toast: when an editor deletes a chart, the success toast contains an "Undo" button for six seconds that re-creates the chart from its full snapshot. This is the cheapest, lowest-friction way to make destructive operations feel safe, and it removes the need for a confirmation dialog in many places — confirmation dialogs are friction users learn to ignore, while undo is forgiveness users actively appreciate.

### 5. Collaborative editing — two editors modify the same chart

I deliberately did not build operational-transform-style real-time collaboration; in 6–10 hours that's a feature that will eat the schedule and end up half-broken. What I did do was put in the *plumbing* that a future collaboration story can sit on. Every chart row carries a `version` integer that increments on every PATCH. Every meaningful mutation writes an audit log entry with the user's id, the action, the resource, and a timestamp. Permission checks are done per-action on the backend and re-checked on the frontend. Together this means a future enhancement can (a) reject a PATCH whose `If-Match: version=N` header is stale, returning the latest version and asking the client to merge — last-writer-wins, but with a visible warning rather than silent data loss, and (b) show "User 2 is also editing this chart" by reading recent audit log entries. For the current scope, when two editors edit the same chart, the second save overwrites the first cleanly; the audit log preserves both events so nothing is invisible. This is "last write wins, fully observable" — a defensible default that is honest about its tradeoff.

---

## Why each major feature is the way it is

The **3-step indicator** at the top of the Query Builder exists because user research on similar tools consistently shows that drag-and-drop builders without progress affordances feel "endless" — users don't know how far they are from done. Numbering the steps and turning each into a checkmark when complete is small but disproportionately reassuring.

The **plain English summary box** addresses a different fear: "did I just build the right query?" Reading "Show the average quantity for each region where region is not Empty" is something a non-technical stakeholder can validate without knowing what AVG or GROUP BY means. It also acts as a free QA tool for the engineer: if the sentence reads wrong, the query is wrong.

The **strict shelf typing** (with shake-on-reject) was added after observing that the *first* version of this product happily accepted text columns into the metrics shelf, generated nonsense queries like `SUM(product)`, and rendered charts with all-zero Y-axes. The fix had to be at three layers — the column picker visually separates the two types, the drop handler refuses cross-type drops, and the backend rejects them with a 400 if the client somehow gets around the UI. Defense in depth.

The **broken chart state with friendly recovery** exists because I wanted the dashboard to feel like a calm tool even when the data underneath has changed. Showing a stack trace inside a chart card is hostile; showing "Chart Unavailable, here's what happened, here's what to do" is welcoming.

**Undo-on-delete** was added because confirmation dialogs are friction; a 6-second forgiveness window inside the success toast is what people actually want. It is also the cheapest way to make destructive operations *feel* safe without polluting the UI with prompts.

---

## What I would do differently with more time

A few things rank above the rest. First, I would replace the simulated user system with real authentication and per-workspace multi-tenancy — the database schema is already shaped for it, and the `X-User-Id` header indirection means the auth layer plugs in without touching the route handlers. Second, I would build a proper "Re-link Dataset" wizard for broken charts, since manually re-doing a query spec when a column is renamed is the most painful manual recovery in the current product. Third, I would add server-sent events for real-time chart refresh so that an editor's chart change is reflected on a viewer's open dashboard within a second, without a refresh — the audit log already captures the "what" of every change, so emitting it as a stream is straightforward. Fourth, I would invest in tests — the current codebase has zero automated tests, which is a deliberate scope choice given the time budget but which is the *first* thing I would close out before any further feature work. Fifth, I would sketch a proper export-to-PDF report, since several real BI workflows end with "send this to my CFO as a one-pager."

## Tradeoffs I made and why

I picked **vanilla JS over React** because the assignment is graded on architectural reasoning rather than on framework idioms, and because the JavaScript I wrote is the JavaScript that runs — no transpilation, no source maps, no build pipeline to debug. That makes the codebase honest. The cost is that scaling this codebase past, say, fifty modules would be painful; that cost is hypothetical for the assignment.

I picked **Pandas + Python** over Node.js because the work the backend actually does — groupby, agg, type inference, histogram generation, null handling, date parsing — is fifteen lines of Pandas and would be fifteen hundred lines of hand-rolled JavaScript. That is not a close call.

I picked **SQLite + in-memory DataFrames** over Postgres because the dataset live in CSVs that fit in RAM, and SQLite needs zero config. The cost is that scaling beyond a single server requires moving the DataFrame store to Redis or a columnar database. That migration is straightforward when it is needed.

I picked **the X-User-Id header pattern** over real authentication because the assignment explicitly says "you don't need authentication — just simulate different roles." The same pattern works with real JWTs by reading `req.user.id` instead of `req.headers["x-user-id"]` — it is a one-line change.

I picked **a 300-second query cache** over fancier strategies (request coalescing, materialized views, etc.) because for the size of data this product targets, an MD5-keyed dictionary lookup with a TTL is fast enough and simple enough to fit on a postcard. Premature optimization is its own bug.

## Rough time breakdown

| Phase | Hours | Notes |
| --- | --- | --- |
| Backend scaffolding (schema, seed, services, routers) | ~2 | Pandas-based engine, cache, permissions, audit |
| Frontend shell + design system + state store | ~1.5 | CSS variables, hash router, reactive store |
| Datasets page + upload + column profiling UI | ~1 | Drag-drop zone, profile cards, Canvas2D tooltips |
| Query Builder (drag/drop, preview, recommendations) | ~2 | The most iterated piece — three full passes |
| Dashboard (cards, KPIs, drag-reorder, resize, broken state) | ~1.5 | Welcome header, sample-charts, fullscreen |
| Polish pass (dark mode, shortcuts, undo, animations, empty states) | ~1 | Documented feel-good details |
| Bug-fix and redesign pass per feedback | ~1 | Strict typing of shelves, axis formatting, plain-English summary |

Total: ~10 hours.

---

## Conclusion

InsightBoard is opinionated about what a *small* analytics tool should feel like: type-safe by default, forgiving when destructive, narrating its own work in plain English, and friendly in failure. Where the product is shallow it is shallow on purpose — there is no real auth, no real-time sync, no test suite — and where it is deep, it is deep where it matters: query correctness, role enforcement, broken-state handling, and the moment-to-moment ergonomics of building a chart. My goal was not to build the largest feature surface in the time available, but to build the smallest surface that genuinely works end to end and would not embarrass me on a Monday morning if a real user tried to ship a real dashboard with it. I think it clears that bar.
