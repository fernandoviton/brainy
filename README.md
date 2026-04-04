# Brainy — Your Second Brain

A lightweight personal knowledge and TODO management system designed to work with Claude/AI assistants.

## What is Brainy?

Brainy helps you:
- **Track TODOs** across inbox, active, later, and scheduled lists
- **Capture knowledge** in an organized database
- **Archive completed work** with learnings and context

All data lives in Supabase (PostgreSQL + Storage) — no local files, works across devices.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [Supabase](https://supabase.com/) project

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database schema

Open the Supabase SQL Editor for your project and run the contents of `sql/setup.sql`. This creates all tables, RLS policies, indexes, and a storage bucket.

### 3. Enable Google Auth

In the Supabase dashboard:

1. Go to **Authentication > Providers > Google**
2. Enable Google and configure your OAuth credentials
3. Add `http://localhost:3000/auth/callback` to **Redirect URLs** (under Authentication > URL Configuration)

### 4. Configure environment

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from your Supabase project settings (Settings > API).

### 5. Authenticate

Run the one-time Google login flow:

```bash
node scripts/google-login.js
```

This opens your browser for Google sign-in, then prints a `SUPABASE_REFRESH_TOKEN`. Add it to your `.env` file.

### 6. Verify

```bash
node scripts/smoke-test.js
```

This tests auth, CRUD operations on the `brainy_todos` table, and RLS isolation.

## CLI Usage

### TODOs

```bash
# List all TODOs
node backend/cli.js todo list

# List by status (inbox, active, later, scheduled)
node backend/cli.js todo list --status active

# JSON output (for scripting)
node backend/cli.js todo list --format json

# Get full details on a TODO (notes, collateral, metadata)
node backend/cli.js todo get <name>

# Create a TODO
node backend/cli.js todo create --name "my-task" --summary "Do the thing" --status inbox --priority P2

# Update fields
node backend/cli.js todo update my-task --status active --priority P1

# Update notes via stdin
echo "Made progress on X" | node backend/cli.js todo update my-task --field notes --stdin

# Archive a completed TODO
node backend/cli.js todo archive my-task --summary-text "Done, learned Y"

# Delete a TODO
node backend/cli.js todo delete my-task
```

### Knowledge

```bash
# List all knowledge files
node backend/cli.js knowledge list

# Filter by path prefix
node backend/cli.js knowledge list --prefix "tools/"

# Read a knowledge file
node backend/cli.js knowledge get tools/docker/networking.yml

# Create or update a knowledge file
echo "topic: my-topic" | node backend/cli.js knowledge upsert --path "category/my-topic.yml" --stdin
```

### Maintenance

```bash
# Run integrity checks (same as the post-session hook)
node backend/cli.js check-integrity

# Promote scheduled items dated today or earlier to active
node backend/cli.js promote-scheduled
```

## AI Commands

Use these slash commands when working with Claude:

- `/add-todo <description>` — Create a new TODO with proper structure
- `/triage` — Process all items in inbox
- `/work-on <task> [details]` — Make progress, complete, or start work on a task
- `/review` — Review all open tasks
- `/focus` — Get recommended next task to work on
- `/breakdown <task>` — Decompose a TODO into sub-tasks
- `/capture <info>` — Capture knowledge into the database

## Hooks

Brainy includes Claude Code hooks (in `.claude/hooks/`) that run automatically:
- **SessionStart**: Promotes scheduled TODOs that are due
- **Stop**: Runs integrity checks after each session

> **Note:** Hooks use `.bat` files (Windows). On other platforms, you'll need to adapt them or replace with equivalent shell scripts.

## Schema

See `sql/SCHEMA.md` for the full database entity-relationship diagram and table descriptions.
