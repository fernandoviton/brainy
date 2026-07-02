# Brainy — Development Guide

Reference for modifying Brainy's own codebase (backend, CLI, tests, schema).

## Setup

```bash
npm install
python -m venv tools/.venv && tools/.venv/Scripts/pip install -r tools/requirements.txt
```

## Development Practice

- **TDD first**: Write or update tests before writing the fix/feature. Verify the test fails without the change, then implement the change and confirm the test passes.

## Standalone scripts

| Script | Purpose |
|--------|---------|
| `node tools/convert-capture-pdfs.js` | Batch-convert all unconverted PDF capture media to Markdown (`.pdf.md`) via `marker-pdf`. Run before processing captures. |

## Running the frontend locally

The `frontend/` directory is a **static site** — no build step and no backend server. Everything (Supabase auth, browse pages, deep linking) runs client-side. `frontend/config.local.js` (gitignored) holds the Supabase URL + publishable key that the pages read at load; each `index.html` loads `config.local.js` before `config.js`.

To test working-tree changes, serve `frontend/` over HTTP (opening the files as `file://` breaks the relative `../../config.local.js` script paths and Supabase auth):

```bash
cd frontend && python -m http.server 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080/` (browse pages under `/browse/todos/`, `/browse/captures/`, `/browse/knowledge/`). It serves working-tree files directly, so edits show up on a browser refresh — no restart needed.

Deep linking: each browse page reads a query param and auto-opens the matching item — `?todo=<name>`, `?capture=<id>`, `?knowledge=<path>`.

`scripts/inject-config.js` bakes `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` env vars into `config.js` for hosted deploys; not needed locally when `config.local.js` is present.

## Project layout

- `backend/storage-supabase.js` — all Supabase CRUD. Every public function is exported from `module.exports` at the bottom. This is the only file that talks to Supabase.
- `backend/cli.js` — CLI routing and output formatting. Commands dispatch under `resource === 'todo'` / `'capture'` / `'knowledge'` branches. Argument parsing converts `--kebab-case` flags to camelCase.
- `backend/capture-service.js` — thin orchestration layer over storage for captures (e.g., joining media to captures). Follow this pattern if a CLI command needs to compose multiple storage calls.
- `sql/setup.sql` — canonical schema. Idempotent, safe to re-run.

## Test patterns

- Framework: **Jest**. Run with `npm test`.
- CLI tests mock `backend/storage` via `jest.mock` and use a `runCLI(args)` harness that captures stdout/stderr and intercepts `process.exit`. See `test/cli-captures.test.js` for the reference pattern — copy that structure for new CLI test files.
- Storage-layer tests mock `backend/supabase-client` using the chain builder in `test/helpers/mock-supabase.js`. See `test/storage-captures.test.js`.
- The mock storage object in CLI tests must list every function exported by `storage-supabase.js` (even if unused in that test file) because `getStorage()` returns the whole object.
