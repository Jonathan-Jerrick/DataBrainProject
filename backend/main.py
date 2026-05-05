"""InsightBoard application entry point.

Wires the routers together, serves the static frontend, and on startup
initializes the SQLite schema + reloads any previously uploaded CSVs.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .database import init_db
from .routers import charts, dashboards, datasources, queries, users
from .services import csv_engine

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    csv_engine.reload_all_from_disk()
    yield


app = FastAPI(title="InsightBoard", lifespan=lifespan)

# API routers
for r in (users.router, datasources.router, queries.router, dashboards.router, charts.router):
    app.include_router(r)


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
async def health():
    return {"status": "ok"}


# Static frontend
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
