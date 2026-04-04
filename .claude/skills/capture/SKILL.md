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

Knowledge is stored in a Supabase database, organized by path (e.g., `tools/docker/networking.yml`, `programming/python/dataclasses.yml`).

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
echo "<full YAML content>" | node backend/cli.js knowledge upsert --path "<category/topic-name.yml>" --stdin
```

Every knowledge file uses this schema:

```yaml
topic: docker-networking
summary: Docker container networking modes and configuration

# Structured fields — extracted from input when present
# Field names are flexible per domain, but use consistent names
# across similar items. Common examples:
#   model, brand, location, url, cost
#   replacement_interval, last_replaced, last_serviced
#   installed, expires, account_number
# Use YYYY-MM-DD for dates, human-readable strings for intervals.

notes:
  - date: 2026-02-15
    content: "Bridge mode is the default network driver."
```

**Rules:**
- `topic` and `summary` are always present
- Other top-level fields are **structured and script-parseable** — add them when the input contains concrete facts (model numbers, dates, intervals, etc.)
- Use **consistent field names** across similar items (e.g., all replaceable items get `replacement_interval` + `last_replaced`)
- `notes` is an **append-only log** for context that doesn't fit structured fields

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
