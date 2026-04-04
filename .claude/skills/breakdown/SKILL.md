# /breakdown

Decompose a TODO into actionable sub-TODOs.

## Usage
`/breakdown <todo-name>`

## Instructions

1. Fetch the TODO with full details:
   ```bash
   node backend/cli.js todo get <todo-name> --format json
   ```

2. Analyze what's needed to complete it. Consider:
   - What are the distinct steps or deliverables?
   - What has dependencies on what?
   - What can be done in parallel?

3. **Present the breakdown to the user for review.** Format as:
   ```
   ## Breakdown: <name>

   1. **sub-todo-name** — Description (P2, blocked by: none)
   2. **another-sub-todo** — Description (P2, blocked by: sub-todo-name)
   ...
   ```

4. **Wait for user approval before making any changes.**

5. After approval, create each sub-TODO via CLI:
   ```bash
   node backend/cli.js todo create --name "<sub-todo-name>" --summary "<description>" --status inbox
   ```
   If a sub-TODO has dependencies, update it:
   ```bash
   node backend/cli.js todo update <sub-todo-name> --blocked-by <parent-name>
   ```

6. Update the parent TODO's notes with the breakdown:
   ```bash
   echo "<breakdown notes>" | node backend/cli.js todo update <todo-name> --field notes --stdin
   ```

## Allowed Tools
Bash, AskUserQuestion
