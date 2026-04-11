var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('status-msg');
var pathSearch = document.getElementById('path-search');

var _formatFilter = '';
var _pathPrefix = '';
var _debounceTimer = null;

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    contentSection.style.display = 'block';
    loadKnowledge();
  } else {
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

// Format filter pills
var formatGroup = document.getElementById('format-filter');
formatGroup.addEventListener('click', function (e) {
  if (!e.target.classList.contains('pill')) return;
  var pills = formatGroup.querySelectorAll('.pill');
  for (var i = 0; i < pills.length; i++) pills[i].classList.remove('active');
  e.target.classList.add('active');
  _formatFilter = e.target.getAttribute('data-value');
  loadKnowledge();
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
    .select('path, topic, summary, format, updated_at')
    .order('path')
    .limit(100);

  if (_pathPrefix) query = query.like('path', _pathPrefix + '%');
  if (_formatFilter) query = query.eq('format', _formatFilter);

  query.then(function (result) {
    if (result.error) {
      showStatus('Failed to load: ' + result.error.message, 'status-error');
      return;
    }
    renderKnowledge(result.data);
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

function renderKnowledge(items) {
  if (!items || items.length === 0) {
    cardsEl.innerHTML = '<div class="empty-state">No knowledge entries found.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < items.length; i++) {
    var k = items[i];
    html += '<div class="card">' +
      '<div class="card-path">' + renderPathBreadcrumb(k.path) + '</div>' +
      (k.topic ? '<div class="card-topic">' + escapeHtml(k.topic) + '</div>' : '') +
      (k.summary ? '<div class="card-summary">' + escapeHtml(truncate(k.summary, 200)) + '</div>' : '') +
      '<div class="card-meta">' +
        (k.format ? '<span class="badge-format">' + escapeHtml(k.format) + '</span>' : '') +
        '<span>' + escapeHtml(formatDate(k.updated_at)) + '</span>' +
      '</div>' +
    '</div>';
  }
  cardsEl.innerHTML = html;
}
