var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('status-msg');
var searchEl = document.getElementById('text-search');

var _statusFilter = 'active';
var _priorityFilter = '';
var _deepLinkName = getDeepLink('todo') || getStashedDeepLink('todo');
var _todos = [];
var _rendered = [];
var _detailCache = {};
var _collateralCache = {};
var _archivedCollateralByName = {};

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text));
  }
  return escapeHtml(text);
}

var _loadedUserId = null;
db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    contentSection.style.display = 'block';
    if (session.user && session.user.id !== _loadedUserId) {
      _loadedUserId = session.user.id;
      loadTodos();
    }
  } else {
    _loadedUserId = null;
    authSection.style.display = 'block';
    contentSection.style.display = 'none';
  }
});

loginBtn.addEventListener('click', function () {
  stashDeepLink(); // the OAuth redirect drops the hash
  db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
});

logoutBtn.addEventListener('click', function () {
  db.auth.signOut();
});

// Filter pill handlers
function setupFilterGroup(groupId, callback) {
  var group = document.getElementById(groupId);
  group.addEventListener('click', function (e) {
    if (!e.target.classList.contains('pill')) return;
    var pills = group.querySelectorAll('.pill');
    for (var i = 0; i < pills.length; i++) pills[i].classList.remove('active');
    e.target.classList.add('active');
    callback(e.target.getAttribute('data-value'));
  });
}

setupFilterGroup('status-filter', function (val) {
  _statusFilter = val;
  loadTodos();
});

setupFilterGroup('priority-filter', function (val) {
  _priorityFilter = val;
  loadTodos();
});

function loadTodos() {
  if (searchEl) searchEl.value = '';

  if (_statusFilter === 'archived') {
    var aq = db.from('brainy_archive_entries')
      .select('id, todo_name, completion_date, year_month, summary_text, todo_snapshot, collateral_snapshot')
      .order('completion_date', { ascending: false })
      .limit(50);
    aq.then(function (result) {
      if (result.error) {
        showStatus('Failed to load: ' + result.error.message, 'status-error');
        return;
      }
      var rows = result.data || [];
      _todos = rows.map(function (r) {
        var snap = r.todo_snapshot || {};
        var summary = r.summary_text || '';
        return {
          id: r.id,
          name: r.todo_name,
          status: 'archived',
          priority: snap.priority || null,
          summary: summary.split(/\n\n/)[0],
          notes: summary,
          category: snap.category || null,
          due: r.completion_date,
          created_at: r.completion_date,
          _archived: true,
          _collateralSnapshot: r.collateral_snapshot || null,
        };
      });
      if (_priorityFilter) {
        _todos = _todos.filter(function (t) { return t.priority === _priorityFilter; });
      }
      _detailCache = {};
      _collateralCache = {};
      _archivedCollateralByName = {};
      for (var i = 0; i < _todos.length; i++) {
        _archivedCollateralByName[_todos[i].name] = _todos[i]._collateralSnapshot;
      }
      renderTodos(_todos);
      handleDeepLink();
    });
    return;
  }

  var query = db.from('brainy_todos').select('id, name, status, priority, summary, category, due, scheduled_date, created_at').order('created_at', { ascending: false }).limit(50);
  if (_statusFilter) query = query.eq('status', _statusFilter);
  if (_priorityFilter) query = query.eq('priority', _priorityFilter);

  query.then(function (result) {
    if (result.error) {
      showStatus('Failed to load: ' + result.error.message, 'status-error');
      return;
    }
    _todos = result.data || [];
    _detailCache = {};
    _collateralCache = {};
    renderTodos(_todos);
    handleDeepLink();
  });
}

// On first load, open the todo named in the URL hash (#todo=<name>). If it
// isn't in the current filter's results (e.g. a "later" todo while the
// default filter is "active"), fetch it by name and show it on top.
function handleDeepLink() {
  if (!_deepLinkName) return;
  var name = _deepLinkName;
  _deepLinkName = null;

  for (var i = 0; i < _rendered.length; i++) {
    if (_rendered[i].name === name) {
      openTodoAt(i);
      return;
    }
  }

  db.from('brainy_todos')
    .select('id, name, status, priority, summary, category, due, scheduled_date, created_at')
    .eq('name', name)
    .then(function (result) {
      var rows = (!result.error && result.data) || [];
      if (!rows.length) return;
      _todos = [rows[0]].concat(_todos);
      renderTodos(_todos);
      openTodoAt(0);
    });
}

function openTodoAt(idx) {
  var card = cardsEl.querySelector('[data-todo-idx="' + idx + '"]');
  if (!card) return;
  card.classList.add('card-expanded');
  setDeepLink('todo', _rendered[idx].name); // restore the shareable URL (lost when the link went through sign-in)
  ensureDetail(card, _rendered[idx]);
  if (card.scrollIntoView) card.scrollIntoView();
}

if (searchEl) {
  setupLiveSearch(searchEl, function () { return _todos; }, ['name', 'summary', 'category'], renderTodos);
}

function renderTodos(todos) {
  // Track exactly what was rendered so expand-clicks resolve the right todo.
  // During live search this is a filtered subset, so card indexes (data-todo-idx)
  // are positions in THIS array, not in the full _todos list.
  _rendered = todos || [];

  if (!todos || todos.length === 0) {
    cardsEl.innerHTML = '<div class="empty-state">No TODOs found.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < todos.length; i++) {
    var t = todos[i];
    html += '<div class="card" data-todo-idx="' + i + '">' +
      '<div class="card-header">' +
        '<button class="card-toggle" aria-label="Expand">&#x25B6;</button>' +
        '<span class="card-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="badge badge-status-' + escapeHtml(t.status) + '">' + escapeHtml(t.status) + '</span>' +
        (t.priority ? '<span class="badge badge-priority-' + escapeHtml(t.priority) + '">' + escapeHtml(t.priority) + '</span>' : '') +
      '</div>' +
      (t.summary ? '<div class="card-summary">' + escapeHtml(truncate(t.summary, 200)) + '</div>' : '') +
      '<div class="card-meta">' +
        (t.category ? '<span>' + escapeHtml(t.category) + '</span>' : '') +
        (t.due ? '<span>Due ' + escapeHtml(t.due) + '</span>' : '') +
        (t.scheduled_date ? '<span>Scheduled ' + escapeHtml(t.scheduled_date) + '</span>' : '') +
        '<span>' + escapeHtml(formatDate(t.created_at)) + '</span>' +
      '</div>' +
    '</div>';
  }
  cardsEl.innerHTML = html;
}

// Expand/collapse via event delegation
cardsEl.addEventListener('click', function (e) {
  var toggle = e.target;
  if (!toggle.classList.contains('card-toggle')) return;

  var card = toggle.closest('.card');
  if (!card) return;

  var idx = parseInt(card.getAttribute('data-todo-idx'), 10);
  var todo = _rendered[idx];
  if (!todo) return;

  var expanded = card.classList.toggle('card-expanded');
  setDeepLink('todo', expanded ? todo.name : null);
  if (!expanded) return; // collapsing — just toggle class, detail div stays hidden via CSS

  ensureDetail(card, todo);
});

// Build the detail div (notes + collateral) unless the card already has one.
function ensureDetail(card, todo) {
  var detail = card.querySelector('.card-detail');
  if (detail) return;

  detail = document.createElement('div');
  detail.className = 'card-detail';
  detail.innerHTML = '<div class="detail-loading">Loading\u2026</div>';
  card.appendChild(detail);

  // Fetch full todo details + collateral
  loadDetail(todo, detail);
}

// Collateral box expand/collapse via event delegation
cardsEl.addEventListener('click', function (e) {
  var header = e.target.closest ? e.target.closest('.collateral-toggle') : null;
  if (!header) {
    // fallback for environments without closest
    var el = e.target;
    while (el && el !== cardsEl) {
      if (el.className && el.className.indexOf('collateral-toggle') !== -1) { header = el; break; }
      el = el.parentNode;
    }
  }
  if (!header) return;
  var box = header.parentNode;
  if (!box) return;
  var isOpen = box.className.indexOf('collateral-open') !== -1;
  box.className = isOpen ? box.className.replace(' collateral-open', '') : box.className + ' collateral-open';
});

function loadDetail(todo, detailEl) {
  var todoId = todo.id;

  if (todo._archived) {
    renderDetail({ notes: todo.notes }, detailEl);
    renderCollateral(normalizeArchivedCollateral(_archivedCollateralByName[todo.name]), detailEl);
    return;
  }

  if (_detailCache[todoId] !== undefined) {
    renderDetail(_detailCache[todoId], detailEl);
    loadCollateral(todoId, detailEl);
    return;
  }

  db.from('brainy_todos')
    .select('id, notes')
    .eq('id', todoId)
    .then(function (result) {
      var row = (!result.error && result.data && result.data[0]) ? result.data[0] : {};
      _detailCache[todoId] = row;
      renderDetail(row, detailEl);
      loadCollateral(todoId, detailEl);
    });
}

function normalizeArchivedCollateral(snap) {
  if (!snap || !snap.length) return [];
  return snap.map(function (entry) {
    if (typeof entry === 'string') {
      return { filename: entry, content_type: null, storage_path: null, text_content: null, _legacy: true };
    }
    return entry;
  });
}

function renderDetail(row, detailEl) {
  var html = '';
  if (row.notes) {
    html += '<div class="card-notes">' + renderMarkdown(row.notes) + '</div>';
  }
  detailEl.innerHTML = html;
}

function loadCollateral(todoId, detailEl) {
  if (_collateralCache[todoId] !== undefined) {
    renderCollateral(_collateralCache[todoId], detailEl);
    return;
  }

  db.from('brainy_todo_collateral')
    .select('id, filename, content_type, text_content, storage_path')
    .eq('todo_id', todoId)
    .then(function (result) {
      var items = (result.error ? [] : result.data) || [];
      _collateralCache[todoId] = items;
      renderCollateral(items, detailEl);
    });
}

function renderCollateral(items, detailEl) {
  if (!items || items.length === 0) return;

  var html = '<div class="card-collateral">';

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.text_content) {
      // Text collateral — render in a bordered box with collapsible header
      var content;
      if ((item.content_type && item.content_type.match(/markdown/)) || (item.filename && item.filename.match(/\.md$/i))) {
        content = renderMarkdown(item.text_content);
      } else {
        content = '<pre>' + escapeHtml(item.text_content) + '</pre>';
      }
      html += '<div class="collateral-box">' +
        '<div class="collateral-box-header collateral-toggle">' +
          '<span class="collateral-chevron">&#x25B6;</span>' +
          '<span class="collateral-box-filename">' + escapeHtml(item.filename) + '</span>' +
        '</div>' +
        '<div class="collateral-box-body">' + content + '</div>' +
      '</div>';
    } else if (item.storage_path) {
      // Binary collateral — file link in a box
      html += '<div class="collateral-box collateral-box-link">' +
        '<span class="collateral-file-link" data-storage-path="' + escapeHtml(item.storage_path) + '">' +
          escapeHtml(item.filename) +
        '</span>' +
      '</div>';
    } else if (item._legacy) {
      // Old-shape archive entry: filename string only, content not preserved
      html += '<div class="collateral-box collateral-box-link">' +
        '<span class="collateral-file-link">' + escapeHtml(item.filename) + '</span>' +
        '<span class="archived-empty-note"> (content not preserved)</span>' +
      '</div>';
    }
  }

  html += '</div>';
  detailEl.innerHTML += html;

  // Resolve signed URLs for binary items
  resolveSignedUrls(detailEl);
}

function resolveSignedUrls(detailEl) {
  var placeholders = detailEl.querySelectorAll('[data-storage-path]');
  if (!placeholders || !placeholders.length) return;

  for (var i = 0; i < placeholders.length; i++) {
    (function (el) {
      var storagePath = el.getAttribute('data-storage-path');
      db.storage.from('brainy_files').createSignedUrl(storagePath, 3600)
        .then(function (result) {
          if (result.data && result.data.signedUrl) {
            var a = document.createElement('a');
            a.href = result.data.signedUrl;
            a.target = '_blank';
            a.className = 'collateral-file-link';
            a.textContent = el.textContent;
            if (el.parentNode && el.parentNode.replaceChild) {
              el.parentNode.replaceChild(a, el);
            }
          }
        });
    })(placeholders[i]);
  }
}
