import time
import warnings
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException

from ..models.schemas import (
    ColumnProfile, DimensionSpec, FilterCondition, MetricSpec,
    QueryResult, QuerySpec,
)

# Pandas emits noisy warnings on mixed-format date parsing; we handle parse
# failures explicitly via errors="coerce", so silence the warning.
warnings.filterwarnings("ignore", category=UserWarning, module="pandas")

UPLOADS_DIR = Path(__file__).parent.parent / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# In-memory DataFrame store
_dataframes: Dict[str, pd.DataFrame] = {}

ID_LIKE_TOKENS = ["id", "code", "key", "zip", "phone", "year"]


def get_dataframe(datasource_id: str) -> pd.DataFrame:
    if datasource_id not in _dataframes:
        # Try to lazy-load from disk
        path = UPLOADS_DIR / f"{datasource_id}.csv"
        if path.exists():
            load_csv(datasource_id, str(path))
        else:
            raise HTTPException(status_code=404, detail=f"Datasource {datasource_id} not loaded")
    return _dataframes[datasource_id]


def load_csv(datasource_id: str, file_path: str) -> pd.DataFrame:
    df = pd.read_csv(file_path)
    # Try parse date-looking columns
    for col in df.columns:
        if df[col].dtype == "object":
            sample = df[col].dropna().head(50)
            if len(sample) > 0:
                try:
                    parsed = pd.to_datetime(sample, errors="coerce")
                    if parsed.notna().sum() / len(sample) > 0.8:
                        df[col] = pd.to_datetime(df[col], errors="coerce")
                except Exception:
                    pass
    _dataframes[datasource_id] = df
    return df


def unload_dataframe(datasource_id: str):
    _dataframes.pop(datasource_id, None)


def reload_all_from_disk():
    """Called on startup to repopulate _dataframes from saved CSVs."""
    for path in UPLOADS_DIR.glob("*.csv"):
        ds_id = path.stem
        try:
            load_csv(ds_id, str(path))
        except Exception as e:
            print(f"Failed to reload {ds_id}: {e}")


def detect_column_type(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    # Try date parse
    sample = series.dropna().head(50)
    if len(sample) > 0:
        try:
            parsed = pd.to_datetime(sample, errors="coerce")
            if parsed.notna().sum() / len(sample) > 0.8:
                return "date"
        except Exception:
            pass
    return "string"


def infer_role(column_name: str, column_type: str, series: pd.Series, row_count: int) -> str:
    name_lower = column_name.lower()
    if column_type == "numeric":
        if any(tok in name_lower for tok in ID_LIKE_TOKENS):
            return "dimension"
        # ID-like detection: unique_count == row_count AND looks like sequential integers
        # AND we have enough rows for the heuristic to be meaningful.
        unique_count = series.nunique()
        if row_count >= 50 and unique_count == row_count:
            try:
                if pd.api.types.is_integer_dtype(series) or (series.dropna() % 1 == 0).all():
                    return "dimension"
            except Exception:
                pass
        return "metric"
    return "dimension"


def profile_columns(datasource_id: str) -> List[ColumnProfile]:
    df = get_dataframe(datasource_id)
    profiles: List[ColumnProfile] = []
    row_count = len(df)

    for col in df.columns:
        series = df[col]
        col_type = detect_column_type(series)
        role = infer_role(col, col_type, series, row_count)

        null_count = int(series.isna().sum())
        null_pct = (null_count / row_count * 100) if row_count else 0.0
        unique_count = int(series.nunique(dropna=True))

        min_value = None
        max_value = None
        mean_value = None
        median_value = None
        top_values = None
        histogram_data = None

        non_null = series.dropna()

        if col_type == "numeric" and len(non_null) > 0:
            min_value = str(non_null.min())
            max_value = str(non_null.max())
            mean_value = float(non_null.mean())
            median_value = float(non_null.median())
            try:
                if non_null.nunique() > 1:
                    bins = pd.cut(non_null, bins=10)
                    counts = bins.value_counts().sort_index()
                    histogram_data = [
                        {"label": f"{interval.left:.1f}-{interval.right:.1f}", "count": int(c)}
                        for interval, c in counts.items()
                    ]
                else:
                    histogram_data = [{"label": str(non_null.iloc[0]), "count": int(len(non_null))}]
            except Exception:
                histogram_data = None
        elif col_type == "date" and len(non_null) > 0:
            min_value = str(non_null.min())
            max_value = str(non_null.max())
        elif col_type == "string" and len(non_null) > 0:
            try:
                min_value = str(non_null.astype(str).min())
                max_value = str(non_null.astype(str).max())
            except Exception:
                pass

        if col_type in ("string", "date") and len(non_null) > 0:
            try:
                vc = non_null.astype(str).value_counts().head(5)
                total = len(non_null)
                top_values = [
                    {"value": str(v), "count": int(c), "percentage": round(c / total * 100, 1)}
                    for v, c in vc.items()
                ]
            except Exception:
                top_values = None

        profiles.append(ColumnProfile(
            column_name=col,
            column_type=col_type,
            inferred_role=role,
            user_overridden_role=None,
            null_count=null_count,
            null_percentage=round(null_pct, 2),
            unique_count=unique_count,
            min_value=min_value,
            max_value=max_value,
            mean_value=mean_value,
            median_value=median_value,
            top_values=top_values,
            histogram_data=histogram_data,
        ))
    return profiles


def compute_health(datasource_id: str, column_profiles: List[ColumnProfile]) -> Tuple[str, List[str]]:
    df = get_dataframe(datasource_id)
    issues: List[str] = []

    for cp in column_profiles:
        if cp.null_percentage > 20:
            issues.append(f"Column '{cp.column_name}' has {cp.null_percentage:.1f}% missing values")

    if len(df) > 0:
        dup_count = len(df) - len(df.drop_duplicates())
        if dup_count > 0:
            issues.append(f"Dataset contains {dup_count} duplicate rows")

    for cp in column_profiles:
        if cp.column_type == "numeric" and cp.min_value is not None:
            try:
                if float(cp.min_value) < 0 and "amount" in cp.column_name.lower():
                    issues.append(f"Column '{cp.column_name}' contains negative values")
            except Exception:
                pass

    if not issues:
        return "clean", []
    if len(issues) > 5:
        return "errors", issues
    return "warnings", issues


def generate_suggestions(datasource_id: str, column_profiles: List[ColumnProfile]) -> List[dict]:
    suggestions: List[dict] = []
    date_cols = [c for c in column_profiles if c.column_type == "date"]
    numeric_metrics = [c for c in column_profiles if c.column_type == "numeric" and c.inferred_role == "metric"]
    cat_dims = [c for c in column_profiles if c.column_type == "string"]

    if date_cols and numeric_metrics:
        d, m = date_cols[0], numeric_metrics[0]
        suggestions.append({
            "title": f"{m.column_name} over Time",
            "icon": "📈",
            "chart_type": "line",
            "query_spec": {
                "datasource_id": datasource_id,
                "dimensions": [{"column": d.column_name, "alias": d.column_name}],
                "metrics": [{"column": m.column_name, "aggregation": "SUM", "alias": f"sum_{m.column_name}"}],
                "filters": [],
                "limit": 1000,
            },
        })

    if cat_dims and numeric_metrics:
        d, m = cat_dims[0], numeric_metrics[0]
        suggestions.append({
            "title": f"{m.column_name} by {d.column_name}",
            "icon": "📊",
            "chart_type": "bar",
            "query_spec": {
                "datasource_id": datasource_id,
                "dimensions": [{"column": d.column_name, "alias": d.column_name}],
                "metrics": [{"column": m.column_name, "aggregation": "SUM", "alias": f"sum_{m.column_name}"}],
                "filters": [],
                "limit": 50,
            },
        })

    if len(cat_dims) >= 2 and numeric_metrics:
        d, m = cat_dims[1], numeric_metrics[0]
        suggestions.append({
            "title": f"{m.column_name} share by {d.column_name}",
            "icon": "🥧",
            "chart_type": "pie",
            "query_spec": {
                "datasource_id": datasource_id,
                "dimensions": [{"column": d.column_name, "alias": d.column_name}],
                "metrics": [{"column": m.column_name, "aggregation": "SUM", "alias": f"sum_{m.column_name}"}],
                "filters": [],
                "limit": 10,
            },
        })

    if numeric_metrics and not cat_dims and not date_cols:
        m = numeric_metrics[0]
        suggestions.append({
            "title": f"Total {m.column_name}",
            "icon": "🔢",
            "chart_type": "kpi",
            "query_spec": {
                "datasource_id": datasource_id,
                "dimensions": [],
                "metrics": [{"column": m.column_name, "aggregation": "SUM", "alias": f"sum_{m.column_name}"}],
                "filters": [],
                "limit": 1,
            },
        })

    # Always offer table
    if column_profiles:
        suggestions.append({
            "title": "Browse all rows",
            "icon": "📋",
            "chart_type": "table",
            "query_spec": {
                "datasource_id": datasource_id,
                "dimensions": [{"column": c.column_name, "alias": c.column_name} for c in column_profiles[:5]],
                "metrics": [],
                "filters": [],
                "limit": 100,
            },
        })

    return suggestions[:5]


def compute_date_range(datasource_id: str, column_profiles: List[ColumnProfile]) -> Optional[dict]:
    df = get_dataframe(datasource_id)
    for cp in column_profiles:
        if cp.column_type == "date":
            series = df[cp.column_name].dropna()
            if len(series) > 0:
                try:
                    freq = pd.infer_freq(series.sort_values().head(20))
                except Exception:
                    freq = None
                return {
                    "column": cp.column_name,
                    "min": str(series.min()),
                    "max": str(series.max()),
                    "frequency": freq,
                }
    return None


# ----- Query Execution -----

def _apply_filter(df: pd.DataFrame, f: FilterCondition) -> pd.DataFrame:
    col = f.column
    if col not in df.columns:
        raise HTTPException(status_code=400, detail=f"Filter column '{col}' not in datasource")
    series = df[col]
    op = f.operator
    val = f.value

    if op == "is_null":
        return df[series.isna()]
    if op == "is_not_null":
        return df[series.notna()]

    # Coerce val type
    if f.value_type == "number" and val is not None and not isinstance(val, list):
        try:
            val = float(val)
        except Exception:
            pass
    elif f.value_type == "date" and val is not None and not isinstance(val, list):
        try:
            val = pd.to_datetime(val)
        except Exception:
            pass

    if op == "eq":
        return df[series == val]
    if op == "neq":
        return df[series != val]
    if op == "gt":
        return df[series > val]
    if op == "gte":
        return df[series >= val]
    if op == "lt":
        return df[series < val]
    if op == "lte":
        return df[series <= val]
    if op == "contains":
        return df[series.astype(str).str.contains(str(val), case=False, na=False)]
    if op == "not_contains":
        return df[~series.astype(str).str.contains(str(val), case=False, na=False)]
    if op == "in":
        if not isinstance(val, list):
            val = [val]
        return df[series.isin(val)]
    raise HTTPException(status_code=400, detail=f"Unknown operator: {op}")


_AGG_MAP = {
    "SUM": "sum",
    "AVG": "mean",
    "COUNT": "count",
    "MIN": "min",
    "MAX": "max",
    "COUNT_DISTINCT": "nunique",
}


def execute_query(query_spec: QuerySpec) -> QueryResult:
    start = time.time()
    df = get_dataframe(query_spec.datasource_id)
    total_row_count = len(df)

    # Validate columns
    all_cols = set(df.columns)
    for d in query_spec.dimensions:
        if d.column not in all_cols:
            raise HTTPException(status_code=400, detail=f"Dimension column '{d.column}' not found")
    for m in query_spec.metrics:
        if m.column not in all_cols:
            raise HTTPException(status_code=400, detail=f"Metric column '{m.column}' not found")
        # Reject text/dimension columns used as metrics (except COUNT/COUNT_DISTINCT)
        agg = (m.aggregation or "").upper()
        if agg not in ("COUNT", "COUNT_DISTINCT"):
            series = df[m.column]
            if not pd.api.types.is_numeric_dtype(series):
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{m.column}' is a text column and cannot be aggregated. Move it to dimensions.",
                )

    # Apply filters
    filtered = df
    for f in query_spec.filters:
        filtered = _apply_filter(filtered, f)

    # Build result
    if query_spec.dimensions and query_spec.metrics:
        # Fill nulls in dimensions with "Unknown" before groupby
        group_cols = [d.column for d in query_spec.dimensions]
        grouped_df = filtered.copy()
        for c in group_cols:
            if grouped_df[c].dtype == "object":
                grouped_df[c] = grouped_df[c].fillna("Unknown")
        agg_dict = {}
        rename_map = {}
        for m in query_spec.metrics:
            pandas_agg = _AGG_MAP.get(m.aggregation.upper())
            if not pandas_agg:
                raise HTTPException(status_code=400, detail=f"Unknown aggregation: {m.aggregation}")
            agg_dict.setdefault(m.column, []).append(pandas_agg)
            rename_map[(m.column, pandas_agg)] = m.alias

        result_df = grouped_df.groupby(group_cols, dropna=False).agg(agg_dict)
        # Flatten multiindex columns
        new_cols = []
        for col in result_df.columns:
            new_cols.append(rename_map.get(col, f"{col[0]}_{col[1]}"))
        result_df.columns = new_cols
        result_df = result_df.reset_index()
    elif query_spec.dimensions and not query_spec.metrics:
        # Just project dimensions (table mode)
        result_df = filtered[[d.column for d in query_spec.dimensions]].copy()
    elif query_spec.metrics and not query_spec.dimensions:
        # Aggregate without group
        row = {}
        for m in query_spec.metrics:
            pandas_agg = _AGG_MAP.get(m.aggregation.upper())
            if pandas_agg == "count":
                row[m.alias] = int(filtered[m.column].count())
            elif pandas_agg == "nunique":
                row[m.alias] = int(filtered[m.column].nunique())
            else:
                val = getattr(filtered[m.column], pandas_agg)()
                row[m.alias] = float(val) if pd.notna(val) else None
        result_df = pd.DataFrame([row])
    else:
        result_df = filtered.head(query_spec.limit).copy()

    # Sort
    if query_spec.sort_by and query_spec.sort_by.column in result_df.columns:
        ascending = query_spec.sort_by.direction == "asc"
        result_df = result_df.sort_values(by=query_spec.sort_by.column, ascending=ascending)

    # Limit
    result_df = result_df.head(query_spec.limit)

    # Convert to JSON-friendly
    columns = list(result_df.columns)
    rows = []
    for _, r in result_df.iterrows():
        row = []
        for v in r.values:
            if pd.isna(v):
                row.append(None)
            elif isinstance(v, (np.integer,)):
                row.append(int(v))
            elif isinstance(v, (np.floating,)):
                row.append(float(v))
            elif isinstance(v, (pd.Timestamp,)):
                row.append(v.isoformat())
            else:
                row.append(v if isinstance(v, (str, int, float, bool)) or v is None else str(v))
        rows.append(row)

    elapsed_ms = (time.time() - start) * 1000
    recommended = recommend_chart_types(query_spec.dimensions, query_spec.metrics, result_df, df)

    return QueryResult(
        columns=columns,
        rows=rows,
        row_count=len(rows),
        total_row_count=total_row_count,
        execution_time_ms=round(elapsed_ms, 2),
        cache_hit=False,
        recommended_chart_types=recommended,
    )


def recommend_chart_types(
    dimensions: List[DimensionSpec],
    metrics: List[MetricSpec],
    result_df: pd.DataFrame,
    source_df: pd.DataFrame,
) -> List[str]:
    if not dimensions:
        return ["kpi", "table"]
    first_dim_col = dimensions[0].column
    has_date = first_dim_col in source_df.columns and pd.api.types.is_datetime64_any_dtype(source_df[first_dim_col])
    unique_dim_values = result_df[first_dim_col].nunique() if first_dim_col in result_df.columns else 0

    if has_date:
        return ["line", "bar", "table"]
    if unique_dim_values <= 6 and len(metrics) == 1:
        return ["pie", "donut", "bar", "table"]
    if len(metrics) == 2:
        return ["scatter", "bar", "table"]
    return ["bar", "table", "line"]
