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
select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__label_thread,mcp__claude_ai_Gmail__unlabel_thread,mcp__claude_ai_Gmail__list_labels
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

**First, split the window by sender type. This split governs everything below.**

- **Human-sent** — a real person typed it or chose to send it: family, friends, neighbors, colleagues, contractors, your kid's school advisor writing individually. **A forward counts as human-sent even when the forwarded content is a bulk newsletter** — the person's choice to send it to *you* is the signal, and that signal is not in the content.
- **Machine-sent** — bulk or automated: promos, PAC blasts, receipts, shipping notices, statements, alerts, portal notifications, all-campus/all-staff announcements that arrived directly from the list.

Machine-sent mail may be triaged in bulk. **Human-sent mail may not.** Judge each human-sent thread on its own and report it by name (see step 5), whichever label it ends up with. Never let a human-sent thread ride along in a batch of machine mail.

Then, for each thread, decide:

- **Needs an action (now or later)?** → Create a Brainy TODO (use `/add-todo` logic) and label the thread **`ai-todo`**. Things merely being watched/awaited are just TODOs with status `later`/`scheduled` — still `ai-todo` on the email. If a follow-up only triggers conditionally on an existing TODO, fold it into that TODO's notes instead of spawning a new one.
- **Has interesting durable knowledge?** → Capture it into a **knowledge entry** via `node backend/cli.js knowledge upsert <path> --file <tmp-file>` (use `/capture` logic). **Knowledge goes in knowledge entries, NEVER in the email or a label.** The email is only the source.
- **A reservation reminder from Resy, OpenTable, Tock or a similar booking platform?** ("Confirm you're coming", "let the restaurant know", reminder of an upcoming booking.) Label it `ai-done` and create no TODO. The platform also texts the user, who confirms there. Only create a TODO if the email asks for something the text can't cover, such as a deposit or a form, or if the restaurant cancelled or changed the booking.
- **A one-off invoice for a repair or service visit?** (A contractor, often sent through ServiceTitan or similar.) This is a record worth keeping:
  - Add the job (date, what was done, amount, tech) to the contractor's **History** in `contractors/<name>.md`. Create the entry if there isn't one. Link a related `home/...` entry if one exists.
  - **Clearly paid** (paid stamp, zero balance) → label `ai-done`.
  - **Not clearly paid** (a balance or due date, or you can't tell) → create a TODO to check whether it's paid, and label the thread `ai-todo`. The invoice often gets paid on the spot as part of the job, but a TODO the user closes in a glance beats a missed bill.
- **Neither?** → Label it **`ai-done`** so it's not re-reviewed. If it was human-sent, it still gets named individually in the report (step 5).

Apply labels with `label_thread` using the label IDs. If you mislabel something, `unlabel_thread` removes it.

### 5. Report
Summarize concisely:
- **Labeled `ai-done` — machine-sent**: count + a sense of what (e.g. "11 promo/fundraising/receipt threads"). Category summaries are fine here, but every category you closed must appear; don't leave a thread covered by no category at all.
- **Labeled `ai-done` — human-sent**: **list every one individually** — sender, subject, and the one-line reason it's closed. No exceptions, no bundling, no "and a few personal threads." If this list is long, it is still a list.
- **Action candidates → TODOs**: each with sender/subject, suggested action, thread ID, and whether it duplicates an existing TODO. Hold off on creating TODOs without the user's go-ahead unless they've asked you to run autonomously.
- **Knowledge candidates**: anything worth a durable entry, with proposed path. Be conservative — don't manufacture entries.

**Self-check before sending the report:** re-scan the threads you labeled `ai-done` and confirm that each human-sent one is named somewhere in the report. A human-sent thread the user cannot find in your report is a thread you closed behind their back — that is the failure this step exists to prevent.

## Autonomous mode (scheduled job)

When this skill runs as the `email-triage` scheduled job (the prompt says "autonomous mode"; `BRAINY_RUN_ID` is set), nobody is there to answer questions. Steps 1–5 still apply, with these changes:

- **Tools.** You can only read Gmail and add or remove labels. Send, reply, draft, forward, trash, spam and label-management tools are removed. Never try to work around that, and never "unsubscribe" by any route.
- **Window.** Search `in:inbox newer_than:3d -label:ai-done -label:ai-todo`. Runs are daily, and the overlap catches anything a failed run missed.
- **Don't ask; decide.**
  - **Dealt with, or no action needed** → label `ai-done`.
  - **Needs the user** → create the TODO yourself (status `inbox`, or `active` if it's time-sensitive). Put a `## Open questions` section in its notes with whatever you can't decide: should they reply, which option, by when. Then label the thread `ai-todo`.
  - If an open TODO already covers the thread, add to that TODO's notes instead of creating a duplicate. Use `todo update <name> --field notes --append --file tmp/<name>.md` with just the new part.
  - Write notes with the Write tool to `tmp/<name>.md` and pass `--file`. Never use `--stdin`.
- **Log every label you apply, in batches.** Each CLI call signs in to Supabase, so one call per thread trips its rate limit, and a subject containing `$` gets the whole command denied. So don't log thread by thread. After each page of labels, write the events with the Write tool to `tmp/email-events.json` as a JSON array:
  ```json
  [{"action": "label ai-done", "type": "email", "target": "<sender>: <subject>", "detail": "<human|machine>; <one-line reason>"}]
  ```
  then log them all in **one** call: `node backend/cli.js job log-event --file tmp/email-events.json`. Use the real subject, which you have from `search_threads`.
  The CLI audits TODO and knowledge writes automatically, but it can't see Gmail, so these events are the only reliable record of what you closed.
  Log an event only **after** its `label_thread` call has succeeded. Never log in the same batch as the label call, because a failed label would then leave a false record.
- **Your final message is the run report** the user reads on the Activity page and in their session digest. Use the step 5 structure, in markdown, starting with a one-line summary (e.g. "Reviewed 23 threads: 2 TODOs, 19 closed, 2 knowledge entries"). The human-sent list is mandatory, and the self-check still applies.
- **If labeling fails with an auth or scope error** (`Insufficient scope`), stop: one failure is enough. That means the Gmail connector can't modify mail. Create no further TODOs, because without the `ai-todo` label the next run would see the same threads again. Report the error as the first line, along with the TODOs already created.
- **When unsure, open a TODO rather than closing the thread.** A wrongly-opened TODO costs a glance. A wrongly-closed human email costs a missed person.

## Key principles

- **Mail from a person is never "noise."** It can still be closed — but only after judging it individually and naming it in the report. Unactionable content is not the same as an unimportant email: when someone chooses to send you a bulk newsletter, the *choice* is the content, and only the user can read it. Surface it and let them.
- **Every reviewed email is binary: open (`ai-todo`, a TODO exists) or closed (`ai-done`).**
- **Knowledge belongs in knowledge entries, never in email.** Labels mark triage state only.
- **TODO status, not labels, carries "active vs waiting."** Don't mirror TODO state onto the email.
- **Don't over-tag.** Only label what you actually reviewed in the window. The durable fix for recurring noise is unsubscribes + Gmail filters (see the `inbox-noise-cleanup` TODO), not labeling every promo.

## Allowed Tools
Bash, ToolSearch, AskUserQuestion, mcp__claude_ai_Gmail__search_threads, mcp__claude_ai_Gmail__get_thread, mcp__claude_ai_Gmail__label_thread, mcp__claude_ai_Gmail__unlabel_thread, mcp__claude_ai_Gmail__list_labels
