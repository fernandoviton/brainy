# Brainy Database Schema

All tables are prefixed with `brainy_` for safe co-existence in a shared Supabase project.
Every table has RLS enabled — users can only access their own rows (`auth.uid() = user_id`).

## Entity Relationship Diagram

```
 ┌─────────────────────────┐
 │       auth.users         │  (Supabase built-in)
 │─────────────────────────│
 │  id  uuid  PK           │
 └────────┬────┬───────────┘
          │    │
          │    │  user_id FK (on all tables)
          │    │
  ┌───────┘    └──────────────────┐
  │                               │
  ▼                               ▼
┌──────────────────────────┐  ┌───────────────────────┐
│      brainy_todos        │  │    brainy_knowledge   │
│──────────────────────────│  │───────────────────────│
│ *id         uuid PK      │  │ *id        uuid PK    │
│  user_id    uuid FK NN   │  │  user_id   uuid FK NN │
│  name       text NN      │  │  path      text NN    │
│  summary    text         │  │  topic     text       │
│  status     text NN      │  │  summary   text       │
│    {inbox,active,        │  │  content   text       │
│     later,scheduled}     │  │  created_at tstz      │
│  priority   text         │  │  updated_at tstz      │
│    {P0,P1,P2,P3}         │  │                       │
│  category   text         │  │  UQ(user_id, path)    │
│  created_date date       │  └───────────┬───────────┘
│  due          date       │              │
│  scheduled_date date     │              │
│  blocked_by text[]       │              │ knowledge_id FK
│  notes      text         │              │ (cascade delete)
│  created_at timestamptz  │  ┌────────────────────────────────┐
│  updated_at timestamptz  │  │  brainy_knowledge_attachments  │
│                          │  │────────────────────────────────│
│  UQ(user_id, name)       │  │ *id            uuid PK         │
└────────────┬─────────────┘  │  user_id       uuid FK NN      │
             │                │  knowledge_id  uuid FK NN      │
             │ todo_id FK     │  path          text NN         │
             │ (cascade del)  │  filename      text NN         │
             ▼                │  storage_path  text NN ──────┐ │
┌──────────────────────────┐  │  created_at    timestamptz   │ │
│  brainy_todo_collateral  │  │                              │ │
│──────────────────────────│  │  IDX(knowledge_id)           │ │
│ *id           uuid PK    │  └──────────────────────────────│─┘                                 │
│  user_id      uuid FK NN │                                 │
│  todo_id      uuid FK NN │         ┌──────────────────┐    │
│  filename     text NN    │         │   brainy_files    │    │
│  content_type text       │         │   (storage bucket)│    │
│  text_content text       │         │──────────────────│    │
│  storage_path text ───────────────▶│  Private bucket   │◀───┘
│  created_at   timestamptz│         │  RLS: uid folder  │
│  updated_at   timestamptz│         └──────────────────┘
│                          │
│  UQ(todo_id, filename)   │
│  CHK: text OR storage    │
└──────────────────────────┘


┌──────────────────────────┐  ┌───────────────────────────────┐
│    brainy_captures       │  │    brainy_capture_media        │
│──────────────────────────│  │───────────────────────────────│
│ *id         uuid PK      │  │ *id           uuid PK          │
│  user_id    uuid FK NN   │  │  user_id      uuid FK NN       │
│  text       text         │  │  capture_id   uuid FK NN       │
│  processed_at tstz       │  │  filename     text NN          │
│  created_at  tstz        │  │  content_type text             │
│                          │  │  storage_path text NN ──────┐  │
│  IDX(user_id,            │  │  created_at   tstz          │  │
│      processed_at)       │  │                             │  │
└────────────┬─────────────┘  │  IDX(capture_id)            │  │
             │ capture_id FK  └─────────────────────────────│──┘
             │ (cascade del)                                │
             └────────────────────────────────────────┐     │
                                                      ▼     │
                                                brainy_files │
                                                  (bucket)◀──┘


┌──────────────────────────┐  ┌───────────────────────────────┐
│  brainy_archive_entries  │  │  brainy_archive_summaries     │
│──────────────────────────│  │───────────────────────────────│
│ *id           uuid PK    │  │ *id          uuid PK          │
│  user_id      uuid FK NN │  │  user_id     uuid FK NN       │
│  todo_name    text NN    │  │  year_month  text NN          │
│  completion_date date    │  │  content     text             │
│  year_month   text NN    │  │  created_at  timestamptz      │
│  summary_text text       │  │  updated_at  timestamptz      │
│  todo_snapshot    jsonb  │  │                               │
│  collateral_snapshot jsonb│  └───────────────────────────────┘
│  created_at   timestamptz│
│                          │
│  IDX(user_id, year_month)│
└──────────────────────────┘
```

### Scheduler tables

Design: `docs/scheduler-architecture.md`.

**`brainy_scheduled_jobs`**: one row per job. `UQ(user_id, name)`.
- Definition: `id` PK, `user_id`, `name`, `description`, `enabled`, `kind` {command, agent}, `command` / `prompt` (CHK: the one matching `kind` is required), `workdir`, `model`, `permission_mode`, `timeout_minutes`, `priority` {P0..P3}, `starvation_hours`
- Trigger: `trigger` {schedule, capacity}, `cron` (CHK: required for schedule), and the capacity gates `window_hours`, `max_weekly_pct`, `max_session_pct`, `runs_per_cycle`
- Agent controls: `precheck` (exit 10 = skip), `allowed_tools`, `disallowed_tools` (text[])
- Bookkeeping (written by the tick): `run_requested_at`, `last_run_at`, `last_finished_at`, `last_status`, `last_success_at`, `next_run_at`

**`brainy_job_runs`**: one row per run. `job_id` FK → `brainy_scheduled_jobs` (cascade).
- `job_name`, `reason` {schedule, capacity, requested}, `status` {running, succeeded, failed, timed_out, abandoned}
- `started_at`, `finished_at`, `exit_code`, `output_tail` (last 4,000 chars), `host`, `pid`, `usage_before` / `usage_after` (jsonb)
- Agent runs: `report` (the final message, in full), `transcript_path` (stream-json in `brainy_files`), `permission_denials` (jsonb)

**`brainy_run_events`**: the audit trail. `run_id` FK → `brainy_job_runs` (cascade).
- `job_name`, `action` (e.g. `create`, `update`, `label ai-done`), `target_type` (`todo`, `knowledge`, `capture`, `email`), `target`, `detail`
- Written by the CLI for every write made while `BRAINY_RUN_ID` is set, and by `job log-event` for actions the CLI can't see

**`brainy_scheduler_state`**: one row per user (`user_id` PK), overwritten every tick.
- `last_tick_at`, `host`, `usage` (jsonb, the latest plan usage reading), `usage_error`, `waiting` (jsonb: why each job is waiting), `starved` (jsonb)

## Relationships Summary

| Parent                  | Child                            | FK Column      | On Delete |
|-------------------------|----------------------------------|----------------|-----------|
| `auth.users`            | `brainy_todos`                   | `user_id`      | —         |
| `auth.users`            | `brainy_todo_collateral`         | `user_id`      | —         |
| `auth.users`            | `brainy_knowledge`               | `user_id`      | —         |
| `auth.users`            | `brainy_knowledge_attachments`   | `user_id`      | —         |
| `auth.users`            | `brainy_archive_entries`         | `user_id`      | —         |
| `auth.users`            | `brainy_archive_summaries`       | `user_id`      | —         |
| `brainy_todos`          | `brainy_todo_collateral`         | `todo_id`      | CASCADE   |
| `brainy_knowledge`      | `brainy_knowledge_attachments`   | `knowledge_id` | CASCADE   |
| `auth.users`            | `brainy_captures`                | `user_id`      | —         |
| `auth.users`            | `brainy_capture_media`           | `user_id`      | —         |
| `brainy_captures`       | `brainy_capture_media`           | `capture_id`   | CASCADE   |
| `auth.users`            | `brainy_scheduled_jobs`          | `user_id`      | —         |
| `auth.users`            | `brainy_job_runs`                | `user_id`      | —         |
| `auth.users`            | `brainy_scheduler_state`         | `user_id` (PK) | —         |
| `brainy_scheduled_jobs` | `brainy_job_runs`                | `job_id`       | CASCADE   |
| `brainy_job_runs`       | `brainy_run_events`              | `run_id`       | CASCADE   |

*Note: `brainy_goals` was intentionally removed — goals are not tracked in the database.*

## Indexes

| Table            | Index                                | Columns / Filter                           |
|------------------|--------------------------------------|--------------------------------------------|
| `brainy_todos`   | `idx_brainy_todos_user_status`       | `(user_id, status)`                        |
| `brainy_todos`   | `idx_brainy_todos_user_name`         | `(user_id, name)`                          |
| `brainy_todos`   | `idx_brainy_todos_scheduled`         | `(scheduled_date)` WHERE status='scheduled'|
| `brainy_knowledge` | `idx_brainy_knowledge_user_path`   | `(user_id, path text_pattern_ops)`         |
| `brainy_knowledge_attachments` | `idx_brainy_knowledge_attachments_knowledge` | `(knowledge_id)` |
| `brainy_captures` | `idx_brainy_captures_user_processed` | `(user_id, processed_at)` |
| `brainy_capture_media` | `idx_brainy_capture_media_capture` | `(capture_id)` |
| `brainy_job_runs` | `idx_brainy_job_runs_job_started` | `(job_id, started_at desc)` |
| `brainy_job_runs` | `idx_brainy_job_runs_user_started` | `(user_id, started_at desc)` |
| `brainy_job_runs` | `idx_brainy_job_runs_running` | `(user_id)` WHERE status='running' |
| `brainy_archive_entries` | `idx_brainy_archive_entries_user_month` | `(user_id, year_month)` |

## Triggers

All tables with `updated_at` use the `brainy_update_updated_at()` function to auto-set the timestamp on update.

## Storage

- **Bucket:** `brainy_files` (private)
- **RLS:** users can only read/write objects under their own `{uid}/` folder prefix.
