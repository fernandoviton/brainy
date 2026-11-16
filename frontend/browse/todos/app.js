/* global BoardCore, TodoDetail, MockClient, BoardFixture, CONFIG, supabase, marked, DOMPurify,
   escapeHtml, loadReferenceIndex, linkifyReferences, resolveAttachmentLinks */
// TODOs page: live TODOs on a board in columns by status, with drag and drop,
// a per-card status control (for phones), quick priority/due edits, filters
// kept in the URL hash, and a due strip. A card's name opens a details drawer
// (notes, attachments) at #todo=<name>, the deep link other pages use, falling
// back to the archive for completed TODOs. #archived=1 lists the archive. Reads and writes brainy_todos directly with the
// signed-in Supabase client (RLS: own rows only). The rules the CLI's storage
// layer normally enforces live in core.js. On localhost with no Supabase
// config it runs in mock mode against the fake fixture.
(function () {
  var C = BoardCore;
  var D = TodoDetail;
  var COLUMNS = 'id, name, status, priority, summary, category, due, scheduled_date, created_at';
  var TODO_LIMIT = 500; // live TODOs drain into the archive, so this stays small
  var ARCHIVE_LIMIT = 5000; // the archive grows without bound
  var STASH_KEY = 'board.hash'; // survives the OAuth round trip, which drops the hash
  var STATUS_LABEL = { inbox: 'Inbox', active: 'Active', later: 'Later', scheduled: 'Scheduled' };

  var db = null;
  var todos = [];
  var filters = C.parseHash(location.hash);
  var dragging = null;
  var archiveRows = null; // loaded on first visit to the Archived view
  var shownTodo = null; // name in the details drawer
  var detailToken = 0; // drops stale detail loads

  // Test hook: the rows the board currently shows.
  window.__board = { todos: function () { return todos; } };

  // ── DOM helpers ────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k.substring(0, 2) === 'on') el.addEventListener(k.substring(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      [].concat(c).forEach(function (x) { el.appendChild(x.nodeType ? x : document.createTextNode(String(x))); });
    }
    return el;
  }

  function options(values, labels, selected) {
    return values.map(function (v) {
      var o = h('option', { value: v }, labels ? labels[v] || v : v);
      if (v === selected) o.selected = true;
      return o;
    });
  }

  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = isError ? 'error' : '';
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, isError ? 6000 : 2200);
  }

  // ── Data ───────────────────────────────────────────────────────────────
  function load() {
    $('message').textContent = todos.length ? '' : 'Loading TODOs from Brainy…';
    return db.from('brainy_todos').select(COLUMNS).order('created_at', { ascending: false }).limit(TODO_LIMIT)
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        todos = res.data || [];
        var warn = $('limit-warning');
        warn.hidden = todos.length < TODO_LIMIT;
        warn.textContent = 'Only the first ' + TODO_LIMIT + ' TODOs loaded; some are missing from the board.';
        $('message').textContent = '';
        sync();
      })
      .catch(function (e) {
        $('message').textContent = 'Could not load TODOs: ' + e.message;
      });
  }

  // Save one TODO's changes. On failure, re-fetch so the board shows what the
  // database really holds.
  function save(todo, updates, label) {
    if (!updates) { render(); return Promise.resolve(); }
    return db.from('brainy_todos').update(updates).eq('id', todo.id).select(COLUMNS)
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (!res.data || !res.data.length) throw new Error('it is no longer on the board (archived or deleted?)');
        todos = todos.map(function (t) { return t.id === todo.id ? res.data[0] : t; });
        render();
        toast(todo.name + ': ' + label);
      })
      .catch(function (e) {
        toast('Not saved: ' + e.message, true);
        return load();
      });
  }

  function find(name) {
    return todos.filter(function (t) { return t.name === name; })[0];
  }

  // Apply a core.js change function, turning its validation errors into toasts.
  function attempt(fn) {
    try { return { updates: fn() }; } catch (e) { toast(e.message, true); render(); return null; }
  }

  function moveTo(name, status) {
    var todo = find(name);
    if (!todo) return Promise.resolve();
    if (status !== 'scheduled') {
      var r = attempt(function () { return C.statusChange(todo, status); });
      return r ? save(todo, r.updates, 'moved to ' + STATUS_LABEL[status]) : Promise.resolve();
    }
    var initial = todo.scheduled_date || C.addDays(C.localToday(), 1);
    return askDate(todo.name, initial).then(function (date) {
      if (!date) { render(); return; }
      var s = attempt(function () { return C.statusChange(todo, 'scheduled', date); });
      if (s) return save(todo, s.updates, 'scheduled for ' + date);
    });
  }

  // ── Date dialog (moving to Scheduled) ─────────────────────────────────
  var pendingDate = null;

  function askDate(name, initial) {
    $('date-title').textContent = 'Schedule "' + name + '" for';
    $('date-input').value = initial || '';
    $('date-error').hidden = true;
    $('date-dialog').hidden = false;
    if ($('date-input').focus) $('date-input').focus();
    return new Promise(function (resolve) { pendingDate = resolve; });
  }

  function closeDate(value) {
    $('date-dialog').hidden = true;
    var resolve = pendingDate;
    pendingDate = null;
    if (resolve) resolve(value);
  }

  function confirmDate(e) {
    if (e) e.preventDefault();
    var v = $('date-input').value;
    if (!C.isValidDate(v)) { $('date-error').hidden = false; return; }
    closeDate(v);
  }

  $('date-ok').addEventListener('click', confirmDate);
  $('date-form').addEventListener('submit', confirmDate);
  $('date-cancel').addEventListener('click', function () { closeDate(null); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('date-dialog').hidden) closeDate(null);
  });

  // ── Rendering ─────────────────────────────────────────────────────────
  function renderCard(t, today) {
    var overdue = C.isOverdue(t, today);
    return h('article', {
      class: 'todo-card' + (overdue ? ' overdue' : ''), draggable: 'true', 'data-name': t.name,
      ondragstart: function (e) {
        dragging = t.name;
        if (e.dataTransfer) { e.dataTransfer.setData('text/plain', t.name); e.dataTransfer.effectAllowed = 'move'; }
        e.currentTarget.classList.add('dragging');
      },
      ondragend: function (e) { dragging = null; e.currentTarget.classList.remove('dragging'); },
    },
      h('div', { class: 'card-head' },
        h('span', { class: 'badge prio prio-' + (t.priority || 'none') }, t.priority || '–'),
        h('a', {
          class: 'card-name', href: C.hashFor(Object.assign({}, filters, { todo: t.name })), draggable: 'false',
          onclick: function (e) { e.preventDefault(); navigate({ todo: t.name }, true); },
        }, t.name)),
      t.summary ? h('div', { class: 'summary' }, t.summary) : null,
      h('div', { class: 'meta' },
        t.category ? h('span', { class: 'category' }, t.category) : null,
        t.due ? h('span', { class: 'due' + (overdue ? ' overdue' : '') }, (overdue ? 'Overdue ' : 'Due ') + t.due) : null,
        t.scheduled_date ? h('span', { class: 'scheduled' }, 'Scheduled ' + t.scheduled_date) : null),
      h('div', { class: 'controls' },
        h('select', {
          class: 'status-select', 'aria-label': 'Status of ' + t.name,
          onchange: function (e) { moveTo(t.name, e.target.value); },
        }, options(C.STATUSES, STATUS_LABEL, t.status)),
        h('select', {
          class: 'prio-select', 'aria-label': 'Priority of ' + t.name,
          onchange: function (e) {
            var r = attempt(function () { return C.priorityChange(t, e.target.value); });
            if (r) save(t, r.updates, 'priority ' + e.target.value);
          },
        }, t.priority ? null : h('option', { value: '' }, '–'), options(C.PRIORITIES, null, t.priority)),
        h('input', {
          type: 'date', class: 'due-input', value: t.due || '', 'aria-label': 'Due date of ' + t.name, title: 'Due date',
          onchange: function (e) {
            var r = attempt(function () { return C.dueChange(t, e.target.value); });
            if (r) save(t, r.updates, e.target.value ? 'due ' + e.target.value : 'due date cleared');
          },
        })));
  }

  function renderDueStrip(rows, today) {
    var strip = $('due-strip');
    strip.innerHTML = '';
    var b = C.dueBuckets(rows, today);
    var groups = [['overdue', 'Overdue'], ['today', 'Today'], ['soon', 'Next 7 days']];
    if (!b.overdue.length && !b.today.length && !b.soon.length) {
      strip.appendChild(h('span', { class: 'muted' }, 'Nothing due in the next 7 days.'));
      return;
    }
    groups.forEach(function (g) {
      var list = b[g[0]];
      if (!list.length) return;
      strip.appendChild(h('div', { class: 'due-group', 'data-bucket': g[0] },
        h('span', { class: 'due-label' }, g[1] + ' (' + list.length + ')'),
        list.map(function (t) {
          return h('a', {
            class: 'due-chip', href: '#', 'data-name': t.name, title: t.summary || t.name,
            onclick: function (e) { e.preventDefault(); focusCard(t.name); },
          }, t.name, g[0] === 'today' ? null : h('span', { class: 'chip-date' }, t.due.substring(5)));
        })));
    });
  }

  function focusCard(name) {
    var el = document.querySelector('.todo-card[data-name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');
    if (!el) return;
    if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1600);
  }

  function renderFilters() {
    $('f-priority').value = filters.priority;
    if ($('f-q').value !== filters.q) $('f-q').value = filters.q;
    var cats = C.categories(todos);
    if (filters.category && cats.indexOf(filters.category) === -1) cats.push(filters.category);
    var sel = $('f-category');
    sel.innerHTML = '';
    sel.appendChild(h('option', { value: '' }, 'All categories'));
    options(cats, null, filters.category).forEach(function (o) { sel.appendChild(o); });
    sel.value = filters.category;
  }

  function render() {
    $('board').hidden = false;
    $('due-strip').hidden = false;
    $('archive').hidden = true;
    var today = C.localToday();
    var rows = C.filterTodos(todos, filters);
    var groups = C.groupByStatus(rows);
    renderFilters();
    renderDueStrip(rows, today);
    C.STATUSES.forEach(function (s) {
      var col = document.querySelector('.column[data-status="' + s + '"]');
      col.querySelector('.count').textContent = String(groups[s].length);
      var cards = col.querySelector('.cards');
      cards.innerHTML = '';
      groups[s].forEach(function (t) { cards.appendChild(renderCard(t, today)); });
      if (!groups[s].length) cards.appendChild(h('div', { class: 'empty muted' }, 'Nothing here'));
    });
  }

  // ── Drag and drop onto columns ────────────────────────────────────────
  [].forEach.call(document.querySelectorAll('.column'), function (col) {
    col.addEventListener('dragover', function (e) { if (dragging) { e.preventDefault(); col.classList.add('drop-target'); } });
    col.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget || !col.contains(e.relatedTarget)) col.classList.remove('drop-target');
    });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('drop-target');
      var name = dragging || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      dragging = null;
      if (name) moveTo(name, col.getAttribute('data-status'));
    });
  });

  // ── Filters and the hash ──────────────────────────────────────────────
  // Merge `changes` into the hash state and redraw. Opening a TODO pushes a
  // history entry, so Back closes the drawer; everything else replaces.
  function navigate(changes, push) {
    filters = Object.assign({}, filters, changes);
    var url = location.pathname + location.search + C.hashFor(filters);
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
    sync();
  }

  function sync() {
    if (!db) return;
    var toggle = $('archived-toggle');
    toggle.setAttribute('href', C.hashFor(Object.assign({}, filters, { archived: filters.archived ? '' : '1', todo: '' })) || '#');
    toggle.textContent = filters.archived ? 'Back to board' : 'Archived';
    if (filters.archived) showArchive();
    else render();
    syncDetail();
  }

  $('f-priority').addEventListener('change', function (e) { navigate({ priority: e.target.value }); });
  $('f-category').addEventListener('change', function (e) { navigate({ category: e.target.value }); });
  $('f-q').addEventListener('input', function (e) { navigate({ q: e.target.value }); });
  $('archived-toggle').addEventListener('click', function (e) {
    e.preventDefault();
    navigate({ archived: filters.archived ? '' : '1', todo: '' });
  });
  window.addEventListener('hashchange', function () { filters = C.parseHash(location.hash); sync(); });
  window.addEventListener('popstate', function () { filters = C.parseHash(location.hash); sync(); });

  // ── Archived view ─────────────────────────────────────────────────────
  function showArchive() {
    $('board').hidden = true;
    $('due-strip').hidden = true;
    $('archive').hidden = false;
    renderFilters();
    if (!archiveRows) {
      $('message').textContent = 'Loading archived TODOs…';
      db.from('brainy_archive_entries').select(D.ARCHIVE_COLUMNS)
        .order('completion_date', { ascending: false }).limit(ARCHIVE_LIMIT)
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          archiveRows = (res.data || []).map(D.archiveRowToTodo);
          $('message').textContent = archiveRows.length >= ARCHIVE_LIMIT
            ? 'Only the first ' + ARCHIVE_LIMIT + ' archived TODOs loaded.' : '';
          if (filters.archived) showArchive();
        })
        .catch(function (e) { $('message').textContent = 'Could not load the archive: ' + e.message; });
      return;
    }
    var rows = C.filterTodos(archiveRows, { priority: filters.priority, category: filters.category, q: filters.q });
    $('archive').querySelector('.count').textContent = String(rows.length);
    var list = $('archive').querySelector('.archive-list');
    list.innerHTML = '';
    rows.forEach(function (t) {
      list.appendChild(h('li', { class: 'archive-item', 'data-name': t.name },
        h('a', {
          href: C.hashFor(Object.assign({}, filters, { todo: t.name })),
          onclick: function (e) { e.preventDefault(); navigate({ todo: t.name }, true); },
        }, t.name),
        t.completion_date ? h('span', { class: 'muted small' }, ' · done ' + t.completion_date) : null,
        t.summary ? h('div', { class: 'summary' }, t.summary) : null));
    });
    if (!rows.length) list.appendChild(h('li', { class: 'empty muted' }, 'No archived TODOs match.'));
  }

  // ── Details drawer (#todo=<name>) ─────────────────────────────────────
  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(marked.parse(text));
    return '<pre class="plain-notes">' + escapeHtml(text) + '</pre>';
  }

  function rows(query) {
    return Promise.resolve(query).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return res.data || [];
    });
  }

  // Resolves to { todo, notes, collateral } or null: the loaded board row, a
  // live TODO outside it, or the newest archive entry with that name.
  function findTodo(name) {
    var live = todos.filter(function (t) { return t.name === name; })[0];
    var found = live ? Promise.resolve(live)
      : rows(db.from('brainy_todos').select(COLUMNS).eq('name', name)).then(function (r) { return r[0] || null; });
    return found.then(function (t) {
      if (t) {
        return Promise.all([
          rows(db.from('brainy_todos').select('id, notes').eq('id', t.id)),
          rows(db.from('brainy_todo_collateral').select('id, filename, content_type, text_content, storage_path').eq('todo_id', t.id)),
        ]).then(function (res) { return { todo: t, notes: (res[0][0] || {}).notes, collateral: res[1] }; });
      }
      return rows(db.from('brainy_archive_entries').select(D.ARCHIVE_COLUMNS).eq('todo_name', name)
        .order('completion_date', { ascending: false }).limit(1)).then(function (r) {
        if (!r.length) return null;
        var a = D.archiveRowToTodo(r[0]);
        return { todo: a, notes: a.notes, collateral: D.normalizeArchivedCollateral(a.collateralSnapshot) };
      });
    });
  }

  function syncDetail() {
    var name = filters.todo;
    if (!name) { closeDetailQuiet(); return; }
    if (name === shownTodo) return;
    shownTodo = name;
    var token = ++detailToken;
    $('detail').hidden = false;
    $('detail-backdrop').hidden = false;
    $('detail-title').textContent = name;
    var body = $('detail-body');
    body.innerHTML = '';
    body.appendChild(h('p', { class: 'muted' }, 'Loading…'));
    findTodo(name).then(function (found) {
      if (token !== detailToken) return;
      if (!found) {
        body.innerHTML = '';
        body.appendChild(h('p', null, 'TODO "' + name + '" not found (not live, not archived).'));
        return;
      }
      renderDetail(found);
    }).catch(function (e) {
      if (token !== detailToken) return;
      body.innerHTML = '';
      body.appendChild(h('p', { class: 'error' }, 'Could not load this TODO: ' + e.message));
    });
  }

  function renderDetail(found) {
    var t = found.todo;
    var body = $('detail-body');
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'meta detail-meta' },
      h('span', { class: 'badge status' }, t.archived ? 'Archived' + (t.completion_date ? ' ' + t.completion_date : '') : STATUS_LABEL[t.status] || t.status),
      t.priority ? h('span', { class: 'badge prio prio-' + t.priority }, t.priority) : null,
      t.category ? h('span', { class: 'category' }, t.category) : null,
      t.due ? h('span', { class: 'due' }, 'Due ' + t.due) : null,
      t.scheduled_date ? h('span', { class: 'scheduled' }, 'Scheduled ' + t.scheduled_date) : null));
    if (t.summary) body.appendChild(h('p', { class: 'summary' }, t.summary));
    var extra = h('div');
    extra.innerHTML = (found.notes ? '<div class="card-notes">' + renderMarkdown(found.notes) + '</div>' : '') +
      D.collateralHtml(found.collateral, renderMarkdown, escapeHtml);
    body.appendChild(extra);
    if (!found.notes && !(found.collateral && found.collateral.length)) body.appendChild(h('p', { class: 'muted' }, 'No notes.'));
    loadReferenceIndex(db).then(function (index) { linkifyReferences(body, index); });
    if (db.storage) resolveAttachmentLinks(body, db.storage.from('brainy_files'));
  }

  function closeDetailQuiet() {
    shownTodo = null;
    detailToken++;
    $('detail').hidden = true;
    $('detail-backdrop').hidden = true;
  }

  function closeDetail() { if (filters.todo) navigate({ todo: '' }); }

  $('detail-close').addEventListener('click', closeDetail);
  $('detail-backdrop').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && filters.todo && $('date-dialog').hidden) closeDetail(); });
  $('detail-body').addEventListener('click', function (e) {
    var header = e.target.closest && e.target.closest('.collateral-toggle');
    if (header) header.parentNode.classList.toggle('collateral-open');
  });
  $('reload-btn').addEventListener('click', function () {
    archiveRows = null;
    shownTodo = null;
    load().then(function () { toast('Reloaded from Brainy'); });
  });

  // ── Boot: mock mode, or Supabase sign-in ──────────────────────────────
  function start(client) {
    db = client;
    $('auth-section').hidden = true;
    $('app').hidden = false;
    // Replace whatever is in the hash (e.g. an OAuth token hash) with our filters.
    history.replaceState(null, '', location.pathname + location.search + C.hashFor(filters));
    return load();
  }

  function boot() {
    var config = typeof CONFIG !== 'undefined' ? CONFIG : {};
    if (!config.SUPABASE_URL) {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        $('app').hidden = false;
        $('message').textContent = 'Not configured: this site has no Supabase config.';
        return;
      }
      // Mock mode: fake data in memory, reset on reload. Never real data.
      $('mock-banner').hidden = false;
      $('logout-btn').hidden = true;
      start(MockClient.createMockClient(BoardFixture.rows(), { table: 'brainy_todos', tables: BoardFixture.tables() }));
      return;
    }

    var client = supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
    $('login-btn').addEventListener('click', function () {
      var hash = C.hashFor(filters);
      if (hash) sessionStorage.setItem(STASH_KEY, hash);
      client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
    });
    $('logout-btn').addEventListener('click', function () {
      // 'local' ends only this browser's session; the default ('global')
      // would also revoke the CLI's refresh token in .env.
      client.auth.signOut({ scope: 'local' });
    });

    var started = false;
    client.auth.onAuthStateChange(function (event, session) {
      if (!session) {
        $('app').hidden = true;
        $('auth-section').hidden = false;
        return;
      }
      if (started) return;
      started = true;
      // Leave the auth callback before querying (supabase-js can deadlock on
      // calls made inside it).
      setTimeout(function () {
        var stashed = sessionStorage.getItem(STASH_KEY);
        sessionStorage.removeItem(STASH_KEY);
        if (stashed && !C.hashFor(filters)) filters = C.parseHash(stashed);
        start(client);
      }, 0);
    });
  }

  boot();
})();
