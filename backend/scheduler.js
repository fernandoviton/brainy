/**
 * Job scheduler: decides which scheduled jobs run on each tick, and runs them.
 *
 * Everything here is pure or takes its side effects as injected dependencies
 * (storage, usage probe, job runner, clock), so the decision logic is unit
 * testable. See docs/scheduler-architecture.md for the design.
 *
 * Triggers:
 *   schedule  — runs every time its cron expression fires (missed fires while
 *               the host was off collapse into one catch-up run).
 *   capacity  — runs only on spare subscription capacity: near the end of the
 *               weekly usage cycle, with weekly and 5-hour usage under caps,
 *               at most runs_per_cycle times per cycle, one job per tick.
 *   requested — any job whose run_requested_at is newer than its last run
 *               (set by `job run`), regardless of trigger or capacity.
 */
const { parseCron, nextFire, maxGapMs } = require('./cron');

const HOUR = 3600e3;
const CYCLE_MS = 7 * 24 * HOUR;
const USAGE_FRESH_MS = 30 * 60e3;
// A run on another host is presumed dead after its timeout plus this grace.
const STALE_GRACE_MS = 15 * 60e3;

const KINDS = ['command', 'agent'];
const TRIGGERS = ['schedule', 'capacity'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const JOB_DEFAULTS = {
  enabled: true,
  timeout_minutes: 30,
  window_hours: 24,
  max_weekly_pct: 80,
  max_session_pct: 50,
  runs_per_cycle: 1,
  priority: 'P2',
};

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function assertInt(job, field, { min, max, nullable = false }) {
  const v = job[field];
  if (v === null || v === undefined) {
    if (nullable) return;
    throw new Error(`${field} is required`);
  }
  if (!Number.isInteger(v) || v < min || (max !== undefined && v > max)) {
    throw new Error(`${field} must be an integer ${max !== undefined ? `${min}-${max}` : `>= ${min}`} (got ${v})`);
  }
}

// Throws on the first problem. `job` is the full row (defaults merged in).
function validateJob(job) {
  if (!job.name || !NAME_RE.test(job.name)) {
    throw new Error(`job name "${job.name}" must be kebab-case (e.g. nightly-backup)`);
  }
  if (!KINDS.includes(job.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')} (got ${job.kind})`);
  if (!TRIGGERS.includes(job.trigger)) {
    throw new Error(`trigger must be one of ${TRIGGERS.join(', ')} (got ${job.trigger})`);
  }
  if (job.kind === 'command' && isBlank(job.command)) throw new Error('a command job needs a command (--command)');
  if (job.kind === 'agent' && isBlank(job.prompt)) throw new Error('an agent job needs a prompt (--prompt or --file)');
  if (job.trigger === 'schedule') {
    if (isBlank(job.cron)) throw new Error('a schedule job needs a cron expression (--cron)');
  }
  if (!isBlank(job.cron)) parseCron(job.cron);
  if (job.priority && !PRIORITIES.includes(job.priority)) {
    throw new Error(`priority must be one of ${PRIORITIES.join(', ')} (got ${job.priority})`);
  }
  if (!isBlank(job.permission_mode) && !PERMISSION_MODES.includes(job.permission_mode)) {
    throw new Error(`permission_mode must be one of ${PERMISSION_MODES.join(', ')} (got ${job.permission_mode})`);
  }
  assertInt(job, 'timeout_minutes', { min: 1 });
  assertInt(job, 'window_hours', { min: 1, max: 168 });
  assertInt(job, 'max_weekly_pct', { min: 1, max: 100 });
  assertInt(job, 'max_session_pct', { min: 1, max: 100 });
  assertInt(job, 'runs_per_cycle', { min: 1 });
  assertInt(job, 'starvation_hours', { min: 1, nullable: true });
  for (const field of ['allowed_tools', 'disallowed_tools']) {
    const v = job[field];
    if (v === null || v === undefined) continue;
    if (!Array.isArray(v) || v.some((t) => typeof t !== 'string' || t.trim() === '')) {
      throw new Error(`${field} must be a list of non-empty tool names/patterns`);
    }
  }
}

const ms = (t) => (t ? new Date(t).getTime() : null);

function cycleStart(usage) {
  return new Date(ms(usage.weekly.resets_at) - CYCLE_MS);
}

function usageIsFresh(usage, now) {
  return !!(usage && usage.weekly && usage.session && ms(usage.fetched_at) !== null
    && now.getTime() - ms(usage.fetched_at) <= USAGE_FRESH_MS);
}

// null = may run now; otherwise a human-readable reason it is waiting.
// The weekly reset time is stable, so even a stale reading can rule a job out
// for being outside its window; the percentages must be fresh to rule it in.
function capacityGate(job, usage, now, cycleCount) {
  const resetAt = usage && usage.weekly && ms(usage.weekly.resets_at);
  if (resetAt && resetAt > now.getTime()) {
    const resetInH = Math.round((resetAt - now.getTime()) / HOUR);
    if (resetInH > job.window_hours) {
      return `waiting for capacity: weekly reset in ${resetInH}h (runs in the last ${job.window_hours}h)`;
    }
  }
  if (!usageIsFresh(usage, now)) return 'waiting for capacity: usage unknown';
  if (usage.weekly.percent >= job.max_weekly_pct) {
    return `waiting for capacity: weekly usage ${usage.weekly.percent}% (cap ${job.max_weekly_pct}%)`;
  }
  if (usage.session.percent >= job.max_session_pct) {
    return `waiting for capacity: session usage ${usage.session.percent}% (cap ${job.max_session_pct}%)`;
  }
  if (cycleCount >= job.runs_per_cycle) {
    return `done for this cycle: ${cycleCount}/${job.runs_per_cycle} runs this cycle`;
  }
  return null;
}

function isRequested(job) {
  return !!job.run_requested_at
    && (!job.last_run_at || ms(job.run_requested_at) > ms(job.last_run_at));
}

function scheduleDue(job, now) {
  const since = new Date(ms(job.last_run_at) ?? ms(job.created_at) ?? now.getTime());
  return nextFire(job.cron, since).getTime() <= now.getTime();
}

function nextRunAt(job, now) {
  if (job.trigger !== 'schedule' || isBlank(job.cron)) return null;
  return nextFire(job.cron, now).toISOString();
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

function capacityOrder(a, b) {
  const p = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
  if (p !== 0) return p;
  return (ms(a.last_success_at) ?? 0) - (ms(b.last_success_at) ?? 0);
}

// Decide what runs this tick. Returns { run: [{job, reason}], waiting: [{name, reason}] }.
function planTick({ jobs, now, usage, cycleRuns }) {
  const requested = [];
  const scheduled = [];
  const capacity = [];
  const waiting = [];

  for (const job of jobs) {
    if (!job.enabled) { waiting.push({ name: job.name, reason: 'disabled' }); continue; }
    if (isRequested(job)) { requested.push({ job, reason: 'requested' }); continue; }
    if (job.trigger === 'schedule') {
      if (scheduleDue(job, now)) scheduled.push({ job, reason: 'schedule' });
      else waiting.push({ name: job.name, reason: `next run ${nextRunAt(job, now)}` });
      continue;
    }
    const gate = capacityGate(job, usage, now, cycleRuns[job.id] || 0);
    if (gate) waiting.push({ name: job.name, reason: gate });
    else capacity.push(job);
  }

  // One capacity job per tick, so usage is re-read before spending more.
  capacity.sort(capacityOrder);
  const [first, ...rest] = capacity;
  for (const job of rest) {
    waiting.push({ name: job.name, reason: `queued behind ${first.name} (one capacity job per tick)` });
  }

  return {
    run: [...requested, ...scheduled, ...(first ? [{ job: first, reason: 'capacity' }] : [])],
    waiting,
  };
}

function starvationThresholdMs(job, now) {
  if (job.starvation_hours) return job.starvation_hours * HOUR;
  if (job.trigger === 'schedule' && !isBlank(job.cron)) return 2 * maxGapMs(job.cron, now);
  return 2 * CYCLE_MS;
}

// A job is starved when it has not SUCCEEDED for longer than its threshold:
// two fire-gaps for a schedule job, two weekly cycles for a capacity job, or
// starvation_hours when set. Never-succeeded jobs count from created_at.
function starvation(job, now) {
  if (!job.enabled) return null;
  const since = ms(job.last_success_at) ?? ms(job.created_at);
  if (since === null) return null;
  const threshold = starvationThresholdMs(job, now);
  const elapsed = now.getTime() - since;
  if (elapsed <= threshold) return null;
  return {
    name: job.name,
    hours_since_success: Math.floor(elapsed / HOUR),
    threshold_hours: Math.round(threshold / HOUR),
    last_status: job.last_status || null,
  };
}

// Probing usage costs a network call (and, with an expired token, a tiny
// Claude call to refresh it), so skip it when the cached weekly reset shows
// we are outside every capacity job's window.
function needsUsage(jobs, cachedUsage, now) {
  const cap = jobs.filter((j) => j.enabled && j.trigger === 'capacity' && !isRequested(j));
  if (!cap.length) return false;
  if (!cachedUsage || !cachedUsage.weekly || !cachedUsage.weekly.resets_at) return true;
  const resetIn = ms(cachedUsage.weekly.resets_at) - now.getTime();
  if (resetIn <= 0) return true;
  const widest = Math.max(...cap.map((j) => j.window_hours || JOB_DEFAULTS.window_hours));
  return resetIn <= widest * HOUR;
}

// Split runs left in 'running' into ones to mark abandoned and ones genuinely live.
// Same host: dead if its pid is gone or it started before the last boot (a pid
// can be reused after a reboot). Other host: dead once past timeout + grace.
function classifyRunning(runs, { host, now, bootTime, isPidAlive, jobsById }) {
  const abandon = [];
  const live = [];
  for (const run of runs) {
    let dead;
    if (run.host === host) {
      dead = ms(run.started_at) < bootTime.getTime() || !isPidAlive(run.pid);
    } else {
      const job = jobsById[run.job_id];
      const timeout = ((job && job.timeout_minutes) || JOB_DEFAULTS.timeout_minutes) * 60e3;
      dead = now.getTime() - ms(run.started_at) > timeout + STALE_GRACE_MS;
    }
    (dead ? abandon : live).push(run);
  }
  return { abandon, live };
}

function errorMessage(err) {
  return (err && err.message) || String(err);
}

// Exit codes for a job's precheck command.
const PRECHECK_SKIP_CODE = 10;

// Run one job: precheck, then the job itself, then file away the transcript.
async function executeJob({ job, reason, storage, runJob, runPrecheck, removeFile, host, pid, usage }) {
  if (job.precheck) {
    const pre = await runPrecheck(job);
    if (pre.outcome === 'skip') {
      // Nothing to do is healthy: stamp the job, no run row, no LLM call.
      await storage.markJobSkipped(job);
      return { status: 'skipped' };
    }
    if (pre.outcome === 'error') {
      const run = await storage.startJobRun({ job, reason, host, pid, usage });
      const result = {
        status: 'failed',
        exit_code: pre.exit_code ?? null,
        output_tail: `precheck failed (exit ${pre.exit_code}):\n${pre.output_tail || ''}`,
      };
      await storage.finishJobRun(run, result);
      return { status: 'failed' };
    }
  }

  const run = await storage.startJobRun({ job, reason, host, pid, usage });
  let result;
  try {
    result = await runJob(job, { runId: run.id });
  } catch (err) {
    result = { status: 'failed', exit_code: null, output_tail: `runner error: ${errorMessage(err)}` };
  }
  if (result.transcript_file) {
    try {
      result.transcript_path = await storage.uploadRunTranscript(run, result.transcript_file);
    } catch (err) {
      result.transcript_path = null;
      result.output_tail = `${result.output_tail || ''}\n[brainy] transcript upload failed: ${errorMessage(err)}`;
    }
    removeFile(result.transcript_file);
    delete result.transcript_file;
  }
  return { run, result };
}

async function runTick({
  storage, probeUsage, runJob, runPrecheck, removeFile = () => {}, now = () => new Date(),
  host, pid, bootTime, isPidAlive, log = console.log,
}) {
  const jobs = await storage.listJobs();
  const jobsById = Object.fromEntries(jobs.map((j) => [j.id, j]));

  // 1. Recover from crashes / shutdowns, and refuse to overlap a live tick.
  const running = await storage.listRunningJobRuns();
  const { abandon, live } = classifyRunning(running, { host, now: now(), bootTime, isPidAlive, jobsById });
  for (const run of abandon) {
    await storage.abandonJobRun(run, `process ${run.pid} on ${run.host} is gone (crash or shutdown)`);
    log(`abandoned stale run ${run.id} (${run.host}:${run.pid})`);
  }
  if (live.some((r) => r.host === host && r.pid !== pid)) {
    return { skipped: 'another tick is already running on this host' };
  }

  // 2. Usage (only when a capacity job could plausibly be in its window).
  const state = (await storage.getSchedulerState()) || {};
  let usage = state.usage || null;
  let usageError = null;
  if (needsUsage(jobs, usage, now())) {
    try {
      usage = await probeUsage();
    } catch (err) {
      usageError = errorMessage(err);
      log(`usage probe failed: ${usageError}`);
    }
  }
  const cycleRuns = !usageError && usageIsFresh(usage, now())
    ? await storage.countCycleRuns(cycleStart(usage).toISOString())
    : {};

  // 3. Plan and run, sequentially.
  const plan = planTick({ jobs, now: now(), usage: usageError ? null : usage, cycleRuns });
  // Agent runs are measured: make sure there is a fresh "before" reading even
  // when no capacity check needed one (e.g. a requested or scheduled run).
  if (!usageError && plan.run.some((r) => r.job.kind === 'agent') && !usageIsFresh(usage, now())) {
    try {
      usage = await probeUsage();
    } catch (err) {
      usageError = errorMessage(err);
      log(`usage probe failed: ${usageError}`);
    }
  }

  const ran = [];
  for (const { job, reason } of plan.run) {
    const outcome = await executeJob({ job, reason, storage, runJob, runPrecheck, removeFile, host, pid, usage });
    if (!outcome.run) {
      ran.push({ name: job.name, reason, status: outcome.status });
      log(`${job.name} (${reason}): ${outcome.status}`);
      continue;
    }
    const { run, result } = outcome;
    if (job.kind === 'agent' && !usageError) {
      try {
        result.usage_after = await probeUsage();
        usage = result.usage_after;
      } catch (_) { /* cost tracking is best-effort */ }
    }
    await storage.finishJobRun(run, result);
    ran.push({ name: job.name, reason, status: result.status });
    log(`${job.name} (${reason}): ${result.status}`);
  }

  // 4. Persist what the web page shows (its health banner is the dead man's
  // switch: a stale last_tick_at means the scheduler itself is down).
  const t = now();
  for (const job of jobs) {
    if (job.trigger === 'schedule' && job.enabled) await storage.updateJobNextRun(job.name, nextRunAt(job, t));
  }
  const ranNames = new Set(ran.map((r) => r.name));
  const starved = jobs
    .filter((j) => !ranNames.has(j.name) || !['succeeded', 'skipped'].includes(ran.find((r) => r.name === j.name).status))
    .map((j) => starvation(j, t))
    .filter(Boolean);
  await storage.saveSchedulerState({
    last_tick_at: t.toISOString(),
    host,
    usage,
    usage_error: usageError,
    waiting: plan.waiting,
    starved,
  });


  return { ran, waiting: plan.waiting, starved, usage, usage_error: usageError };
}

module.exports = {
  PRECHECK_SKIP_CODE,
  JOB_DEFAULTS,
  KINDS,
  TRIGGERS,
  PERMISSION_MODES,
  validateJob,
  planTick,
  capacityGate,
  cycleStart,
  starvation,
  nextRunAt,
  needsUsage,
  classifyRunning,
  runTick,
};
