from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from pathlib import Path

from .database import init_db
from .services import csv_engine
from .routers import users, datasources, queries, dashboards, charts


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    csv_engine.reload_all_from_disk()
    yield


app = FastAPI(title="InsightBoard", lifespan=lifespan)

app.include_router(users.router)
app.include_router(datasources.router)
app.include_router(queries.router)
app.include_router(dashboards.router)
app.include_router(charts.router)


FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


# Mount static last so it doesn't shadow API routes
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")


@app.get("/health")
async def health():
    return {"status": "ok"}
