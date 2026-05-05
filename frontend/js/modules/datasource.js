import { api } from '../utils/api.js';
import { store } from '../utils/state.js';
import { showToast } from '../utils/toast.js';
import { can, applyPermissions } from './permissions.js';
import { openQueryBuilder } from './queryBuilder.js';

export async function renderDatasetsPage(container, params = {}) {
  if (params.id) return renderProfile(container, params.id);

  container.innerHTML = `
    <div class="datasets-page">
      <div class="dashboard-toolbar">
        <h2>Datasets</h2>
      </div>
      <div id="upload-zone-container" data-requires-permission="upload_dataset"></div>
      <div id="dataset-list-container">
        <div class="skeleton" style="height:100px;"></div>
      </div>
    </div>
  `;
  applyPermissions(container);

  if (can('upload_dataset')) {
    renderUploadZone(document.getElementById('upload-zone-container'));
  }

  try {
    const datasources = await api.get('/datasources');
    store.set('datasources', datasources);
    renderList(document.getElementById('dataset-list-container'), datasources);
  } catch (e) {
    showToast(`Failed to load datasets: ${e.message}`, 'error');
  }
}

function renderUploadZone(host) {
  if (!host) return;
  host.innerHTML = `
    <div class="upload-zone" id="upload-zone">
      <div class="upload-icon">☁️</div>
      <h3>Drop a CSV file here</h3>
      <p>or click to browse · Max 100MB</p>
      <input type="file" id="upload-input" accept=".csv" hidden>
      <div id="upload-progress" class="upload-progress hidden"></div>
    </div>`;

  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('upload-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragenter', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { e.preventDefault(); zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files[0]) handleUpload(e.target.files[0]);
  });
}

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Only CSV files are accepted', 'error');
    return;
  }
  const progressEl = document.getElementById('upload-progress');
  progressEl.classList.remove('hidden');
  const stages = ['Receiving', 'Parsing', 'Detecting types', 'Profiling', 'Generating suggestions', 'Complete'];
  progressEl.innerHTML = `
    <div class="upload-progress-bar"><div class="upload-progress-fill" id="up-fill" style="width:5%"></div></div>
    <div id="up-stages">
      ${stages.map((s, i) => `<div class="upload-stage" id="stage-${i}">${s}</div>`).join('')}
    </div>`;

  // Animate stages while we upload
  let stageIdx = 0;
  const interval = setInterval(() => {
    if (stageIdx < stages.length - 1) {
      document.getElementById(`stage-${stageIdx}`)?.classList.add('complete');
      document.getElementById(`stage-${stageIdx+1}`)?.classList.add('active');
      stageIdx++;
      document.getElementById('up-fill').style.width = ((stageIdx + 1) / stages.length * 100) + '%';
    }
  }, 300);

  try {
    const result = await api.uploadFile('/datasources/upload', file);
    clearInterval(interval);
    document.getElementById('up-fill').style.width = '100%';
    stages.forEach((_, i) => document.getElementById(`stage-${i}`)?.classList.add('complete'));
    showToast(`Uploaded ${result.name}: ${result.row_count} rows, ${result.column_count} cols`, 'success');
    setTimeout(() => {
      window.location.hash = `#datasets/${result.id}`;
    }, 400);
  } catch (e) {
    clearInterval(interval);
    showToast(`Upload failed: ${e.message}`, 'error');
    progressEl.innerHTML = `<div style="color:var(--color-error);font-size:13px;">${e.message}</div>`;
  }
}

function renderList(host, datasources) {
  if (!host) return;
  if (datasources.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📁</div>
        <h2>No datasets yet</h2>
        <p>Upload a CSV file to get started.</p>
      </div>`;
    return;
  }
  host.innerHTML = `
    <div class="section-heading">All datasets · ${datasources.length}</div>
    <div class="dataset-list">
      ${datasources.map(d => `
        <div class="dataset-card" data-id="${d.id}">
          <h4>${escapeHtml(d.name)}</h4>
          <div class="meta">${escapeHtml(d.filename)}</div>
          <div class="stats">
            <span>📊 ${d.row_count?.toLocaleString() || 0} rows</span>
            <span>📐 ${d.column_count} cols</span>
          </div>
          <div style="margin-top:8px;">
            ${healthBadge(d.health_status)}
          </div>
        </div>
      `).join('')}
    </div>`;
  host.querySelectorAll('.dataset-card').forEach(c => {
    c.addEventListener('click', () => { window.location.hash = `#datasets/${c.dataset.id}`; });
  });
}

function healthBadge(status) {
  if (status === 'clean') return `<span class="badge badge-success">✅ Clean</span>`;
  if (status === 'warnings') return `<span class="badge badge-warning">⚠️ Warnings</span>`;
  if (status === 'errors') return `<span class="badge badge-error">❌ Issues</span>`;
  return '';
}

async function renderProfile(container, id) {
  container.innerHTML = '<div class="skeleton" style="height:300px;"></div>';
  let profile;
  try {
    profile = await api.get(`/datasources/${id}/profile`);
    store.set('activeDatasource', profile);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h2>${e.message}</h2></div>`;
    return;
  }

  container.innerHTML = `
    <div class="dataset-profile">
      <div class="dataset-hero">
        <h2>${escapeHtml(profile.name)} ${can('rename_dataset') ? '<button class="btn-icon" id="rename-ds" title="Rename">✏</button>' : ''}</h2>
        <div class="subline">${escapeHtml(profile.filename)} · uploaded by ${profile.uploaded_by}</div>
        <div class="stat-pill-row">
          <span class="stat-pill"><span class="label">Rows</span> ${profile.row_count?.toLocaleString() || 0}</span>
          <span class="stat-pill"><span class="label">Columns</span> ${profile.column_count}</span>
          <span class="stat-pill"><span class="label">Size</span> ${formatSize(profile.file_size_bytes)}</span>
          <span class="stat-pill">${healthBadge(profile.health_status)}</span>
        </div>
        ${profile.health_issues && profile.health_issues.length ? `
          <div class="health-issues">
            <strong>Issues found:</strong>
            <ul>${profile.health_issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
          </div>` : ''}
        ${can('delete_dataset') ? `<button class="btn btn-danger" id="delete-ds" style="margin-top:12px;">Delete Dataset</button>` : ''}
      </div>

      ${profile.suggested_explorations && profile.suggested_explorations.length ? `
        <div>
          <div class="section-heading">Suggested Explorations</div>
          <div class="suggestion-row" id="suggestion-row">
            ${profile.suggested_explorations.map((s, i) => `
              <div class="suggestion-chip" data-idx="${i}">
                <span>${s.icon || '📊'}</span><span>${escapeHtml(s.title)}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

      ${profile.columns && profile.columns.length ? `
        <div>
          <div class="section-heading">Columns · ${profile.columns.length}</div>
          <div class="column-grid" id="column-grid"></div>
        </div>` : '<div class="empty-state"><p>Column profile not available for your role.</p></div>'}
    </div>
  `;

  const grid = document.getElementById('column-grid');
  if (grid) {
    profile.columns.forEach(col => grid.appendChild(buildColumnCard(col, profile.id)));
  }

  if (can('delete_dataset')) {
    document.getElementById('delete-ds')?.addEventListener('click', async () => {
      if (!confirm('Delete this dataset? Charts using it will break.')) return;
      try {
        await api.del(`/datasources/${profile.id}`);
        showToast('Dataset deleted', 'success');
        window.location.hash = '#datasets';
      } catch (e) {
        showToast(`Failed: ${e.message}`, 'error');
      }
    });
  }

  if (can('rename_dataset')) {
    document.getElementById('rename-ds')?.addEventListener('click', async () => {
      const newName = prompt('New name:', profile.name);
      if (newName) {
        try {
          await api.patch(`/datasources/${profile.id}`, { name: newName });
          showToast('Renamed', 'success');
          renderProfile(container, profile.id);
        } catch (e) { showToast(e.message, 'error'); }
      }
    });
  }

  // Suggestions click
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.idx);
      const sug = profile.suggested_explorations[idx];
      openQueryBuilder({
        querySpec: sug.query_spec,
        chartType: sug.chart_type,
        title: sug.title,
      });
    });
  });
}

function buildColumnCard(col, datasourceId) {
  const card = document.createElement('div');
  card.className = 'column-card';
  card.dataset.columnName = col.column_name;
  card.dataset.columnType = col.column_type;
  const role = col.user_overridden_role || col.inferred_role;

  const stats = [];
  if (col.column_type === 'numeric') {
    if (col.mean_value != null) stats.push(`avg: ${formatNum(col.mean_value)}`);
    if (col.min_value != null) stats.push(`min: ${col.min_value} · max: ${col.max_value}`);
  } else {
    if (col.unique_count != null) stats.push(`${col.unique_count.toLocaleString()} unique`);
    if (col.top_values && col.top_values[0]) stats.push(`top: ${col.top_values[0].value}`);
  }
  if (col.null_count > 0) stats.push(`${col.null_percentage}% null`);

  card.innerHTML = `
    <div class="column-card-header">
      <span class="badge badge-${col.column_type === 'numeric' ? 'metric' : (col.column_type === 'date' ? 'date' : 'dim')}">${role}</span>
      ${can('edit_dataset') ? '<button class="btn-icon role-toggle" title="Override role">✏</button>' : ''}
    </div>
    <div class="column-name">${escapeHtml(col.column_name)}</div>
    <div class="column-type-label">${col.column_type}</div>
    <div class="column-stats-preview">
      ${stats.map(s => `<div>${escapeHtml(s)}</div>`).join('')}
    </div>
    <canvas class="column-mini-chart" width="160" height="40"></canvas>
  `;

  // Draw mini chart
  const canvas = card.querySelector('canvas');
  drawMiniChart(canvas, col);

  // Tooltip
  let tooltip = null;
  card.addEventListener('mouseenter', () => {
    tooltip = createTooltip(col);
    document.body.appendChild(tooltip);
    positionTooltip(tooltip, card);
  });
  card.addEventListener('mouseleave', () => {
    if (tooltip) { tooltip.remove(); tooltip = null; }
  });

  // Role override
  card.querySelector('.role-toggle')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newRole = role === 'metric' ? 'dimension' : 'metric';
    try {
      await api.patch(`/datasources/${datasourceId}/columns/${encodeURIComponent(col.column_name)}/role`, { role: newRole });
      col.user_overridden_role = newRole;
      const badge = card.querySelector('.badge');
      badge.textContent = newRole;
      showToast(`Set ${col.column_name} as ${newRole}`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  return card;
}

function drawMiniChart(canvas, col) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const color = col.column_type === 'numeric' ? '#10B981' :
                col.column_type === 'date' ? '#F59E0B' : '#3B82F6';

  if (col.histogram_data && col.histogram_data.length) {
    const data = col.histogram_data;
    const max = Math.max(...data.map(d => d.count)) || 1;
    const bw = w / data.length;
    ctx.fillStyle = color;
    data.forEach((d, i) => {
      const bh = (d.count / max) * (h - 4);
      ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    });
  } else if (col.top_values && col.top_values.length) {
    const data = col.top_values;
    const max = Math.max(...data.map(d => d.count)) || 1;
    const bh = h / data.length;
    ctx.fillStyle = color;
    data.forEach((d, i) => {
      const bw = (d.count / max) * w;
      ctx.fillRect(0, i * bh + 1, bw, bh - 2);
    });
  } else {
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(0, h/2 - 2, w, 4);
  }
}

function createTooltip(col) {
  const tip = document.createElement('div');
  tip.className = 'column-tooltip';
  let body = `<h4>${escapeHtml(col.column_name)} <span class="badge badge-${col.column_type === 'numeric' ? 'metric' : (col.column_type === 'date' ? 'date' : 'dim')}">${col.column_type}</span></h4>`;
  body += `<div class="row"><span>Nulls</span><span>${col.null_count} (${col.null_percentage}%)</span></div>`;
  body += `<div class="row"><span>Unique</span><span>${col.unique_count?.toLocaleString() || 0}</span></div>`;
  if (col.column_type === 'numeric') {
    if (col.mean_value != null) body += `<div class="row"><span>Mean</span><span>${formatNum(col.mean_value)}</span></div>`;
    if (col.median_value != null) body += `<div class="row"><span>Median</span><span>${formatNum(col.median_value)}</span></div>`;
    if (col.min_value != null) body += `<div class="row"><span>Range</span><span>${col.min_value} → ${col.max_value}</span></div>`;
  } else if (col.top_values && col.top_values.length) {
    body += '<div style="margin-top:6px;font-weight:600;">Top values</div>';
    col.top_values.forEach(v => {
      body += `<div class="row"><span>${escapeHtml(String(v.value)).slice(0, 30)}</span><span>${v.count} (${v.percentage}%)</span></div>`;
    });
  }
  body += `<canvas width="260" height="80"></canvas>`;
  tip.innerHTML = body;
  // draw chart in tooltip
  setTimeout(() => drawMiniChart(tip.querySelector('canvas'), col), 0);
  return tip;
}

function positionTooltip(tooltip, anchor) {
  const r = anchor.getBoundingClientRect();
  const tw = 280, th = 200;
  let left = r.right + 8;
  let top = r.top;
  if (left + tw > window.innerWidth) left = r.left - tw - 8;
  if (top + th > window.innerHeight) top = window.innerHeight - th - 8;
  if (top < 8) top = 8;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function formatNum(n) {
  if (n == null) return '';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return Number(n).toFixed(2);
}

function formatSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/1024/1024).toFixed(1) + ' MB';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
