# InsightBoard — Mini Data Query and Visualization Platform

InsightBoard is a full-stack analytics tool. When a user uploads a CSV file, the platform automatically profiles its columns and the user can then build aggregations and visualizations through a Query Builder without writing a single line of SQL. Multiple charts assemble into dashboards, and a simulated multi user system enforces three permission roles (admin, editor, viewer) so that the surface a user sees changes with the role they hold.

## Stack

- **Backend:** Python 3.11+, FastAPI, Pandas, Pydantic v2, aiosqlite, uvicorn
- **Frontend:** Vanilla HTML5, CSS3, ES6 JavaScript modules, Chart.js loaded from CDN
- **Database:** SQLite (via aiosqlite) for metadata; raw CSV data lives as in-memory Pandas DataFrames

## Requirements and how to run

The full Python dependency list lives in `requirements.txt`. From a clean clone:

```bash
cd insightboard
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Then open <http://localhost:8000>.


## Feature summary

- **CSV upload with automatic column profiling.** Type detection (numeric / date / string), role inference (dimension vs metric), null %, unique count, top values, histograms, suggested explorations and dataset health checks.
- **Visual Query Builder.** A slide-in panel with a 3-step indicator, a typed column picker that strictly separates dimensions from metrics, drag-and-drop shelves, six aggregations, filters, sorting and a plain-English summary that updates as you build.
- **Five chart types.** Bar, line, pie/donut, scatter, table and KPI each with sensible defaults (rounded bars, gradient fills under lines, donut center totals, K/M-formatted axes, dark tooltips, and a recommendation engine that picks the best fit for the result shape).
- **Dashboards.** Multiple dashboards per workspace, drag-to-reorder, resizable cards, inline title editing, fullscreen view, PNG/CSV export, and a friendly empty state.
- **Permissions.** Mirror-implemented on backend (enforced) and frontend (gated UI). Admins manage users and see the audit log; editors create/edit only their own; viewers read only and see a persistent banner reminding them their filters are temporary.
- **Caching.** A 300-second query cache keyed by an MD5 hash of the canonicalized query spec, automatically invalidated when its source dataset is deleted.
- **Audit log.** Every meaningful action (upload, query, chart create/edit/delete, role change) is recorded with user attribution and timestamp.
- **Undo-on-delete.** Deleting a chart pops a toast with an "Undo" action button for six seconds; clicking it restores the chart from a captured snapshot.
- **Smooth, responsive UI.** 300ms slide animations on the Query Builder, slide-in chart cards, hover lifts, KPI summary cards, and a layout that collapses to single column under 1200px and to an icon-only sidebar under 900px.

---

## Product Thinking — the five questions

### 1. How do you balance flexibility versus simplicity?

The Query Builder is the place where this question is most visible, because power users want SQL-level expressiveness while beginners just want to drag two columns onto a screen and see a chart. My approach was to use **strict typing as the safety rail and rich guidance as the on-ramp**, both at once. The column picker is split into clearly labelled DIMENSIONS and METRICS sections, color-coded, before the user ever sees the shelves below. The shelves themselves *physically refuse* a wrong-typed drop — a metric chip dragged onto the dimensions shelf shakes red and pops a tooltip — and the backend independently enforces the same rule with a 400 response, so the rules are not just visual. On top of that, a live "plain English" sentence builds itself over the user's choices, turning the query into something a non-technical user can verify by reading aloud. Power, meanwhile, is preserved through six aggregations, all comparison operators, sorts, and a 5000-row limit slider. The UI layers these so beginners never see the complexity unless they go looking for it: filters and sort are collapsed sections under the shelves, not part of the primary flow. The principle I'm following: *progressive disclosure with hard guardrails*. The defaults must be safe; advanced controls must exist; and the system must protect the user from themselves at the lowest possible layer (the database, then the API, then the UI).

### 2. What happens when the underlying data changes?

Data change is treated as a first-class lifecycle event rather than something to retrofit. When an admin deletes a datasource, three things happen atomically: the file is removed from disk, the in-memory DataFrame is unloaded, and every chart that referenced that datasource is updated in SQLite to `status='broken'` with a human-readable `broken_reason`. Every query cache entry tagged with that datasource is also invalidated. The next time a dashboard is loaded, those broken charts render with an amber-bordered, friendly explanation card offering "Edit Chart" and "Remove Chart" instead of a blank red error. When a user re-uploads or fixes the underlying issue and edits a broken chart's query spec, the backend automatically flips its status back to `active` and clears `broken_reason`. For column-level changes (a column gets renamed, or its type is overridden from metric to dimension), I made the explicit choice to *not* silently rewrite the affected charts, because I think guessing the user's intent across schema drift is dangerous.

### 3. Performance — should aggregations run client-side or server-side?

Server-side, without much ambiguity for this product. The largest CSV one user can upload is bounded (currently 100 MB), but the data is shared across all users in a workspace, so caching one server-side query result serves N concurrent dashboard viewers, while client-side aggregation would re-do that work in every browser. The result of a typical aggregated query is small — usually a few dozen rows — which is what gets sent to the client. To keep this fast under load I added (a) a 300-second TTL query cache keyed by the MD5 of the canonical query spec, (b) lazy reload of CSVs from disk so server restarts don't lose state, (c) `dropna=False` in groupby to avoid silent row loss, and (d) a debounced 500ms live-preview in the Query Builder so the API is not pummeled while a user is still dragging chips around. The one place I deliberately do client-side work is sorting in rendered tables (clicking a column header re-sorts within the already-fetched 1000 rows) and chart-type recommendation post-processing — both cheap operations on already-summarized data.

### 4. Error recovery when a user deletes the data their charts depend on

A chart that has lost its datasource is not deleted, it is not blank, and it certainly does not render an exception to the user — it transitions into a recognized `broken` state with a `broken_reason`, and its card UI shifts to a calm amber-toned panel that names the problem ("Chart Unavailable — column 'revenue' no longer exists in the connected dataset.") and offers two clear next actions. The audit log records the deletion that caused this. Beyond that, ordinary destructive actions in the UI use undo-with-toast: when an editor deletes a chart, the success toast contains an "Undo" button for six seconds that re-creates the chart from its full snapshot. This is the cheapest, lowest-friction way to make destructive operations feel safe, and it removes the need for a confirmation dialog in many places — confirmation dialogs are friction users learn to ignore, while undo is forgiveness users actively appreciate.