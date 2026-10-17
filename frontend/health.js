// Site-wide scheduler health: the in-app dead man's switch. On every page,
// once signed in, read the scheduler state and show a banner when the
// scheduler has stopped ticking, jobs are starved, or a job's last run
// failed; badge the Jobs nav link with the problem count and the Activity
// link with the number of unread agent reports.
//
// Loaded after the page's app.js, which defines the shared `db` client.

var BRAINY_STALE_TICK_MS = 60 * 60 * 1000;
var BRAINY_ACTIVITY_SEEN_KEY = 'brainy.activitySeenAt';

// Pure: list the problems worth a banner. `jobs` decides whether a scheduler
// is expected at all (no jobs = nothing to monitor).
// eslint-disable-next-line no-unused-vars
function brainyHealthProblems(state, jobs, nowMs) {
  var problems = [];
  if (!jobs || !jobs.length) return problems;
  if (!state || !state.last_tick_at) {
    problems.push('The scheduler has never ticked — install the timer on the scheduler host.');
    return problems;
  }
  var age = nowMs - new Date(state.last_tick_at).getTime();
  if (age > BRAINY_STALE_TICK_MS) {
    problems.push('The scheduler has not ticked for ' + Math.floor(age / 3600000) +
      'h — the scheduler host or its timer may be down.');
  }
  var starved = state.starved || [];
  if (starved.length) {
    problems.push(starved.length + ' starved job' + (starved.length > 1 ? 's' : '') + ': ' +
      starved.map(function (s) { return s.name; }).join(', '));
  }
  var failed = jobs.filter(function (j) {
    return j.enabled && (j.last_status === 'failed' || j.last_status === 'timed_out');
  });
  if (failed.length) {
    problems.push('Last run failed: ' + failed.map(function (j) { return j.name; }).join(', '));
  }
  return problems;
}

function brainyNavLink(suffix) {
  var nav = document.getElementById('brainy-nav');
  if (!nav || !nav.querySelectorAll) return null;
  var links = nav.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    if (links[i].href && links[i].href.indexOf(suffix) !== -1) return links[i];
  }
  return null;
}

function brainyBadge(link, count, className) {
  if (!link || !count) return;
  var badge = document.createElement('span');
  badge.className = 'nav-badge ' + className;
  badge.textContent = String(count);
  link.appendChild(badge);
}

function brainyRenderHealth(problems, unread) {
  if (problems.length) {
    var banner = document.createElement('div');
    banner.id = 'brainy-health-banner';
    banner.className = 'limit-warning health-banner';
    var jobsLink = brainyNavLink('browse/jobs/');
    banner.innerHTML = '<span class="limit-warning-icon" aria-hidden="true">⚠️</span><span><strong>Scheduler needs attention.</strong> ' +
      problems.map(escapeHtml).join(' · ') +
      (jobsLink ? ' <a href="' + jobsLink.href + '">Open Jobs</a>' : '') + '</span>';
    var main = document.querySelector('main');
    if (main && main.insertBefore) main.insertBefore(banner, main.firstChild);
  }
  brainyBadge(brainyNavLink('browse/jobs/'), problems.length, 'nav-badge-alert');
  brainyBadge(brainyNavLink('browse/activity/'), unread, 'nav-badge-new');
}

function brainyCheckHealth() {
  var seen = null;
  try { seen = window.localStorage && window.localStorage.getItem(BRAINY_ACTIVITY_SEEN_KEY); } catch (e) { /* private mode */ }
  var reportsQuery = db.from('brainy_job_runs').select('id').not('report', 'is', null);
  if (seen) reportsQuery = reportsQuery.gt('finished_at', seen);
  Promise.all([
    db.from('brainy_scheduled_jobs').select('name, enabled, last_status'),
    db.from('brainy_scheduler_state').select('*').limit(1),
    reportsQuery.limit(100),
  ]).then(function (results) {
    // Tables missing (scheduler not set up) or offline: say nothing.
    if (results[0].error || results[1].error) return;
    var problems = brainyHealthProblems((results[1].data || [])[0], results[0].data || [], Date.now());
    var unread = results[2].error ? 0 : (results[2].data || []).length;
    brainyRenderHealth(problems, unread);
  });
}

(function () {
  if (typeof db === 'undefined' || !db.auth) return;
  var checked = false;
  db.auth.onAuthStateChange(function (event, session) {
    if (session && !checked) {
      checked = true;
      brainyCheckHealth();
    }
  });
})();
