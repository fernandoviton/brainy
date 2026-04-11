# Future Ideas

## When updating notes it should always be additive.
Had a problem where I told it an update and it erased all the previous notes.  Supabase is not good for versioning.  We should make sure the cli only allows updating new rows.  When archiving is the only time it can delete (and then it rewrites everything).  Ie notes about a todo should be a ledger.  Another approach is to prompt and make sure it always reads what is there and updates but I feel that is too fragile.

## Get files for TODO and anythign else
**`todo collateral <name>` CLI command** — Generate signed download URLs for TODO collateral files, similar to `capture media`. The storage_path and `createSignedMediaUrls` infra already exist; just needs wiring in `cli.js`.  Need to also do for knowledge.  Anythign else?

## SQL-Powered Review
Use priority/due-date sorting and filtering directly in SQL for `/review` and `/focus`. Replace in-memory scoring with database queries.

## Full-Text Search on Knowledge
Add `tsvector` column to `knowledge` table for full-text search. Enable queries like "find all knowledge mentioning Docker networking" without scanning every record.

## Automated Scheduled Promotion
Replace the session-start hook with `pg_cron` or a Supabase Edge Function that promotes scheduled TODOs daily — works even when no CLI session is active.

## Cross-Device Access
With Supabase as the backend, Brainy can work from any machine with the CLI and `.env` credentials. Consider a lightweight web UI or mobile client for quick captures on the go.

## Binary Collateral in Supabase Storage
Store PDFs, images, and other binary collateral in the `brainy_files` Storage bucket instead of the filesystem. The `todo_collateral` and `knowledge_attachments` tables already support `storage_path`.

## Isolate Brainy into Its Own Supabase Project

**Problem:** Brainy shares a Supabase project with other apps. Since all apps authenticate as the same user (same `auth.uid()`), and RLS policies gate on uid alone, any app's credentials can read/write/delete data belonging to any other app in the project. Supabase RLS cannot distinguish *which app* is making a request — only *which user*. This means a compromised or buggy app could affect Brainy's data, and vice versa.

**Why not per-app RLS or DB roles?**
- Adding an `app_id` column to RLS policies doesn't help — the app self-reports its identity, so nothing prevents a client from claiming to be a different app.
- Custom Postgres roles per app aren't usable through Supabase's PostgREST API, which uses fixed `anon`/`authenticated` roles.

**Plan:** Migrate Brainy to its own Supabase project (free tier allows 2 projects). Keep the other project for everything else. If a second app ever needs isolation, upgrade to Pro for more projects.

**Steps:**
1. Create a new Supabase project for Brainy
2. Run `sql/setup.sql` against the new project
3. Migrate existing data (export/import brainy_* tables and storage bucket)
4. Update `.env` with new project URL, publishable key, and refresh token
5. Drop brainy_* tables and RLS policies from the old project
