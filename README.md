# InsightBoard

A full-stack BI Dashboard Platform — upload CSVs, build visual queries, create charts, assemble dashboards. Role-based permissions (Admin / Editor / Viewer).

## Stack
- **Backend:** Python FastAPI + Pandas + Pydantic v2 + aiosqlite
- **Frontend:** Vanilla HTML5 / CSS3 / JS ES6 modules + Chart.js
- **DB:** SQLite for metadata; in-memory Pandas DataFrames for raw CSV data

## Run

```bash
cd insightboard
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Open http://localhost:8000

## Seeded users (top-right user switcher)

| User | Role |
| --- | --- |
| Sarah Chen | admin |
| Marcus Webb | editor |
| Priya Nair | editor |
| James Okafor | viewer |
| Lisa Park | viewer |

## Project layout

```
insightboard/
  backend/
    main.py              # FastAPI app, static serving
    database.py          # SQLite schema + seed
    routers/             # users, datasources, queries, dashboards, charts
    services/            # csv_engine, cache, permissions, profiler, auth
    models/schemas.py    # Pydantic models
    data/                # SQLite db + uploaded CSVs
  frontend/
    index.html           # Single page entry
    css/                 # base, layout, components, dashboard, query-builder
    js/
      app.js             # Hash router
      utils/             # api, state, toast
      modules/           # userSwitcher, datasource, queryBuilder,
                         # chartRenderer, dashboard, users, permissions
```

## Key flows

1. **Upload a CSV** — Datasets page → drag & drop. Profiles columns, infers roles, generates suggestions.
2. **Build a chart** — Click a suggestion or "+ New Chart" on the dashboard. Drag columns to dimensions / metrics shelves. Pick a chart type. Add to dashboard.
3. **Switch users** — Top-right dropdown. Permissions re-applied immediately.
