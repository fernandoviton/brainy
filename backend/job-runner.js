/**
 * Runs one scheduled job as a child process and reports how it went.
 *
 *   command jobs -> bash -lc "<command>"
 *   agent jobs   -> claude -p "<prompt>" --output-format stream-json [--model m]
 *                   --permission-mode p [--allowedTools ...] [--disallowedTools ...]
 *                   (the stream is kept as the run's transcript; its final
 *                   result is the run's report)
 *
 * The child gets its own process group so a timeout kills everything it
 * spawned, not just the shell. Output (stdout + stderr interleaved) is kept to
 * the last OUTPUT_TAIL_CHARS characters for the run record.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PRECHECK_SKIP_CODE } = require('./scheduler');

const REPO_ROOT = path.join(__dirname, '..');
const OUTPUT_TAIL_CHARS = 4000;
const KILL_GRACE_MS = 10e3;
const PRECHECK_TIMEOUT_MS = 2 * 60e3;

function buildCommand(job, { shell = 'bash', claudeBin = 'claude' } = {}) {
  if (job.kind === 'command') return { file: shell, args: ['-lc', job.command] };
  const args = ['-p', job.prompt, '--output-format', 'stream-json', '--verbose'];
  if (job.model) args.push('--model', job.model);
  // Always explicit: a user-level defaultMode must never widen what a job may do.
  args.push('--permission-mode', job.permission_mode || 'default');
  if (job.allowed_tools && job.allowed_tools.length) args.push('--allowedTools', ...job.allowed_tools);
  if (job.disallowed_tools && job.disallowed_tools.length) args.push('--disallowedTools', ...job.disallowed_tools);
  return { file: claudeBin, args };
}

function tail(text, max = OUTPUT_TAIL_CHARS) {
  return text.length <= max ? text : `…[truncated]\n${text.slice(-max)}`;
}

function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch (_) { /* already gone */ }
}

// Agent jobs: stdout is the stream-json transcript, written to a file line by
// line; the last `result` event carries the report. stderr goes to the tail.
function createTranscript(dir, name) {
  const file = path.join(dir, `brainy-${name}-${process.pid}-${Date.now()}.jsonl`);
  const out = fs.createWriteStream(file);
  let pending = '';
  let result = null;
  const parse = (line) => {
    if (!line.trim()) return;
    try {
      const ev = JSON.parse(line);
      if (ev && ev.type === 'result') result = ev;
    } catch (_) { /* non-JSON noise stays in the transcript only */ }
  };
  return {
    file,
    write(chunk) {
      out.write(chunk);
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(parse);
    },
    close() {
      parse(pending);
      return new Promise((resolve) => out.end(resolve));
    },
    result: () => result,
  };
}

function runJob(job, { runId, timeoutMs, shell, claudeBin, transcriptDir = os.tmpdir() } = {}) {
  const limit = timeoutMs ?? job.timeout_minutes * 60e3;
  const { file, args } = buildCommand(job, { shell, claudeBin });
  const transcript = job.kind === 'agent' ? createTranscript(transcriptDir, job.name) : null;
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!transcript) {
        resolve({ ...result, output_tail: tail(output) });
        return;
      }
      await transcript.close();
      const ev = transcript.result();
      let { status } = result;
      if (status === 'succeeded' && (!ev || ev.is_error)) status = 'failed';
      if (!ev && status !== 'timed_out') output += '\n[brainy] claude produced no result event\n';
      resolve({
        ...result,
        status,
        output_tail: tail(output),
        report: ev && typeof ev.result === 'string' ? ev.result : null,
        permission_denials: ev && ev.permission_denials && ev.permission_denials.length ? ev.permission_denials : null,
        transcript_file: transcript.file,
      });
    };

    const env = { ...process.env, BRAINY_JOB_NAME: job.name };
    if (runId) env.BRAINY_RUN_ID = runId;
    const child = spawn(file, args, {
      cwd: job.workdir || REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const collect = (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > OUTPUT_TAIL_CHARS * 4) output = output.slice(-OUTPUT_TAIL_CHARS * 2);
    };
    child.stdout.on('data', transcript ? (c) => transcript.write(c) : collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      output += `\n[brainy] timed out after ${Math.round(limit / 1000)}s — killing\n`;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref();
    }, limit);

    child.on('error', (err) => {
      output += `[brainy] failed to start ${file}: ${err.message}\n`;
      finish({ status: 'failed', exit_code: null });
    });
    child.on('close', (code) => {
      if (timedOut) finish({ status: 'timed_out', exit_code: code });
      else finish({ status: code === 0 ? 'succeeded' : 'failed', exit_code: code });
    });
  });
}

// A job's precheck is a cheap shell command run before the job: exit 0 = go,
// exit PRECHECK_SKIP_CODE (10) = nothing to do, anything else = broken.
async function runPrecheck(job, { timeoutMs = PRECHECK_TIMEOUT_MS, shell } = {}) {
  const r = await runJob({ ...job, kind: 'command', command: job.precheck }, { timeoutMs, shell });
  if (r.exit_code === 0) return { outcome: 'run' };
  if (r.exit_code === PRECHECK_SKIP_CODE) return { outcome: 'skip' };
  return { outcome: 'error', exit_code: r.exit_code, output_tail: r.output_tail };
}

module.exports = { runJob, runPrecheck, buildCommand, tail, OUTPUT_TAIL_CHARS };
