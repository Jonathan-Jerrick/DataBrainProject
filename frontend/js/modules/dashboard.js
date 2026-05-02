import { api } from '../utils/api.js';
import { store } from '../utils/state.js';
import { showToast } from '../utils/toast.js';
import { can, canEditChart, applyPermissions } from './permissions.js';
import { renderChart, exportChartCSV, formatNumber, getChartBorderColor } from './chartRenderer.js';
import { openQueryBuilder } from './queryBuilder.js';

let _activeContainer = null;
let _chartResults = new Map();

export async function renderDashboardPage(container) {
  _activeContainer = container;
  container.classList.add('dashboard-bg');
  container.innerHTML = `<div class="dashboard-page">
    <div class="skeleton" style="height:80px;border-radius:12px;"></div>
    <div class="kpi-row">
      ${Array.from({ length: 4 }, () => '<div class="skeleton" style="height:90px;border-radius:12px;"></div>').join('')}
    </div>
    <div class="skeleton" style="height:300px;border-radius:12px;"></div>
  </div>`;

  let dashboards = [];
  try {
    dashboards = await api.get('/dashboards');
    store.set('dashboards', dashboards);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h2>Failed to load: ${e.message}</h2></div>`;
    return;
  }

  if (dashboards.length === 0) {
    container.innerHTML = `<div class="empty-state"><h2>No dashboards available</h2></div>`;
    return;
  }

  const activeId = store.get('activeDashboardId') || dashboards[0].id;
  store.set('activeDashboardId', activeId);

  await renderDashboard(container, dashboards, activeId);
}

async function renderDashboard(container, dashboards, activeId) {
  const active = dashboards.find(d => d.id === activeId) || dashboards[0];
  const charts = await api.get(`/dashboards/${active.id}/charts`);
  store.set('charts', charts);
  window._charts = charts;

  // Datasets — for KPI summary computation and welcome header
  let datasources = store.get('datasources');
  if (!datasources) {
    try { datasources = await api.get('/datasources'); store.set('datasources', datasources); } catch { datasources = []; }
  }
  const primaryDs = datasources[0];
  const user = store.get('activeUser');

  container.innerHTML = `
    <div class="dashboard-page">
      <div class="dashboard-welcome">
        <div>
          <div class="welcome-title">${greeting()}, ${user ? escapeHtml(user.name.split(' ')[0]) : 'there'} 👋</div>
          <div class="welcome-sub">
            ${escapeHtml(active.name)} · <strong>${charts.length}</strong> chart${charts.length === 1 ? '' : 's'}
            ${primaryDs ? ` · ${escapeHtml(primaryDs.name)}` : ''}
          </div>
        </div>
        <div class="welcome-meta">Last updated: <strong>just now</strong></div>
      </div>

      <div class="kpi-row" id="kpi-row"></div>

      <div class="dashboard-toolbar">
        <div class="dashboard-tabs" id="dash-tabs">
          ${dashboards.map(d => `
            <div class="tab ${d.id === active.id ? 'active' : ''}" data-id="${d.id}">${escapeHtml(d.name)}</div>
          `).join('')}
          ${can('create_dashboard') ? '<button class="tab tab-add" id="add-dash">+ New</button>' : ''}
        </div>
        <div>
          ${can('create_chart') ? '<button class="btn btn-primary" id="new-chart-btn">+ New Chart</button>' : ''}
        </div>
      </div>

      <div class="global-filter-bar" id="filter-bar">
        <strong style="font-size:12px;">Filters:</strong>
        <span id="filter-chips" style="font-size:11px;color:var(--color-text-muted);">No filters applied</span>
        ${can('apply_filters') || can('apply_temp_filters') ? '<button class="btn btn-secondary" id="add-global-filter" style="font-size:11px;padding:4px 10px;">+ Add</button>' : ''}
        ${user?.role === 'viewer' ? '<small style="color:var(--color-text-muted);margin-left:auto;">Temporary — won\'t be saved</small>' : ''}
      </div>

      <div id="chart-area"></div>

      ${can('create_chart') ? '<button class="floating-add-btn" id="floating-add" title="Add chart">+</button>' : ''}
    </div>
  `;
  applyPermissions(container);

  container.querySelectorAll('.dashboard-tabs .tab[data-id]').forEach(tab => {
    tab.addEventListener('click', () => {
      store.set('activeDashboardId', tab.dataset.id);
      renderDashboardPage(container);
    });
  });
  container.querySelector('#add-dash')?.addEventListener('click', async () => {
    const name = prompt('Dashboard name:');
    if (!name) return;
    try {
      const d = await api.post('/dashboards', { name, visibility: 'workspace' });
      showToast('Dashboard created', 'success');
      store.set('activeDashboardId', d.id);
      renderDashboardPage(container);
    } catch (e) { showToast(e.message, 'error'); }
  });
  const openBuilder = () => {
    if (!primaryDs) {
      showToast('Upload a dataset first', 'warning');
      window.location.hash = '#datasets';
      return;
    }
    openQueryBuilder({ dashboardId: active.id });
  };
  container.querySelector('#new-chart-btn')?.addEventListener('click', openBuilder);
  container.querySelector('#floating-add')?.addEventListener('click', openBuilder);

  renderKpiRow(primaryDs);
  renderChartArea(charts, active.id, primaryDs);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

async function renderKpiRow(primaryDs) {
  const host = document.getElementById('kpi-row');
  if (!host) return;

  if (!primaryDs) {
    host.innerHTML = Array.from({ length: 4 }, (_, i) => `
      <div class="kpi-summary-card border-${i}">
        <div class="kpi-summary-label">No data</div>
        <div class="kpi-summary-value">—</div>
        <div class="kpi-summary-sub">Upload a dataset</div>
      </div>`).join('');
    return;
  }

  // Get profile to find the first numeric column
  let profile;
  try {
    profile = await api.get(`/datasources/${primaryDs.id}/profile`);
  } catch {
    host.innerHTML = '';
    return;
  }
  const numCols = (profile.columns || []).filter(c => c.column_type === 'numeric' && (c.user_overridden_role || c.inferred_role) === 'metric');
  const firstMetric = numCols[0];
  const secondMetric = numCols[1];

  const cards = [];
  if (firstMetric) {
    cards.push({ label: `Total ${titleCase(firstMetric.column)}`, query: { aggregation: 'SUM', col: firstMetric.column }, sub: 'across all rows' });
    cards.push({ label: `Average ${titleCase(firstMetric.column)}`, query: { aggregation: 'AVG', col: firstMetric.column }, sub: 'per row' });
  }
  if (secondMetric) {
    cards.push({ label: `Total ${titleCase(secondMetric.column)}`, query: { aggregation: 'SUM', col: secondMetric.column }, sub: 'across all rows' });
  }
  cards.push({ label: 'Data Points', value: primaryDs.row_count?.toLocaleString() || '0', sub: 'rows total' });

  // Pad to 4
  while (cards.length < 4) cards.push({ label: '—', value: '—', sub: '' });

  host.innerHTML = cards.slice(0, 4).map((c, i) => `
    <div class="kpi-summary-card border-${i}" data-idx="${i}">
      <div class="kpi-summary-label">${escapeHtml(c.label)}</div>
      <div class="kpi-summary-value">${c.value !== undefined ? escapeHtml(c.value) : '<div class="skeleton" style="height:24px;width:80px;margin-top:4px;"></div>'}</div>
      <div class="kpi-summary-sub">${escapeHtml(c.sub || '')}</div>
    </div>`).join('');

  // Resolve the queried KPI values
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (!c.query) continue;
    try {
      const r = await api.post('/queries/execute', {
        datasource_id: primaryDs.id,
        dimensions: [],
        metrics: [{ column: c.query.col, aggregation: c.query.aggregation, alias: 'v' }],
        filters: [],
        limit: 1,
      });
      const v = r.rows?.[0]?.[0];
      const card = host.querySelector(`[data-idx="${i}"] .kpi-summary-value`);
      if (card) card.textContent = typeof v === 'number' ? formatNumber(v) : (v ?? '—');
    } catch {
      const card = host.querySelector(`[data-idx="${i}"] .kpi-summary-value`);
      if (card) card.textContent = '—';
    }
  }
}

function renderChartArea(charts, dashboardId, primaryDs) {
  const host = document.getElementById('chart-area');
  if (!host) return;

  if (!charts.length) {
    host.innerHTML = `
      <div class="empty-dashboard">
        <svg viewBox="0 0 80 80" width="80" height="80" stroke="#CBD5E1" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="6" width="68" height="68" rx="6"/>
          <line x1="20" y1="56" x2="20" y2="42"/>
          <line x1="34" y1="56" x2="34" y2="28"/>
          <line x1="48" y1="56" x2="48" y2="36"/>
          <line x1="62" y1="56" x2="62" y2="22"/>
          <line x1="14" y1="62" x2="68" y2="62"/>
        </svg>
        <h2>Your dashboard is empty</h2>
        <p>Create your first chart using the Query Builder to start visualizing your data.</p>
        <div class="empty-actions">
          ${can('create_chart') ? '<button class="btn btn-primary" id="empty-new-chart">+ New Chart</button>' : ''}
          ${can('create_chart') && primaryDs ? '<button class="btn btn-secondary" id="empty-sample">Try Sample Charts</button>' : ''}
        </div>
      </div>`;
    document.getElementById('empty-new-chart')?.addEventListener('click', () => {
      if (!primaryDs) { showToast('Upload a dataset first', 'warning'); window.location.hash = '#datasets'; return; }
      openQueryBuilder({ dashboardId });
    });
    document.getElementById('empty-sample')?.addEventListener('click', () => createSampleCharts(dashboardId, primaryDs));
    return;
  }

  host.innerHTML = `<div class="chart-grid" id="chart-grid"></div>`;
  const grid = document.getElementById('chart-grid');
  charts.forEach((chart, i) => grid.appendChild(buildChartCard(chart, i)));
  applyPermissions(host);
}

async function createSampleCharts(dashboardId, primaryDs) {
  if (!primaryDs) { showToast('No dataset available', 'warning'); return; }
  let profile;
  try { profile = await api.get(`/datasources/${primaryDs.id}/profile`); }
  catch (e) { showToast(e.message, 'error'); return; }

  const cols = profile.columns || [];
  const numericMetrics = cols.filter(c => c.column_type === 'numeric' && (c.user_overridden_role || c.inferred_role) === 'metric');
  const dateCols = cols.filter(c => c.column_type === 'date');
  const stringCols = cols.filter(c => c.column_type === 'string');

  if (!numericMetrics.length || (!stringCols.length && !dateCols.length)) {
    showToast('Sample charts need a numeric metric and a dimension', 'warning');
    return;
  }

  const m = numericMetrics[0];
  const sample = [];

  if (stringCols.length) {
    sample.push({
      title: `${titleCase(m.column)} by ${titleCase(stringCols[0].column)}`,
      chart_type: 'bar',
      query_spec: {
        datasource_id: primaryDs.id,
        dimensions: [{ column: stringCols[0].column, alias: stringCols[0].column }],
        metrics: [{ column: m.column, aggregation: 'SUM', alias: `sum_${m.column}` }],
        filters: [], limit: 50,
      },
    });
  }

  if (dateCols.length) {
    sample.push({
      title: `${titleCase(m.column)} Over Time`,
      chart_type: 'line',
      query_spec: {
        datasource_id: primaryDs.id,
        dimensions: [{ column: dateCols[0].column, alias: dateCols[0].column }],
        metrics: [{ column: m.column, aggregation: 'SUM', alias: `sum_${m.column}` }],
        filters: [], limit: 200,
      },
    });
  }

  if (stringCols.length > 1) {
    sample.push({
      title: `${titleCase(m.column)} by ${titleCase(stringCols[1].column)}`,
      chart_type: 'donut',
      query_spec: {
        datasource_id: primaryDs.id,
        dimensions: [{ column: stringCols[1].column, alias: stringCols[1].column }],
        metrics: [{ column: m.column, aggregation: 'SUM', alias: `sum_${m.column}` }],
        filters: [], limit: 8,
      },
    });
  }

  showToast('Creating sample charts…', 'info', 2000);
  for (const c of sample) {
    try {
      await api.post('/charts', {
        title: c.title,
        dashboard_id: dashboardId,
        datasource_id: primaryDs.id,
        query_spec: c.query_spec,
        chart_type: c.chart_type,
        visual_config: {},
        width: c.chart_type === 'line' ? 12 : 6,
        height: 4, position_x: 0, position_y: 0,
      });
    } catch (e) {
      console.error(e);
    }
  }
  showToast('Sample charts added', 'success');
  window.dispatchEvent(new CustomEvent('chartsChanged'));
}

function buildChartCard(chart, index) {
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.dataset.chartId = chart.id;
  const isWide = chart.chart_type === 'line' || (chart.width && chart.width >= 10);
  card.style.gridColumn = `span ${isWide ? 12 : Math.min(chart.width || 6, 12)}`;
  card.style.setProperty('--card-accent', getChartBorderColor(index));

  const editable = canEditChart(chart);
  const broken = chart.status === 'broken';
  if (broken) card.classList.add('broken');

  card.innerHTML = `
    <div class="chart-card-header">
      <h3 class="chart-title" ${editable ? 'data-editable="true"' : ''}>${escapeHtml(chart.title)}</h3>
      <div class="chart-card-actions">
        <button class="btn-icon" data-action="fullscreen" title="Fullscreen">⛶</button>
        ${editable ? '<button class="btn-icon" data-action="edit" title="Edit chart">✏</button>' : ''}
        <div class="dropdown">
          <button class="btn-icon" data-action="menu">⋮</button>
          <div class="dropdown-menu">
            ${can('duplicate_any_chart') ? '<button data-action="duplicate">Duplicate</button>' : ''}
            ${can('export_chart') ? '<button data-action="export-png">Export PNG</button>' : ''}
            ${can('export_chart') ? '<button data-action="export-csv">Export CSV</button>' : ''}
            ${editable ? '<button data-action="delete" class="danger">Delete</button>' : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="chart-card-body" data-body></div>
    <div class="chart-card-footer">
      <span class="chart-meta">${escapeHtml(describeQuery(chart.query_spec))}</span>
      <span class="chart-meta-right">Refreshed just now</span>
    </div>
    ${editable && !broken ? '<div class="chart-resize-handle"></div>' : ''}
  `;

  const body = card.querySelector('[data-body]');

  if (broken) {
    body.innerHTML = `
      <div class="chart-broken-state">
        <div class="broken-icon">⚠️</div>
        <h4>Chart Unavailable</h4>
        <p>${escapeHtml(chart.broken_reason || 'The data source for this chart is unavailable.')}</p>
        <div class="broken-actions">
          ${editable ? '<button class="btn btn-secondary" data-action="edit-broken">Edit Chart</button>' : ''}
          ${editable ? '<button class="btn btn-danger" data-action="remove-broken">Remove Chart</button>' : ''}
        </div>
      </div>`;
  } else {
    renderChart(chart, body).then(result => {
      if (result) _chartResults.set(chart.id, result);
    });
  }

  if (editable && !broken) {
    const titleEl = card.querySelector('.chart-title');
    titleEl.addEventListener('click', () => { titleEl.setAttribute('contenteditable', 'true'); titleEl.focus(); });
    titleEl.addEventListener('blur', async () => {
      titleEl.removeAttribute('contenteditable');
      const newTitle = titleEl.textContent.trim();
      if (newTitle && newTitle !== chart.title) {
        try { await api.patch(`/charts/${chart.id}`, { title: newTitle }); chart.title = newTitle; showToast('Title updated', 'success'); }
        catch (e) { showToast(e.message, 'error'); titleEl.textContent = chart.title; }
      }
    });
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
      if (e.key === 'Escape') { titleEl.textContent = chart.title; titleEl.blur(); }
    });
  }

  card.querySelector('[data-action="fullscreen"]')?.addEventListener('click', () => fullscreen(chart));
  const editAction = () => openQueryBuilder({
    querySpec: chart.query_spec, chartType: chart.chart_type,
    title: chart.title, editingChartId: chart.id, dashboardId: chart.dashboard_id,
  });
  card.querySelector('[data-action="edit"]')?.addEventListener('click', editAction);
  card.querySelector('[data-action="edit-broken"]')?.addEventListener('click', editAction);
  card.querySelector('[data-action="remove-broken"]')?.addEventListener('click', async () => {
    if (!confirm(`Remove chart "${chart.title}"?`)) return;
    try { await api.del(`/charts/${chart.id}`); showToast('Removed', 'success'); window.dispatchEvent(new CustomEvent('chartsChanged')); }
    catch (e) { showToast(e.message, 'error'); }
  });

  const menuBtn = card.querySelector('[data-action="menu"]');
  const dropdown = card.querySelector('.dropdown');
  if (menuBtn && dropdown) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown.open').forEach(d => d !== dropdown && d.classList.remove('open'));
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
  }
  card.querySelector('[data-action="duplicate"]')?.addEventListener('click', async () => {
    try { await api.post(`/charts/${chart.id}/duplicate`); showToast('Duplicated', 'success'); window.dispatchEvent(new CustomEvent('chartsChanged')); }
    catch (e) { showToast(e.message, 'error'); }
  });
  card.querySelector('[data-action="export-png"]')?.addEventListener('click', () => {
    const canvas = card.querySelector('canvas');
    if (canvas) {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${chart.title}.png`;
      a.click();
    } else { showToast('Cannot export this chart type as PNG', 'warning'); }
  });
  card.querySelector('[data-action="export-csv"]')?.addEventListener('click', () => {
    const r = _chartResults.get(chart.id);
    if (r) exportChartCSV(r, `${chart.title}.csv`);
    else showToast('No data loaded', 'warning');
  });
  card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`Delete chart "${chart.title}"?`)) return;
    try { await api.del(`/charts/${chart.id}`); showToast('Deleted', 'success'); window.dispatchEvent(new CustomEvent('chartsChanged')); }
    catch (e) { showToast(e.message, 'error'); }
  });

  if (editable && !broken) {
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/chart-id', chart.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.chart-card.drop-target').forEach(c => c.classList.remove('drop-target'));
    });
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drop-target'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drop-target');
      const id = e.dataTransfer.getData('text/chart-id');
      if (id && id !== chart.id) reorderCharts(id, chart.id);
    });

    const handle = card.querySelector('.chart-resize-handle');
    let startX = 0, startW = 0;
    handle?.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startW = chart.width || 6;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const cellW = card.parentElement.getBoundingClientRect().width / 12;
        const delta = Math.round(dx / cellW);
        const newW = Math.max(3, Math.min(12, startW + delta));
        card.style.gridColumn = `span ${newW}`;
        chart._tmpWidth = newW;
      };
      const onUp = async () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (chart._tmpWidth && chart._tmpWidth !== chart.width) {
          try { await api.patch(`/charts/${chart.id}`, { width: chart._tmpWidth }); chart.width = chart._tmpWidth; }
          catch (e) { showToast(e.message, 'error'); }
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  return card;
}

async function reorderCharts(draggedId, targetId) {
  const charts = store.get('charts') || [];
  const dragged = charts.find(c => c.id === draggedId);
  const target = charts.find(c => c.id === targetId);
  if (!dragged || !target) return;
  const di = charts.indexOf(dragged);
  const ti = charts.indexOf(target);
  charts.splice(di, 1);
  charts.splice(ti, 0, dragged);
  store.set('charts', charts);
  const grid = document.getElementById('chart-grid');
  if (grid) {
    grid.innerHTML = '';
    charts.forEach((c, i) => grid.appendChild(buildChartCard(c, i)));
    applyPermissions(grid.parentElement);
  }
}

function fullscreen(chart) {
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal-fullscreen-chart">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2>${escapeHtml(chart.title)}</h2>
        <button class="btn-icon" id="fs-close">✕</button>
      </div>
      <div style="flex:1;position:relative;" id="fs-body"></div>
    </div>`;
  overlay.classList.remove('hidden');
  renderChart(chart, document.getElementById('fs-body'));
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.getElementById('fs-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function describeQuery(spec) {
  const dims = (spec.dimensions || []).map(d => d.column).join(', ');
  const mets = (spec.metrics || []).map(m => `${m.aggregation}(${m.column})`).join(', ');
  if (dims && mets) return `${mets} by ${dims}`;
  if (mets) return mets;
  if (dims) return dims;
  return 'Empty query';
}

function titleCase(s) {
  return String(s).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

window.addEventListener('chartsChanged', () => {
  if (_activeContainer && window.location.hash.startsWith('#dashboard')) {
    renderDashboardPage(_activeContainer);
  }
});
