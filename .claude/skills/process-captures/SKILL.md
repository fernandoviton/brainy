# /process-captures

Process unprocessed captures: convert PDFs to Markdown, then collaboratively route content to TODOs and knowledge.

## Instructions

### 0. Convert PDFs

```bash
node tools/convert-capture-pdfs.js
```

Run this first to batch-convert any unconverted PDF media to Markdown across all unprocessed captures.

### 1. List unprocessed captures

```bash
node backend/cli.js capture list --format json
```

If none, tell the user and stop.

### 2. For each capture

#### a. Show contents

```bash
node backend/cli.js capture get <id> --format json
```

Display the capture text and list media filenames.

#### b. Fetch media URLs if needed

```bash
node backend/cli.js capture media <id> --format json
```

Read any `.pdf.md` or text media to understand the full content. **Never read PDF files directly** — PDFs were already converted in step 0.

#### c. Mark processed

```bash
node backend/cli.js capture process <id>
```

Marks the capture as processed.

#### d. Route collaboratively

Based on the capture content, suggest:
- **Knowledge entries** to create/update (use `/capture` logic)
- **TODOs** to create

Present suggestions and let the user decide. Use the CLI to execute approved actions.

### 3. Continue

Move to the next unprocessed capture. After all are processed, summarize what was done.

## Autonomous mode (scheduled job)

When this skill runs as the `capture-processing` scheduled job (the prompt says "autonomous mode"; `BRAINY_RUN_ID` is set), nobody is there to approve suggestions. The job only starts when `capture pending` finds work. For each unprocessed capture, oldest first:

1. **Read it all.** Run `capture get <id> --format json`, then `node tools/fetch-capture-media.js <id>`, and Read each downloaded file (images and `.pdf.md` included).
   - If step 0's PDF conversion failed, or an original PDF still has no `.pdf.md`, **don't** read the PDF. Leave that capture unprocessed and say why in the report.
2. **Check what exists** before creating anything, so you update rather than duplicate: run `todo list --all --format json`, and `knowledge list` for knowledge.
3. **Route it yourself:**
   - **Knowledge** → `knowledge upsert` (use `/capture` logic for paths and summaries).
   - **Action** → create a TODO, or add to an existing one with `todo update <name> --field notes --append --file tmp/<name>.md` (just the new part). Anything you can't decide goes in a `## Open questions` section of the TODO's notes. Don't guess at priorities or dates you weren't given; leave the defaults and ask in the open questions.
   - **Coding work another agent could do** (a change to a repo, a script, a fix) → create the TODO with a summary that starts with `[agent-ready]`. Its notes get a `## Agent brief`: repo, goal, relevant context from the capture, acceptance criteria, and open questions. The user starts these as coding sessions from chat; don't attempt the code yourself.
   - Write notes and knowledge with the Write tool to `tmp/<name>.md` and pass `--file`. Never use `--stdin`.
4. **Mark it processed last** (`capture process <id>`), after routing succeeded, so a failed run leaves the capture to retry.
5. **Clean up** `tmp/captures/<id>/` and your `tmp/*.md` files.

**Your final message is the run report** the user reads on the Activity page and in their session digest:
- One summary line, e.g. "3 captures: 2 TODOs created, 1 updated, 1 knowledge entry, 1 agent-ready brief".
- Then, for each capture: a short quote of what it said → what you did, with the TODO and knowledge names.
- Then any open questions you parked, and any captures left unprocessed, with the reason.

## Allowed Tools
Bash, AskUserQuestion
