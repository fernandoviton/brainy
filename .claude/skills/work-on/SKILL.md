# /work-on

Work on a specific TODO — the primary skill for making progress.

## Usage
`/work-on <todo-name> [optional user prompt]`

## Instructions

1. Fetch the TODO with full details:
   ```bash
   node lib/cli.js todo get <todo-name> --format json
   ```

2. If the TODO has collateral listed in the JSON output, review it for full context.

3. If the TODO is not already active, move it:
   ```bash
   node lib/cli.js todo update <todo-name> --status active
   ```

4. **Route Assessment** — Before diving in, classify the work and check fit:

   a. **Classify** the TODO into one category:
      - **knowledge-work** — Research, writing, synthesis. Brainy handles natively.
      - **planning** — Vague or multi-step, needs decomposition before execution.
      - **coding** — Writing/modifying code in a repo outside Brainy.
      - **external-action** — Requires the user to act in the real world.
      - **brainy-internal** — Changes to Brainy itself (skills, CLAUDE.md, structure).

   b. **Assess fit**: Can Brainy handle this well, partially, or not at all?

   c. **Check skill delegation**: Would an existing skill be a better starting point?
      - Planning + lacks clear steps → suggest `/breakdown` first
      - Vague/untriaged → ask clarifying questions

   d. **Check for skill gaps**: If no skill fits, note it and offer to create a TODO to build the missing skill.

   e. **Present assessment** to user with category, fit level, and recommendation. Wait for confirmation.
      - If user already provided a specific prompt, keep assessment brief/inline.

5. **Execute based on route**:
   - **knowledge-work / brainy-internal**: Do the work directly.
   - **planning**: Delegate to `/breakdown` if user approves.
   - **coding**: Note that this is a coding task and suggest handling it in a separate Claude Code session in the target repo. Optionally do prep work (research, context) if useful. TODO stays active until user returns with completion report.
   - **external-action**: Prepare supporting materials (drafts, checklists, research). Note what user needs to do. TODO stays active.
   - **skill gap**: Offer to create `build-skill-<name>` TODO, otherwise best-effort.

6. Update notes with progress:
   ```bash
   echo "<progress notes>" | node lib/cli.js todo update <todo-name> --field notes --stdin
   ```

7. **Evaluate completion**: After work is done, assess whether the TODO is fully complete.
   - **If complete**, archive it:
     1. Extract learnings → update knowledge via CLI and/or `CLAUDE.md`
     2. Archive the TODO:
        ```bash
        node lib/cli.js todo archive <todo-name> --summary-text "<completion summary>" --completion-date <YYYY-MM-DD>
        ```
   - **If not complete**: Update the TODO with current status and remaining work:
     ```bash
     echo "<updated notes>" | node lib/cli.js todo update <todo-name> --field notes --stdin
     ```

## Allowed Tools
Bash, Read, Edit, Write, Glob, Grep, WebSearch, WebFetch
