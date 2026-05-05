from pydantic import BaseModel
from typing import List, Optional, Any, Union, Dict


class FilterCondition(BaseModel):
    column: str
    operator: str  # eq, neq, gt, gte, lt, lte, contains, not_contains, in, is_null, is_not_null
    value: Optional[Union[str, float, int, bool, List[Any]]] = None
    value_type: str = "string"  # string, number, date


class MetricSpec(BaseModel):
    column: str
    aggregation: str  # SUM, AVG, COUNT, MIN, MAX, COUNT_DISTINCT
    alias: str


class DimensionSpec(BaseModel):
    column: str
    alias: str


class SortSpec(BaseModel):
    column: str
    direction: str = "asc"  # asc, desc


class QuerySpec(BaseModel):
    datasource_id: str
    dimensions: List[DimensionSpec] = []
    metrics: List[MetricSpec] = []
    filters: List[FilterCondition] = []
    sort_by: Optional[SortSpec] = None
    limit: int = 1000


class QueryResult(BaseModel):
    columns: List[str]
    rows: List[List[Any]]
    row_count: int
    total_row_count: int
    execution_time_ms: float
    cache_hit: bool
    recommended_chart_types: List[str]


class ColumnProfile(BaseModel):
    column_name: str
    column_type: str
    inferred_role: str
    user_overridden_role: Optional[str] = None
    null_count: int
    null_percentage: float
    unique_count: int
    min_value: Optional[str] = None
    max_value: Optional[str] = None
    mean_value: Optional[float] = None
    median_value: Optional[float] = None
    top_values: Optional[List[Dict[str, Any]]] = None
    histogram_data: Optional[List[Dict[str, Any]]] = None


class ChartCreate(BaseModel):
    title: str
    dashboard_id: str
    datasource_id: str
    query_spec: QuerySpec
    chart_type: str
    visual_config: Dict[str, Any] = {}
    width: int = 6
    height: int = 4
    position_x: int = 0
    position_y: int = 0


class ChartUpdate(BaseModel):
    title: Optional[str] = None
    query_spec: Optional[QuerySpec] = None
    chart_type: Optional[str] = None
    visual_config: Optional[Dict[str, Any]] = None
    width: Optional[int] = None
    height: Optional[int] = None
    position_x: Optional[int] = None
    position_y: Optional[int] = None


class DashboardCreate(BaseModel):
    name: str
    visibility: str = "workspace"


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    layout_config: Optional[List[Dict[str, Any]]] = None
    is_locked: Optional[bool] = None
    visibility: Optional[str] = None
    is_default: Optional[bool] = None


class UserRoleUpdate(BaseModel):
    role: str


class ColumnRoleUpdate(BaseModel):
    role: str  # dimension or metric


class QueryTemplateCreate(BaseModel):
    name: str
    datasource_id: str
    query_spec: QuerySpec
