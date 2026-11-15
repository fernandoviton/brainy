// Entry store: read and write a JSON document kept in a Brainy knowledge entry
// (`brainy_knowledge`), straight from the browser with the signed-in Supabase
// client. The entry is a short markdown preamble, so it still reads sensibly in
// `knowledge get`, followed by one ```json fenced block holding the document.
//
// Nothing here is specific to the trip planner: the caller supplies `apply`,
// the pure function that turns (document, op, nowIso) into the next document.
// Works in the browser (window.EntryStore) and in Node (require), like core.js.
(function (root) {
  var TABLE = 'brainy_knowledge';
  var FENCE = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/;

  function parseEntry(content) {
    var match = FENCE.exec(content || '');
    if (!match) throw new Error('Entry has no ```json block');
    var plan;
    try {
      plan = JSON.parse(match[1]);
    } catch (e) {
      throw new Error('Entry has invalid JSON: ' + e.message);
    }
    return {
      plan: plan,
      preamble: content.substring(0, match.index),
      trailer: content.substring(match.index + match[0].length),
    };
  }

  function serializeEntry(plan, preamble, trailer) {
    return (preamble || '') + '```json\n' + JSON.stringify(plan, null, 2) + '\n```' + (trailer || '\n');
  }

  function check(result) {
    if (result.error) throw new Error(result.error.message || String(result.error));
    return result.data;
  }

  // opts: { client, apply(plan, op, nowIso), now?, maxAttempts? }
  function createEntryStore(opts) {
    var db = opts.client;
    var apply = opts.apply;
    var now = opts.now || function () { return new Date().toISOString(); };
    var maxAttempts = opts.maxAttempts || 4;
    var queue = Promise.resolve();

    // One op at a time, like the old server's queue: each op reads the entry
    // fresh, so this page never races itself.
    function enqueue(fn) {
      var run = queue.then(fn, fn);
      queue = run.catch(function () {});
      return run;
    }

    function load(path) {
      return Promise.resolve(db.from(TABLE).select('content, updated_at').eq('path', path).maybeSingle())
        .then(check)
        .then(function (row) {
          if (!row) throw new Error('Knowledge entry ' + path + ' not found');
          var parsed = parseEntry(row.content);
          return { plan: parsed.plan, preamble: parsed.preamble, trailer: parsed.trailer, updatedAt: row.updated_at };
        });
    }

    // Optimistic concurrency: the write only lands if updated_at is still the
    // value we read. Zero rows means someone else (the CLI, an agent, another
    // tab) saved in between, so re-read and re-apply the op on top of theirs.
    function attempt(path, op, n) {
      return load(path).then(function (entry) {
        var next = apply(entry.plan, op, now());
        var content = serializeEntry(next, entry.preamble, entry.trailer);
        return Promise.resolve(db.from(TABLE).update({ content: content })
          .eq('path', path).eq('updated_at', entry.updatedAt).select('updated_at'))
          .then(check)
          .then(function (rows) {
            if (rows && rows.length) {
              return { plan: next, preamble: entry.preamble, trailer: entry.trailer, updatedAt: rows[0].updated_at };
            }
            if (n >= maxAttempts) {
              var err = new Error('The entry kept changing while saving (' + n + ' tries); reload and try again.');
              err.code = 'conflict';
              throw err;
            }
            return attempt(path, op, n + 1);
          });
      });
    }

    function applyOp(path, op) {
      return enqueue(function () { return attempt(path, op, 1); });
    }

    function get(path) {
      return Promise.resolve(db.from(TABLE).select('path, topic, summary, content').eq('path', path).maybeSingle()).then(check);
    }

    function list(prefix) {
      return Promise.resolve(db.from(TABLE).select('path, topic, summary').like('path', (prefix || '') + '%').order('path'))
        .then(check)
        .then(function (rows) { return rows || []; });
    }

    return { load: load, applyOp: applyOp, get: get, list: list };
  }

  var api = { parseEntry: parseEntry, serializeEntry: serializeEntry, createEntryStore: createEntryStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EntryStore = api;
})(this);
