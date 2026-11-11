// Knee PT — storage. Three stores share one promise-based interface:
//   listEntries(sinceDate) · addEntry(row) · deleteEntry(id)
//   getSettings() · saveSettings(settings) · savePushSubscription(sub, ua)
// ptSupabaseStore is the real one; ptLocalStore backs demo mode (?demo=1,
// localStorage only, never touches Supabase); ptWithOutbox wraps either so
// an entry logged with no signal is kept and sent later.

var PT_ENTRY_LIMIT = 2000;
var PT_OUTBOX_KEY = 'brainy.pt.outbox';

function _ptCheck(res) {
  if (res.error) throw new Error(res.error.message || String(res.error));
  return res.data;
}

function ptSupabaseStore(db, userId) {
  return {
    listEntries: function (sinceDate) {
      return db.from('brainy_pt_entries').select('*')
        .gte('entry_date', sinceDate)
        .order('occurred_at', { ascending: false })
        .limit(PT_ENTRY_LIMIT)
        .then(_ptCheck);
    },
    addEntry: function (row) {
      var r = Object.assign({}, row, { user_id: userId });
      return db.from('brainy_pt_entries').insert(r).select().single().then(_ptCheck);
    },
    deleteEntry: function (id) {
      return db.from('brainy_pt_entries').delete().eq('id', id).then(_ptCheck);
    },
    getSettings: function () {
      return db.from('brainy_pt_settings').select('settings').eq('user_id', userId).maybeSingle()
        .then(_ptCheck)
        .then(function (row) { return row ? row.settings : null; });
    },
    saveSettings: function (settings) {
      return db.from('brainy_pt_settings')
        .upsert({ user_id: userId, settings: settings }, { onConflict: 'user_id' })
        .then(_ptCheck);
    },
    savePushSubscription: function (sub, userAgent) {
      return db.from('brainy_pt_push_subscriptions').upsert({
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent || null,
      }, { onConflict: 'endpoint' }).then(_ptCheck);
    },
  };
}

function ptLocalStore(storage) {
  var ENTRIES = 'brainy.pt.demo.entries';
  var SETTINGS = 'brainy.pt.demo.settings';

  function read(key, fallback) {
    try { return JSON.parse(storage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }

  return {
    listEntries: function (sinceDate) {
      var rows = read(ENTRIES, []).filter(function (e) { return e.entry_date >= sinceDate; });
      rows.sort(function (a, b) { return a.occurred_at < b.occurred_at ? 1 : -1; });
      return Promise.resolve(rows);
    },
    addEntry: function (row) {
      var rows = read(ENTRIES, []);
      var saved = Object.assign({ id: 'demo-' + Date.now() + '-' + rows.length }, row);
      rows.push(saved);
      storage.setItem(ENTRIES, JSON.stringify(rows));
      return Promise.resolve(saved);
    },
    deleteEntry: function (id) {
      var rows = read(ENTRIES, []).filter(function (e) { return e.id !== id; });
      storage.setItem(ENTRIES, JSON.stringify(rows));
      return Promise.resolve();
    },
    getSettings: function () { return Promise.resolve(read(SETTINGS, null)); },
    saveSettings: function (settings) {
      storage.setItem(SETTINGS, JSON.stringify(settings));
      return Promise.resolve();
    },
    savePushSubscription: function () { return Promise.resolve(); },
  };
}

// Only connectivity failures are worth queueing; anything else (RLS, a bad
// value) would fail the same way on retry, so it surfaces now.
function _ptIsNetworkError(err) {
  return err instanceof TypeError || /fetch|network|offline|load failed/i.test(err && err.message);
}

function ptWithOutbox(inner, storage) {
  function read() {
    try { return JSON.parse(storage.getItem(PT_OUTBOX_KEY)) || []; } catch (e) { return []; }
  }
  function write(rows) { storage.setItem(PT_OUTBOX_KEY, JSON.stringify(rows)); }

  var wrapped = Object.assign({}, inner);

  wrapped.addEntry = function (row) {
    return inner.addEntry(row).catch(function (err) {
      if (!_ptIsNetworkError(err)) throw err;
      var rows = read();
      rows.push(row);
      write(rows);
      return Object.assign({ queued: true }, row);
    });
  };

  wrapped.pendingCount = function () { return read().length; };
  wrapped.pending = function () { return read(); };

  // Send queued rows oldest first; stop at the first failure so order holds.
  wrapped.flush = function () {
    var rows = read();
    var sent = 0;
    function next() {
      if (sent >= rows.length) return Promise.resolve();
      return inner.addEntry(rows[sent]).then(function () {
        sent++;
        write(rows.slice(sent));
        return next();
      });
    }
    return next().catch(function () {}).then(function () { return sent; });
  };

  return wrapped;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ptSupabaseStore: ptSupabaseStore,
    ptLocalStore: ptLocalStore,
    ptWithOutbox: ptWithOutbox,
  };
}
