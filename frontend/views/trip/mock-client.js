// In-memory stand-in for the Supabase client, covering only the query shapes
// entry-store.js uses. Backs the page's mock mode (localhost, no config) and
// the unit tests. Like the real table, every update bumps `updated_at`.
//
//   client.rows          the table (mutate it to simulate someone else's edit)
//   client.calls         every query run: { op, columns, filters, values }
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

  function createMockClient(rows) {
    var lastStamp = 0;
    var client = { rows: rows || [], calls: [], failNext: null, beforeUpdate: null };

    function stamp() {
      lastStamp = Math.max(Date.now(), lastStamp + 1);
      return new Date(lastStamp).toISOString();
    }

    function query() {
      var q = { op: 'select', columns: null, filters: [], values: null, single: false, orderBy: null };
      function matches(row) {
        return q.filters.every(function (f) {
          if (f[0] === 'eq') return row[f[1]] === f[2];
          return likeToRegExp(f[2]).test(String(row[f[1]] || ''));
        });
      }
      function run() {
        client.calls.push({ op: q.op, columns: q.columns, filters: q.filters.slice(), values: q.values });
        if (client.failNext) {
          var error = client.failNext;
          client.failNext = null;
          return { data: null, error: error };
        }
        if (q.op === 'update' && client.beforeUpdate) client.beforeUpdate();
        var hits = client.rows.filter(matches);
        if (q.op === 'update') {
          hits.forEach(function (row) {
            Object.keys(q.values).forEach(function (k) { row[k] = q.values[k]; });
            row.updated_at = stamp();
          });
        }
        if (q.orderBy) {
          var key = q.orderBy;
          hits = hits.slice().sort(function (a, b) { return a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; });
        }
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
        order: function (col) { q.orderBy = col; return builder; },
        maybeSingle: function () { q.single = true; return builder; },
        then: function (resolve, reject) {
          var result;
          try { result = run(); } catch (e) { return Promise.reject(e).then(resolve, reject); }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    }

    client.from = function (table) {
      if (table !== 'brainy_knowledge') throw new Error('mock client: unexpected table ' + table);
      return query();
    };
    return client;
  }

  var api = { createMockClient: createMockClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MockClient = api;
})(this);
