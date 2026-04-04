---
name: review-plan
description: Iteratively review a plan using a reviewer subagent. Auto-applies critical feedback, asks user about medium/low-priority items.
argument-hint: "[max-iterations] [plan-file-path]"
disable-model-invocation: true
---

# Review Plan Skill

Iteratively review a plan file by spawning a `plan-reviewer` agent, parsing its structured feedback by priority, auto-applying critical fixes, and consulting the user on lower-priority items.

## Argument Parsing

Parse `$ARGUMENTS`:
- If `$ARGUMENTS[0]` is a number, use it as max iterations. Otherwise default to 5.
- If `$ARGUMENTS[0]` is not a number, treat it as the plan file path.
- If `$ARGUMENTS[1]` exists, use it as the plan file path.
- If no plan file path is provided, find the most recently modified `.md` file in `~/.claude/plans/` using Bash: `ls -t ~/.claude/plans/*.md | head -1`

Store the resolved values:
- `MAX_ITERATIONS` (default: 5)
- `PLAN_PATH` (resolved absolute path to the plan file)

Read the plan file to confirm it exists and display its name to the user.

## Orchestration Loop

Repeat for up to `MAX_ITERATIONS` iterations:

### Step 1: Spawn Reviewer

Use the Agent tool to spawn a `plan-reviewer` agent with this prompt:

```
Review the plan at: {PLAN_PATH}
This is review iteration {N} of {MAX_ITERATIONS}.
Read the plan file, verify all referenced source files and APIs against the codebase, and provide structured feedback.
```

### Step 2: Parse Feedback

Parse the agent's response for feedback blocks between `### FEEDBACK_START` and `### FEEDBACK_END` markers.

If the response contains `NO_ISSUES_FOUND`, exit the loop early.

Sort feedback items into three buckets: HIGH, MED, LOW.

### Step 3: Route by Priority

**HIGH items** — auto-apply each one:
- Use the Edit tool to apply the suggested fix to the plan file
- Announce to the user: what was changed and why (one line per item)

**MED items** — auto-apply each one:
- Use the Edit tool to apply the suggested fix to the plan file
- Announce to the user: what was changed and why (one line per item)

**LOW items** — save for after the loop exits. Do NOT present or apply them during the loop.

### Step 4: Continue or Exit

- If there were no HIGH or MED items in this iteration, exit the loop
- Otherwise, continue to the next iteration (the updated plan will be re-reviewed)

## After Loop Exits

When the loop ends (either max iterations reached or no HIGH/MED feedback remains):

1. If there are accumulated LOW items from the final iteration, present them to the user via AskUserQuestion:
   - List each LOW item with its summary and suggested fix
   - Ask which ones (if any) the user wants applied

2. Apply any LOW items the user approves via Edit

3. Show a summary:
   - Total iterations run
   - Items auto-applied (HIGH + MED count), each with a one-line description of what was changed and why
   - Items user-approved (LOW count applied), each with a one-line description of what was changed and why
   - Items skipped (LOW count not applied), each with a one-line description of what was skipped
