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

## Allowed Tools
Bash, AskUserQuestion
