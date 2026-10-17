-- Brainy Supabase Schema
-- Idempotent: safe to run multiple times

----------------------------------------------------------------------
-- Helper: auto-update updated_at
----------------------------------------------------------------------
create or replace function brainy_update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

----------------------------------------------------------------------
-- brainy_todos
----------------------------------------------------------------------
create table if not exists brainy_todos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  name text not null,
  summary text,
  status text not null default 'inbox'
    check (status in ('inbox', 'active', 'later', 'scheduled')),
  priority text default 'P2'
    check (priority in ('P0', 'P1', 'P2', 'P3')),
  category text default 'uncategorized',
  created_date date default current_date,
  due date,
  scheduled_date date,
  blocked_by text[] default '{}',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint unique_brainy_todo_name unique (user_id, name),
  constraint brainy_scheduled_needs_date
    check (status != 'scheduled' or scheduled_date is not null)
);

create index if not exists idx_brainy_todos_user_status on brainy_todos (user_id, status);
create index if not exists idx_brainy_todos_user_name on brainy_todos (user_id, name);
create index if not exists idx_brainy_todos_scheduled
  on brainy_todos (scheduled_date) where status = 'scheduled';

drop trigger if exists brainy_todos_updated_at on brainy_todos;
create trigger brainy_todos_updated_at
  before update on brainy_todos
  for each row execute function brainy_update_updated_at();

alter table brainy_todos enable row level security;

drop policy if exists "Users manage own brainy_todos" on brainy_todos;
create policy "Users manage own brainy_todos" on brainy_todos
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_todo_collateral
----------------------------------------------------------------------
create table if not exists brainy_todo_collateral (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  todo_id uuid references brainy_todos(id) on delete cascade not null,
  filename text not null,
  content_type text,
  text_content text,
  storage_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint unique_brainy_collateral unique (todo_id, filename),
  constraint brainy_has_content check (text_content is not null or storage_path is not null)
);

drop trigger if exists brainy_todo_collateral_updated_at on brainy_todo_collateral;
create trigger brainy_todo_collateral_updated_at
  before update on brainy_todo_collateral
  for each row execute function brainy_update_updated_at();

alter table brainy_todo_collateral enable row level security;

drop policy if exists "Users manage own brainy_todo_collateral" on brainy_todo_collateral;
create policy "Users manage own brainy_todo_collateral" on brainy_todo_collateral
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_knowledge
----------------------------------------------------------------------
create table if not exists brainy_knowledge (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  path text not null,
  topic text,
  summary text,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint unique_brainy_knowledge_path unique (user_id, path)
);

create index if not exists idx_brainy_knowledge_user_path
  on brainy_knowledge (user_id, path text_pattern_ops);

drop trigger if exists brainy_knowledge_updated_at on brainy_knowledge;
create trigger brainy_knowledge_updated_at
  before update on brainy_knowledge
  for each row execute function brainy_update_updated_at();

alter table brainy_knowledge enable row level security;

drop policy if exists "Users manage own brainy_knowledge" on brainy_knowledge;
create policy "Users manage own brainy_knowledge" on brainy_knowledge
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_knowledge_attachments
----------------------------------------------------------------------
create table if not exists brainy_knowledge_attachments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  knowledge_id uuid references brainy_knowledge(id) on delete cascade not null,
  path text not null,
  filename text not null,
  storage_path text not null,
  created_at timestamptz default now()
);

create index if not exists idx_brainy_knowledge_attachments_knowledge
  on brainy_knowledge_attachments (knowledge_id);

alter table brainy_knowledge_attachments enable row level security;

drop policy if exists "Users manage own brainy_knowledge_attachments" on brainy_knowledge_attachments;
create policy "Users manage own brainy_knowledge_attachments" on brainy_knowledge_attachments
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_archive_entries
----------------------------------------------------------------------
create table if not exists brainy_archive_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  todo_name text not null,
  completion_date date,
  year_month text not null,
  summary_text text,
  todo_snapshot jsonb,
  collateral_snapshot jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_brainy_archive_entries_user_month
  on brainy_archive_entries (user_id, year_month);

alter table brainy_archive_entries enable row level security;

drop policy if exists "Users manage own brainy_archive_entries" on brainy_archive_entries;
create policy "Users manage own brainy_archive_entries" on brainy_archive_entries
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_archive_summaries
----------------------------------------------------------------------
create table if not exists brainy_archive_summaries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  year_month text not null,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint unique_brainy_archive_summary unique (user_id, year_month)
);

drop trigger if exists brainy_archive_summaries_updated_at on brainy_archive_summaries;
create trigger brainy_archive_summaries_updated_at
  before update on brainy_archive_summaries
  for each row execute function brainy_update_updated_at();

alter table brainy_archive_summaries enable row level security;

drop policy if exists "Users manage own brainy_archive_summaries" on brainy_archive_summaries;
create policy "Users manage own brainy_archive_summaries" on brainy_archive_summaries
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_captures
----------------------------------------------------------------------
create table if not exists brainy_captures (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  text text,
  processed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_brainy_captures_user_processed
  on brainy_captures (user_id, processed_at);

alter table brainy_captures enable row level security;

drop policy if exists "Users manage own brainy_captures" on brainy_captures;
create policy "Users manage own brainy_captures" on brainy_captures
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_capture_media
----------------------------------------------------------------------
create table if not exists brainy_capture_media (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  capture_id uuid references brainy_captures(id) on delete cascade not null,
  filename text not null,
  content_type text,
  storage_path text not null,
  created_at timestamptz default now()
);

create index if not exists idx_brainy_capture_media_capture
  on brainy_capture_media (capture_id);

alter table brainy_capture_media enable row level security;

drop policy if exists "Users manage own brainy_capture_media" on brainy_capture_media;
create policy "Users manage own brainy_capture_media" on brainy_capture_media
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_scheduled_jobs  (see docs/scheduler-architecture.md)
----------------------------------------------------------------------
create table if not exists brainy_scheduled_jobs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  name text not null,
  description text,
  enabled boolean not null default true,
  kind text not null check (kind in ('command', 'agent')),
  command text,
  prompt text,
  workdir text,
  model text,
  permission_mode text
    check (permission_mode in ('default', 'acceptEdits', 'plan', 'bypassPermissions')),
  timeout_minutes integer not null default 30 check (timeout_minutes > 0),
  trigger text not null check (trigger in ('schedule', 'capacity')),
  cron text,
  window_hours integer not null default 24 check (window_hours between 1 and 168),
  max_weekly_pct integer not null default 80 check (max_weekly_pct between 1 and 100),
  max_session_pct integer not null default 50 check (max_session_pct between 1 and 100),
  runs_per_cycle integer not null default 1 check (runs_per_cycle > 0),
  priority text not null default 'P2' check (priority in ('P0', 'P1', 'P2', 'P3')),
  starvation_hours integer check (starvation_hours > 0),
  precheck text,
  allowed_tools text[],
  disallowed_tools text[],
  run_requested_at timestamptz,
  last_run_at timestamptz,
  last_finished_at timestamptz,
  last_status text,
  last_success_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint unique_brainy_job_name unique (user_id, name),
  constraint brainy_job_has_payload check (
    (kind = 'command' and command is not null) or (kind = 'agent' and prompt is not null)
  ),
  constraint brainy_job_schedule_needs_cron check (trigger != 'schedule' or cron is not null)
);

drop trigger if exists brainy_scheduled_jobs_updated_at on brainy_scheduled_jobs;
create trigger brainy_scheduled_jobs_updated_at
  before update on brainy_scheduled_jobs
  for each row execute function brainy_update_updated_at();

alter table brainy_scheduled_jobs enable row level security;

drop policy if exists "Users manage own brainy_scheduled_jobs" on brainy_scheduled_jobs;
create policy "Users manage own brainy_scheduled_jobs" on brainy_scheduled_jobs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_job_runs
----------------------------------------------------------------------
create table if not exists brainy_job_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  job_id uuid references brainy_scheduled_jobs(id) on delete cascade not null,
  job_name text not null,
  reason text not null check (reason in ('schedule', 'capacity', 'requested')),
  status text not null
    check (status in ('running', 'succeeded', 'failed', 'timed_out', 'abandoned')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  exit_code integer,
  output_tail text,
  host text,
  pid integer,
  usage_before jsonb,
  usage_after jsonb,
  report text,
  transcript_path text,
  permission_denials jsonb,
  created_at timestamptz default now()
);

-- Columns added after the first release of the tables above (idempotent).
alter table brainy_scheduled_jobs add column if not exists precheck text;
alter table brainy_scheduled_jobs add column if not exists allowed_tools text[];
alter table brainy_scheduled_jobs add column if not exists disallowed_tools text[];
alter table brainy_job_runs add column if not exists report text;
alter table brainy_job_runs add column if not exists transcript_path text;
alter table brainy_job_runs add column if not exists permission_denials jsonb;

create index if not exists idx_brainy_job_runs_job_started
  on brainy_job_runs (job_id, started_at desc);
create index if not exists idx_brainy_job_runs_user_started
  on brainy_job_runs (user_id, started_at desc);
create index if not exists idx_brainy_job_runs_running
  on brainy_job_runs (user_id) where status = 'running';

alter table brainy_job_runs enable row level security;

drop policy if exists "Users manage own brainy_job_runs" on brainy_job_runs;
create policy "Users manage own brainy_job_runs" on brainy_job_runs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_run_events  (audit trail: every CLI write made during a job run)
----------------------------------------------------------------------
create table if not exists brainy_run_events (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  run_id uuid references brainy_job_runs(id) on delete cascade not null,
  job_name text,
  action text not null,
  target_type text not null,
  target text,
  detail text,
  created_at timestamptz default now()
);

create index if not exists idx_brainy_run_events_run on brainy_run_events (run_id);

alter table brainy_run_events enable row level security;

drop policy if exists "Users manage own brainy_run_events" on brainy_run_events;
create policy "Users manage own brainy_run_events" on brainy_run_events
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- brainy_scheduler_state  (one row per user, written every tick)
----------------------------------------------------------------------
create table if not exists brainy_scheduler_state (
  user_id uuid references auth.users(id) primary key,
  last_tick_at timestamptz,
  host text,
  usage jsonb,
  usage_error text,
  waiting jsonb,
  starved jsonb,
  updated_at timestamptz default now()
);

drop trigger if exists brainy_scheduler_state_updated_at on brainy_scheduler_state;
create trigger brainy_scheduler_state_updated_at
  before update on brainy_scheduler_state
  for each row execute function brainy_update_updated_at();

alter table brainy_scheduler_state enable row level security;

drop policy if exists "Users manage own brainy_scheduler_state" on brainy_scheduler_state;
create policy "Users manage own brainy_scheduler_state" on brainy_scheduler_state
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

----------------------------------------------------------------------
-- Storage bucket for binary files
----------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('brainy_files', 'brainy_files', false)
  on conflict (id) do nothing;

drop policy if exists "Users manage own brainy_files" on storage.objects;
create policy "Users manage own brainy_files" on storage.objects
  for all using (
    bucket_id = 'brainy_files'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'brainy_files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
