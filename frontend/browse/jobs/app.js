var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var tickPanel = document.getElementById('tick-panel');
var statusMsg = document.getElementById('status-msg');

// Read-only view of the scheduler (docs/scheduler-architecture.md). Jobs are
// managed through the CLI; this page only reads.
var RUNS_LIMIT = 300;
var RUNS_PER_JOB = 10;
// The timer ticks every 15 minutes; more than an hour of silence means the
// scheduler host (or its timer) is down.
var STALE_TICK_MS = 60 * 60 * 1000;

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

var _loadedUserId = null;
db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    contentSection.style.display = 'block';
    if (session.user && session.user.id !== _loadedUserId) {
      _loadedUserId = session.user.id;
      loadAll();
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
  // 'local' ends only this browser's session; 'global' would also revoke the CLI's token.
  db.auth.signOut({ scope: 'local' });
});

function fetchRows(q) {
  return new Promise(function (resolve) {
    q.then(function (result) {
      if (result.error) {
        showStatus('Failed to load: ' + result.error.message, 'status-error');
        resolve([]);
        return;
      }
      resolve(result.data || []);
    });
  });
}

function loadAll() {
  Promise.all([
    fetchRows(db.from('brainy_scheduled_jobs').select('*').order('name')),
    fetchRows(db.from('brainy_job_runs')
      .select('id, job_id, job_name, reason, status, started_at, finished_at, exit_code, host, output_tail')
      .order('started_at', { ascending: false })
      .limit(RUNS_LIMIT)),
    fetchRows(db.from('brainy_scheduler_state').select('*').limit(1)),
  ]).then(function (results) {
    var state = results[2][0] || null;
    renderTickPanel(state);
    renderJobs(results[0], results[1], state);
  });
}

function fmtTime(iso) {
  if (!iso) return 'never';
  var d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function describeTrigger(job) {
  if (job.trigger === 'schedule') return 'Schedule <code>' + escapeHtml(job.cron) + '</code>';
  return 'Capacity: last ' + job.window_hours + 'h of the week, weekly &lt;' + job.max_weekly_pct +
    '%, session &lt;' + job.max_session_pct + '%, ' + job.runs_per_cycle + '/cycle';
}

function renderTickPanel(state) {
  if (!state || !state.last_tick_at) {
    tickPanel.innerHTML = '<div class="limit-warning"><span class="limit-warning-icon" aria-hidden="true">⚠️</span>' +
      '<span><strong>The scheduler has never ticked.</strong> Install the timer on the scheduler host ' +
      '(<code>node scripts/install-scheduler.js</code>).</span></div>';
    return;
  }
  var html = '';
  var age = Date.now() - new Date(state.last_tick_at).getTime();
  if (age > STALE_TICK_MS) {
    html += '<div class="limit-warning"><span class="limit-warning-icon" aria-hidden="true">⚠️</span>' +
      '<span><strong>The scheduler has not ticked since ' + escapeHtml(fmtTime(state.last_tick_at)) + '.</strong> ' +
      'The host or its timer may be down — nothing below is current.</span></div>';
  }
  html += '<div class="tick-line">Last tick ' + escapeHtml(formatDate(state.last_tick_at)) +
    (state.host ? ' on <strong>' + escapeHtml(state.host) + '</strong>' : '') + '</div>';
  var u = state.usage;
  if (u && u.weekly && u.session) {
    html += '<div class="tick-line">Session ' + u.session.percent + '% (resets ' + escapeHtml(fmtTime(u.session.resets_at)) + ') · ' +
      'Weekly ' + u.weekly.percent + '% (resets ' + escapeHtml(fmtTime(u.weekly.resets_at)) + ')</div>';
  }
  if (state.usage_error) {
    html += '<div class="tick-line tick-error">Usage unavailable: ' + escapeHtml(state.usage_error) + '</div>';
  }
  tickPanel.innerHTML = html;
}

function byName(list) {
  var map = {};
  for (var i = 0; i < (list || []).length; i++) map[list[i].name] = list[i];
  return map;
}

function duration(run) {
  if (!run.finished_at) return '';
  var s = Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000);
  return s < 120 ? s + 's' : Math.round(s / 60) + 'm';
}

function renderRuns(runs) {
  if (!runs.length) return '<div class="detail-empty">No runs yet.</div>';
  var html = '<div class="runs">';
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    html += '<details class="run run-' + escapeHtml(r.status) + '"><summary>' +
      '<span class="badge badge-' + escapeHtml(r.status) + '">' + escapeHtml(r.status) + '</span> ' +
      escapeHtml(fmtTime(r.started_at)) + ' · ' + escapeHtml(r.reason) +
      (duration(r) ? ' · ' + duration(r) : '') +
      (r.exit_code !== null && r.exit_code !== undefined ? ' · exit ' + r.exit_code : '') +
      (r.host ? ' · ' + escapeHtml(r.host) : '') +
      '</summary><pre class="run-output">' + escapeHtml(r.output_tail || '(no output)') + '</pre></details>';
  }
  return html + '</div>';
}

function renderJobs(jobs, runs, state) {
  if (!jobs.length) {
    cardsEl.innerHTML = '<div class="empty-state">No scheduled jobs. Create one with <code>node backend/cli.js job create</code>.</div>';
    return;
  }
  var waiting = byName(state && state.waiting);
  var starved = byName(state && state.starved);
  var runsByJob = {};
  for (var r = 0; r < runs.length; r++) {
    var list = runsByJob[runs[r].job_id] || (runsByJob[runs[r].job_id] = []);
    if (list.length < RUNS_PER_JOB) list.push(runs[r]);
  }

  var html = '';
  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    var badges = '<span class="badge badge-kind">' + escapeHtml(j.kind) + '</span>';
    if (!j.enabled) badges += '<span class="badge badge-disabled">disabled</span>';
    if (starved[j.name]) badges += '<span class="badge badge-starved">starved ' + starved[j.name].hours_since_success + 'h</span>';
    if (j.last_status) badges += '<span class="badge badge-' + escapeHtml(j.last_status) + '">' + escapeHtml(j.last_status) + '</span>';

    var next = '';
    if (waiting[j.name] && j.trigger !== 'schedule') next = escapeHtml(waiting[j.name].reason);
    else if (j.trigger === 'schedule' && j.next_run_at) next = 'next ' + escapeHtml(fmtTime(j.next_run_at));
    var requested = j.run_requested_at && (!j.last_run_at || j.run_requested_at > j.last_run_at);

    html += '<details class="card job-card"><summary class="card-header">' +
        '<span class="job-name">' + escapeHtml(j.name) + '</span>' + badges +
      '</summary>' +
      '<div class="card-summary">' + describeTrigger(j) + ' · ' + escapeHtml(j.priority || '') + '</div>' +
      '<div class="card-meta">' +
        '<span>last: ' + (j.last_run_at ? escapeHtml(fmtTime(j.last_run_at)) : 'never run') + '</span>' +
        (j.last_success_at ? '<span>last success: ' + escapeHtml(fmtTime(j.last_success_at)) + '</span>' : '') +
        (next ? '<span>' + next + '</span>' : '') +
        (requested ? '<span class="requested">run requested</span>' : '') +
      '</div>' +
      '<div class="card-detail">' +
        (j.description ? '<p class="job-description">' + escapeHtml(j.description) + '</p>' : '') +
        '<pre class="job-payload">' + escapeHtml(j.kind === 'command' ? '$ ' + j.command : j.prompt) + '</pre>' +
        renderRuns(runsByJob[j.id] || []) +
      '</div>' +
    '</details>';
  }
  cardsEl.innerHTML = html;
}
