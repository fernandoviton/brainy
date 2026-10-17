# /proactive-review

End-of-week proactive pass: review the whole TODO list, move parked items forward with research, and propose what the user should do next. This is meant for spare capacity: it runs as the `proactive-review` capacity job near the end of the weekly usage cycle, but it also works interactively.

## Goal

Produce **signal the user can judge**. Every finding should be specific, sourced, and tied to a TODO. A short report with three useful things beats a long one with twenty generic ones. If the reports turn out to be high-signal, this job gets promoted to run more often, so quality matters more than volume.

## Instructions

### 1. Load the state
```bash
node backend/cli.js todo list --all --format json
node backend/cli.js knowledge list
```
Use `todo get <name> --format json` for the notes of anything you act on.

### 2. Review (report only: change nothing)
Look for:
- **Overdue** (`due` in the past) and **due within 7 days**.
- **Stale**: `active` items that look stuck (no obvious next step in the notes), and `inbox` items never triaged.
- **Blocked**: what's blocking them, and whether the blocker is itself moving.
- **Connections**: TODOs that should be merged, sequenced (`blocked_by`), or done together. For example, two errands in the same place.

Suggest status, priority and blocking changes **in the report**. Don't apply them.

### 3. Research (at most 3 TODOs per run)
Pick up to three `later`/`active` TODOs where web research would move them forward, such as comparisons, prices, availability, "how do I", or season or schedule lookups. Prefer ones with a clear question in the summary or notes. For each:
- Research with WebSearch/WebFetch. Cite sources with URLs, and note when they were published or checked.
- **Append** a section to the TODO's notes. Never replace or reword what's already there. Write **only the new section** with the Write tool to `tmp/<name>.md`, then run `todo update <name> --field notes --append --file tmp/<name>.md`. The CLI adds it to the end, so you never re-send the existing notes. The new section looks like this:
  ```
  ## Research (agent, YYYY-MM-DD)
  - finding — source URL
  **Suggested next step:** ...
  **Open questions:** ...
  ```
- If the research shows the TODO is really coding work another agent could do, also give it an `## Agent brief` (repo, goal, context, acceptance criteria) and prefix its summary with `[agent-ready]`.

Durable facts that outlive the TODO (e.g. "how X works") go into a knowledge entry instead (`/capture` logic), linked from the TODO's notes.

### 4. Report: your final message
This is what the user reads on the Activity page and in their session digest. Structure:
1. **Top 3**: the three things most worth the user's attention this week, one line each, each naming its TODO.
2. **Research done**: per TODO, the key finding and the suggested next step.
3. **Review**: overdue / due soon / stale / blocked / connections. Only the sections that have something.
4. **Suggested changes** you did *not* apply (status, priority, merges).

Clean up your `tmp/*.md` files at the end.

## Rules
- Change TODOs only by appending research or briefs to their notes. No status, priority, delete, or archive changes.
- Never contact anyone or buy, book, or sign up for anything.
- If nothing is worth reporting, say so in one line. Don't pad the report.

## Allowed Tools
Bash, Read, Write, WebSearch, WebFetch
