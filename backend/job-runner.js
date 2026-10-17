/**
 * Runs one scheduled job as a child process and reports how it went.
 *
 *   command jobs -> bash -lc "<command>"
 *   agent jobs   -> claude -p "<prompt>" [--model m] [--permission-mode p]
 *
 * The child gets its own process group so a timeout kills everything it
 * spawned, not just the shell. Output (stdout + stderr interleaved) is kept to
 * the last OUTPUT_TAIL_CHARS characters for the run record.
 */
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const OUTPUT_TAIL_CHARS = 4000;
const KILL_GRACE_MS = 10e3;

function buildCommand(job, { shell = 'bash', claudeBin = 'claude' } = {}) {
  if (job.kind === 'command') return { file: shell, args: ['-lc', job.command] };
  const args = ['-p', job.prompt, '--output-format', 'text'];
  if (job.model) args.push('--model', job.model);
  if (job.permission_mode) args.push('--permission-mode', job.permission_mode);
  return { file: claudeBin, args };
}

function tail(text, max = OUTPUT_TAIL_CHARS) {
  return text.length <= max ? text : `…[truncated]\n${text.slice(-max)}`;
}

function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch (_) { /* already gone */ }
}

function runJob(job, { timeoutMs, shell, claudeBin } = {}) {
  const limit = timeoutMs ?? job.timeout_minutes * 60e3;
  const { file, args } = buildCommand(job, { shell, claudeBin });
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, output_tail: tail(output) });
    };

    const child = spawn(file, args, {
      cwd: job.workdir || REPO_ROOT,
      env: { ...process.env, BRAINY_JOB_NAME: job.name },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const collect = (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > OUTPUT_TAIL_CHARS * 4) output = output.slice(-OUTPUT_TAIL_CHARS * 2);
    };
    child.stdout.on('data', collect);
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

// Dead man's switch ping (healthchecks.io-style): <url> on success,
// <url>/fail on failure, with a short message as the body. Unset URL = off.
function createHeartbeat(url, fetchImpl = globalThis.fetch, log = console.error) {
  return async function heartbeat({ ok, message }) {
    if (!url) return;
    try {
      await fetchImpl(ok ? url : `${url.replace(/\/$/, '')}/fail`, {
        method: 'POST',
        body: message,
        signal: AbortSignal.timeout(10e3),
      });
    } catch (err) {
      log(`heartbeat ping failed: ${err.message}`);
    }
  };
}

module.exports = { runJob, buildCommand, tail, createHeartbeat, OUTPUT_TAIL_CHARS };
