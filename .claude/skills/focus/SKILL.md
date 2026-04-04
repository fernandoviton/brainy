# /focus

Recommend the single most important thing to work on right now.

## Usage
`/focus`

## Instructions

1. Fetch all TODOs with metadata:
   ```bash
   node lib/cli.js todo list --format json
   ```

2. Filter to active + inbox + items scheduled for today.

3. Filter out **blocked** items (those with non-empty `blocked_by` where the blocker still exists).

4. Score remaining items by:
   - **Priority** (P0 > P1 > P2 > P3)
   - **Due date** (sooner = higher urgency)

5. Recommend the **single next thing** to work on. Present:
   - The TODO name and summary
   - Why it's the top pick (priority, urgency)
   - Suggest: "Run `/work-on <todo-name>` to get started"

## Allowed Tools
Bash
