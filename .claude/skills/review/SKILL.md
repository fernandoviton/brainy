# /review

Review all TODOs and suggest actions.

## Usage
`/review`

## Instructions

1. Fetch all TODOs with full metadata:
   ```bash
   node lib/cli.js todo list --format json
   ```

2. For any TODOs that need more detail (notes, collateral), fetch individually:
   ```bash
   node lib/cli.js todo get <name> --format json
   ```

3. Generate a review report covering:
   - **Inbox**: Items needing triage (suggest moving to active or later)
   - **Scheduled**: Upcoming items (next 7 days highlighted)
   - **Overdue**: Items past their due date
   - **Upcoming**: Items due soon (within 7 days)
   - **Blocked**: Items that are blocked and what's blocking them
   - **Status summary**: Counts by status and priority

4. Suggest reprioritization where appropriate. Offer to move items between inbox/active/later using:
   ```bash
   node lib/cli.js todo update <name> --status <new-status>
   ```

5. **Proactive proposals**: For each TODO, evaluate whether the agent can make independent progress right now. For actionable ones:
   - Present details and ask the user:
     1. Should the agent work on it now? (launches `/work-on`)
     2. Or write this down as a potential next action on the TODO?

6. Do NOT trigger archiving or completion — that happens via `/work-on`.

## Allowed Tools
Bash, Read
