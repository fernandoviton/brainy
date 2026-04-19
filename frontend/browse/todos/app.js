var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('status-msg');

var _statusFilter = 'active';
var _priorityFilter = '';
var _todos = [];
var _detailCache = {};
var _collateralCache = {};

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
  var query = db.from('brainy_todos').select('id, name, status, priority, summary, category, due, created_at').order('created_at', { ascending: false }).limit(50);
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
  });
}

function renderTodos(todos) {
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
  var todo = _todos[idx];
  if (!todo) return;

  var expanded = card.classList.toggle('card-expanded');
  if (!expanded) return; // collapsing — just toggle class, detail div stays hidden via CSS

  // Already has detail div? skip rebuild
  var detail = card.querySelector('.card-detail');
  if (detail) return;

  // Build detail div
  detail = document.createElement('div');
  detail.className = 'card-detail';
  detail.innerHTML = '<div class="detail-loading">Loading\u2026</div>';
  card.appendChild(detail);

  // Fetch full todo details + collateral
  loadDetail(todo.id, detail);
});

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

function loadDetail(todoId, detailEl) {
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
