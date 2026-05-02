class Store {
  constructor(initialState) {
    this._state = { ...initialState };
    this._listeners = {};
  }
  get(key) { return this._state[key]; }
  set(key, value) {
    this._state[key] = value;
    if (this._listeners[key]) {
      this._listeners[key].forEach(fn => {
        try { fn(value); } catch (e) { console.error(e); }
      });
    }
  }
  subscribe(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
    return () => {
      this._listeners[key] = this._listeners[key].filter(f => f !== fn);
    };
  }
}

export const store = new Store({
  activeUser: null,
  users: [],
  datasources: [],
  activeDatasource: null,
  dashboards: [],
  activeDashboardId: null,
  charts: [],
  globalFilters: [],
  notifications: [],
});
