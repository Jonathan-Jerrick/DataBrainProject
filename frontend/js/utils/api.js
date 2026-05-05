// Tiny fetch wrapper. Reads the active user from the store and attaches
// the X-User-Id header. Throws Error(message) with the backend's `detail`
// string on non-2xx responses.
import { store } from './state.js';

const BASE_URL = '/api';

async function request(method, path, body = null, isForm = false) {
  const headers = {};
  const u = store.get('activeUser');
  if (u) headers['X-User-Id'] = u.id;

  const opts = { method, headers };
  if (body && isForm) {
    opts.body = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    let detail = 'Request failed';
    try { const j = await res.json(); detail = j.detail || detail; } catch {}
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  uploadFile: (path, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', path, fd, true);
  },
};
