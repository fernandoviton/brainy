# Future Ideas

Potential enhancements for Brainy.

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
