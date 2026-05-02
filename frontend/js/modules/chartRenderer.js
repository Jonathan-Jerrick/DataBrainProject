import { api } from '../utils/api.js';
import { showToast } from '../utils/toast.js';

const PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6'];
const CARD_BORDER_PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6'];

// Set Chart.js defaults
if (window.Chart) {
  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#475569';
  Chart.defaults.plugins.tooltip.backgroundColor = '#0F172A';
  Chart.defaults.plugins.tooltip.titleColor = '#F8FAFC';
  Chart.defaults.plugins.tooltip.bodyColor = '#CBD5E1';
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.boxPadding = 6;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 12 };
  Chart.defaults.animation.duration = 600;
  Chart.defaults.animation.easing = 'easeInOutQuart';
}

export function getChartBorderColor(index) {
  return CARD_BORDER_PALETTE[index % CARD_BORDER_PALETTE.length];
}

export function formatAxisTick(value) {
  if (value == null) return '';
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}

export function formatNumber(n) {
  if (n == null) return '—';
  if (typeof n !== 'number') return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export async function renderChart(chartConfig, containerEl, opts = {}) {
  if (!containerEl) return null;
  containerEl.innerHTML = buildSkeletonHtml(chartConfig.chart_type);

  let result;
  try {
    result = await api.post('/queries/execute', chartConfig.query_spec);
  } catch (e) {
    containerEl.innerHTML = `<div class="chart-error">⚠️ ${escapeHtml(e.message)}</div>`;
    return null;
  }

  const type = chartConfig.chart_type;
  containerEl.innerHTML = '';

  if (type === 'table') {
    renderTable(result, containerEl);
    return result;
  }
  if (type === 'kpi') {
    renderKpi(chartConfig, result, containerEl);
    return result;
  }

  const canvas = document.createElement('canvas');
  containerEl.appendChild(canvas);

  const data = transformData(result, chartConfig);
  if (!data) {
    containerEl.innerHTML = `<div class="chart-error">No data to display</div>`;
    return result;
  }

  // Validate numeric data for chart types that need numbers
  if (['bar', 'line', 'scatter'].includes(type)) {
    let bad = 0;
    data.datasets.forEach(ds => {
      ds.data = ds.data.map(v => {
        if (type === 'scatter') {
          if (!v || isNaN(v.x) || isNaN(v.y)) { bad++; return { x: 0, y: 0 }; }
          return v;
        }
        const n = Number(v);
        if (isNaN(n) || n == null) { bad++; return 0; }
        return n;
      });
    });
    if (bad > 0 && opts.silentValidation !== true) {
      showToast("Some values couldn't be displayed — check your metric column selection.", 'warning');
    }
  }

  const cfg = buildChartJsConfig(type, data, chartConfig, opts);
  const chart = new Chart(canvas, cfg);

  if (opts.interactive !== false) {
    canvas.onclick = (evt) => {
      const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
      if (points.length > 0) {
        const idx = points[0].index;
        const label = data.labels?.[idx];
        if (label != null) {
          window.dispatchEvent(new CustomEvent('chartDrilldown', {
            detail: { chart: chartConfig, value: label, index: idx }
          }));
        }
      }
    };
  }

  return result;
}

function transformData(result, chartConfig) {
  const cols = result.columns || [];
  const rows = result.rows || [];
  if (!cols.length || !rows.length) return null;

  const dims = chartConfig.query_spec.dimensions || [];
  const metrics = chartConfig.query_spec.metrics || [];
  const type = chartConfig.chart_type;

  if (type === 'scatter' && metrics.length >= 2) {
    const xIdx = cols.indexOf(metrics[0].alias);
    const yIdx = cols.indexOf(metrics[1].alias);
    return {
      datasets: [{
        label: `${metrics[1].column} vs ${metrics[0].column}`,
        data: rows.map(r => ({ x: Number(r[xIdx]) || 0, y: Number(r[yIdx]) || 0 })),
        backgroundColor: PALETTE[0],
        pointRadius: 5,
        pointHoverRadius: 8,
      }]
    };
  }

  const dimIdx = dims[0] ? cols.indexOf(dims[0].column) : -1;
  const labels = dimIdx >= 0 ? rows.map(r => String(r[dimIdx] ?? '—')) : rows.map((_, i) => `Row ${i+1}`);

  const datasets = metrics.map((m, i) => {
    const idx = cols.indexOf(m.alias);
    const baseColor = PALETTE[i % PALETTE.length];
    const isPie = type === 'pie' || type === 'donut';
    const isSingle = metrics.length === 1;

    return {
      label: humanizeAlias(m),
      data: rows.map(r => Number(r[idx]) || 0),
      backgroundColor: isPie
        ? rows.map((_, k) => PALETTE[k % PALETTE.length])
        : (isSingle ? '#6366F1CC' : baseColor + 'CC'),
      hoverBackgroundColor: isPie
        ? rows.map((_, k) => PALETTE[k % PALETTE.length])
        : (isSingle ? '#6366F1' : baseColor),
      borderColor: type === 'line' ? baseColor : 'transparent',
      borderWidth: type === 'line' ? 2.5 : 0,
      borderRadius: type === 'bar' ? 6 : 0,
      tension: 0.4,
      fill: type === 'line',
      pointRadius: type === 'line' ? 4 : 0,
      pointHoverRadius: type === 'line' ? 7 : 0,
      pointBackgroundColor: baseColor,
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      offset: isPie ? 0 : undefined,
      hoverOffset: isPie ? 12 : undefined,
    };
  });

  return { labels, datasets };
}

function buildChartJsConfig(type, data, chartConfig, opts) {
  const isHorizontal = type === 'bar' && data.labels && data.labels.some(l => String(l).length > 14);
  const chartType = (type === 'donut') ? 'doughnut' : type;
  const isPie = type === 'pie' || type === 'donut';
  const dims = chartConfig.query_spec.dimensions || [];
  const metrics = chartConfig.query_spec.metrics || [];
  const xLabel = dims[0]?.column || '';
  const yLabel = metrics.length === 1 ? humanizeAlias(metrics[0]) : 'Value';

  const baseColor = PALETTE[0];

  const config = {
    type: chartType,
    data,
    options: {
      indexAxis: isHorizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 4 },
      plugins: {
        legend: {
          display: isPie || data.datasets.length > 1,
          position: 'right',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
        },
        tooltip: {
          enabled: opts.interactive !== false,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y ?? ctx.parsed ?? ctx.raw;
              if (typeof v === 'number') return ` ${ctx.dataset.label}: ${formatNumber(v)}`;
              if (v && typeof v === 'object') return ` (${formatNumber(v.x)}, ${formatNumber(v.y)})`;
              return ` ${v}`;
            },
          },
        },
      },
    },
  };

  if (!isPie) {
    config.options.scales = {
      x: {
        title: { display: !!xLabel && opts.compact !== true, text: xLabel, font: { size: 11, weight: '600' }, color: '#64748B' },
        grid: { display: false },
        ticks: { font: { size: 10 }, color: '#64748B', maxRotation: 30, autoSkipPadding: 8 },
      },
      y: {
        beginAtZero: true,
        title: { display: !!yLabel && opts.compact !== true, text: yLabel, font: { size: 11, weight: '600' }, color: '#64748B' },
        grid: { color: '#F1F5F9', drawBorder: false },
        border: { display: false },
        ticks: {
          font: { size: 10 }, color: '#64748B',
          callback: (v) => formatAxisTick(v),
        },
      },
    };
    if (isHorizontal) {
      // Swap label callbacks
      const x = config.options.scales.x;
      const y = config.options.scales.y;
      config.options.scales = { x: { ...y, title: y.title }, y: { ...x, title: x.title } };
      config.options.scales.x.beginAtZero = true;
    }
  } else if (type === 'donut') {
    config.options.cutout = '65%';
    // Center text plugin
    const totalText = formatNumber(data.datasets[0].data.reduce((a, b) => a + (Number(b) || 0), 0));
    config.plugins = [{
      id: 'donutCenter',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0F172A';
        ctx.font = "600 18px 'Inter', sans-serif";
        ctx.fillText(totalText, cx, cy - 8);
        ctx.fillStyle = '#94A3B8';
        ctx.font = "500 10px 'Inter', sans-serif";
        ctx.fillText('TOTAL', cx, cy + 12);
        ctx.restore();
      }
    }];
  }

  // Line chart gradient fill
  if (type === 'line' && opts.compact !== true) {
    config.plugins = [{
      id: 'lineGradient',
      beforeDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        chart.data.datasets.forEach((ds, i) => {
          if (ds._gradientApplied) return;
          const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          const c = PALETTE[i % PALETTE.length];
          grad.addColorStop(0, c + '33');
          grad.addColorStop(1, c + '00');
          ds.backgroundColor = grad;
          ds._gradientApplied = true;
        });
      }
    }];
  }

  return config;
}

function humanizeAlias(m) {
  const aggMap = {
    SUM: '', AVG: 'Average ', COUNT: 'Count of ', MIN: 'Minimum ', MAX: 'Maximum ', COUNT_DISTINCT: 'Unique '
  };
  const prefix = aggMap[(m.aggregation || '').toUpperCase()] ?? '';
  return (prefix + titleCase(m.column)).trim();
}

function titleCase(s) {
  return String(s).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildSkeletonHtml(type) {
  if (type === 'pie' || type === 'donut') {
    return `<div class="chart-skeleton"><div class="skeleton" style="width:60%;height:14px;"></div>
      <div class="skeleton-circle"></div></div>`;
  }
  if (type === 'line') {
    return `<div class="chart-skeleton"><div class="skeleton" style="width:60%;height:14px;"></div>
      <svg class="skeleton-line" viewBox="0 0 200 80" preserveAspectRatio="none">
        <path d="M0 60 Q 25 20, 50 40 T 100 30 T 150 50 T 200 25" stroke="#CBD5E1" stroke-width="3" fill="none"/>
      </svg></div>`;
  }
  if (type === 'kpi') {
    return `<div class="chart-skeleton"><div class="skeleton" style="width:60%;height:32px;margin:auto;"></div></div>`;
  }
  return `<div class="chart-skeleton">
    <div class="skeleton" style="width:60%;height:14px;"></div>
    <div class="skeleton-bars">
      <div class="sk-bar" style="height:60%"></div>
      <div class="sk-bar" style="height:90%"></div>
      <div class="sk-bar" style="height:40%"></div>
      <div class="sk-bar" style="height:75%"></div>
    </div></div>`;
}

function renderTable(result, containerEl) {
  const cols = result.columns || [];
  const rows = result.rows || [];
  let html = '<div style="overflow:auto;height:100%;"><table class="data-table"><thead><tr>';
  cols.forEach((c, i) => {
    const numeric = rows.length > 0 && typeof rows[0][i] === 'number';
    html += `<th class="${numeric ? 'numeric' : ''}" data-col="${i}">${escapeHtml(c)}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr>';
    r.forEach((v) => {
      const numeric = typeof v === 'number';
      const formatted = numeric ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : (v == null ? '' : escapeHtml(String(v)));
      html += `<td class="${numeric ? 'numeric' : ''}">${formatted}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  containerEl.innerHTML = html;

  containerEl.querySelectorAll('th').forEach(th => {
    let asc = true;
    th.addEventListener('click', () => {
      const idx = parseInt(th.dataset.col);
      const tbody = containerEl.querySelector('tbody');
      const rs = Array.from(tbody.querySelectorAll('tr'));
      rs.sort((a, b) => {
        const av = a.cells[idx].textContent;
        const bv = b.cells[idx].textContent;
        const an = parseFloat(av.replace(/,/g, ''));
        const bn = parseFloat(bv.replace(/,/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      asc = !asc;
      rs.forEach(r => tbody.appendChild(r));
    });
  });
}

function renderKpi(chartConfig, result, containerEl) {
  const cols = result.columns || [];
  const rows = result.rows || [];
  const metrics = chartConfig.query_spec.metrics || [];
  let value = '—';
  let label = chartConfig.title || 'KPI';
  if (rows.length > 0 && cols.length > 0) {
    const idx = metrics[0] ? cols.indexOf(metrics[0].alias) : 0;
    const v = rows[0][idx >= 0 ? idx : 0];
    if (typeof v === 'number') value = formatNumber(v);
    else if (v != null) value = String(v);
    if (metrics[0]) label = humanizeAlias(metrics[0]);
  }
  containerEl.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-value">${value}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

export function exportChartCSV(result, filename = 'chart-data.csv') {
  if (!result) return;
  const cols = result.columns || [];
  const rows = result.rows || [];
  const csv = [cols.join(',')]
    .concat(rows.map(r => r.map(v => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
