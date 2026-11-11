// Tracker — storage. Each store is bound to one tracker id and shares one
// promise-based interface:
//   listEntries(sinceDate) · addEntry(row) · deleteEntry(id)
//   getSettings() · saveSettings(settings) · listTrackers()
//   savePushSubscription(sub, ua)
// trkSupabaseStore is the real one; trkLocalStore backs demo mode (?demo=1,
// localStorage only, never touches Supabase); trkWithOutbox wraps either so
// an entry logged with no signal is kept and sent later.

var TRK_ENTRY_LIMIT = 2000;

function _trkCheck(res) {
  if (res.error) throw new Error(res.error.message || String(res.error));
  return res.data;
}

function trkSupabaseStore(db, userId, tracker) {
  return {
    listEntries: function (sinceDate) {
      return db.from('brainy_tracker_entries').select('*')
        .eq('tracker', tracker)
        .gte('entry_date', sinceDate)
        .order('occurred_at', { ascending: false })
        .limit(TRK_ENTRY_LIMIT)
        .then(_trkCheck);
    },
    addEntry: function (row) {
      var r = Object.assign({}, row, { user_id: userId, tracker: tracker });
      return db.from('brainy_tracker_entries').insert(r).select().single().then(_trkCheck);
    },
    deleteEntry: function (id) {
      return db.from('brainy_tracker_entries').delete().eq('id', id).then(_trkCheck);
    },
    getSettings: function () {
      return db.from('brainy_tracker_settings').select('settings')
        .eq('user_id', userId).eq('tracker', tracker).maybeSingle()
        .then(_trkCheck)
        .then(function (row) { return row ? row.settings : null; });
    },
    saveSettings: function (settings) {
      return db.from('brainy_tracker_settings')
        .upsert({ user_id: userId, tracker: tracker, settings: settings }, { onConflict: 'user_id,tracker' })
        .then(_trkCheck);
    },
    listTrackers: function () {
      return db.from('brainy_tracker_settings').select('tracker, settings').eq('user_id', userId)
        .then(_trkCheck)
        .then(function (rows) {
          return (rows || []).map(function (r) { return { id: r.tracker, title: (r.settings && r.settings.title) || r.tracker }; });
        });
    },
    savePushSubscription: function (sub, userAgent) {
      return db.from('brainy_tracker_push_subscriptions').upsert({
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent || null,
      }, { onConflict: 'endpoint' }).then(_trkCheck);
    },
  };
}

function trkLocalStore(storage, tracker) {
  var ENTRIES = 'brainy.tracker.demo.entries.' + tracker;
  var SETTINGS = 'brainy.tracker.demo.settings';

  function read(key, fallback) {
    try { return JSON.parse(storage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function allSettings() { return read(SETTINGS, {}); }

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
      storage.setItem(ENTRIES, JSON.stringify(read(ENTRIES, []).filter(function (e) { return e.id !== id; })));
      return Promise.resolve();
    },
    getSettings: function () { return Promise.resolve(allSettings()[tracker] || null); },
    saveSettings: function (settings) {
      var all = allSettings();
      all[tracker] = settings;
      storage.setItem(SETTINGS, JSON.stringify(all));
      return Promise.resolve();
    },
    listTrackers: function () {
      var all = allSettings();
      return Promise.resolve(Object.keys(all).map(function (id) { return { id: id, title: all[id].title || id }; }));
    },
    savePushSubscription: function () { return Promise.resolve(); },
  };
}

// Only connectivity failures are worth queueing; anything else (RLS, a bad
// value) would fail the same way on retry, so it surfaces now.
function _trkIsNetworkError(err) {
  return err instanceof TypeError || /fetch|network|offline|load failed/i.test(err && err.message);
}

function trkWithOutbox(inner, storage, tracker) {
  var KEY = 'brainy.tracker.outbox.' + tracker;
  function read() {
    try { return JSON.parse(storage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function write(rows) { storage.setItem(KEY, JSON.stringify(rows)); }

  var wrapped = Object.assign({}, inner);

  wrapped.addEntry = function (row) {
    return inner.addEntry(row).catch(function (err) {
      if (!_trkIsNetworkError(err)) throw err;
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
  module.exports = { trkSupabaseStore: trkSupabaseStore, trkLocalStore: trkLocalStore, trkWithOutbox: trkWithOutbox };
}
