var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var filtersEl = document.getElementById('filters');
var statusMsg = document.getElementById('status-msg');

// Agent run reports, newest first, each with the actions the CLI audited
// during the run (not the agent's own account of them). Read-only.
var REPORTS_LIMIT = 100;
var SEEN_KEY = 'brainy.activitySeenAt';

var _reports = [];
var _filter = null;
var _seenBefore = null;

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text));
  }
  return '<pre>' + escapeHtml(text) + '</pre>';
}

var _loadedUserId = null;
db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    contentSection.style.display = 'block';
    if (session.user && session.user.id !== _loadedUserId) {
      _loadedUserId = session.user.id;
      loadReports();
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
  db.auth.signOut({ scope: 'local' });
});

function readSeen() {
  try { return window.localStorage ? window.localStorage.getItem(SEEN_KEY) : null; } catch (e) { return null; }
}

function markSeen() {
  try { if (window.localStorage) window.localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch (e) { /* private mode */ }
}

function loadReports() {
  _seenBefore = readSeen();
  db.from('brainy_job_runs')
    .select('id, job_name, reason, status, started_at, finished_at, report, transcript_path, permission_denials, usage_before, usage_after')
    .not('report', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(REPORTS_LIMIT)
    .then(function (result) {
      if (result.error) {
        showStatus('Failed to load: ' + result.error.message, 'status-error');
        return;
      }
      var runs = result.data || [];
      if (!runs.length) {
        _reports = [];
        render();
        markSeen();
        return;
      }
      db.from('brainy_run_events')
        .select('run_id, action, target_type, target, detail, created_at')
        .in('run_id', runs.map(function (r) { return r.id; }))
        .order('created_at')
        .then(function (evResult) {
          var events = evResult.error ? [] : (evResult.data || []);
          for (var i = 0; i < runs.length; i++) {
            runs[i].events = events.filter(function (e) { return e.run_id === runs[i].id; });
          }
          _reports = runs;
          render();
          markSeen();
        });
    });
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Weekly-usage points the run consumed, when both readings exist.
function costText(r) {
  var b = r.usage_before && r.usage_before.weekly;
  var a = r.usage_after && r.usage_after.weekly;
  if (!b || !a) return '';
  var d = Math.round((a.percent - b.percent) * 10) / 10;
  return 'weekly usage +' + d + '%';
}

function targetLink(e) {
  var t = escapeHtml(e.target || '');
  if (e.target_type === 'todo' && e.target) return '<a href="../todos/#todo=' + encodeURIComponent(e.target) + '">' + t + '</a>';
  if (e.target_type === 'knowledge' && e.target) return '<a href="../knowledge/#knowledge=' + escapeHtml(e.target) + '">' + t + '</a>';
  if (e.target_type === 'capture' && e.target) return '<a href="../captures/#capture=' + encodeURIComponent(e.target) + '">' + t + '</a>';
  return t;
}

function renderFilters() {
  var names = [];
  for (var i = 0; i < _reports.length; i++) {
    if (names.indexOf(_reports[i].job_name) === -1) names.push(_reports[i].job_name);
  }
  var html = '<button type="button" class="pill' + (_filter ? '' : ' active') + '" data-job="">All</button>';
  for (var n = 0; n < names.length; n++) {
    html += '<button type="button" class="pill' + (_filter === names[n] ? ' active' : '') + '" data-job="' +
      escapeHtml(names[n]) + '">' + escapeHtml(names[n]) + '</button>';
  }
  filtersEl.innerHTML = html;
}

function render() {
  renderFilters();
  var items = _reports.filter(function (r) { return !_filter || r.job_name === _filter; });
  if (!items.length) {
    cardsEl.innerHTML = '<div class="empty-state">No agent reports yet.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var r = items[i];
    var isNew = !_seenBefore || (r.finished_at && r.finished_at > _seenBefore);
    var events = r.events || [];
    html += '<div class="card' + (isNew ? ' report-new' : '') + '" data-run-id="' + escapeHtml(r.id) + '">' +
      '<div class="card-header" style="cursor:default">' +
        '<span class="job-name">' + escapeHtml(r.job_name) + '</span>' +
        '<span class="badge badge-' + escapeHtml(r.status) + '">' + escapeHtml(r.status) + '</span>' +
        (isNew ? '<span class="badge badge-new">new</span>' : '') +
      '</div>' +
      '<div class="card-meta"><span>' + escapeHtml(fmtTime(r.finished_at)) + '</span><span>' + escapeHtml(r.reason) + '</span>' +
        (costText(r) ? '<span>' + escapeHtml(costText(r)) + '</span>' : '') +
        '<span>' + events.length + ' audited action' + (events.length === 1 ? '' : 's') + '</span></div>';
    if (events.length) {
      html += '<ul class="events">';
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        html += '<li>' + escapeHtml(ev.action) + ' ' + escapeHtml(ev.target_type) + ' ' + targetLink(ev) +
          (ev.detail ? ' — ' + escapeHtml(ev.detail) : '') + '</li>';
      }
      html += '</ul>';
    }
    if (r.permission_denials && r.permission_denials.length) {
      html += '<div class="denials">Blocked tool calls: ' +
        escapeHtml(r.permission_denials.map(function (d) { return d.tool_name; }).join(', ')) + '</div>';
    }
    html += '<div class="report-body">' + renderMarkdown(r.report || '') + '</div>';
    if (r.transcript_path) {
      html += '<button type="button" class="transcript-btn" data-transcript="' + escapeHtml(r.transcript_path) + '">Open transcript</button>';
    }
    html += '</div>';
  }
  cardsEl.innerHTML = html;
}

filtersEl.addEventListener('click', function (e) {
  var job = e.target && e.target.getAttribute && e.target.getAttribute('data-job');
  if (job === null || job === undefined) return;
  _filter = job || null;
  render();
});

cardsEl.addEventListener('click', function (e) {
  var key = e.target && e.target.getAttribute && e.target.getAttribute('data-transcript');
  if (!key) return;
  db.storage.from('brainy_files').createSignedUrl(key, 3600).then(function (result) {
    if (result.data && result.data.signedUrl) window.open(result.data.signedUrl, '_blank');
    else showStatus('Could not open transcript.', 'status-error');
  });
});
