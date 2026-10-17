/**
 * Argument mapping and text formatting for the `job` / `scheduler` CLI
 * commands. Kept out of cli.js so it can stay a router.
 */
const { starvation } = require('./scheduler');

// CLI flag (camelCase, as parseArgs yields it) -> column, and how to parse it.
const JOB_FIELD_FLAGS = {
  description: { column: 'description', type: 'text', clearable: true },
  kind: { column: 'kind', type: 'text' },
  command: { column: 'command', type: 'text' },
  prompt: { column: 'prompt', type: 'text' },
  trigger: { column: 'trigger', type: 'text' },
  cron: { column: 'cron', type: 'text', clearable: true },
  priority: { column: 'priority', type: 'text' },
  workdir: { column: 'workdir', type: 'text', clearable: true },
  model: { column: 'model', type: 'text', clearable: true },
  permissionMode: { column: 'permission_mode', type: 'text', clearable: true },
  timeoutMinutes: { column: 'timeout_minutes', type: 'int' },
  windowHours: { column: 'window_hours', type: 'int' },
  maxWeeklyPct: { column: 'max_weekly_pct', type: 'int' },
  maxSessionPct: { column: 'max_session_pct', type: 'int' },
  runsPerCycle: { column: 'runs_per_cycle', type: 'int' },
  starvationHours: { column: 'starvation_hours', type: 'int', clearable: true },
};

const FLAG_NAMES = Object.keys(JOB_FIELD_FLAGS);

function kebab(key) {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

// Map parsed CLI args to job columns. Throws on a non-integer numeric flag.
// `--enable` / `--disable` set `enabled`.
function jobFieldsFromArgs(args) {
  const fields = {};
  for (const [flag, spec] of Object.entries(JOB_FIELD_FLAGS)) {
    const v = args[flag];
    if (v === undefined) continue;
    if (v === '' && spec.clearable) { fields[spec.column] = null; continue; }
    if (spec.type === 'int') {
      if (!/^\d+$/.test(String(v))) throw new Error(`${kebab(flag)} must be a whole number (got "${v}")`);
      fields[spec.column] = Number(v);
    } else {
      fields[spec.column] = v;
    }
  }
  if (args.enable) fields.enabled = true;
  if (args.disable) fields.enabled = false;
  return fields;
}

function fmtTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeTrigger(job) {
  if (job.trigger === 'schedule') return `schedule "${job.cron}"`;
  return `capacity (last ${job.window_hours}h of week, weekly <${job.max_weekly_pct}%, session <${job.max_session_pct}%, ${job.runs_per_cycle}/cycle)`;
}

function formatJobLine(job, now = new Date(), waitingReason) {
  const flags = [];
  if (!job.enabled) flags.push('DISABLED');
  const starved = starvation(job, now);
  if (starved) flags.push(`STARVED ${starved.hours_since_success}h`);
  const last = job.last_status ? `${job.last_status} ${fmtTime(job.last_run_at)}` : 'never run';
  const next = waitingReason
    || (job.trigger === 'schedule' && job.next_run_at ? `next ${fmtTime(job.next_run_at)}` : '');
  return `- **${job.name}** [${job.kind}] ${describeTrigger(job)} ${job.priority || ''}`
    + `${flags.length ? ` ${flags.join(' ')}` : ''}\n    last: ${last}${next ? ` · ${next}` : ''}`;
}

function formatJobDetail(job, now = new Date()) {
  const lines = [
    `# ${job.name}${job.enabled ? '' : ' (disabled)'}`,
    job.description ? job.description : null,
    `Kind: ${job.kind} | Trigger: ${describeTrigger(job)} | Priority: ${job.priority}`,
    `Timeout: ${job.timeout_minutes}m${job.workdir ? ` | Workdir: ${job.workdir}` : ''}`
      + `${job.model ? ` | Model: ${job.model}` : ''}${job.permission_mode ? ` | Permission mode: ${job.permission_mode}` : ''}`,
    `Last run: ${fmtTime(job.last_run_at)} (${job.last_status || 'n/a'}) | Last success: ${fmtTime(job.last_success_at)}`,
    job.trigger === 'schedule' ? `Next run: ${fmtTime(job.next_run_at)}` : null,
    job.run_requested_at && (!job.last_run_at || job.run_requested_at > job.last_run_at)
      ? `Run requested: ${fmtTime(job.run_requested_at)} (runs on the next tick)` : null,
  ];
  const starved = starvation(job, now);
  if (starved) lines.push(`STARVED: ${starved.hours_since_success}h since last success (limit ${starved.threshold_hours}h)`);
  lines.push('', job.kind === 'command' ? `$ ${job.command}` : job.prompt);
  return lines.filter((l) => l !== null).join('\n');
}

function formatRun(run) {
  const dur = run.finished_at
    ? ` ${Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000)}s`
    : '';
  return `- ${fmtTime(run.started_at)} ${run.job_name} [${run.reason}] ${run.status}${dur}`
    + `${run.exit_code !== null && run.exit_code !== undefined ? ` exit=${run.exit_code}` : ''} (${run.host || '?'})`;
}

function formatUsage(usage) {
  if (!usage || !usage.weekly) return 'Usage: unknown';
  return `Usage: session ${usage.session.percent}% (resets ${fmtTime(usage.session.resets_at)}) · `
    + `weekly ${usage.weekly.percent}% (resets ${fmtTime(usage.weekly.resets_at)}) · read ${fmtTime(usage.fetched_at)}`;
}

module.exports = {
  JOB_FIELD_FLAGS,
  FLAG_NAMES,
  jobFieldsFromArgs,
  fmtTime,
  describeTrigger,
  formatJobLine,
  formatJobDetail,
  formatRun,
  formatUsage,
};
