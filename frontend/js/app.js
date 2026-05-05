import { initUserSwitcher } from './modules/userSwitcher.js';
import { renderDashboardPage } from './modules/dashboard.js';
import { renderDatasetsPage } from './modules/datasource.js';
import { renderUsersPage } from './modules/users.js';
import { openQueryBuilder } from './modules/queryBuilder.js';
import { applyPermissions } from './modules/permissions.js';
import { showToast } from './utils/toast.js';

const main = () => document.getElementById('main-content');
const pageTitle = () => document.getElementById('page-title');

function parseHash() {
  const h = (window.location.hash || '#dashboard').slice(1);
  const [route, ...rest] = h.split('/');
  return { route, params: { id: rest[0] } };
}

async function route() {
  const { route, params } = parseHash();
  setActiveSidebar(route);

  // Reset background class on every route
  main().classList.remove('dashboard-bg');

  switch (route) {
    case 'dashboard':
    case '':
      pageTitle().textContent = 'Dashboard';
      await renderDashboardPage(main());
      break;
    case 'datasets':
      pageTitle().textContent = params.id ? 'Dataset Profile' : 'Datasets';
      await renderDatasetsPage(main(), params);
      break;
    case 'query-builder':
      pageTitle().textContent = 'Query Builder';
      main().innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎚</div>
          <h2>Query Builder</h2>
          <p>Open the slide-in panel to start building a query.</p>
          <button class="btn btn-primary" id="open-qb" style="margin-top:16px;">Open Query Builder</button>
        </div>`;
      document.getElementById('open-qb').addEventListener('click', () => openQueryBuilder({}));
      break;
    case 'users':
      pageTitle().textContent = 'Users';
      await renderUsersPage(main());
      break;
    default:
      window.location.hash = '#dashboard';
  }

  applyPermissions(main());
}

function setActiveSidebar(route) {
  document.querySelectorAll('.sidebar-link').forEach(l => {
    l.classList.toggle('active', l.dataset.route === route || (route === '' && l.dataset.route === 'dashboard'));
  });
}

window.addEventListener('hashchange', route);
window.addEventListener('userSwitched', () => route());

(async function init() {
  try {
    await initUserSwitcher();
    await route();
  } catch (e) {
    console.error(e);
    showToast(`Init error: ${e.message}`, 'error', 8000);
  }
})();
