// In-memory stand-in for the Supabase client, covering only the query shapes
// entry-store.js and the TODO board use. Backs the pages' mock mode
// (localhost, no config) and the unit tests. Like the real tables, every
// update bumps `updated_at`.
//
//   createMockClient(rows, { table, check })
//     table   the one table it serves (default 'brainy_knowledge')
//     check   optional (row) => error message | null, run on each updated row
//             before it is saved, like a DB check constraint
//     tables  optional { name: rows } of extra tables to serve (selects only)
//
//   client.rows          the table (mutate it to simulate someone else's edit)
//   client.calls         every query run: { table, op, columns, filters, values }
//   client.failNext      set to { message } to make the next query fail
//   client.beforeUpdate  optional hook run just before an update executes
(function (root) {
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function likeToRegExp(pattern) {
    var re = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp('^' + re + '$');
  }

  function pick(row, columns) {
    if (!columns || columns === '*') return clone(row);
    var out = {};
    columns.split(',').forEach(function (c) { c = c.trim(); out[c] = row[c] === undefined ? null : row[c]; });
    return out;
  }

  function createMockClient(rows, options) {
    options = options || {};
    var table = options.table || 'brainy_knowledge';
    var lastStamp = 0;
    var client = { rows: rows || [], calls: [], failNext: null, beforeUpdate: null };

    function stamp() {
      lastStamp = Math.max(Date.now(), lastStamp + 1);
      return new Date(lastStamp).toISOString();
    }

    function query(name, getRows) {
      var q = { op: 'select', columns: null, filters: [], values: null, single: false, orderBy: null, desc: false, limit: null };
      function matches(row) {
        return q.filters.every(function (f) {
          if (f[0] === 'eq') return row[f[1]] === f[2];
          return likeToRegExp(f[2]).test(String(row[f[1]] || ''));
        });
      }
      function run() {
        client.calls.push({ table: name, op: q.op, columns: q.columns, filters: q.filters.slice(), values: q.values });
        if (client.failNext) {
          var error = client.failNext;
          client.failNext = null;
          return { data: null, error: error };
        }
        if (q.op === 'update' && client.beforeUpdate) client.beforeUpdate();
        var hits = getRows().filter(matches);
        if (q.op === 'update') {
          for (var i = 0; i < hits.length && options.check; i++) {
            var message = options.check(Object.assign(clone(hits[i]), q.values));
            if (message) return { data: null, error: { message: message } };
          }
          hits.forEach(function (row) {
            Object.keys(q.values).forEach(function (k) { row[k] = q.values[k]; });
            row.updated_at = stamp();
          });
        }
        if (q.orderBy) {
          var key = q.orderBy;
          var dir = q.desc ? -1 : 1;
          hits = hits.slice().sort(function (a, b) { return dir * (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0); });
        }
        if (q.limit !== null) hits = hits.slice(0, q.limit);
        var data = hits.map(function (r) { return pick(r, q.columns); });
        if (q.single) {
          if (data.length > 1) return { data: null, error: { message: 'multiple rows' } };
          return { data: data[0] || null, error: null };
        }
        return { data: data, error: null };
      }
      var builder = {
        select: function (columns) { q.columns = columns || '*'; return builder; },
        update: function (values) { q.op = 'update'; q.values = clone(values); return builder; },
        eq: function (col, val) { q.filters.push(['eq', col, val]); return builder; },
        like: function (col, pattern) { q.filters.push(['like', col, pattern]); return builder; },
        order: function (col, opts) { q.orderBy = col; q.desc = !!(opts && opts.ascending === false); return builder; },
        limit: function (n) { q.limit = n; return builder; },
        maybeSingle: function () { q.single = true; return builder; },
        then: function (resolve, reject) {
          var result;
          try { result = run(); } catch (e) { return Promise.reject(e).then(resolve, reject); }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    }

    var extra = options.tables || {};
    client.from = function (name) {
      if (name === table) return query(name, function () { return client.rows; });
      if (Object.prototype.hasOwnProperty.call(extra, name)) return query(name, function () { return extra[name]; });
      throw new Error('mock client: unexpected table ' + name);
    };
    return client;
  }

  var api = { createMockClient: createMockClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MockClient = api;
})(this);
