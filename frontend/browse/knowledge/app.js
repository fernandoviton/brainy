var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('status-msg');
var pathSearch = document.getElementById('path-search');

var _pathPrefix = '';
var _debounceTimer = null;
var _items = [];
var _itemsByPath = {};
var _detailCache = {};
var _attachmentCache = {};

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
      loadKnowledge();
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

// Debounced path search
pathSearch.addEventListener('input', function () {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(function () {
    _pathPrefix = pathSearch.value.trim();
    loadKnowledge();
  }, 300);
});

function loadKnowledge() {
  var query = db.from('brainy_knowledge')
    .select('id, path, topic, summary, updated_at')
    .order('path')
    .limit(100);

  if (_pathPrefix) query = query.like('path', _pathPrefix + '%');

  query.then(function (result) {
    if (result.error) {
      showStatus('Failed to load: ' + result.error.message, 'status-error');
      return;
    }
    _items = result.data || [];
    _itemsByPath = {};
    for (var i = 0; i < _items.length; i++) _itemsByPath[_items[i].path] = _items[i];
    _detailCache = {};
    _attachmentCache = {};
    renderKnowledge(_items);
  });
}

function renderPathBreadcrumb(path) {
  var parts = path.split('/');
  var html = '';
  for (var i = 0; i < parts.length; i++) {
    if (i > 0) html += '<span class="path-separator">/</span>';
    html += '<span class="path-segment">' + escapeHtml(parts[i]) + '</span>';
  }
  return html;
}

function groupByTopLevel(items) {
  if (!items || items.length === 0) return [];
  var groups = [];
  var groupMap = {};
  for (var i = 0; i < items.length; i++) {
    var parts = items[i].path.split('/');
    var key = parts.length > 1 ? parts[0] : 'Other';
    if (groupMap[key] === undefined) {
      groupMap[key] = groups.length;
      groups.push({ group: key, items: [] });
    }
    groups[groupMap[key]].items.push(items[i]);
  }
  return groups;
}

function renderKnowledge(items) {
  if (!items || items.length === 0) {
    cardsEl.innerHTML = '<div class="empty-state">No knowledge entries found.</div>';
    return;
  }

  var groups = groupByTopLevel(items);
  var html = '';
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var label = group.group.charAt(0).toUpperCase() + group.group.slice(1);
    html += '<div class="section-group">';
    html += '<h2 class="section-heading">' + escapeHtml(label) + '</h2>';
    for (var i = 0; i < group.items.length; i++) {
      var k = group.items[i];
      html += '<div class="card" data-knowledge-path="' + escapeHtml(k.path) + '">' +
        '<div class="card-header">' +
          '<button class="card-toggle" aria-label="Expand">&#x25B6;</button>' +
          '<span class="card-path">' + renderPathBreadcrumb(k.path) + '</span>' +
        '</div>' +
        (k.topic ? '<div class="card-topic">' + escapeHtml(k.topic) + '</div>' : '') +
        (k.summary ? '<div class="card-summary">' + escapeHtml(truncate(k.summary, 200)) + '</div>' : '') +
        '<div class="card-meta">' +
          '<span>' + escapeHtml(formatDate(k.updated_at)) + '</span>' +
        '</div>' +
      '</div>';
    }
    html += '</div>';
  }
  cardsEl.innerHTML = html;
}

// Expand/collapse via event delegation
cardsEl.addEventListener('click', function (e) {
  var toggle = e.target;
  if (!toggle.classList.contains('card-toggle')) return;

  var card = toggle.closest('.card');
  if (!card) return;

  var path = card.getAttribute('data-knowledge-path');
  var item = _itemsByPath[path];
  if (!item) return;

  var expanded = card.classList.toggle('card-expanded');
  if (!expanded) return;

  var detail = card.querySelector('.card-detail');
  if (detail) return;

  detail = document.createElement('div');
  detail.className = 'card-detail';
  detail.innerHTML = '<div class="detail-loading">Loading\u2026</div>';
  card.appendChild(detail);

  loadDetail(item, detail);
});

function loadDetail(item, detailEl) {
  if (_detailCache[item.path] !== undefined) {
    renderDetail(_detailCache[item.path], detailEl);
    loadAttachments(item.id, detailEl);
    return;
  }

  db.from('brainy_knowledge')
    .select('id, content')
    .eq('id', item.id)
    .then(function (result) {
      var row = (!result.error && result.data && result.data[0]) ? result.data[0] : {};
      _detailCache[item.path] = row;
      renderDetail(row, detailEl);
      loadAttachments(item.id, detailEl);
    });
}

function renderDetail(row, detailEl) {
  var html = '';
  if (row.content) {
    html += '<div class="card-content">' + renderMarkdown(row.content) + '</div>';
  } else {
    html += '<div class="detail-empty">No content.</div>';
  }
  detailEl.innerHTML = html;
}

function loadAttachments(knowledgeId, detailEl) {
  if (_attachmentCache[knowledgeId] !== undefined) {
    renderAttachments(_attachmentCache[knowledgeId], detailEl);
    return;
  }

  db.from('brainy_knowledge_attachments')
    .select('id, filename, storage_path')
    .eq('knowledge_id', knowledgeId)
    .then(function (result) {
      var items = (result.error ? [] : result.data) || [];
      _attachmentCache[knowledgeId] = items;
      renderAttachments(items, detailEl);
    });
}

function renderAttachments(items, detailEl) {
  if (!items || items.length === 0) return;

  var html = '<div class="card-attachments">';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.storage_path) {
      html += '<div class="collateral-box collateral-box-link">' +
        '<span class="collateral-file-link" data-storage-path="' + escapeHtml(item.storage_path) + '">' +
          escapeHtml(item.filename) +
        '</span>' +
      '</div>';
    }
  }
  html += '</div>';
  detailEl.innerHTML += html;

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
