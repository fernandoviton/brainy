# /capture

Capture information into the structured knowledge base.

## Usage
`/capture <freeform text, links, ideas, learnings>`

## Instructions

### 1. Analyze the input

Determine:
- What **topic** does this relate to? (e.g., "Docker networking", "Python dataclasses")
- What **category tree** does it belong in? (e.g., `tools/docker/`, `programming/python/`)
- What are the **structured facts** vs **contextual notes**?
- Does it imply any **TODOs**?

### 2. Route to the right file

Knowledge is stored in a Supabase database, organized by path (e.g., `tools/docker/networking.md`, `programming/python/dataclasses.md`).

**To find or create the right file:**

1. List existing knowledge files:
   ```bash
   node backend/cli.js knowledge list --format json
   ```
2. If a file for this topic already exists → **fetch and update it** (see step 3)
3. If not → **create it** with an appropriate category path

**Organization guidelines** (soft limits, not hard enforcement):
- ~20 entries max per file → consider splitting into subtopics
- ~15 files max per category prefix → introduce subcategories
- Use consistent category names across captures

### 3. Write/update the knowledge file

To read existing content:
```bash
node backend/cli.js knowledge get <path> --format json
```

To write/update:
```bash
echo "<full markdown content>" | node backend/cli.js knowledge upsert "<category/topic-name.md>" --topic "<topic>" --summary "<one-line summary>" --stdin
```

Every knowledge file is a markdown document. `--topic` and `--summary` are CLI flags — the only source of truth for those fields (do not write `topic:` / `summary:` preambles into the body). Example body:

```markdown
## Configuration

| | |
|---|---|
| Default driver | bridge |
| CLI flag | `--network` |

## Notes

**2026-02-15** — Bridge mode is the default network driver.
```

**Rules:**
- Always pass `--topic` and `--summary` flags
- Use tables, lists, and prose — not fenced yaml blocks
- Append a new dated entry under `## Notes` when updating rather than editing prior entries

**When updating an existing file:**
- Update structured fields if the input provides newer/better values
- Append a new entry to `notes` with today's date
- Do NOT remove existing notes

### 4. Suggest TODOs

If the input implies action items:
- Present them: "This suggests the following TODOs: ..."
- Offer to create them via CLI:
  ```bash
  node backend/cli.js todo create --name "<name>" --summary "<summary>" --status inbox
  ```

### 5. Confirm

Tell the user:
- What was captured
- Where it was stored (knowledge path)
- Any TODOs suggested

## Allowed Tools
Bash, AskUserQuestion
