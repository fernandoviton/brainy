#!/usr/bin/env node
/**
 * Brainy CLI — unified interface for both file and Supabase backends.
 * Run with "help" or "<resource> help" for usage details.
 */
const { getStorage } = require('./storage');
const captureService = require('./capture-service');

const HELP = {
  main: `Usage: node backend/cli.js <resource> [action] [options]

Resources:
  todo                 Manage TODOs (CRUD, archive, collateral)
  capture              Manage captures (list, get, media, process)
  knowledge            Manage knowledge entries (list, get, upsert)
  check-integrity      Run data integrity checks
  promote-scheduled    Promote scheduled TODOs whose date has arrived

Run "node backend/cli.js <resource> help" for details on each resource.
All commands support --format json for machine-readable output.`,

  todo: `Usage: node backend/cli.js todo <action> [options]

Actions:
  list [--status <status>] [--all]                 List active TODOs (default); --all for all statuses, --status to filter
  get <name>                                       Get full TODO details (notes, collateral)
  create --name <n> --summary <s> [--status <s>]   Create a new TODO
           [--priority <p>] [--category <c>]
           [--due <date>] [--scheduled-date <date>]
  update <name> [--summary <s>] [--status <s>]     Update TODO fields
           [--priority <p>] [--category <c>]
           [--due <d>] [--scheduled-date <d>]
           [--blocked-by <name>]
           [--field notes --stdin]                  Pipe notes content via stdin
  delete <name>                                    Delete a TODO
  archive <name> [--summary-text <t>]              Archive a completed TODO
           [--completion-date <d>]
  collateral list <name>                           List collateral files
  collateral add <name> <filepath>                 Attach a file
  collateral remove <name> <filename>              Remove an attachment
  collateral get <name> <filename>                 Get collateral content

Statuses: inbox, active, later, scheduled
Priorities: P0 (urgent), P1 (high), P2 (medium), P3 (low)`,

  capture: `Usage: node backend/cli.js capture <action> [options]

Actions:
  list [--all]          List unprocessed captures (--all includes processed)
  get <id>              Get capture details including media
  media <capture_id>    Get signed download URLs for media (1hr expiry)
  process <id>          Mark a capture as processed`,

  knowledge: `Usage: node backend/cli.js knowledge <action> [options]

Actions:
  list [--prefix <path>]       List knowledge entries, optionally filtered by path prefix
  get <path>                   Get knowledge content
  upsert <path> --stdin        Create or update knowledge (content via stdin)
           [--topic <t>] [--summary <s>]`,
};

function showHelp(resource) {
  console.log(HELP[resource] || HELP.main);
}

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
        const mediaCount = item.media?.length ? ` [${item.media.length} file${item.media.length !== 1 ? 's' : ''}]` : '';
        console.log(`- [${short}] ${text} [${status}]${mediaCount} ${item.created_at}`);
      } else if (item.path) {
        console.log(`  ${item.path}`);
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
      if (data.collateral?.length) {
        const names = data.collateral.map((c) => typeof c === 'string' ? c : c.filename);
        console.log(`Collateral: ${names.join(', ')}`);
      }
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
    if (!resource || resource === 'help') {
      showHelp('main');
      return;
    }

    if (resource === 'todo') {
      if (!action || action === 'help') { showHelp('todo'); return; }
      if (action === 'list') {
        const status = args.status || (args.all ? undefined : 'active');
        const result = await storage.listTodos(status);
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
      } else if (action === 'collateral') {
        const [subAction, ...subRest] = rest;
        if (subAction === 'list') {
          const name = subRest[0];
          if (!name) { console.error('Usage: todo collateral list <name>'); process.exit(1); }
          const result = await storage.listCollateral(name);
          if (format === 'json') {
            output(result, format);
          } else {
            for (const c of result) {
              console.log(`- ${c.filename} (${c.content_type}) [${c.is_text ? 'text' : 'binary'}]`);
            }
          }
        } else if (subAction === 'add') {
          const name = subRest[0];
          const filepath = subRest[1];
          if (!name || !filepath) { console.error('Usage: todo collateral add <name> <filepath>'); process.exit(1); }
          const result = await storage.addCollateral(name, filepath);
          console.log(`Added: ${result.filename} (${result.content_type}) [${result.is_text ? 'text' : 'binary'}]`);
        } else if (subAction === 'remove') {
          const name = subRest[0];
          const filename = subRest[1];
          if (!name || !filename) { console.error('Usage: todo collateral remove <name> <filename>'); process.exit(1); }
          const result = await storage.removeCollateral(name, filename);
          console.log(`Removed: ${result.filename}`);
        } else if (subAction === 'get') {
          const name = subRest[0];
          const filename = subRest[1];
          if (!name || !filename) { console.error('Usage: todo collateral get <name> <filename>'); process.exit(1); }
          const result = await storage.getCollateral(name, filename);
          if (format === 'json') {
            output(result, format);
          } else if (result.text_content !== undefined) {
            console.log(result.text_content);
          } else {
            console.log(`${result.filename} (${result.content_type}): ${result.url}`);
          }
        } else {
          console.error(`Unknown collateral action: ${subAction}`);
          process.exit(1);
        }
      } else if (action === 'archive') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo archive <name>'); process.exit(1); }
        const result = await storage.archiveTodo(name, {
          summaryText: args.summaryText,
          completionDate: args.completionDate,
        });
        console.log(`Archived: ${result.name} -> ${result.year_month}`);
      } else {
        console.error(`Unknown todo action: ${action}\n`);
        showHelp('todo');
        process.exit(1);
      }
    } else if (resource === 'capture') {
      if (!action || action === 'help') { showHelp('capture'); return; }
      if (action === 'list') {
        const all = args.all || undefined;
        const result = await captureService.listCapturesWithMedia(all);
        output(result, format);
      } else if (action === 'get') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture get <id>'); process.exit(1); }
        const result = await captureService.getCapture(id);
        if (!result) { console.error(`Capture '${id}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'media') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture media <capture_id>'); process.exit(1); }
        const result = await captureService.getCaptureMediaUrls(id);
        if (result === null) { console.error(`Capture '${id}' not found`); process.exit(1); }
        if (!result.length) { console.log('No media attached to this capture.'); return; }
        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const m of result) {
            console.log(`${m.filename} (${m.content_type}): ${m.url}`);
          }
        }
      } else if (action === 'process') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture process <id>'); process.exit(1); }
        const result = await captureService.processCapture(id);
        console.log(`Processed: ${result.id}`);
      } else {
        console.error(`Unknown capture action: ${action}\n`);
        showHelp('capture');
        process.exit(1);
      }
    } else if (resource === 'knowledge') {
      if (!action || action === 'help') { showHelp('knowledge'); return; }
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
        const upsertPath = rest[0] || args.path;
        if (!upsertPath) { console.error('Usage: knowledge upsert <path> --stdin'); process.exit(1); }
        const content = args.stdin ? await readStdin() : '';
        const result = await storage.upsertKnowledge({
          path: upsertPath,
          content,
          topic: args.topic,
          summary: args.summary,
        });
        console.log(`Upserted: ${result.path}`);
      } else {
        console.error(`Unknown knowledge action: ${action}\n`);
        showHelp('knowledge');
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
      console.error(`Unknown resource: ${resource}\n`);
      showHelp('main');
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
