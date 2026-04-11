var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('status-msg');

var _statusFilter = '';
var _priorityFilter = '';

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    contentSection.style.display = 'block';
    loadTodos();
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
  var query = db.from('brainy_todos').select('*').order('created_at', { ascending: false }).limit(50);
  if (_statusFilter) query = query.eq('status', _statusFilter);
  if (_priorityFilter) query = query.eq('priority', _priorityFilter);

  query.then(function (result) {
    if (result.error) {
      showStatus('Failed to load: ' + result.error.message, 'status-error');
      return;
    }
    renderTodos(result.data);
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
    html += '<div class="card">' +
      '<div class="card-header">' +
        '<span class="card-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="badge badge-status-' + escapeHtml(t.status) + '">' + escapeHtml(t.status) + '</span>' +
        (t.priority ? '<span class="badge badge-priority-' + escapeHtml(t.priority) + '">' + escapeHtml(t.priority) + '</span>' : '') +
      '</div>' +
      (t.summary ? '<div class="card-summary">' + escapeHtml(truncate(t.summary, 200)) + '</div>' : '') +
      '<div class="card-meta">' +
        (t.category ? '<span>' + escapeHtml(t.category) + '</span>' : '') +
        (t.due_date ? '<span>Due ' + escapeHtml(t.due_date) + '</span>' : '') +
        '<span>' + escapeHtml(formatDate(t.created_at)) + '</span>' +
      '</div>' +
    '</div>';
  }
  cardsEl.innerHTML = html;
}
