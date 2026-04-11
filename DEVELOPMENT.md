# Brainy — Development Guide

Reference for modifying Brainy's own codebase (backend, CLI, tests, schema).

## Development Practice

- **TDD first**: Write or update tests before writing the fix/feature. Verify the test fails without the change, then implement the change and confirm the test passes.

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
