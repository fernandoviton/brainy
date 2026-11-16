// Pure logic for the TODO board: grouping and sorting, the status-change rules
// (scheduled_date is set if and only if status is 'scheduled'), quick-edit
// validation, filters, due buckets and the filter hash. No DOM, no Supabase.
(function (root) {
  var STATUSES = ['inbox', 'active', 'later', 'scheduled'];
  var PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function localToday(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isValidDate(s) {
    var m = DATE_RE.exec(s || '');
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function addDays(iso, n) {
    var m = DATE_RE.exec(iso);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function isOverdue(todo, today) {
    return !!todo.due && todo.due < today;
  }

  function priorityRank(p) {
    var i = PRIORITIES.indexOf(p);
    return i === -1 ? PRIORITIES.length : i;
  }

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // Priority (none last), then due date (none last), then name.
  function compareCards(a, b) {
    return priorityRank(a.priority) - priorityRank(b.priority) ||
      (a.due ? (b.due ? cmp(a.due, b.due) : -1) : (b.due ? 1 : 0)) ||
      cmp(a.name, b.name);
  }

  function sortCards(todos) {
    return todos.slice().sort(compareCards);
  }

  function groupByStatus(todos) {
    var groups = {};
    STATUSES.forEach(function (s) { groups[s] = []; });
    todos.forEach(function (t) { if (groups[t.status]) groups[t.status].push(t); });
    STATUSES.forEach(function (s) { groups[s] = sortCards(groups[s]); });
    return groups;
  }

  // The update for moving `todo` to `status`, or null when nothing changes.
  // Mirrors updateTodo in backend/storage-supabase.js: the DB only checks
  // "scheduled needs a date", so clearing the date on the way out is ours.
  function statusChange(todo, status, date) {
    if (STATUSES.indexOf(status) === -1) throw new Error('Unknown status: ' + status);
    if (status === 'scheduled') {
      if (!isValidDate(date)) throw new Error('Scheduled needs a date (YYYY-MM-DD)');
      if (todo.status === 'scheduled' && todo.scheduled_date === date) return null;
      return { status: 'scheduled', scheduled_date: date };
    }
    if (todo.status === status) return null;
    return { status: status, scheduled_date: null };
  }

  function priorityChange(todo, priority) {
    if (PRIORITIES.indexOf(priority) === -1) throw new Error('Unknown priority: ' + priority);
    return todo.priority === priority ? null : { priority: priority };
  }

  function dueChange(todo, due) {
    var next = due || null;
    if (next && !isValidDate(next)) throw new Error('Due must be a date (YYYY-MM-DD)');
    return (todo.due || null) === next ? null : { due: next };
  }

  function filterTodos(todos, f) {
    f = f || {};
    var q = (f.q || '').trim().toLowerCase();
    return todos.filter(function (t) {
      if (f.priority && t.priority !== f.priority) return false;
      if (f.category && t.category !== f.category) return false;
      if (q && ((t.name || '') + '\n' + (t.summary || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function categories(todos) {
    var seen = {};
    todos.forEach(function (t) { if (t.category) seen[t.category] = true; });
    return Object.keys(seen).sort();
  }

  function byDueThenPriority(a, b) {
    return cmp(a.due, b.due) || compareCards(a, b);
  }

  // Overdue, due today, and due within the next 7 days.
  function dueBuckets(todos, today) {
    var week = addDays(today, 7);
    var b = { overdue: [], today: [], soon: [] };
    todos.forEach(function (t) {
      if (!t.due) return;
      if (t.due < today) b.overdue.push(t);
      else if (t.due === today) b.today.push(t);
      else if (t.due <= week) b.soon.push(t);
    });
    Object.keys(b).forEach(function (k) { b[k].sort(byDueThenPriority); });
    return b;
  }

  var HASH_KEYS = ['priority', 'category', 'q', 'todo', 'archived'];

  function parseHash(hash) {
    var out = { priority: '', category: '', q: '', todo: '', archived: '' };
    (hash || '').replace(/^#/, '').split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      if (i === -1) return;
      var key = part.substring(0, i);
      if (HASH_KEYS.indexOf(key) === -1) return;
      var value;
      try { value = decodeURIComponent(part.substring(i + 1).replace(/\+/g, ' ')); } catch (e) { return; }
      out[key] = value;
    });
    if (PRIORITIES.indexOf(out.priority) === -1) out.priority = '';
    if (out.archived !== '1') out.archived = '';
    return out;
  }

  function hashFor(f) {
    f = f || {};
    var parts = [];
    HASH_KEYS.forEach(function (k) {
      var v = (f[k] || '').trim();
      if (v) parts.push(k + '=' + encodeURIComponent(v));
    });
    return parts.length ? '#' + parts.join('&') : '';
  }

  var api = {
    STATUSES: STATUSES,
    PRIORITIES: PRIORITIES,
    localToday: localToday,
    isValidDate: isValidDate,
    addDays: addDays,
    isOverdue: isOverdue,
    sortCards: sortCards,
    groupByStatus: groupByStatus,
    statusChange: statusChange,
    priorityChange: priorityChange,
    dueChange: dueChange,
    filterTodos: filterTodos,
    categories: categories,
    dueBuckets: dueBuckets,
    parseHash: parseHash,
    hashFor: hashFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoardCore = api;
})(this);
