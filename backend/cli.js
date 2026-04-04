#!/usr/bin/env node
/**
 * Brainy CLI — unified interface for both file and Supabase backends.
 *
 * Usage:
 *   node backend/cli.js todo list [--status <status>] [--format json]
 *   node backend/cli.js todo get <name> [--format json]
 *   node backend/cli.js todo create --name <name> --summary <summary> [--status <s>] [--priority <p>] [--category <c>] [--due <d>] [--scheduled-date <d>]
 *   node backend/cli.js todo update <name> [--summary <s>] [--status <s>] [--priority <p>] [--category <c>] [--due <d>] [--scheduled-date <d>] [--field notes --stdin]
 *   node backend/cli.js todo delete <name>
 *   node backend/cli.js todo archive <name> [--summary-text <text>] [--completion-date <d>]
 *   node backend/cli.js capture list [--all] [--format json]
 *   node backend/cli.js capture get <id> [--format json]
 *   node backend/cli.js capture process <id>
 *   node backend/cli.js knowledge list [--prefix <prefix>] [--format json]
 *   node backend/cli.js knowledge get <path> [--format json]
 *   node backend/cli.js knowledge upsert --path <path> --stdin
 *   node backend/cli.js check-integrity
 *   node backend/cli.js promote-scheduled
 */
const { getStorage } = require('./storage');

function parseArgs(argv) {
  const args = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      positional.push(argv[i]);
      i += 1;
    }
  }
  return { args, positional };
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));

    // If stdin is a TTY (no pipe), resolve immediately with empty string
    if (process.stdin.isTTY) resolve('');
  });
}

function output(data, format) {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (item.name && item.summary) {
        console.log(`- **${item.name}** — ${item.summary} [${item.status}] ${item.priority || ''}`);
      } else if (item.id && item.text !== undefined) {
        const short = item.id.substring(0, 8);
        const text = (item.text || '').length > 80 ? item.text.substring(0, 80) + '...' : (item.text || '(empty)');
        const status = item.processed_at ? 'processed' : 'unprocessed';
        console.log(`- [${short}] ${text} [${status}] ${item.created_at}`);
      } else if (item.path) {
        console.log(`  ${item.path} (${item.format})`);
      } else {
        console.log(JSON.stringify(item));
      }
    }
  } else if (data && typeof data === 'object') {
    if (data.name && data.notes !== undefined) {
      // Full TODO view
      console.log(`# ${data.name}`);
      console.log(`Status: ${data.status} | Priority: ${data.priority} | Category: ${data.category}`);
      if (data.due) console.log(`Due: ${data.due}`);
      if (data.scheduled_date) console.log(`Scheduled: ${data.scheduled_date}`);
      if (data.blocked_by?.length) console.log(`Blocked by: ${data.blocked_by.join(', ')}`);
      if (data.collateral?.length) console.log(`Collateral: ${data.collateral.join(', ')}`);
      if (data.notes) console.log(`\n${data.notes}`);
    } else if (data.id && data.text !== undefined) {
      // Capture detail view
      console.log(`ID: ${data.id}`);
      console.log(`Text: ${data.text || '(empty)'}`);
      console.log(`Status: ${data.processed_at ? 'processed' : 'unprocessed'}`);
      if (data.processed_at) console.log(`Processed at: ${data.processed_at}`);
      console.log(`Created: ${data.created_at}`);
      if (data.media?.length) {
        console.log(`Media: ${data.media.map((m) => m.filename).join(', ')}`);
      }
    } else if (data.content !== undefined) {
      // Knowledge view
      console.log(data.content);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else {
    console.log(data);
  }
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2));
  const [resource, action, ...rest] = positional;
  const storage = getStorage();
  const format = args.format;

  try {
    if (resource === 'todo') {
      if (action === 'list') {
        const result = await storage.listTodos(args.status || undefined);
        output(result, format);
      } else if (action === 'get') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo get <name>'); process.exit(1); }
        const result = await storage.getTodo(name);
        if (!result) { console.error(`TODO '${name}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'create') {
        const result = await storage.createTodo({
          name: args.name,
          summary: args.summary || '',
          status: args.status,
          priority: args.priority,
          category: args.category,
          due: args.due,
          scheduled_date: args.scheduledDate,
          blocked_by: args.blockedBy,
        });
        console.log(`Created: ${result.name} [${result.status}]`);
      } else if (action === 'update') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo update <name> [--field value]'); process.exit(1); }
        const changes = {};
        if (args.summary !== undefined) changes.summary = args.summary;
        if (args.status) changes.status = args.status;
        if (args.priority) changes.priority = args.priority;
        if (args.category) changes.category = args.category;
        if (args.due !== undefined) changes.due = args.due || null;
        if (args.scheduledDate !== undefined) changes.scheduled_date = args.scheduledDate || null;
        if (args.blockedBy !== undefined) changes.blocked_by = args.blockedBy || null;
        if (args.field === 'notes' && args.stdin) {
          changes.notes = await readStdin();
        }
        const result = await storage.updateTodo(name, changes);
        console.log(`Updated: ${result.name} [${result.status}]`);
      } else if (action === 'delete') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo delete <name>'); process.exit(1); }
        await storage.deleteTodo(name);
        console.log(`Deleted: ${name}`);
      } else if (action === 'archive') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo archive <name>'); process.exit(1); }
        const result = await storage.archiveTodo(name, {
          summaryText: args.summaryText,
          completionDate: args.completionDate,
        });
        console.log(`Archived: ${result.name} -> ${result.year_month}`);
      } else {
        console.error(`Unknown todo action: ${action}`);
        process.exit(1);
      }
    } else if (resource === 'capture') {
      if (action === 'list') {
        const all = args.all || undefined;
        const result = await storage.listCaptures(all);
        output(result, format);
      } else if (action === 'get') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture get <id>'); process.exit(1); }
        const result = await storage.getCapture(id);
        if (!result) { console.error(`Capture '${id}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'process') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture process <id>'); process.exit(1); }
        const result = await storage.processCapture(id);
        console.log(`Processed: ${result.id}`);
      } else {
        console.error(`Unknown capture action: ${action}`);
        process.exit(1);
      }
    } else if (resource === 'knowledge') {
      if (action === 'list') {
        const result = await storage.listKnowledge(args.prefix || undefined);
        output(result, format);
      } else if (action === 'get') {
        const kPath = rest[0] || args.path;
        if (!kPath) { console.error('Usage: knowledge get <path>'); process.exit(1); }
        const result = await storage.getKnowledge(kPath);
        if (!result) { console.error(`Knowledge '${kPath}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'upsert') {
        if (!args.path) { console.error('Usage: knowledge upsert --path <path> --stdin'); process.exit(1); }
        const content = args.stdin ? await readStdin() : '';
        const result = await storage.upsertKnowledge({
          path: args.path,
          content,
          topic: args.topic,
          format: args.format,
        });
        console.log(`Upserted: ${result.path}`);
      } else {
        console.error(`Unknown knowledge action: ${action}`);
        process.exit(1);
      }
    } else if (resource === 'check-integrity') {
      const result = await storage.checkIntegrity();
      if (result.ok) {
        console.log('Integrity check passed.');
      } else {
        console.log('Integrity check failed:');
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
        process.exit(2);
      }
    } else if (resource === 'promote-scheduled') {
      const promoted = await storage.promoteScheduled();
      if (promoted.length === 0) {
        console.log('No scheduled items to promote.');
      } else {
        console.log(`Promoted ${promoted.length} item(s): ${promoted.join(', ')}`);
      }
    } else {
      console.error('Usage: node backend/cli.js <todo|capture|knowledge|check-integrity|promote-scheduled> ...');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
if (require.main === module) {
  main();
}
