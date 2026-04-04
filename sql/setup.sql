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
  has_folder boolean default false,
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
  format text check (format in ('yaml', 'markdown')),
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
  notes_snapshot text,
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
