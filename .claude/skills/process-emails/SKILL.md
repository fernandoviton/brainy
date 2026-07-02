# /process-emails

Triage the user's recent Gmail inbox: convert a noisy inbox into TODOs and captured knowledge, and mark everything reviewed so it's never re-reviewed.

## Usage
`/process-emails`

## Goal

- **NOT to tag everything.** Labels are a working-set triage marker, not an attempt to classify the entire inbox.
- Surface the emails that need an **action** or contain **interesting durable knowledge**, and make sure nothing reviewed gets looked at twice.

## Label schema (binary — keep it to two)

Confirm IDs with `list_labels` before tagging.

| Label | ID (verify) | Meaning | Action on re-review |
|-------|-------------|---------|---------------------|
| `ai-todo` | `Label_21` | Live — a Brainy TODO tracks it. | Skip; status (active/later/scheduled) lives in the TODO. |
| `ai-done` | `Label_19` | Handled/resolved, OR reviewed with nothing to do. | Skip; don't look again. |

`ai-fyi` and `ai-tracking` are **deprecated** — do not use or recreate them. `ai-fyi` is redundant with `ai-done`; `ai-tracking` is redundant with `ai-todo` ("active vs waiting" is TODO *status*, not an email label).

## Instructions

### 1. Load Gmail tools
The Gmail MCP tools are deferred. Load them with ToolSearch:
```
select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__label_thread,mcp__claude_ai_Gmail__list_labels
```
Run `list_labels` once to confirm the `ai-todo` / `ai-done` label IDs.

### 2. Scope a recent window
Search the inbox for roughly the last month (`newer_than:30d`, or a shorter window if running frequently). Page through enough to see the real items. Don't try to process the full historical inbox.

### 3. Check existing TODOs first (avoid duplicates)
```bash
node backend/cli.js todo list --format json
```
Don't propose a TODO that duplicates one already open. Leave threads already tagged `ai-todo`/`ai-done` untouched.

### 4. Triage each thread that matters
The bulk is political fundraising, retail promos, and auto-receipts — that's noise. For each thread, decide:

- **Needs an action (now or later)?** → Create a Brainy TODO (use `/add-todo` logic) and label the thread **`ai-todo`**. Things merely being watched/awaited are just TODOs with status `later`/`scheduled` — still `ai-todo` on the email. If a follow-up only triggers conditionally on an existing TODO, fold it into that TODO's notes instead of spawning a new one.
- **Has interesting durable knowledge?** → Capture it into a **knowledge entry** via `node backend/cli.js knowledge upsert <path> --file <tmp-file>` (use `/capture` logic). **Knowledge goes in knowledge entries, NEVER in the email or a label.** The email is only the source.
- **Neither?** → Label it **`ai-done`** so it's not re-reviewed.

Apply labels with `label_thread` using the label IDs.

### 5. Report
Summarize concisely:
- **Labeled `ai-done`**: count + a sense of what (e.g. "11 promo/fundraising/receipt threads").
- **Action candidates → TODOs**: each with sender/subject, suggested action, thread ID, and whether it duplicates an existing TODO. Hold off on creating TODOs without the user's go-ahead unless they've asked you to run autonomously.
- **Knowledge candidates**: anything worth a durable entry, with proposed path. Be conservative — don't manufacture entries.

## Key principles

- **Every reviewed email is binary: open (`ai-todo`, a TODO exists) or closed (`ai-done`).**
- **Knowledge belongs in knowledge entries, never in email.** Labels mark triage state only.
- **TODO status, not labels, carries "active vs waiting."** Don't mirror TODO state onto the email.
- **Don't over-tag.** Only label what you actually reviewed in the window. The durable fix for recurring noise is unsubscribes + Gmail filters (see the `inbox-noise-cleanup` TODO), not labeling every promo.

## Allowed Tools
Bash, ToolSearch, AskUserQuestion, mcp__claude_ai_Gmail__search_threads, mcp__claude_ai_Gmail__get_thread, mcp__claude_ai_Gmail__label_thread, mcp__claude_ai_Gmail__list_labels
