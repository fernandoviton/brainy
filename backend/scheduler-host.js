/**
 * Host wiring for the scheduler: the real clock, process table, usage probe,
 * job runner and heartbeat that backend/scheduler.js takes as dependencies,
 * plus `startNow()` to kick the systemd unit immediately.
 */
const os = require('os');
const { spawnSync } = require('child_process');
const { runTick, planTick, starvation, cycleStart } = require('./scheduler');
const { createUsageProbe } = require('./claude-usage');
const { runJob, createHeartbeat } = require('./job-runner');

const UNIT = 'brainy-scheduler';

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, owned by someone else
  }
}

function bootTime() {
  return new Date(Date.now() - os.uptime() * 1000);
}

async function tick(storage, env = process.env) {
  const heartbeat = createHeartbeat(env.SCHEDULER_HEARTBEAT_URL);
  try {
    return await runTick({
      storage,
      probeUsage: createUsageProbe(),
      runJob,
      heartbeat,
      host: os.hostname(),
      pid: process.pid,
      bootTime: bootTime(),
      isPidAlive,
    });
  } catch (err) {
    await heartbeat({ ok: false, message: `tick crashed: ${err.message}` });
    throw err;
  }
}

// Read-only view of what the scheduler would do right now and why.
async function status(storage, { probeUsage = createUsageProbe(), now = new Date() } = {}) {
  const [jobs, state] = await Promise.all([storage.listJobs(), storage.getSchedulerState()]);
  let usage = (state && state.usage) || null;
  let usageError = null;
  if (jobs.some((j) => j.enabled && j.trigger === 'capacity')) {
    try {
      usage = await probeUsage();
    } catch (err) {
      usageError = err.message;
    }
  }
  const cycleRuns = usage && !usageError ? await storage.countCycleRuns(cycleStart(usage).toISOString()) : {};
  const plan = planTick({ jobs, now, usage: usageError ? null : usage, cycleRuns });
  return {
    now: now.toISOString(),
    last_tick_at: (state && state.last_tick_at) || null,
    host: (state && state.host) || null,
    usage,
    usage_error: usageError,
    jobs,
    would_run: plan.run.map(({ job, reason }) => ({ name: job.name, reason })),
    waiting: plan.waiting,
    starved: jobs.map((j) => starvation(j, now)).filter(Boolean),
  };
}

// Start a tick now instead of waiting for the timer. --no-block returns
// immediately; if a tick is already running systemd leaves it be, and that
// tick (or the next) picks up the request.
function startNow({ spawn = spawnSync, platform = process.platform } = {}) {
  if (platform !== 'linux') {
    return { started: false, reason: 'not the scheduler host (systemd timer runs on Linux)' };
  }
  const r = spawn('systemctl', ['--user', 'start', '--no-block', `${UNIT}.service`], { encoding: 'utf8' });
  if (r.error) return { started: false, reason: r.error.message };
  if (r.status !== 0) return { started: false, reason: (r.stderr || '').trim() || `systemctl exited ${r.status}` };
  return { started: true };
}

module.exports = { UNIT, isPidAlive, bootTime, tick, status, startNow };
