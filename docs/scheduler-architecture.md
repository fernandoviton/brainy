# Scheduler architecture

Brainy can run **scheduled jobs** on an always-on host: deterministic scripts (backups,
cleanups) and **agent jobs** (headless `claude -p` runs, e.g. triaging captures or
researching parked TODOs). Some jobs run on a fixed schedule; others only run on
**spare Claude subscription capacity**, near the end of the weekly usage cycle,
when the capacity would otherwise go unused.

Job definitions and run history live in Supabase, next to the rest of the store. You
manage them with the CLI (`node backend/cli.js job ...`), and the web UI shows them
read-only at `browse/jobs/`.

## Components

```
            systemd user timer (every 15 min, Persistent=true)
                               │
                               ▼
              node backend/cli.js scheduler tick          ◀── `job run ... --now`
                               │                              (systemctl start)
   ┌───────────────────────────┼─────────────────────────────┐
   │ backend/scheduler-host.js │ real clock, pids, hostname  │
   │ backend/scheduler.js      │ decide what runs (pure)     │
   │ backend/claude-usage.js   │ read plan usage             │
   │ backend/job-runner.js     │ precheck, spawn, transcript │
   └───────────────────────────┼─────────────────────────────┘
                               │ storage-supabase.js
                               ▼
    brainy_scheduled_jobs · brainy_job_runs · brainy_scheduler_state
                               ▲
                               │ (read-only)
                     frontend/browse/jobs/
```

**Only one host runs the timer.** Jobs are global to your account, so installing the timer on
two machines would run each job twice. Other machines (a laptop, Windows) can still
create, edit and request jobs through the CLI. The scheduler host picks the changes up on its
next tick.

## Jobs

| Field | Meaning |
|---|---|
| `kind` | `command`: runs a shell command via `bash -lc`. `agent`: runs `claude -p "<prompt>"`, with optional `model` and `permission_mode`. |
| `trigger` | `schedule`: runs at every cron fire. `capacity`: runs only on spare capacity (see below). |
| `cron` | A 5-field cron expression in the host's local time. Required for `schedule` jobs. |
| `workdir` | The working directory. Defaults to the Brainy checkout, so agent jobs get Brainy's `CLAUDE.md` and CLI. |
| `timeout_minutes` | When this runs out, the job's whole process group is killed. The run is marked `timed_out`. |
| `priority` | Decides which capacity job goes first when several are eligible. |
| `window_hours`, `max_weekly_pct`, `max_session_pct`, `runs_per_cycle` | The capacity gates. |
| `starvation_hours` | Optional. Overrides the starvation threshold. |
| `last_run_at`, `last_status`, `last_success_at`, `next_run_at` | Bookkeeping written by the tick. |
| `run_requested_at` | Set by `job run`. Makes the job run on the next tick. |

### Triggers

- **schedule**: due when the cron expression has fired since the job's `last_run_at`, or
  since `created_at` if it has never run. Missed fires collapse into **one** catch-up run, for
  example after the host was off for three days.
- **capacity**: eligible only when **all** of these hold:
  1. Usage was read within the last 30 minutes. If usage is unknown, the job does not run.
  2. The weekly usage reset is at most `window_hours` away (default 24h). In other words,
     we're at the end of the cycle, and unused capacity is about to be lost.
  3. Weekly usage is below `max_weekly_pct` (default 80%).
  4. 5-hour session usage is below `max_session_pct` (default 50%). A busy session window
     usually means you're working, and the job shouldn't eat the capacity you're using.
  5. The job has run fewer than `runs_per_cycle` times this cycle (default 1). Capacity runs and
     requested runs both count. Abandoned runs don't.

  **At most one capacity job runs per tick**, so usage is re-read before spending more.
  Ties go to the higher `priority`, then to the job with the oldest last success.
- **requested**: `job run` sets `run_requested_at`. On the next tick the job runs once,
  **bypassing its cron and every capacity gate**. This is the "I'm OK with it running now" path.
  The request is satisfied once a run starts after it. Disabled jobs never run.

Each tick runs jobs one at a time: requested first, then scheduled, then (at most) one
capacity job.

### Asking for runs from chat

The assistant maps plain requests to `job run`:

| You say | Command |
|---|---|
| "run the end-of-week jobs now" / "spend the leftover capacity" | `job run --trigger capacity --now` |
| "run the backup now" | `job run <name> --now` |
| "run everything" | `job run --all --now` |

`--now` also starts a tick right away (`systemctl --user start --no-block brainy-scheduler.service`).
Without `--now`, or from a machine that isn't the scheduler host, the request waits for the next
timer tick (15 minutes at most).

### Prechecks: skipping the LLM when there's nothing to do

A job can have a `precheck`: a cheap shell command that runs before the job.

| Precheck exit | Meaning | What happens |
|---|---|---|
| `0` | there's work | the job runs |
| `10` | nothing to do | **skipped**: no run row, no LLM call; the job is stamped `last_status = skipped` and counts as a success for starvation |
| anything else | the precheck is broken (e.g. auth expired) | recorded as a **failed** run, so it can't silently look healthy forever |

For example, hourly capture processing uses `node backend/cli.js capture pending` as its precheck,
which exits 10 when there are no unprocessed captures. Most hours it costs one Supabase query and no
model call.

### Tool allowlists for agent jobs

What an agent job may do is enforced by Claude Code's permission system, not by its prompt:

- `permission_mode` is always passed explicitly (default: `default`). A user-level setting can
  never widen what a job may do.
- `allowed_tools` (`--allowedTools`): tools the job may use without approval, including patterns
  like `Bash(node backend/cli.js todo create:*)`. In `default` mode, any other tool that needs
  approval is **denied**, because nobody is there to approve it.
- `disallowed_tools` (`--disallowedTools`): tools removed outright. Use it for anything dangerous
  that is always available, e.g. every Gmail tool except read and label.

Calls that were denied are recorded on the run (`permission_denials`) and shown on the Activity page.
A job that keeps hitting denials needs either a wider allowlist or a narrower prompt.

## Observability

Agent jobs are only worth keeping if you can judge their results. Each agent run records:

| What | Where | Written by |
|---|---|---|
| **Report**: the agent's final message (markdown) | `brainy_job_runs.report` | the agent |
| **Audited actions**: every Brainy write the CLI made during the run (TODO create/update/archive, knowledge upsert, capture process, ...) | `brainy_run_events` | **the CLI**, not the agent: the job runner sets `BRAINY_RUN_ID`, and the CLI logs each write under it |
| **Agent-reported actions** the CLI can't see (e.g. Gmail labels) | `brainy_run_events`, via `job log-event` | the agent |
| **Transcript**: the full `stream-json` session | `brainy_files/<user>/job-runs/<run id>.jsonl` | the job runner |
| **Cost**: plan usage before and after | `usage_before` / `usage_after` | the tick |
| **Blocked tool calls** | `permission_denials` | Claude Code |

Because the CLI writes the audited actions, a report can be checked against what actually happened.

You see this in two places:

- **The Activity page** (`browse/activity/`): reports, newest first. Each one shows its audited
  actions (linked to the TODOs, knowledge and captures it touched), its cost, blocked calls, and a
  transcript link. Reports newer than your last visit are marked new, and the **Activity** nav link
  shows the unread count.
- **The session-start digest**: a SessionStart hook (`.claude/hooks/agent_digest.js`) summarizes
  the reports since your last session on that machine, e.g. "email-triage: 1 run, created 2 TODOs
  (...)". It's shown to you and given to the assistant, which can follow up. It does nothing inside
  an agent job's own session.

Feedback on reports goes through chat. The assistant records it in the job's TODO, and that history
is what a promotion or demotion decision rests on.

### Coding work: `[agent-ready]` briefs

Agents that find coding work, such as capture processing or the proactive review, don't attempt
it. They create a TODO whose summary starts with `[agent-ready]` and whose notes contain an
`## Agent brief`: repo, goal, context, acceptance criteria, and open questions. When you say
"start the ready coding work", the assistant launches one coding session per brief in its own git
worktree. You review the brief before any code is written, and the brief format stays the same if
this is automated later.

## Plan usage

`backend/claude-usage.js` reads the same numbers Claude Code's `/usage` shows. It calls
`GET https://api.anthropic.com/api/oauth/usage` with the OAuth access token Claude Code keeps in
`~/.claude/.credentials.json`. It uses the `five_hour` and `seven_day` windows, each with a
utilization percentage and a `resets_at` time. The weekly cycle starts 7 days before the weekly
`resets_at`.

Caveats:

- **The endpoint is undocumented** and could change. The response is validated strictly, and any
  failure means usage is unknown, which means capacity jobs wait. A change can stop capacity jobs
  from running, but can never make them run blind. `scheduler status` and the web page show the
  error.
- **The scheduler never refreshes the OAuth token itself.** Refresh tokens rotate, and racing
  Claude Code for one could sign the machine out. When the access token has expired, the probe
  runs a trivial `claude -p` (on the cheapest model) so that Claude Code refreshes the token, then
  reads it again.
- **Probes are skipped when they can't matter.** The weekly reset time from the last probe is
  cached in `brainy_scheduler_state`. If the reset is further away than every capacity job's
  window, the tick doesn't call the endpoint.
- After an agent job finishes, the tick reads usage again and stores it as `usage_after` next to
  `usage_before`, so you can see what each run cost.

## Starvation

Every job has a `last_success_at`. A job is **starved** when it hasn't *succeeded* for longer than
its threshold:

- **schedule jobs**: twice the longest gap between cron fires. That's 48h for a daily job, and
  6 days for a weekday-only job, because of the 72h weekend gap.
- **capacity jobs**: two weekly cycles (14 days). One skipped cycle is normal if you used your
  capacity yourself; two in a row is worth a look.
- `starvation_hours`, when it's set.

Jobs that have never succeeded count from `created_at`. Disabled jobs are never starved.
Starvation shows up in `job list`, `scheduler status`, the tick's output, the web page, and
the site-wide health banner (below).

## Dead man's switch (in the web UI)

A scheduler can't report that it has stopped running. A **dead man's switch** is the opposite of an
alarm: it raises a warning when an expected sign of life *stops* arriving. Here, the sign of life is
`brainy_scheduler_state.last_tick_at`, which every tick updates.

`frontend/health.js` runs on **every page** of the web UI once you're signed in. It shows a banner,
and a count on the **Jobs** nav link, when:

- jobs exist but the scheduler has **never ticked**, or **hasn't ticked for over an hour** (the
  host is off, the timer is disabled, the network is down, or auth has expired)
- any job is **starved**
- any enabled job's **last run failed** or timed out

It uses no external service. The limitation: a web page can't push anything, so you only see it
when you open Brainy. The session-start digest (below) covers chat sessions.

## Concurrency, crashes and shutdowns

**No lock file.** systemd guarantees that a `Type=oneshot` service has only one instance: if the
timer fires while a tick is still running (say, a long agent job), that trigger is skipped. Manual
starts also go through `systemctl --user start`, so they're covered too. With no lock, there's
nothing to unlock and no stale lock left behind after a crash.

Each run row records the `host` and `pid` of the tick that started it. A tick starts by checking
for runs still marked `running`:

| Situation | Detected by | Result |
|---|---|---|
| Tick crashed or was killed mid-run | same host, pid no longer alive | run marked `abandoned` |
| Host shut down or rebooted mid-run | same host, run started before the last boot (also catches a reused pid) | run marked `abandoned` |
| Someone ran `scheduler tick` by hand while the timer's tick was live | same host, pid alive | the new tick exits without doing anything |
| Run from a different host | older than its timeout + 15 min | run marked `abandoned` |

An abandoned run leaves `last_run_at` unchanged, so the job counts as not run yet and **retries on
the next tick**. A run that *failed* does update `last_run_at`. Scheduled jobs wait for their next
fire rather than retrying every 15 minutes. A job that keeps failing ends up starved, and the
health banner flags it.

On shutdown, systemd stops the whole service cgroup, including the job. `Persistent=true` on the
timer runs a missed tick shortly after boot, and that tick abandons the interrupted run and retries
it.

Ticks run jobs one after another, so a long job delays the others. `timeout_minutes` (default 30)
limits how long, and the service's `TimeoutStartSec=6h` stops a wedged tick.

## Supabase load (free tier)

A tick makes a handful of small requests: an auth refresh, list jobs, list running runs, read the
state row, update `next_run_at` for each schedule job, and save the state row. Each job that runs
adds two more. At 96 ticks a day that's roughly 600 to 1,000 requests and a few MB of transfer a
day. That's far below the free tier's egress and database limits, and API request counts aren't
metered on the free tier. One side effect: the steady activity also keeps a free project from being
paused for inactivity.

Run rows keep only the last 4,000 characters of output, so the run history grows by at most a few
MB a year at typical volumes. Job definitions are included in `backup`, under `jobs/<name>.json`,
without the per-run bookkeeping fields, so they don't create a diff on every backup. Run history
isn't backed up.

## Security notes

- Agent jobs run unattended. Give each one the narrowest `allowed_tools` that does the job, and put
  every tool that could reach outside Brainy (sending mail, deleting, publishing) in
  `disallowed_tools`. Avoid `bypassPermissions` for jobs that read untrusted input such as email,
  because the content of an email could steer the agent.
- Prompts, commands and output tails are stored in Supabase (protected by RLS, readable only by
  you) and shown on the web page. Keep secrets out of them; read secrets from the host's
  environment or files instead.
- Commands run as the scheduler host's user, with that user's credentials.

## Setup (scheduler host, Linux)

1. Create the tables: run `sql/setup.sql` in the Supabase SQL editor. It's idempotent.
2. Sign the host in, both to Brainy (`node scripts/google-login.js`) and to Claude Code
   (`claude`), so usage can be read and agent jobs can run.
3. Make user units run with nobody logged in: `loginctl enable-linger $USER` (may need an
   admin).
4. Install the timer: `node scripts/install-scheduler.js`. `--dry-run` prints the units without
   installing them; `--uninstall` removes them.
6. Create jobs, for example:

   ```bash
   node backend/cli.js job create --name nightly-backup --kind command \
     --command "node backend/cli.js backup --force" --trigger schedule --cron "0 3 * * *"

   node backend/cli.js job create --name weekly-capture-triage --kind agent --trigger capacity \
     --file tmp/triage-prompt.md --priority P1 --permission-mode bypassPermissions
   ```

## Operating

```bash
node backend/cli.js scheduler status      # usage, what would run now, why the rest wait, starvation
node backend/cli.js job list              # all jobs, last/next run, STARVED flags
node backend/cli.js job runs [<name>]     # recent runs
node backend/cli.js job run <name> --now  # run on demand
journalctl --user -u brainy-scheduler     # tick logs
systemctl --user list-timers brainy-scheduler.timer
```
