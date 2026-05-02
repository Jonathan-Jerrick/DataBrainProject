import aiosqlite
import uuid
import json
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent / "data" / "insightboard.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
    avatar_color TEXT NOT NULL,
    avatar_initials TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS datasources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    row_count INTEGER,
    column_count INTEGER,
    file_size_bytes INTEGER,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','archived')),
    uploaded_by TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    health_status TEXT DEFAULT 'clean',
    health_issues TEXT DEFAULT '[]',
    suggested_explorations TEXT DEFAULT '[]',
    date_range TEXT,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS column_profiles (
    id TEXT PRIMARY KEY,
    datasource_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    column_type TEXT NOT NULL,
    inferred_role TEXT NOT NULL CHECK(inferred_role IN ('dimension','metric')),
    user_overridden_role TEXT,
    null_count INTEGER,
    null_percentage REAL,
    unique_count INTEGER,
    min_value TEXT,
    max_value TEXT,
    mean_value REAL,
    median_value REAL,
    top_values TEXT,
    histogram_data TEXT,
    FOREIGN KEY (datasource_id) REFERENCES datasources(id)
);

CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    visibility TEXT DEFAULT 'workspace' CHECK(visibility IN ('workspace','editors_only','private')),
    layout_config TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS charts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    dashboard_id TEXT NOT NULL,
    datasource_id TEXT NOT NULL,
    query_spec TEXT NOT NULL,
    chart_type TEXT NOT NULL CHECK(chart_type IN ('bar','line','pie','scatter','table','donut','kpi')),
    visual_config TEXT DEFAULT '{}',
    created_by TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 6,
    height INTEGER DEFAULT 4,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','broken','stale')),
    broken_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS query_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    datasource_id TEXT NOT NULL,
    query_spec TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    resource_name TEXT,
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dashboard_access (
    dashboard_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (dashboard_id, user_id)
);
"""

SEED_USERS = [
    ("user_sarah", "Sarah Chen", "sarah@insightboard.io", "admin", "#7C3AED", "SC"),
    ("user_marcus", "Marcus Webb", "marcus@insightboard.io", "editor", "#2563EB", "MW"),
    ("user_priya", "Priya Nair", "priya@insightboard.io", "editor", "#059669", "PN"),
    ("user_james", "James Okafor", "james@insightboard.io", "viewer", "#D97706", "JO"),
    ("user_lisa", "Lisa Park", "lisa@insightboard.io", "viewer", "#DC2626", "LP"),
]


async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()

        cursor = await db.execute("SELECT COUNT(*) FROM users")
        count = (await cursor.fetchone())[0]
        if count == 0:
            for u in SEED_USERS:
                await db.execute(
                    "INSERT INTO users (id, name, email, role, avatar_color, avatar_initials) VALUES (?, ?, ?, ?, ?, ?)",
                    u,
                )
            await db.commit()

        cursor = await db.execute("SELECT COUNT(*) FROM dashboards")
        count = (await cursor.fetchone())[0]
        if count == 0:
            await db.execute(
                "INSERT INTO dashboards (id, name, created_by, is_default, visibility) VALUES (?, ?, ?, ?, ?)",
                ("dash_default", "Main Dashboard", "user_sarah", True, "workspace"),
            )
            await db.commit()


async def get_user_by_id(db, user_id: str):
    cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def write_audit_log(
    db,
    user_id: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    resource_name: Optional[str] = None,
    details: Optional[dict] = None,
):
    await db.execute(
        "INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, resource_name, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            str(uuid.uuid4()),
            user_id,
            action,
            resource_type,
            resource_id,
            resource_name,
            json.dumps(details) if details else None,
        ),
    )
    await db.commit()
