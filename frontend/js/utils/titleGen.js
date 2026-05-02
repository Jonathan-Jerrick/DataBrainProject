// Human-readable chart title generation.

function titleCase(s) {
  return String(s).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const AGG_LABEL = {
  SUM: 'Total',     // displayed only when ambiguous; for SUM, drop the prefix
  AVG: 'Average',
  COUNT: 'Count of',
  MIN: 'Minimum',
  MAX: 'Maximum',
  COUNT_DISTINCT: 'Unique',
};

function metricPhrase(m) {
  const agg = (m.aggregation || 'SUM').toUpperCase();
  const col = titleCase(m.column);
  if (agg === 'SUM') return col;
  if (agg === 'AVG') return `Average ${col}`;
  if (agg === 'COUNT') return `Count of ${col}`;
  if (agg === 'MIN') return `Minimum ${col}`;
  if (agg === 'MAX') return `Maximum ${col}`;
  if (agg === 'COUNT_DISTINCT') return `Unique ${col}`;
  return col;
}

function joinList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function generateChartTitle(querySpec, profile) {
  const dims = querySpec.dimensions || [];
  const metrics = querySpec.metrics || [];

  // Detect whether the dimension is a date column
  const isDateDim = dims[0] && profile?.columns?.find(c => c.column_name === dims[0].column)?.column_type === 'date';

  if (metrics.length === 0 && dims.length === 0) return '';

  if (metrics.length === 0) {
    return `Records by ${joinList(dims.map(d => titleCase(d.column)))}`;
  }

  const metricPart = joinList(metrics.map(metricPhrase));

  if (dims.length === 0) {
    return metricPart;
  }

  if (isDateDim) {
    return `${metricPart} Over Time`;
  }

  const dimPart = joinList(dims.map(d => titleCase(d.column)));
  return `${metricPart} by ${dimPart}`;
}

export function plainEnglishSummary(querySpec, profile) {
  const dims = querySpec.dimensions || [];
  const metrics = querySpec.metrics || [];
  const filters = (querySpec.filters || []).filter(f => f.column);
  const sort = querySpec.sort_by;

  if (!dims.length && !metrics.length) return null;

  const parts = [];

  // Build segments as objects so we can render colored chips
  const renderChip = (text, type) => `<span class="qb-summary-chip type-${type}">${escape(text)}</span>`;

  if (metrics.length === 0) {
    parts.push('Show all records grouped by');
    parts.push(joinChips(dims.map(d => renderChip(titleCase(d.column), 'dimension'))));
  } else {
    parts.push('Show the');
    parts.push(joinChips(metrics.map(m => renderChip(metricPhraseLower(m), 'metric'))));
    if (dims.length > 0) {
      parts.push('for each');
      parts.push(joinChips(dims.map(d => {
        const c = profile?.columns?.find(c => c.column_name === d.column);
        const t = c?.column_type === 'date' ? 'date' : 'dimension';
        return renderChip(titleCase(d.column), t);
      })));
    }
  }

  if (filters.length > 0) {
    parts.push('where');
    parts.push(joinChips(filters.map(f => renderChip(`${titleCase(f.column)} ${opLabel(f.operator)} ${f.value ?? ''}`, 'filter'))));
  }

  if (sort && sort.column) {
    parts.push(', sorted by');
    parts.push(renderChip(`${titleCase(sort.column)} ${sort.direction === 'desc' ? '(highest first)' : '(lowest first)'}`, 'sort'));
  }

  return parts.join(' ');
}

function metricPhraseLower(m) {
  const agg = (m.aggregation || 'SUM').toUpperCase();
  const col = titleCase(m.column).toLowerCase();
  if (agg === 'SUM') return `total ${col}`;
  if (agg === 'AVG') return `average ${col}`;
  if (agg === 'COUNT') return `count of ${col}`;
  if (agg === 'MIN') return `minimum ${col}`;
  if (agg === 'MAX') return `maximum ${col}`;
  if (agg === 'COUNT_DISTINCT') return `unique ${col}`;
  return col;
}

function opLabel(op) {
  return ({
    eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
    contains: 'contains', not_contains: 'does not contain',
    is_null: 'is empty', is_not_null: 'is not empty', in: 'is one of',
  })[op] || op;
}

function joinChips(arr) {
  if (arr.length <= 1) return arr.join('');
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
