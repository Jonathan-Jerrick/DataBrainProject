import { store } from './state.js';

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function userId() {
  const u = store.get('activeUser');
  return u ? u.id : null;
}

async function request(method, path, body = null, isForm = false) {
  const headers = {};
  const uid = userId();
  if (uid) headers['X-User-Id'] = uid;

  const options = { method, headers };
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  } else if (body && isForm) {
    options.body = body;
  }

  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    let detail = 'Request failed';
    try { const j = await res.json(); detail = j.detail || detail; } catch {}
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null;
  return res.json();
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
