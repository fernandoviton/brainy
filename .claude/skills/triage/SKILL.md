# /triage

Process inbox items one at a time using `/add-todo` logic.

## Usage
`/triage`

## Instructions

1. Fetch inbox items:
   ```bash
   node lib/cli.js todo list --status inbox --format json
   ```
   If the inbox is empty, tell the user and stop.

2. For each item in the inbox (top to bottom):
   a. Present the item to the user.
   b. Ask clarifying questions (same as `/add-todo` step 2): priority, destination, scheduled date if applicable, due date, blocked_by.
   c. Update the TODO to its new destination:
      ```bash
      node lib/cli.js todo update <name> --status <new-status> --priority <priority> --category <category>
      ```
      Add `--scheduled-date <date>` if moving to scheduled.
      Add `--due <date>` if a due date was specified.
      If it stays in inbox, leave it unchanged.

3. After all items are processed, show a short summary of what was filed where.

## Allowed Tools
Bash, AskUserQuestion
