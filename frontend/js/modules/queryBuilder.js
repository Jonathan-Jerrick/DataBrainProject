import { api } from '../utils/api.js';
import { store } from '../utils/state.js';
import { showToast } from '../utils/toast.js';
import { renderChart } from './chartRenderer.js';
import { generateChartTitle, plainEnglishSummary } from '../utils/titleGen.js';

let panelEl = null;
let backdropEl = null;
let _state = null;
let _previewTimeout = null;
let _miniChart = null;
let _userEditedTitle = false;

const AGGS = [
  { v: 'SUM', label: 'SUM', desc: 'Total' },
  { v: 'AVG', label: 'AVG', desc: 'Average' },
  { v: 'COUNT', label: 'COUNT', desc: 'Count' },
  { v: 'MIN', label: 'MIN', desc: 'Minimum' },
  { v: 'MAX', label: 'MAX', desc: 'Maximum' },
  { v: 'COUNT_DISTINCT', label: 'COUNT_DISTINCT', desc: 'Unique Count' },
];
const OPERATORS = [
  { v: 'eq', label: '=' }, { v: 'neq', label: '≠' },
  { v: 'gt', label: '>' }, { v: 'gte', label: '≥' },
  { v: 'lt', label: '<' }, { v: 'lte', label: '≤' },
  { v: 'contains', label: 'contains' }, { v: 'not_contains', label: 'not contains' },
  { v: 'is_null', label: 'is null' }, { v: 'is_not_null', label: 'is not null' },
];

const TYPE_ICONS = { bar: '📊', line: '📈', pie: '🥧', donut: '🍩', scatter: '✦', table: '📋', kpi: '🔢' };
const TYPE_LABELS = { bar: 'Bar', line: 'Line', pie: 'Pie', donut: 'Donut', scatter: 'Scatter', table: 'Table', kpi: 'KPI' };

function ensurePanel() {
  if (panelEl) return;
  backdropEl = document.createElement('div');
  backdropEl.className = 'qb-backdrop';
  document.body.appendChild(backdropEl);

  panelEl = document.createElement('div');
  panelEl.className = 'qb-panel';
  document.body.appendChild(panelEl);

  backdropEl.addEventListener('click', closeQueryBuilder);
}

function effectiveRole(col) {
  return col.user_overridden_role || col.inferred_role;
}

export async function openQueryBuilder(opts = {}) {
  ensurePanel();
  const datasources = store.get('datasources') || await loadDatasources();
  if (datasources.length === 0) {
    showToast('Upload a dataset first', 'warning');
    return;
  }

  const querySpec = opts.querySpec || {
    datasource_id: datasources[0].id,
    dimensions: [], metrics: [], filters: [], limit: 100, sort_by: null,
  };

  _state = {
    datasourceId: querySpec.datasource_id,
    profile: null,
    dimensions: [...(querySpec.dimensions || [])],
    metrics: [...(querySpec.metrics || [])],
    filters: [...(querySpec.filters || [])],
    sort_by: querySpec.sort_by || null,
    limit: querySpec.limit || 100,
    chartType: opts.chartType || null,
    title: opts.title || '',
    editingChartId: opts.editingChartId || null,
    dashboardId: opts.dashboardId || null,
    lastResult: null,
    recommended: [],
  };
  _userEditedTitle = !!opts.title;

  await loadProfile(_state.datasourceId);

  panelEl.innerHTML = renderShell(datasources);
  panelEl.classList.add('open');
  backdropEl.classList.add('open');
  attachEvents();
  refreshAll();
  schedulePreview();
}

async function loadDatasources() {
  const ds = await api.get('/datasources');
  store.set('datasources', ds);
  return ds;
}

async function loadProfile(id) {
  try {
    _state.profile = await api.get(`/datasources/${id}/profile`);
  } catch (e) {
    showToast(`Profile load failed: ${e.message}`, 'error');
    _state.profile = { columns: [] };
  }
}

function closeQueryBuilder() {
  if (!panelEl) return;
  panelEl.classList.remove('open');
  backdropEl.classList.remove('open');
  if (_miniChart) { _miniChart.destroy(); _miniChart = null; }
}

function renderShell(datasources) {
  return `
    <div class="qb-header">
      <button class="btn-icon" id="qb-close" title="Back">←</button>
      <h3>Query Builder</h3>
      <select class="qb-datasource-select" id="qb-ds-select">
        ${datasources.map(d => `<option value="${d.id}" ${d.id === _state.datasourceId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
      </select>
      <button class="btn-icon" id="qb-x" title="Close">✕</button>
    </div>

    <div class="qb-steps" id="qb-steps">
      <div class="qb-step" data-step="1">
        <span class="qb-step-num">1</span><span>Pick columns</span>
      </div>
      <span class="qb-step-arrow">→</span>
      <div class="qb-step" data-step="2">
        <span class="qb-step-num">2</span><span>Configure</span>
      </div>
      <span class="qb-step-arrow">→</span>
      <div class="qb-step" data-step="3">
        <span class="qb-step-num">3</span><span>Visualize</span>
      </div>
    </div>

    <div class="qb-body">
      <div class="qb-section">
        <input class="qb-search" id="qb-col-search" placeholder="🔎 Search columns...">

        <div class="qb-picker-group">
          <div class="qb-picker-label">
            <span class="dot dot-dim"></span>
            <strong>DIMENSIONS</strong>
            <span class="qb-picker-hint">Group your data by these columns</span>
          </div>
          <div class="qb-column-list" id="qb-col-list-dim"></div>
        </div>

        <div class="qb-picker-group">
          <div class="qb-picker-label">
            <span class="dot dot-met"></span>
            <strong>METRICS</strong>
            <span class="qb-picker-hint">Measure and calculate these numbers</span>
          </div>
          <div class="qb-column-list" id="qb-col-list-met"></div>
        </div>
      </div>

      <div class="qb-summary-box" id="qb-summary" style="display:none;"></div>

      <div class="qb-section qb-shelf-section">
        <div class="qb-shelf-title">
          <span class="dot dot-dim"></span>
          <strong>DIMENSIONS</strong>
          <span class="qb-shelf-sub">— Group by</span>
        </div>
        <div class="qb-shelf qb-shelf-dim" id="qb-dim-shelf" data-kind="dimension">
          <div class="qb-shelf-empty-state">
            <p class="hint">What do you want to break this data down by?</p>
            <p class="example">(e.g. by Product, by Region, by Date)</p>
            <p class="drop-text">Drop a dimension here, or click one above ↑</p>
          </div>
        </div>
      </div>

      <div class="qb-section qb-shelf-section">
        <div class="qb-shelf-title">
          <span class="dot dot-met"></span>
          <strong>METRICS</strong>
          <span class="qb-shelf-sub">— Calculate</span>
        </div>
        <div class="qb-shelf qb-shelf-met" id="qb-met-shelf" data-kind="metric">
          <div class="qb-shelf-empty-state">
            <p class="hint">What numbers do you want to measure?</p>
            <p class="example">(e.g. total Revenue, average Quantity)</p>
            <p class="drop-text">Drop a metric here, or click one above ↑</p>
          </div>
        </div>
      </div>

      <div class="qb-section">
        <div class="qb-section-title">Filters</div>
        <div id="qb-filters"></div>
        <button class="btn btn-secondary" id="qb-add-filter" style="margin-top:6px;">+ Add Filter</button>
      </div>

      <div class="qb-section">
        <div class="qb-section-title">Sort & Limit</div>
        <div class="qb-filter-row">
          <select id="qb-sort-col"><option value="">No sort</option></select>
          <select id="qb-sort-dir"><option value="asc">ASC</option><option value="desc">DESC</option></select>
        </div>
        <label class="form-label" style="margin-top:6px;">Limit: <span id="qb-limit-display">${_state.limit}</span></label>
        <input type="range" min="10" max="5000" step="10" value="${_state.limit}" id="qb-limit-input" style="width:100%;">
      </div>

      <div class="qb-section">
        <div class="qb-section-title">Preview</div>
        <div class="qb-preview" id="qb-preview"></div>
        <div class="qb-preview-meta" id="qb-meta"></div>
      </div>

      <div class="qb-section qb-visualize" id="qb-recommend-section" style="display:none;">
        <div class="qb-section-title">Visualize As</div>
        <p class="qb-rec-hint">Recommended for your data:</p>
        <div class="qb-chart-types" id="qb-chart-types"></div>
        <div class="qb-mini-preview" id="qb-mini-preview"></div>
        <label class="form-label" style="margin-top:8px;">Chart title</label>
        <input class="form-input" id="qb-title" value="${escapeHtml(_state.title)}" placeholder="Auto-generated">
      </div>
    </div>

    <div class="qb-footer">
      <button class="btn btn-primary qb-add-btn" id="qb-add-btn" disabled>${_state.editingChartId ? 'Update Chart' : 'Add to Dashboard'}</button>
    </div>
  `;
}

function attachEvents() {
  panelEl.querySelector('#qb-close').addEventListener('click', closeQueryBuilder);
  panelEl.querySelector('#qb-x').addEventListener('click', closeQueryBuilder);
  panelEl.querySelector('#qb-ds-select').addEventListener('change', async (e) => {
    _state.datasourceId = e.target.value;
    _state.dimensions = []; _state.metrics = []; _state.filters = [];
    await loadProfile(_state.datasourceId);
    refreshAll();
    schedulePreview();
  });
  panelEl.querySelector('#qb-col-search').addEventListener('input', (e) => {
    renderColumnLists(e.target.value);
  });
  panelEl.querySelector('#qb-add-filter').addEventListener('click', () => {
    const cols = (_state.profile?.columns || []);
    if (!cols.length) return;
    _state.filters.push({ column: cols[0].column_name, operator: 'eq', value: '', value_type: cols[0].column_type === 'numeric' ? 'number' : (cols[0].column_type === 'date' ? 'date' : 'string') });
    renderFilters();
    updateSummary();
    schedulePreview();
  });
  panelEl.querySelector('#qb-limit-input').addEventListener('input', (e) => {
    _state.limit = parseInt(e.target.value);
    panelEl.querySelector('#qb-limit-display').textContent = _state.limit;
    schedulePreview();
  });
  panelEl.querySelector('#qb-sort-col').addEventListener('change', updateSort);
  panelEl.querySelector('#qb-sort-dir').addEventListener('change', updateSort);
  panelEl.querySelector('#qb-add-btn').addEventListener('click', addOrUpdateChart);
  panelEl.querySelector('#qb-title').addEventListener('input', (e) => {
    _state.title = e.target.value;
    _userEditedTitle = true;
  });
}

function updateSort() {
  const col = panelEl.querySelector('#qb-sort-col').value;
  const dir = panelEl.querySelector('#qb-sort-dir').value;
  _state.sort_by = col ? { column: col, direction: dir } : null;
  updateSummary();
  schedulePreview();
}

function refreshAll() {
  renderColumnLists('');
  renderShelves();
  renderFilters();
  renderSortOptions();
  updateSummary();
  updateSteps();
  updateAddButton();
}

function renderColumnLists(filter) {
  const cols = (_state.profile?.columns || []);
  const f = (filter || '').toLowerCase();
  const usedCols = new Set([..._state.dimensions.map(d => d.column), ..._state.metrics.map(m => m.column)]);

  const dimCols = cols.filter(c => effectiveRole(c) === 'dimension' && (!f || c.column_name.toLowerCase().includes(f)));
  const metCols = cols.filter(c => effectiveRole(c) === 'metric' && (!f || c.column_name.toLowerCase().includes(f)));

  const renderChip = (c) => {
    const role = effectiveRole(c);
    const used = usedCols.has(c.column_name);
    const icon = c.column_type === 'numeric' ? '#' : c.column_type === 'date' ? '📅' : 'A';
    const cls = c.column_type === 'date' ? 'date' : (role === 'metric' ? 'metric' : 'dimension');
    return `<div class="qb-column-chip ${cls} ${used ? 'added' : ''}"
      draggable="true"
      data-col="${escapeAttr(c.column_name)}"
      data-type="${c.column_type}"
      data-role="${role}">
      <span class="chip-icon">${icon}</span>${escapeHtml(c.column_name)}${used ? ' <span class="chip-check">✓</span>' : ''}
    </div>`;
  };

  const dimList = panelEl.querySelector('#qb-col-list-dim');
  const metList = panelEl.querySelector('#qb-col-list-met');
  dimList.innerHTML = dimCols.length ? dimCols.map(renderChip).join('') : '<span class="qb-empty-hint">No dimension columns</span>';
  metList.innerHTML = metCols.length ? metCols.map(renderChip).join('') : '<span class="qb-empty-hint">No numeric metric columns</span>';

  panelEl.querySelectorAll('.qb-column-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const col = chip.dataset.col;
      const role = chip.dataset.role;
      // If already added, remove
      if (chip.classList.contains('added')) {
        if (role === 'metric') {
          _state.metrics = _state.metrics.filter(m => m.column !== col);
        } else {
          _state.dimensions = _state.dimensions.filter(d => d.column !== col);
        }
      } else {
        if (role === 'metric') {
          _state.metrics.push({ column: col, aggregation: 'SUM', alias: aliasFor(col, 'SUM') });
        } else {
          _state.dimensions.push({ column: col, alias: col });
        }
      }
      refreshAll();
      schedulePreview();
    });
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/col', JSON.stringify({ col: chip.dataset.col, type: chip.dataset.type, role: chip.dataset.role }));
    });
  });
}

function aliasFor(col, agg) {
  return `${(agg || 'sum').toLowerCase()}_${col}`;
}

function renderShelves() {
  const dimShelf = panelEl.querySelector('#qb-dim-shelf');
  const metShelf = panelEl.querySelector('#qb-met-shelf');

  if (_state.dimensions.length) {
    dimShelf.innerHTML = _state.dimensions.map((d, i) => `
      <span class="qb-pill pill-dim">
        <span class="pill-icon">A</span>
        ${escapeHtml(d.column)}
        <button data-rm-dim="${i}" title="Remove">×</button>
      </span>`).join('') + '<button class="qb-add-another" id="qb-add-another-dim">+ Add another</button>';
  } else {
    dimShelf.innerHTML = `
      <div class="qb-shelf-empty-state">
        <p class="hint">What do you want to break this data down by?</p>
        <p class="example">(e.g. by Product, by Region, by Date)</p>
        <p class="drop-text">Drop a dimension here, or click one above ↑</p>
      </div>`;
  }

  if (_state.metrics.length) {
    metShelf.innerHTML = _state.metrics.map((m, i) => `
      <span class="qb-pill pill-met">
        <button class="agg-btn" data-agg-idx="${i}">${m.aggregation}</button>
        ${escapeHtml(m.column)}
        <button data-rm-met="${i}" title="Remove">×</button>
      </span>`).join('') + '<button class="qb-add-another" id="qb-add-another-met">+ Add another</button>';
  } else {
    metShelf.innerHTML = `
      <div class="qb-shelf-empty-state">
        <p class="hint">What numbers do you want to measure?</p>
        <p class="example">(e.g. total Revenue, average Quantity)</p>
        <p class="drop-text">Drop a metric here, or click one above ↑</p>
      </div>`;
  }

  dimShelf.querySelectorAll('[data-rm-dim]').forEach(b => {
    b.addEventListener('click', () => {
      _state.dimensions.splice(parseInt(b.dataset.rmDim), 1);
      refreshAll(); schedulePreview();
    });
  });
  metShelf.querySelectorAll('[data-rm-met]').forEach(b => {
    b.addEventListener('click', () => {
      _state.metrics.splice(parseInt(b.dataset.rmMet), 1);
      refreshAll(); schedulePreview();
    });
  });
  metShelf.querySelectorAll('[data-agg-idx]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      showAggPopover(b, parseInt(b.dataset.aggIdx));
    });
  });
  panelEl.querySelector('#qb-add-another-dim')?.addEventListener('click', () => {
    panelEl.querySelector('#qb-col-search').focus();
  });
  panelEl.querySelector('#qb-add-another-met')?.addEventListener('click', () => {
    panelEl.querySelector('#qb-col-search').focus();
  });

  setupDropTarget(dimShelf, 'dimension');
  setupDropTarget(metShelf, 'metric');
}

function setupDropTarget(el, kind) {
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/col')); } catch { return; }

    const isMetricCol = data.role === 'metric';
    const wantsMetric = kind === 'metric';

    if (isMetricCol !== wantsMetric) {
      // Wrong shelf — reject
      const msg = wantsMetric
        ? "This is a text column — add it to Dimensions instead"
        : "This is a number column — add it to Metrics instead";
      el.classList.add('shake', 'reject');
      setTimeout(() => el.classList.remove('shake', 'reject'), 600);
      showToast(msg, 'warning', 3000);
      return;
    }

    if (kind === 'dimension') {
      if (!_state.dimensions.find(d => d.column === data.col)) {
        _state.dimensions.push({ column: data.col, alias: data.col });
      }
    } else {
      if (!_state.metrics.find(m => m.column === data.col)) {
        _state.metrics.push({ column: data.col, aggregation: 'SUM', alias: aliasFor(data.col, 'SUM') });
      }
    }
    refreshAll();
    schedulePreview();
  });
}

function showAggPopover(anchor, idx) {
  document.querySelectorAll('.qb-popover').forEach(p => p.remove());
  const pop = document.createElement('div');
  pop.className = 'qb-popover';
  pop.innerHTML = AGGS.map(a => `
    <button data-agg="${a.v}">
      <strong>${a.label}</strong> <span class="agg-desc">${a.desc}</span>
    </button>`).join('');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  pop.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      _state.metrics[idx].aggregation = b.dataset.agg;
      _state.metrics[idx].alias = aliasFor(_state.metrics[idx].column, b.dataset.agg);
      pop.remove();
      refreshAll();
      schedulePreview();
    });
  });
  setTimeout(() => {
    document.addEventListener('click', () => pop.remove(), { once: true });
  }, 50);
}

function renderFilters() {
  const host = panelEl.querySelector('#qb-filters');
  const cols = _state.profile?.columns || [];
  if (_state.filters.length === 0) {
    host.innerHTML = '<div style="font-size:11px;color:var(--color-text-muted);">No filters applied</div>';
    return;
  }
  host.innerHTML = _state.filters.map((f, i) => `
    <div class="qb-filter-row" data-i="${i}">
      <select class="f-col">${cols.map(c => `<option value="${escapeAttr(c.column_name)}" ${c.column_name === f.column ? 'selected' : ''}>${escapeHtml(c.column_name)}</option>`).join('')}</select>
      <select class="f-op">${OPERATORS.map(o => `<option value="${o.v}" ${o.v === f.operator ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <input class="f-val" value="${escapeAttr(f.value ?? '')}" placeholder="value">
      <button class="btn-icon f-rm" title="Remove filter">×</button>
    </div>
  `).join('');
  host.querySelectorAll('.qb-filter-row').forEach(row => {
    const i = parseInt(row.dataset.i);
    row.querySelector('.f-col').addEventListener('change', e => { _state.filters[i].column = e.target.value; updateSummary(); schedulePreview(); });
    row.querySelector('.f-op').addEventListener('change', e => { _state.filters[i].operator = e.target.value; updateSummary(); schedulePreview(); });
    row.querySelector('.f-val').addEventListener('input', e => { _state.filters[i].value = e.target.value; updateSummary(); schedulePreview(); });
    row.querySelector('.f-rm').addEventListener('click', () => {
      _state.filters.splice(i, 1); renderFilters(); updateSummary(); schedulePreview();
    });
  });
}

function renderSortOptions() {
  const sel = panelEl.querySelector('#qb-sort-col');
  if (!sel) return;
  const cols = [..._state.dimensions.map(d => d.column), ..._state.metrics.map(m => m.alias)];
  sel.innerHTML = '<option value="">No sort</option>' + cols.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if (_state.sort_by) sel.value = _state.sort_by.column;
}

function updateSummary() {
  const host = panelEl.querySelector('#qb-summary');
  if (!host) return;
  const summary = plainEnglishSummary(buildQuerySpec(), _state.profile);
  if (!summary) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }
  host.style.display = '';
  host.innerHTML = summary;
}

function updateSteps() {
  const stepEl = panelEl.querySelector('#qb-steps');
  if (!stepEl) return;
  const hasCols = _state.dimensions.length > 0 || _state.metrics.length > 0;
  const hasPreview = !!_state.lastResult;
  const hasViz = hasPreview && !!_state.chartType;

  stepEl.querySelectorAll('.qb-step').forEach(s => {
    const n = parseInt(s.dataset.step);
    s.classList.remove('active', 'complete');
    if (n === 1) {
      if (hasCols) s.classList.add('complete');
      else s.classList.add('active');
    } else if (n === 2) {
      if (hasPreview) s.classList.add('complete');
      else if (hasCols) s.classList.add('active');
    } else if (n === 3) {
      if (hasViz) s.classList.add('complete');
      else if (hasPreview) s.classList.add('active');
    }
  });
}

function updateAddButton() {
  const btn = panelEl.querySelector('#qb-add-btn');
  if (!btn) return;
  const ready = _state.dimensions.length > 0 && _state.metrics.length > 0 && _state.lastResult && _state.chartType;
  btn.disabled = !ready;
}

function buildQuerySpec() {
  return {
    datasource_id: _state.datasourceId,
    dimensions: _state.dimensions,
    metrics: _state.metrics,
    filters: _state.filters.filter(f => f.column),
    sort_by: _state.sort_by,
    limit: _state.limit,
  };
}

function schedulePreview() {
  clearTimeout(_previewTimeout);
  updateSummary();
  updateSteps();
  updateAddButton();
  _previewTimeout = setTimeout(runPreview, 500);
}

async function runPreview() {
  const preview = panelEl.querySelector('#qb-preview');
  const meta = panelEl.querySelector('#qb-meta');
  if (!preview) return;

  if (!_state.dimensions.length && !_state.metrics.length) {
    preview.innerHTML = `
      <div class="qb-preview-hint">
        <div class="qb-hint-arrows">↑ ↑</div>
        <p>Add a dimension and a metric above to preview your results</p>
      </div>`;
    meta.textContent = '';
    panelEl.querySelector('#qb-recommend-section').style.display = 'none';
    _state.lastResult = null;
    updateSteps();
    updateAddButton();
    return;
  }

  // Skeleton
  const colCount = _state.dimensions.length + _state.metrics.length || 3;
  preview.innerHTML = `<table class="data-table"><thead><tr>${
    Array.from({ length: colCount }, () => '<th><div class="skeleton" style="height:10px;width:60%;"></div></th>').join('')
  }</tr></thead><tbody>${
    Array.from({ length: 5 }, () => `<tr>${Array.from({ length: colCount }, () => '<td><div class="skeleton" style="height:10px;"></div></td>').join('')}</tr>`).join('')
  }</tbody></table>`;
  meta.textContent = '';

  try {
    const spec = buildQuerySpec();
    const result = await api.post('/queries/preview', spec);
    _state.lastResult = result;
    _state.recommended = result.recommended_chart_types || ['table'];
    if (!_state.chartType || !_state.recommended.includes(_state.chartType)) {
      _state.chartType = _state.recommended[0];
    }
    renderPreviewTable(result);
    renderRecommendations();
    renderMiniPreview();
    autoTitle();
  } catch (e) {
    preview.innerHTML = `<div class="qb-error-card">⚠️ ${escapeHtml(e.message)}</div>`;
    meta.textContent = '';
    _state.lastResult = null;
    panelEl.querySelector('#qb-recommend-section').style.display = 'none';
  }
  updateSteps();
  updateAddButton();
}

function renderPreviewTable(result) {
  const cols = result.columns || [];
  const rows = result.rows || [];
  let html = '<table class="data-table"><thead><tr>';
  cols.forEach((c, i) => {
    const numeric = rows.length > 0 && typeof rows[0][i] === 'number';
    html += `<th class="${numeric ? 'numeric' : ''}">${escapeHtml(c)}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr>';
    r.forEach(v => {
      const numeric = typeof v === 'number';
      const formatted = numeric
        ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : (v == null ? '' : escapeHtml(String(v)));
      html += `<td class="${numeric ? 'numeric' : ''}">${formatted}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  panelEl.querySelector('#qb-preview').innerHTML = html;
  panelEl.querySelector('#qb-meta').innerHTML =
    `<strong>${result.total_row_count?.toLocaleString() || 0}</strong> total rows · ${result.execution_time_ms}ms ${result.cache_hit ? '⚡ Cached' : '🔄 Fresh'}`;
}

function renderRecommendations() {
  const sec = panelEl.querySelector('#qb-recommend-section');
  sec.style.display = '';
  const types = _state.recommended;
  const recommended = types[0];
  const host = panelEl.querySelector('#qb-chart-types');
  host.innerHTML = types.map(t => `
    <div class="qb-chart-type ${t === _state.chartType ? 'selected' : ''}" data-type="${t}">
      <span class="icon">${TYPE_ICONS[t] || '📊'}</span>
      <span class="label">${TYPE_LABELS[t] || t}</span>
      ${t === recommended ? '<span class="rec-badge">★</span>' : ''}
    </div>
  `).join('');
  host.querySelectorAll('.qb-chart-type').forEach(el => {
    el.addEventListener('click', () => {
      _state.chartType = el.dataset.type;
      renderRecommendations();
      renderMiniPreview();
      updateAddButton();
      updateSteps();
    });
  });
}

async function renderMiniPreview() {
  const host = panelEl.querySelector('#qb-mini-preview');
  if (!host) return;
  host.innerHTML = '';
  if (_miniChart) { _miniChart.destroy(); _miniChart = null; }
  if (!_state.lastResult) return;
  const cfg = { query_spec: buildQuerySpec(), chart_type: _state.chartType, title: '' };
  await renderChart(cfg, host, { interactive: false, compact: true, silentValidation: true });
}

function autoTitle() {
  const titleInput = panelEl.querySelector('#qb-title');
  if (!titleInput || _userEditedTitle) return;
  const t = generateChartTitle(buildQuerySpec(), _state.profile);
  titleInput.value = t;
  _state.title = t;
}

async function addOrUpdateChart() {
  const title = (panelEl.querySelector('#qb-title')?.value?.trim()) || generateChartTitle(buildQuerySpec(), _state.profile) || 'Untitled chart';
  const spec = buildQuerySpec();

  try {
    if (_state.editingChartId) {
      await api.patch(`/charts/${_state.editingChartId}`, {
        title, query_spec: spec, chart_type: _state.chartType,
      });
      showToast('Chart updated', 'success');
    } else {
      const dashboardId = _state.dashboardId || store.get('activeDashboardId');
      if (!dashboardId) {
        showToast('Open a dashboard first', 'warning');
        return;
      }
      await api.post('/charts', {
        title, dashboard_id: dashboardId, datasource_id: _state.datasourceId,
        query_spec: spec, chart_type: _state.chartType, visual_config: {},
        width: 6, height: 4, position_x: 0, position_y: 0,
      });
      showToast('Chart added to dashboard', 'success');
    }
    closeQueryBuilder();
    window.dispatchEvent(new CustomEvent('chartsChanged'));
    if (window.location.hash !== '#dashboard') window.location.hash = '#dashboard';
  } catch (e) {
    showToast(`Failed: ${e.message}`, 'error');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function escapeAttr(s) { return escapeHtml(s); }
