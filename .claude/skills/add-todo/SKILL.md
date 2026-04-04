# /add-todo

Add a new TODO from freeform text.

## Usage
`/add-todo <freeform text describing the TODO>`

## Instructions

1. Parse the freeform input to extract:
   - A `kebab-case` name (short, descriptive)
   - A one-line summary
   - Category (infer from context, default `uncategorized`)
   - Due date (if mentioned)

2. Ask the user clarifying questions using `AskUserQuestion`:
   - **Priority**: P0 (urgent), P1 (high), P2 (medium), P3 (low)
   - **Destination**: inbox, active, later, or scheduled?
   - If **scheduled**: ask for a date (YYYY-MM-DD) — when should this appear?
   - Only ask about due date or blocked_by if not already clear from the input.
   - Present sensible defaults based on what you inferred (put the best guess first).

3. Create the TODO via CLI:
   ```bash
   node lib/cli.js todo create --name "<name>" --summary "<summary>" --status <status> --priority <priority> --category <category>
   ```
   Add `--due <date>` if a due date was specified.
   Add `--scheduled-date <date>` if status is scheduled.

4. If the TODO needs notes or additional context from the input, update it:
   ```bash
   echo "<notes content>" | node lib/cli.js todo update <name> --field notes --stdin
   ```

5. Confirm what was created and suggest next actions (e.g., "Run `/breakdown todo-name` to decompose").

## Allowed Tools
Bash, AskUserQuestion
